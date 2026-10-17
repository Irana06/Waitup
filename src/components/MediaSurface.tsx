import { useEffect, useRef, useState } from 'react';
import type { Media, RoomState } from '../../shared/protocol.ts';
import { positionAt } from '../../shared/protocol.ts';
import { serverNow } from '../lib/socket.ts';
import { isAudioUrl } from '../lib/media.ts';

/** How far (seconds) a player may drift before we seek it back in line. */
const SEEK_THRESHOLD_PLAYING = 0.75;
const SEEK_THRESHOLD_PAUSED = 0.3;
/** Buffering shorter than this (e.g. right after a seek) is not reported to the room. */
const BUFFER_DEBOUNCE_MS = 600;
const LOOP_MS = 400;
const REPORT_MS = 2000;

interface Engine {
  ready(): boolean;
  play(): Promise<void> | void;
  pause(): void;
  seek(t: number): void;
  time(): number;
  duration(): number;
  /** True while the player is trying to play, buffering included. */
  playing(): boolean;
  setRate(r: number): void;
  destroy(): void;
}

interface EngineEvents {
  onReady(): void;
  onBuffering(buffering: boolean): void;
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApi: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApi) {
    ytApi = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

function youtubeEngine(host: HTMLElement, videoId: string, ev: EngineEvents): Engine {
  let player: YTPlayer | null = null;
  let isReady = false;
  let state = -1;
  let destroyed = false;
  const mount = document.createElement('div');
  host.appendChild(mount);

  void loadYouTubeApi().then(() => {
    if (destroyed || !window.YT) return;
    player = new window.YT.Player(mount, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
      events: {
        onReady: () => {
          isReady = true;
          ev.onReady();
        },
        onStateChange: (e: { data: number }) => {
          state = e.data;
          ev.onBuffering(e.data === 3);
        },
      },
    });
  });

  return {
    ready: () => isReady,
    play: () => player?.playVideo(),
    pause: () => player?.pauseVideo(),
    seek: (t) => player?.seekTo(t, true),
    time: () => (isReady && player ? player.getCurrentTime() : 0),
    duration: () => (isReady && player ? player.getDuration() : 0),
    playing: () => state === 1 || state === 3,
    setRate: (r) => player?.setPlaybackRate(r),
    destroy: () => {
      destroyed = true;
      player?.destroy();
      host.innerHTML = '';
    },
  };
}

function htmlEngine(el: HTMLMediaElement, ev: EngineEvents): Engine {
  let isReady = el.readyState >= 2;
  const onWaiting = () => ev.onBuffering(true);
  const onPlaying = () => ev.onBuffering(false);
  const onCanPlay = () => {
    if (!isReady) {
      isReady = true;
      ev.onReady();
    }
    ev.onBuffering(false);
  };
  el.addEventListener('waiting', onWaiting);
  el.addEventListener('playing', onPlaying);
  el.addEventListener('canplay', onCanPlay);
  return {
    ready: () => isReady,
    play: () => el.play(),
    pause: () => el.pause(),
    seek: (t) => {
      el.currentTime = t;
    },
    time: () => el.currentTime,
    duration: () => (Number.isFinite(el.duration) ? el.duration : 0),
    playing: () => !el.paused,
    setRate: (r) => {
      el.playbackRate = r;
    },
    destroy: () => {
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('canplay', onCanPlay);
    },
  };
}

interface Props {
  media: Media;
  room: RoomState;
  you: string;
  onBuffering(position: number): void;
  onReady(position: number): void;
  onPosition(position: number): void;
  onDuration(seconds: number): void;
}

