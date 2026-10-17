import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/protocol.ts';

export type WaitupSocket = Socket<ServerToClient, ClientToServer>;

/**
 * One id per browser tab. sessionStorage survives a refresh but not a new tab, so a reload
 * reclaims the same seat in the room while a second tab joins as a separate person.
 */
function tabId(): string {
  const KEY = 'waitup:tab';
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const clientId = tabId();

export const socket: WaitupSocket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
  withCredentials: true,
  auth: { clientId },
});

/** Server clock minus local clock, in ms. Estimated from the lowest-latency ping. */
let offset = 0;

export const serverNow = (): number => Date.now() + offset;

export async function syncClock(samples = 5): Promise<void> {
  let best = Infinity;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const remote = await new Promise<number>((resolve) => socket.emit('time:ping', resolve));
    const t1 = Date.now();
    const rtt = t1 - t0;
    if (rtt < best) {
      best = rtt;
      offset = remote - (t0 + t1) / 2;
    }
  }
}

/** Reconnect so the server sees a new sign-in cookie (or its removal). */
export function reconnect(): void {
  socket.disconnect();
  socket.connect();
}

socket.on('connect', () => {
  void syncClock();
});
