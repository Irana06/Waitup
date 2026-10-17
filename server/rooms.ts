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
  chat: ChatMessage[];
  emptySince: number | null;
}

const rooms = new Map<string, Room>();
let msgSeq = 0;

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
    chat: room.chat,
    serverNow: Date.now(),
  };
}

export function system(room: Room, text: string): void {
  pushChat(room, { id: `m${++msgSeq}`, at: Date.now(), system: true, text });
}

export function say(room: Room, from: string, text: string): void {
  pushChat(room, { id: `m${++msgSeq}`, at: Date.now(), system: false, from, text });
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

export function addMember(room: Room, member: Member): void {
  room.members.set(member.id, member);
  room.emptySince = null;
  if (!room.hostId) room.hostId = member.id;
  system(room, `${member.name} join dari ${member.device}`);
}

export function removeMember(room: Room, id: string): void {
  const m = room.members.get(id);
  if (!m) return;
  room.members.delete(id);
  release(room, id);
  system(room, `${m.name} keluar`);
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
