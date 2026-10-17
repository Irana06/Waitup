export type SyncMode = 'wait' | 'catch';

export type Media =
  | { kind: 'youtube'; videoId: string; title: string }
  | { kind: 'url'; url: string; title: string }
  /** Streamed peer-to-peer from the publisher's browser: a local file or a shared tab. */
  | { kind: 'stream'; source: 'file' | 'tab'; title: string; publisherId: string };

/** Media as the host proposes it; the server fills in who publishes a stream. */
export type MediaInput =
  | Exclude<Media, { kind: 'stream' }>
  | { kind: 'stream'; source: 'file' | 'tab'; title: string };

/** WebRTC signalling relayed by the server between the publisher and each viewer. */
export type RtcSignal =
  | { type: 'hello' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; to: 'host' | 'viewer'; candidate: RTCIceCandidateInit };

export interface Member {
  id: string;
  name: string;
  device: string;
  buffering: boolean;
  /** Last playback position this member reported, in seconds. */
  position: number;
  /** Server clock (ms) when `position` was reported. */
  reportedAt: number;
  joinedAt: number;
}

export interface Playback {
  /** What people asked for. The effective state also depends on `holdFor`. */
  playing: boolean;
  /** Position in seconds at `updatedAt`. */
  position: number;
  /** Server clock, ms. */
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  at: number;
  system: boolean;
  from?: string;
  text: string;
}

export interface RoomState {
  code: string;
  hostId: string;
  members: Member[];
  media: Media | null;
  /** Length of the current media in seconds, once a player has reported it. */
  duration: number | null;
  playback: Playback;
  mode: SyncMode;
  /** Member ids everyone is currently waiting for (mode "wait" only). */
  holdFor: string[];
  /** A member asking the current host to hand over control. */
  hostRequest: { from: string; at: number } | null;
  chat: ChatMessage[];
  serverNow: number;
}

export type Ack<T = undefined> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  'time:ping': (cb: (serverNow: number) => void) => void;
  'room:create': (p: { name: string; device: string }, cb: Ack<{ code: string; you: string }>) => void;
  'room:join': (p: { code: string; name: string; device: string }, cb: Ack<{ code: string; you: string }>) => void;
  'room:leave': () => void;
  'media:set': (p: { media: MediaInput }, cb: Ack) => void;
  'media:clear': () => void;
  'rtc:signal': (p: { to: string; data: RtcSignal }) => void;
  'media:duration': (p: { duration: number }) => void;
  'control:play': () => void;
  'control:pause': () => void;
  'control:seek': (p: { position: number }) => void;
  'mode:set': (p: { mode: SyncMode }) => void;
  'host:request': () => void;
  'host:cancel': () => void;
  'host:respond': (p: { accept: boolean }) => void;
  'host:give': (p: { to: string }) => void;
  'status:buffering': (p: { position: number }) => void;
  'status:ready': (p: { position: number }) => void;
  'status:position': (p: { position: number }) => void;
  'chat:send': (p: { text: string }) => void;
}

export interface ServerToClient {
  'room:state': (s: RoomState) => void;
  'rtc:signal': (p: { from: string; data: RtcSignal }) => void;
}

type Clock = Pick<RoomState, 'playback' | 'holdFor' | 'duration'>;

/** Position the room is at for a given server time, never past the end of the media. */
export function positionAt(state: Clock, serverNow: number): number {
  const { playback, holdFor, duration } = state;
  const raw =
    !playback.playing || holdFor.length > 0
      ? playback.position
      : playback.position + Math.max(0, serverNow - playback.updatedAt) / 1000;
  return duration ? Math.min(raw, duration) : raw;
}

export function hasEnded(state: Clock, serverNow: number): boolean {
  return !!state.duration && positionAt(state, serverNow) >= state.duration - 0.05;
}
