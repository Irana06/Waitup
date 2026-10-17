import { useEffect, useRef, useState } from 'react';
import type { RtcSignal } from '../../shared/protocol.ts';
import { socket } from '../lib/socket.ts';
import { ICE_CONFIG } from '../lib/rtc.ts';

const RETRY_MS = 5000;
const REPORT_MS = 2000;

interface Props {
  publisherId: string;
  /** Viewers of a live stream are always at the room position; this keeps the convoy honest. */
  onPosition(): void;
}

/** The viewer side of a peer-to-peer stream: asks the publisher for an offer and shows what arrives. */
export function RemoteStream({ publisherId, onPosition }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'failed'>('connecting');
  const [needsTap, setNeedsTap] = useState(false);
  const report = useRef(onPosition);
  report.current = onPosition;

  useEffect(() => {
    let pc: RTCPeerConnection | null = null;
    const pendingIce: RTCIceCandidateInit[] = [];
    setStatus('connecting');

    const play = () => {
      const el = video.current;
      if (!el) return;
      el.play()
        .then(() => setNeedsTap(false))
        .catch(() => setNeedsTap(true));
    };

    const onSignal = async ({ from, data }: { from: string; data: RtcSignal }) => {
      if (from !== publisherId) return;
      if (data.type === 'offer') {
        pc?.close();
        const conn = new RTCPeerConnection(ICE_CONFIG);
        pc = conn;
        conn.ontrack = (e) => {
          const el = video.current;
          const stream = e.streams[0];
          if (el && stream && el.srcObject !== stream) {
            el.srcObject = stream;
            play();
          }
          setStatus('live');
        };
        conn.onicecandidate = (e) => {
          if (e.candidate) socket.emit('rtc:signal', { to: publisherId, data: { type: 'ice', to: 'host', candidate: e.candidate.toJSON() } });
        };
        conn.onconnectionstatechange = () => {
          if (conn.connectionState === 'failed') setStatus('failed');
          if (conn.connectionState === 'connected') setStatus('live');
        };
        await conn.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        for (const c of pendingIce.splice(0)) await conn.addIceCandidate(c).catch(() => undefined);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        socket.emit('rtc:signal', { to: publisherId, data: { type: 'answer', sdp: answer.sdp ?? '' } });
      } else if (data.type === 'ice' && data.to === 'viewer') {
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
        else pendingIce.push(data.candidate);
      }
    };

    const hello = () => socket.emit('rtc:signal', { to: publisherId, data: { type: 'hello' } });
    socket.on('rtc:signal', onSignal);
    hello();
    const retry = setInterval(() => {
      const state = pc?.connectionState;
      if (!pc || state === 'failed' || state === 'disconnected' || state === 'closed') hello();
    }, RETRY_MS);
    const reporter = setInterval(() => report.current(), REPORT_MS);

    return () => {
      clearInterval(retry);
      clearInterval(reporter);
      socket.off('rtc:signal', onSignal);
      pc?.close();
    };
  }, [publisherId]);

  return (
    <>
      <video ref={video} autoPlay playsInline />
      {status !== 'live' && (
        <div className="video-empty" style={{ position: 'relative', zIndex: 2 }}>
          <span className="display" style={{ fontSize: 22 }}>
            {status === 'failed' ? 'Gagal nyambung ke host' : 'Nyambung ke stream host…'}
          </span>
          <p>
            {status === 'failed'
              ? 'Jaringan kamu atau host mungkin memblokir koneksi langsung. Waitup bakal coba lagi tiap 5 detik.'
              : 'Video dikirim langsung dari browser host.'}
          </p>
        </div>
      )}
      {needsTap && (
        <div className="tap-overlay">
          <button type="button" className="btn btn-primary" onClick={() => video.current?.play().then(() => setNeedsTap(false)).catch(() => undefined)}>
            Ketuk buat ikut nonton
          </button>
        </div>
      )}
    </>
  );
}
