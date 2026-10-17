import type { ChatMessage, Media, Member, RoomState, SyncMode } from '../shared/protocol.ts';
import { hasEnded, positionAt } from '../shared/protocol.ts';

const CHAT_LIMIT = 100;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

export interface Room {
  code: string;
  hostId: string;
  members: Map<string, Member>;
  media: Media | null;
  duration: number | null;
  playback: { playing: boolean; position: number; updatedAt: number };
  mode: SyncMode;
  holdFor: Set<string>;
  hostRequest: { from: string; at: number } | null;
  chat: ChatMessage[];
  emptySince: number | null;
}

/** An unanswered host request stops blocking new ones after this long. */
const HOST_REQUEST_TTL_MS = 2 * 60 * 1000;

const rooms = new Map<string, Room>();
let msgSeq = 0;
// Message ids stay unique across restarts, since restored rooms keep their chat.
const msgId = () => `m${Date.now().toString(36)}${(++msgSeq).toString(36)}`;

export function listRooms(): Room[] {
  return [...rooms.values()];
}

function newCode(): string {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('Tidak bisa membuat kode room baru');
}

export function createRoom(): Room {
  const room: Room = {
    code: newCode(),
    hostId: '',
    members: new Map(),
    media: null,
    duration: null,
    playback: { playing: false, position: 0, updatedAt: Date.now() },
    mode: 'wait',
    holdFor: new Set(),
    hostRequest: null,
    chat: [],
    emptySince: null,
  };
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function snapshot(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    members: [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt),
    media: room.media,
    duration: room.duration,
    playback: { ...room.playback },
    mode: room.mode,
    holdFor: [...room.holdFor],
    hostRequest: room.hostRequest,
    chat: room.chat,
    serverNow: Date.now(),
  };
}

export function system(room: Room, text: string): void {
  pushChat(room, { id: msgId(), at: Date.now(), system: true, text });
}

export function say(room: Room, from: string, text: string): void {
  pushChat(room, { id: msgId(), at: Date.now(), system: false, from, text });
}

function pushChat(room: Room, msg: ChatMessage): void {
  room.chat = [...room.chat, msg].slice(-CHAT_LIMIT);
}

function clockOf(room: Room) {
  return { playback: room.playback, holdFor: [...room.holdFor], duration: room.duration };
}

function currentPosition(room: Room): number {
  return positionAt(clockOf(room), Date.now());
}

export function ended(room: Room): boolean {
  return hasEnded(clockOf(room), Date.now());
}

export function setDuration(room: Room, seconds: number): void {
  if (room.duration === null && room.media && seconds > 0) room.duration = seconds;
}

/** Freeze the clock at the current position before changing what drives it. */
function rebase(room: Room): void {
  room.playback.position = currentPosition(room);
  room.playback.updatedAt = Date.now();
}

/**
 * Adds a member, or reattaches one who refreshed or reconnected (same id) without a fresh
 * "join" entry. Returns true for a genuinely new member.
 */
export function addMember(room: Room, member: Member): boolean {
  const existing = room.members.get(member.id);
  room.emptySince = null;
  if (existing) {
    Object.assign(existing, { name: member.name, device: member.device, userId: member.userId, picture: member.picture, online: true });
    return false;
  }
  room.members.set(member.id, member);
  if (!room.hostId || !room.members.has(room.hostId)) room.hostId = member.id;
  system(room, `${member.name} join dari ${member.device}`);
  return true;
}

/** The member's connection dropped. They keep their place (and host role) until removed. */
export function setOffline(room: Room, id: string): void {
  const m = room.members.get(id);
  if (!m) return;
  m.online = false;
  release(room, id);
  m.buffering = false;
}

export function removeMember(room: Room, id: string): void {
  const m = room.members.get(id);
  if (!m) return;
  room.members.delete(id);
  release(room, id);
  if (room.hostRequest && (room.hostRequest.from === id || room.hostId === id)) room.hostRequest = null;
  system(room, `${m.name} keluar`);
  if (room.media?.kind === 'stream' && room.media.publisherId === id) {
    clearMedia(room);
    system(room, 'Stream berhenti karena pengirimnya keluar');
  }
  if (room.hostId === id) {
    const next = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    room.hostId = next ? next.id : '';
    if (next) system(room, `${next.name} sekarang jadi host`);
  }
  if (room.members.size === 0) room.emptySince = Date.now();
}

export function setMedia(room: Room, media: Media, by: string): void {
  room.media = media;
  room.duration = null;
  room.holdFor.clear();
  for (const m of room.members.values()) {
    m.buffering = false;
    m.position = 0;
    m.reportedAt = Date.now();
  }
  room.playback = { playing: true, position: 0, updatedAt: Date.now() };
  system(room, `${by} memutar ${media.title}`);
}

function nameOf(room: Room, id: string): string {
  return room.members.get(id)?.name ?? 'Seseorang';
}

