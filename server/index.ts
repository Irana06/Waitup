import './env.ts';
import express, { type Request } from 'express';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import type { Account, ClientToServer, FriendEntry, Media, ServerToClient } from '../shared/protocol.ts';
import { SESSION_COOKIE, clearedCookie, readCookie, sessionCookie, verifyGoogleCredential } from './auth.ts';
import {
  acceptFriend, acceptedFriendIds, createSession, deleteSession, friendLinks, removeFriend, requestFriend,
  upsertGoogleUser, userByFriendCode, userBySession, type User,
} from './db.ts';
import {
  addMember, cancelHostRequest, clearMedia, createRoom, ended, getRoom, giveHost, hold, listRooms, pause, play,
  release, removeMember, requestHost, respondHostRequest, restoreRooms, say, seek, serializeRooms, setDuration,
  setMedia, setMode, setOffline, snapshot, sweepEmptyRooms, system, type Room,
} from './rooms.ts';

const PORT = Number(process.env.PORT ?? 3001);
/** Set HOST=127.0.0.1 behind a reverse proxy so the app is only reachable through it. */
const HOST = process.env.HOST ?? '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const ROOMS_FILE = process.env.WAITUP_ROOMS ?? path.resolve('data/rooms.json');

/** How long a dropped member keeps their place (refresh, phone screen off, flaky network). */
const RECONNECT_GRACE_MS = 90_000;
/** After a server restart everyone needs a moment to come back. */
const RESTART_GRACE_MS = 3 * 60_000;

const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: isProd ? undefined : { origin: true, credentials: true },
});

app.use(express.json({ limit: '16kb' }));

const clean = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;

const account = (u: User): Account => ({ id: u.id, name: u.name, email: u.email, picture: u.picture, friendCode: u.friendCode });

// ---------- Room persistence ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function saveRoomsNow(): void {
  clearTimeout(saveTimer);
  try {
    mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
    writeFileSync(`${ROOMS_FILE}.tmp`, JSON.stringify(serializeRooms()));
    renameSync(`${ROOMS_FILE}.tmp`, ROOMS_FILE);
  } catch (e) {
    console.error('Gagal menyimpan room:', e);
  }
}

function saveRoomsSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveRoomsNow, 1000);
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    saveRoomsNow();
    process.exit(0);
  });
}

// ---------- Presence ----------

/** Open sockets per browser tab id, and per signed-in user. */
const tabSockets = new Map<string, number>();
const userSockets = new Map<string, number>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

const bump = (map: Map<string, number>, key: string, by: number) => {
  const n = (map.get(key) ?? 0) + by;
  if (n <= 0) map.delete(key);
  else map.set(key, n);
  return Math.max(0, n);
};

function friendRoomOf(userId: string): FriendEntry['room'] {
  for (const r of listRooms()) {
    for (const m of r.members.values()) {
      if (m.userId === userId && m.online) {
        const people = [...r.members.values()].filter((x) => x.online).length;
        return { code: r.code, hosting: r.hostId === m.id, title: r.media?.title ?? null, people };
      }
    }
  }
  return null;
}

function notifyFriends(userId: string | undefined): void {
  if (!userId) return;
  for (const f of acceptedFriendIds(userId)) io.to(`u:${f}`).emit('friends:changed');
}

function notifyRoomFriends(room: Room): void {
  for (const m of room.members.values()) notifyFriends(m.userId);
}

function broadcast(room: Room): void {
  io.to(room.code).emit('room:state', snapshot(room));
  saveRoomsSoon();
}

function scheduleRemoval(room: Room, memberId: string, delay: number): void {
  const key = `${room.code}:${memberId}`;
  clearTimeout(removalTimers.get(key));
  removalTimers.set(
    key,
    setTimeout(() => {
      removalTimers.delete(key);
      const m = room.members.get(memberId);
      if (!m || m.online) return;
      removeMember(room, memberId);
      broadcast(room);
      notifyFriends(m.userId);
    }, delay),
  );
}

function cancelRemoval(room: Room, memberId: string): void {
  const key = `${room.code}:${memberId}`;
  clearTimeout(removalTimers.get(key));
  removalTimers.delete(key);
}

// Bring back rooms from before a restart; members get a few minutes to reconnect.
try {
  const restored = restoreRooms(JSON.parse(readFileSync(ROOMS_FILE, 'utf8')));
  for (const r of restored) for (const id of r.members.keys()) scheduleRemoval(r, id, RESTART_GRACE_MS);
  if (restored.length) console.log(`Memulihkan ${restored.length} room`);
} catch {
  /* first start, or no saved rooms */
}

// ---------- HTTP API: config, Google sign-in, friends ----------

function userOf(req: Request): User | null {
  return userBySession(readCookie(req.headers.cookie, SESSION_COOKIE));
}