export function MediaSurface({ media, room, you, onBuffering, onReady, onPosition, onDuration }: Props) {
  const ytHost = useRef<HTMLDivElement>(null);
  const mediaEl = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const engine = useRef<Engine | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const cb = useRef({ onBuffering, onReady, onPosition, onDuration });
  cb.current = { onBuffering, onReady, onPosition, onDuration };
  const [needsTap, setNeedsTap] = useState(false);

  const mediaKey = media.kind === 'youtube' ? `yt:${media.videoId}` : `url:${media.url}`;

  useEffect(() => {
    let reported = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let playAttemptAt = 0;

    const events: EngineEvents = {
      onReady: () => tick(),
      onBuffering: (b) => {
        clearTimeout(timer);
        const pos = () => engine.current?.time() ?? 0;
        if (b && !reported) {
          timer = setTimeout(() => {
            reported = true;
            cb.current.onBuffering(pos());
          }, BUFFER_DEBOUNCE_MS);
        } else if (!b && reported) {
          reported = false;
          cb.current.onReady(pos());
        }
      },
    };

    const e =
      media.kind === 'youtube' && ytHost.current
        ? youtubeEngine(ytHost.current, media.videoId, events)
        : mediaEl.current
          ? htmlEngine(mediaEl.current, events)
          : null;
    engine.current = e;
    setNeedsTap(false);

    const tryPlay = () => {
      if (!e) return;
      if (!playAttemptAt) playAttemptAt = Date.now();
      const p = e.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') setNeedsTap(true);
        });
      }
    };

    function tick() {
      if (!e || !e.ready()) return;
      const r = roomRef.current;
      const target = positionAt(r, serverNow());
      const heldOnMe = r.holdFor.includes(you);
      const shouldPlay = r.playback.playing && (r.holdFor.length === 0 || heldOnMe);

      if (shouldPlay && !e.playing()) {
        tryPlay();
        // YouTube has no rejected promise for blocked autoplay, so watch for a stuck start instead.
        if (media.kind === 'youtube' && playAttemptAt && Date.now() - playAttemptAt > 2500) setNeedsTap(true);
      } else if (e.playing()) {
        playAttemptAt = 0;
        setNeedsTap(false);
      }
      if (!shouldPlay && e.playing()) e.pause();

      const dur = e.duration();
      if (dur > 0) cb.current.onDuration(dur);

      // While the room waits for us, keep loading instead of fighting the buffer.
      if (heldOnMe) return;

      const local = e.time();
      const goal = dur > 0 ? Math.min(target, Math.max(0, dur - 0.25)) : target;
      const drift = local - goal;
      const limit = shouldPlay ? SEEK_THRESHOLD_PLAYING : SEEK_THRESHOLD_PAUSED;
      if (Math.abs(drift) > limit) {
        e.seek(goal);
        e.setRate(1);
      } else if (shouldPlay && media.kind === 'url') {
        // Small drift on direct files: nudge the speed instead of jumping.
        e.setRate(Math.abs(drift) > 0.1 ? (drift > 0 ? 0.95 : 1.05) : 1);
      }
    }

    const loop = setInterval(tick, LOOP_MS);
    const report = setInterval(() => {
      if (e?.ready()) cb.current.onPosition(e.time());
    }, REPORT_MS);

    return () => {
      clearInterval(loop);
      clearInterval(report);
      clearTimeout(timer);
      e?.destroy();
      engine.current = null;
    };
    // The engine is rebuilt only when the media itself changes; everything else is read through refs.
  }, [mediaKey, you]);

  const tapToStart = () => {
    const e = engine.current;
    if (!e) return;
    const p = e.play();
    if (p && typeof p.then === 'function') p.then(() => setNeedsTap(false)).catch(() => undefined);
    else setNeedsTap(false);
  };

  return (
    <>
      {media.kind === 'youtube' ? (
        <div ref={ytHost} key={mediaKey} style={{ position: 'absolute', inset: 0 }} />
      ) : isAudioUrl(media.url) ? (
        <audio ref={mediaEl} key={mediaKey} src={media.url} preload="auto" />
      ) : (
        <video ref={mediaEl} key={mediaKey} src={media.url} preload="auto" playsInline />
      )}
      {needsTap && (
        <div className="tap-overlay">
          <button type="button" className="btn btn-primary" onClick={tapToStart}>
            Ketuk buat ikut nonton
          </button>
        </div>
      )}
    </>
  );
}