/** A non-host asks for control. Returns an error message, or null when the request was recorded. */
export function requestHost(room: Room, from: string): string | null {
  if (from === room.hostId) return 'Kamu udah jadi host.';
  const pending = room.hostRequest;
  if (pending && pending.from !== from && Date.now() - pending.at < HOST_REQUEST_TTL_MS) {
    return `${nameOf(room, pending.from)} lagi minta jadi host. Tunggu sebentar.`;
  }
  room.hostRequest = { from, at: Date.now() };
  system(room, `${nameOf(room, from)} minta jadi host`);
  return null;
}

export function cancelHostRequest(room: Room, from: string): void {
  if (room.hostRequest?.from !== from) return;
  room.hostRequest = null;
  system(room, `${nameOf(room, from)} batal minta jadi host`);
}

export function respondHostRequest(room: Room, host: string, accept: boolean): void {
  const req = room.hostRequest;
  if (host !== room.hostId || !req) return;
  room.hostRequest = null;
  if (accept && room.members.has(req.from)) {
    room.hostId = req.from;
    system(room, `${nameOf(room, host)} nyerahin host ke ${nameOf(room, req.from)}`);
  } else {
    system(room, `${nameOf(room, host)} belum mau nyerahin host`);
  }
}

export function giveHost(room: Room, host: string, to: string): void {
  if (host !== room.hostId || to === host || !room.members.has(to)) return;
  room.hostId = to;
  room.hostRequest = null;
  system(room, `${nameOf(room, host)} nyerahin host ke ${nameOf(room, to)}`);
}

export function clearMedia(room: Room): void {
  room.media = null;
  room.duration = null;
  room.holdFor.clear();
  room.playback = { playing: false, position: 0, updatedAt: Date.now() };
  for (const m of room.members.values()) m.buffering = false;
}

/** Play, or start over from the top when the media has already finished. */
export function play(room: Room): void {
  if (ended(room)) {
    room.playback = { playing: true, position: 0, updatedAt: Date.now() };
    return;
  }
  if (room.playback.playing) return;
  rebase(room);
  room.playback.playing = true;
}

export function pause(room: Room): void {
  if (!room.playback.playing) return;
  rebase(room);
  room.playback.playing = false;
}

export function seek(room: Room, position: number): void {
  const end = room.duration ?? Infinity;
  room.playback.position = Math.min(Math.max(0, position), end);
  room.playback.updatedAt = Date.now();
}

export function setMode(room: Room, mode: SyncMode): void {
  room.mode = mode;
  if (mode === 'catch' && room.holdFor.size > 0) {
    rebase(room);
    room.holdFor.clear();
  }
}

/** A member started buffering. In "wait" mode the whole room holds for them. */
export function hold(room: Room, id: string): boolean {
  const m = room.members.get(id);
  if (!m) return false;
  m.buffering = true;
  if (room.mode !== 'wait' || !room.playback.playing || room.holdFor.has(id)) return false;
  rebase(room);
  room.holdFor.add(id);
  system(room, `${m.name} buffering, semua di-pause dulu`);
  return true;
}

/** A member is ready again. When nobody is left to wait for, playback resumes. */
export function release(room: Room, id: string): boolean {
  const m = room.members.get(id);
  if (m) m.buffering = false;
  if (!room.holdFor.has(id)) return false;
  room.holdFor.delete(id);
  if (room.holdFor.size === 0) {
    room.playback.updatedAt = Date.now();
    if (m) system(room, `${m.name} udah siap, lanjut bareng`);
  }
  return true;
}

export function sweepEmptyRooms(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(code);
  }
}

/** Plain data for the room file; live-only state (streams, holds, requests) is left out. */
export function serializeRooms(): unknown[] {
  return listRooms().map((r) => ({
    code: r.code,
    hostId: r.hostId,
    members: [...r.members.values()],
    media: r.media?.kind === 'stream' ? null : r.media,
    duration: r.media?.kind === 'stream' ? null : r.duration,
    playback: r.media?.kind === 'stream' ? { playing: false, position: 0, updatedAt: Date.now() } : r.playback,
    mode: r.mode,
    chat: r.chat,
    emptySince: r.emptySince,
  }));
}

/** Restores rooms after a restart. Everyone starts offline until their browser reconnects. */
export function restoreRooms(data: unknown): Room[] {
  if (!Array.isArray(data)) return [];
  const restored: Room[] = [];
  for (const raw of data as Partial<Room & { members: Member[] }>[]) {
    if (!raw?.code || rooms.has(raw.code) || !Array.isArray(raw.members)) continue;
    const room: Room = {
      code: raw.code,
      hostId: raw.hostId ?? '',
      members: new Map(raw.members.map((m) => [m.id, { ...m, online: false, buffering: false }])),
      media: raw.media ?? null,
      duration: raw.duration ?? null,
      playback: raw.playback ?? { playing: false, position: 0, updatedAt: Date.now() },
      mode: raw.mode === 'catch' ? 'catch' : 'wait',
      holdFor: new Set(),
      hostRequest: null,
      chat: Array.isArray(raw.chat) ? raw.chat : [],
      emptySince: raw.members.length === 0 ? Date.now() : null,
    };
    rooms.set(room.code, room);
    restored.push(room);
  }
  return restored;
}
