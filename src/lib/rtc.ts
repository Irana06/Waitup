/** Public STUN only: enough for most home networks. Strict NATs would need a TURN server. */
export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export function captureElement(el: HTMLVideoElement): MediaStream | null {
  const v = el as CapturableVideo;
  if (typeof v.captureStream === 'function') return v.captureStream();
  if (typeof v.mozCaptureStream === 'function') return v.mozCaptureStream();
  return null;
}

export function canStreamFile(): boolean {
  const proto = HTMLVideoElement.prototype as CapturableVideo;
  return typeof proto.captureStream === 'function' || typeof proto.mozCaptureStream === 'function';
}

export function canShareTab(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}
