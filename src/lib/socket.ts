import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/protocol.ts';

export type WaitupSocket = Socket<ServerToClient, ClientToServer>;

export const socket: WaitupSocket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

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

socket.on('connect', () => {
  void syncClock();
});