app.get('/api/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

app.get('/api/me', (req, res) => {
  const u = userOf(req);
  res.json(u ? account(u) : null);
});

app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Login Google belum disetel di server.' });
  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  try {
    const profile = await verifyGoogleCredential(credential, GOOGLE_CLIENT_ID);
    const user = upsertGoogleUser(profile);
    const { token, maxAgeSec } = createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, maxAgeSec, isProd));
    res.json(account(user));
  } catch {
    res.status(401).json({ error: 'Login Google gagal diverifikasi. Coba lagi.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (token) deleteSession(token);
  res.setHeader('Set-Cookie', clearedCookie(isProd));
  res.json({ ok: true });
});

app.get('/api/friends', (req, res) => {
  const u = userOf(req);
  if (!u) return res.status(401).json({ error: 'Masuk dulu buat lihat teman.' });
  const friends: FriendEntry[] = friendLinks(u.id).map(({ user, status }) => {
    const online = status === 'accepted' && (userSockets.get(user.id) ?? 0) > 0;
    return { id: user.id, name: user.name, picture: user.picture, status, online, room: online ? friendRoomOf(user.id) : null };
  });
  res.json({ friends });
});

app.post('/api/friends', (req, res) => {
  const u = userOf(req);
  if (!u) return res.status(401).json({ error: 'Masuk dulu buat nambah teman.' });
  const code = clean(req.body?.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const other = code.length === 8 ? userByFriendCode(`${code.slice(0, 4)}-${code.slice(4)}`) : null;
  if (!other) return res.status(404).json({ error: 'Kode teman itu nggak ketemu.' });
  if (other.id === u.id) return res.status(400).json({ error: 'Itu kode teman kamu sendiri.' });
  const result = requestFriend(u.id, other.id);
  io.to(`u:${other.id}`).emit('friends:changed');
  res.json({ result, name: other.name });
});

app.post('/api/friends/:id/accept', (req, res) => {
  const u = userOf(req);
  if (!u) return res.status(401).json({ error: 'Masuk dulu.' });
  if (!acceptFriend(u.id, req.params.id)) return res.status(404).json({ error: 'Permintaan pertemanan nggak ketemu.' });
  io.to(`u:${req.params.id}`).emit('friends:changed');
  res.json({ ok: true });
});

app.delete('/api/friends/:id', (req, res) => {
  const u = userOf(req);
  if (!u) return res.status(401).json({ error: 'Masuk dulu.' });
  removeFriend(u.id, req.params.id);
  io.to(`u:${req.params.id}`).emit('friends:changed');
  res.json({ ok: true });
});

if (isProd) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get(/^\/(?!socket\.io|api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- Rooms over Socket.IO ----------

function validMedia(media: unknown, publisherId: string): Media | null {
  if (!media || typeof media !== 'object') return null;
  const m = media as Record<string, unknown>;
  const title = clean(m.title, 120) || 'Video';
  if (m.kind === 'stream' && (m.source === 'file' || m.source === 'tab')) {
    return { kind: 'stream', source: m.source, title, publisherId };
  }
  if (m.kind === 'youtube' && typeof m.videoId === 'string' && /^[\w-]{6,20}$/.test(m.videoId)) {
    return { kind: 'youtube', videoId: m.videoId, title };
  }
  if (m.kind === 'url' && typeof m.url === 'string') {
    try {
      const u = new URL(m.url);
      if (u.protocol === 'https:' || u.protocol === 'http:') return { kind: 'url', url: u.toString(), title };
    } catch {
      return null;
    }
  }
  return null;
}

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
  // The tab id survives refreshes (sessionStorage), so a reload lands back in the same seat.
  const rawId = socket.handshake.auth?.clientId;
  const me = typeof rawId === 'string' && /^[\w-]{8,64}$/.test(rawId) ? rawId : socket.id;
  const user = userBySession(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
  let room: Room | null = null;

  socket.join(`c:${me}`);
  bump(tabSockets, me, 1);
  if (user) {
    socket.join(`u:${user.id}`);
    if (bump(userSockets, user.id, 1) === 1) notifyFriends(user.id);
  }

  const leaveRoom = () => {
    if (!room) return;
    const r = room;
    room = null;
    socket.leave(r.code);
    cancelRemoval(r, me);
    removeMember(r, me);
    broadcast(r);
    notifyFriends(user?.id);
  };

  const enter = (r: Room, name: string, device: string) => {
    if (room && room !== r) leaveRoom();
    room = r;
    socket.join(r.code);
    cancelRemoval(r, me);
    addMember(r, {
      id: me,
      name: clean(name, 24) || user?.name.slice(0, 24) || 'Tamu',
      device: clean(device, 24) || 'Perangkat',
      online: true,
      userId: user?.id,
      picture: user?.picture ?? undefined,
      buffering: false,
      position: 0,
      reportedAt: Date.now(),
      joinedAt: Date.now(),
    });
    broadcast(r);
    notifyFriends(user?.id);
  };

  socket.on('time:ping', (cb) => {
    if (typeof cb === 'function') cb(Date.now());
  });

  socket.on('room:create', (p, cb) => {
    const r = createRoom();
    enter(r, p?.name, p?.device);
    cb({ ok: true, data: { code: r.code, you: me } });
  });

  socket.on('room:join', (p, cb) => {
    const r = getRoom(clean(p?.code, 6));
    if (!r) {
      cb({ ok: false, error: 'Room dengan kode itu nggak ketemu, mungkin udah ditutup.' });
      return;
    }
    enter(r, p?.name, p?.device);
    cb({ ok: true, data: { code: r.code, you: me } });
  });

  socket.on('room:leave', leaveRoom);

  socket.on('disconnect', () => {
    bump(tabSockets, me, -1);
    if (user && bump(userSockets, user.id, -1) === 0) notifyFriends(user.id);
    if (!room || (tabSockets.get(me) ?? 0) > 0) return;
    // Keep the seat warm: a refresh or a locked phone should not cost the host role.
    setOffline(room, me);
    scheduleRemoval(room, me, RECONNECT_GRACE_MS);
    broadcast(room);
    notifyFriends(user?.id);
  });

  const by = () => (room ? room.members.get(me)?.name ?? 'Seseorang' : '');

  socket.on('media:set', (p, cb) => {
    if (!room) return cb({ ok: false, error: 'Kamu belum ada di room.' });
    if (room.hostId !== me) return cb({ ok: false, error: 'Cuma host yang bisa ganti video.' });
    const media = validMedia(p?.media, me);
    if (!media) return cb({ ok: false, error: 'Link ini belum bisa diputar.' });
    setMedia(room, media, by() || 'Host');
    broadcast(room);
    notifyRoomFriends(room);
    cb({ ok: true, data: undefined });
  });

  socket.on('media:clear', () => {
    if (!room || room.media?.kind !== 'stream' || room.media.publisherId !== me) return;
    const what = room.media.source === 'tab' ? 'share tab' : 'stream file';
    clearMedia(room);
    system(room, `${by()} berhenti ${what}`);
    broadcast(room);
    notifyRoomFriends(room);
  });

  socket.on('media:duration', (p) => {
    const d = finite(p?.duration);
    if (!room?.media || !d || room.duration !== null) return;
    setDuration(room, d);
    broadcast(room);
  });

  // Signalling is only relayed between members of the same room.
  socket.on('rtc:signal', (p) => {
    if (!room || typeof p?.to !== 'string' || !room.members.has(p.to) || !p.data) return;
    io.to(`c:${p.to}`).emit('rtc:signal', { from: me, data: p.data });
  });

  socket.on('control:play', () => {
    if (!room?.media) return;
    const restart = ended(room);
    if (room.playback.playing && !restart) return;
    play(room);
    system(room, restart ? `${by()} muter lagi dari awal` : `${by()} lanjut play di ${clock(room.playback.position)}`);
    broadcast(room);
  });

  socket.on('control:pause', () => {
    if (!room?.media || !room.playback.playing) return;
    pause(room);
    system(room, `${by()} nge-pause di ${clock(room.playback.position)}`);
    broadcast(room);
  });

  socket.on('control:seek', (p) => {
    const pos = finite(p?.position);
    if (!room?.media || pos === null) return;
    seek(room, pos);
    system(room, `${by()} loncat ke ${clock(pos)}`);
    broadcast(room);
  });

  socket.on('host:request', () => {
    if (!room) return;
    requestHost(room, me);
    broadcast(room);
  });

  socket.on('host:cancel', () => {
    if (!room) return;
    cancelHostRequest(room, me);
    broadcast(room);
  });

  socket.on('host:respond', (p) => {
    if (!room || typeof p?.accept !== 'boolean') return;
    respondHostRequest(room, me, p.accept);
    broadcast(room);
    notifyRoomFriends(room);
  });

  socket.on('host:give', (p) => {
    if (!room || typeof p?.to !== 'string') return;
    giveHost(room, me, p.to);
    broadcast(room);
    notifyRoomFriends(room);
  });

  socket.on('mode:set', (p) => {
    if (!room || room.hostId !== me) return;
    if (p?.mode !== 'wait' && p?.mode !== 'catch') return;
    setMode(room, p.mode);
    broadcast(room);
  });

  const report = (p: { position: number } | undefined) => {
    const m = room?.members.get(me);
    const pos = finite(p?.position);
    if (!m || pos === null) return;
    m.position = pos;
    m.reportedAt = Date.now();
  };

  socket.on('status:buffering', (p) => {
    if (!room) return;
    report(p);
    hold(room, me);
    broadcast(room);
  });

  socket.on('status:ready', (p) => {
    if (!room) return;
    report(p);
    release(room, me);
    broadcast(room);
  });

  socket.on('status:position', (p) => {
    if (!room) return;
    report(p);
    broadcast(room);
  });

  socket.on('chat:send', (p) => {
    if (!room) return;
    const text = clean(p?.text, 500);
    if (!text) return;
    say(room, by(), text);
    broadcast(room);
  });
});

setInterval(sweepEmptyRooms, 60_000);

http.listen(PORT, HOST, () => {
  console.log(`Waitup server di http://${HOST}:${PORT}${isProd ? '' : ' (dev, buka http://localhost:5173)'}`);
  if (!GOOGLE_CLIENT_ID) console.log('GOOGLE_CLIENT_ID belum diisi: login Google dimatikan, mode tamu tetap jalan.');
});
