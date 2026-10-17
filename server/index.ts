import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import type { ClientToServer, Media, ServerToClient } from '../shared/protocol.ts';
import {
  addMember, clearMedia, createRoom, ended, getRoom, hold, pause, play, release, removeMember, say, seek,
  setDuration, setMedia, setMode, snapshot, sweepEmptyRooms, system, type Room,
} from './rooms.ts';

const PORT = Number(process.env.PORT ?? 3001);
/** Set HOST=127.0.0.1 behind a reverse proxy so the app is only reachable through it. */
const HOST = process.env.HOST ?? '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: isProd ? undefined : { origin: true },
});

if (isProd) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const clean = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;

function broadcast(room: Room): void {
  io.to(room.code).emit('room:state', snapshot(room));
}

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

io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
  let room: Room | null = null;

  const leave = () => {
    if (!room) return;
    const r = room;
    room = null;
    socket.leave(r.code);
    removeMember(r, socket.id);
    broadcast(r);
  };

  const enter = (r: Room, name: string, device: string) => {
    leave();
    room = r;
    socket.join(r.code);
    addMember(r, {
      id: socket.id,
      name: clean(name, 24) || 'Tamu',
      device: clean(device, 24) || 'Perangkat',
      buffering: false,
      position: 0,
      reportedAt: Date.now(),
      joinedAt: Date.now(),
    });
    broadcast(r);
  };

  socket.on('time:ping', (cb) => {
    if (typeof cb === 'function') cb(Date.now());
  });

  socket.on('room:create', (p, cb) => {
    const r = createRoom();
    enter(r, p?.name, p?.device);
    cb({ ok: true, data: { code: r.code, you: socket.id } });
  });

  socket.on('room:join', (p, cb) => {
    const code = clean(p?.code, 6);
    const r = getRoom(code);
    if (!r) {
      cb({ ok: false, error: 'Room dengan kode itu nggak ketemu. Cek lagi kodenya.' });
      return;
    }
    enter(r, p?.name, p?.device);
    cb({ ok: true, data: { code: r.code, you: socket.id } });
  });

  socket.on('room:leave', leave);
  socket.on('disconnect', leave);

  socket.on('media:set', (p, cb) => {
    if (!room) return cb({ ok: false, error: 'Kamu belum ada di room.' });
    if (room.hostId !== socket.id) return cb({ ok: false, error: 'Cuma host yang bisa ganti video.' });
    const media = validMedia(p?.media, socket.id);
    if (!media) return cb({ ok: false, error: 'Link ini belum bisa diputar.' });
    setMedia(room, media, room.members.get(socket.id)?.name ?? 'Host');
    broadcast(room);
    cb({ ok: true, data: undefined });
  });

  const by = () => (room ? room.members.get(socket.id)?.name ?? 'Seseorang' : '');

  const clock = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  socket.on('control:play', () => {
    if (!room?.media) return;
    const restart = ended(room);
    if (room.playback.playing && !restart) return;
    play(room);
    system(room, restart ? `${by()} muter lagi dari awal` : `${by()} lanjut play di ${clock(room.playback.position)}`);
    broadcast(room);
  });

  socket.on('media:clear', () => {
    if (!room || room.media?.kind !== 'stream' || room.media.publisherId !== socket.id) return;
    const what = room.media.source === 'tab' ? 'share tab' : 'stream file';
    clearMedia(room);
    system(room, `${by()} berhenti ${what}`);
    broadcast(room);
  });

  // Signalling is only relayed between members of the same room.
  socket.on('rtc:signal', (p) => {
    if (!room || typeof p?.to !== 'string' || !room.members.has(p.to) || !p.data) return;
    io.to(p.to).emit('rtc:signal', { from: socket.id, data: p.data });
  });

  socket.on('media:duration', (p) => {
    const d = finite(p?.duration);
    if (!room?.media || !d || room.duration !== null) return;
    setDuration(room, d);
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

  socket.on('mode:set', (p) => {
    if (!room || room.hostId !== socket.id) return;
    if (p?.mode !== 'wait' && p?.mode !== 'catch') return;
    setMode(room, p.mode);
    broadcast(room);
  });

  const report = (p: { position: number } | undefined) => {
    const m = room?.members.get(socket.id);
    const pos = finite(p?.position);
    if (!m || pos === null) return;
    m.position = pos;
    m.reportedAt = Date.now();
  };

  socket.on('status:buffering', (p) => {
    if (!room) return;
    report(p);
    hold(room, socket.id);
    broadcast(room);
  });

  socket.on('status:ready', (p) => {
    if (!room) return;
    report(p);
    release(room, socket.id);
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
});
