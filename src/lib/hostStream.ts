import { useSyncExternalStore } from 'react';
import type { RtcSignal } from '../../shared/protocol.ts';
import { socket } from './socket.ts';
import { ICE_CONFIG, captureElement } from './rtc.ts';

/**
 * The publisher side of a peer-to-peer stream. The host keeps one RTCPeerConnection per viewer
 * and sends them whatever is being played locally: a file from disk or a shared browser tab.
 */

export type HostSource =
  | { kind: 'file'; file: File; url: string }
  | { kind: 'tab'; stream: MediaStream };

interface Peer {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
}

let source: HostSource | null = null;
let outgoing: MediaStream | null = null;
let capturedFrom: HTMLVideoElement | null = null;
const peers = new Map<string, Peer>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function useHostSource(): HostSource | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => source,
  );
}

export function getHostSource(): HostSource | null {
  return source;
}

function send(to: string, data: RtcSignal) {
  socket.emit('rtc:signal', { to, data });
}

function closePeers() {
  for (const p of peers.values()) p.pc.close();
  peers.clear();
}

export function stopHosting(): void {
  closePeers();
  waiting.clear();
  if (source?.kind === 'file') URL.revokeObjectURL(source.url);
  if (source?.kind === 'tab') for (const t of source.stream.getTracks()) t.stop();
  source = null;
  outgoing = null;
  capturedFrom = null;
  notify();
}

export function hostFile(file: File): void {
  stopHosting();
  source = { kind: 'file', file, url: URL.createObjectURL(file) };
  notify();
}

/** Asks the browser to pick a tab or window. Rejects if the user cancels. */
export async function hostTab(onEnded: () => void): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  stopHosting();
  source = { kind: 'tab', stream };
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (source?.kind === 'tab' && source.stream === stream) {
      stopHosting();
      onEnded();
    }
  });
  setOutgoing(stream);
  notify();
}

/** Called by the host's own player once the local file can play. Captures it only once per element. */
export function captureFrom(el: HTMLVideoElement): void {
  if (source?.kind !== 'file' || capturedFrom === el) return;
  const stream = captureElement(el);
  if (!stream) return;
  capturedFrom = el;
  // Audio and video tracks of a captured element can arrive one after the other.
  stream.addEventListener('addtrack', () => reconnectAll());
  setOutgoing(stream);
}

function setOutgoing(stream: MediaStream) {
  outgoing = stream;
  reconnectAll();
  for (const id of waiting) void connect(id);
  waiting.clear();
}

function reconnectAll() {
  for (const id of [...peers.keys()]) void connect(id);
}

async function connect(viewer: string) {
  if (!outgoing || outgoing.getTracks().length === 0) {
    waiting.add(viewer);
    return;
  }
  peers.get(viewer)?.pc.close();
  const pc = new RTCPeerConnection(ICE_CONFIG);
  const peer: Peer = { pc, pendingIce: [] };
  peers.set(viewer, peer);
  for (const track of outgoing.getTracks()) pc.addTrack(track, outgoing);
  pc.onicecandidate = (e) => {
    if (e.candidate) send(viewer, { type: 'ice', to: 'viewer', candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && peers.get(viewer)?.pc === pc) {
      peers.delete(viewer);
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send(viewer, { type: 'offer', sdp: offer.sdp ?? '' });
}

socket.on('rtc:signal', async ({ from, data }) => {
  if (!source) return;
  if (data.type === 'hello') {
    await connect(from);
  } else if (data.type === 'answer') {
    const peer = peers.get(from);
    if (!peer) return;
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
  } else if (data.type === 'ice' && data.to === 'host') {
    const peer = peers.get(from);
    if (!peer) return;
    if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => undefined);
    else peer.pendingIce.push(data.candidate);
  }
});
