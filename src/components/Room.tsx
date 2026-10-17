import { createPortal } from 'react-dom';
import {
  useEffect, useMemo, useRef, useState,
  type ChangeEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { getHostSource, hostFile, hostTab, stopHosting, useHostSource } from '../lib/hostStream.ts';
import { canShareTab, canStreamFile } from '../lib/rtc.ts';
import type { Member, RoomState } from '../../shared/protocol.ts';
import { hasEnded, positionAt } from '../../shared/protocol.ts';
import { serverNow, socket } from '../lib/socket.ts';
import { clock, initial } from '../lib/format.ts';
import { isAudioUrl, parseMediaLink } from '../lib/media.ts';
import type { Theme } from '../lib/theme.ts';
import { setCaptions, useCaptions } from '../lib/captions.ts';
import { AccountButton, FriendsPanel } from './Account.tsx';
import { Lockup } from './Logo.tsx';
import { MediaSurface } from './MediaSurface.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

const CONTROLS_IDLE_MS = 3000;

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

async function lockLandscape(): Promise<void> {
  const o = screen.orientation as LockableOrientation | undefined;
  if (!o?.lock) throw new Error('unsupported');
  await o.lock('landscape');
}

function unlockOrientation(): void {
  try {
    (screen.orientation as LockableOrientation | undefined)?.unlock?.();
  } catch {
    /* nothing was locked */
  }
}

function PlayIcon({ pause, size }: { pause: boolean; size: number }) {
  return pause ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/** A member this far behind the room (seconds) counts as left behind. */
const LAG_SECONDS = 1.5;
/** Width of the convoy strip, in seconds behind the room position. */
const CONVOY_WINDOW = 20;

interface Props {
  room: RoomState;
  you: string;
  connected: boolean;
  theme: Theme;
  onTheme(t: Theme): void;
  onLeave(): void;
  onJoinFriend(code: string): void;
}

function useNow(ms: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Where a member probably is right now, from their last report. */
function projected(m: Member, room: RoomState, now: number): number {
  const moving = room.playback.playing && room.holdFor.length === 0 && !m.buffering;
  const pos = moving ? m.position + Math.max(0, now - m.reportedAt) / 1000 : m.position;
  return room.duration ? Math.min(pos, room.duration) : pos;
}

function names(list: string[]): string {
  if (list.length <= 2) return list.join(' dan ');
  return `${list.slice(0, -1).join(', ')}, dan ${list[list.length - 1]}`;
}

export function Room({ room, you, connected, theme, onTheme, onLeave, onJoinFriend }: Props) {
  const now = useNow(250);
  const isHost = room.hostId === you;
  const position = positionAt(room, now);

  // Stop publishing as soon as the room moves on to something else.
  const mediaKey = JSON.stringify(room.media);
  useEffect(() => {
    const mine = room.media?.kind === 'stream' && room.media.publisherId === you;
    if (!mine && getHostSource()) stopHosting();
    // mediaKey stands in for room.media so unrelated room updates don't re-run this.
  }, [mediaKey, you]);
  const effectivePlaying = room.playback.playing && room.holdFor.length === 0;
  const memberName = (id: string) => room.members.find((m) => m.id === id)?.name ?? 'Seseorang';

  const lag = useMemo(() => {
    const out = new Map<string, number>();
    if (!room.media) return out;
    for (const m of room.members) out.set(m.id, Math.max(0, position - projected(m, room, now)));
    return out;
  }, [room, position, now]);

  const behind = room.members.filter((m) => m.online && (m.buffering || (lag.get(m.id) ?? 0) > LAG_SECONDS));

  // Share state
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? room.code : `${location.origin}/${room.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Salin ini:', text);
    }
  };

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [giveTo, setGiveTo] = useState<Member | null>(null);
  // Below this width the panel takes over the source picker, so chat sits right under the video.
  const compact = useMediaQuery('(max-width: 899px)');
  const request = isHost && room.hostRequest ? room.members.find((m) => m.id === room.hostRequest?.from) : undefined;

  // A host request should not go unnoticed: buzz the phone and flag the tab title until it is answered.
  const requestKey = request ? `${request.id}:${room.hostRequest?.at}` : '';
  useEffect(() => {
    if (!requestKey) return;
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {
      /* vibration not available */
    }
    const original = document.title;
    let flip = false;
    const timer = setInterval(() => {
      flip = !flip;
      document.title = flip ? '(1) Ada yang minta jadi host' : original;
    }, 1200);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
  }, [requestKey]);

  return (
    <div>
      <header className="app-header">
        <Lockup height={30} />
        <div className="header-actions">
          <button type="button" className="room-code" onClick={() => copy('code')} aria-label={`Salin kode room ${room.code}`}>
            <span className="muted">Kode</span>
            <strong className="tabular">
              {room.code.slice(0, 3)} {room.code.slice(3)}
            </strong>
            <span className="room-code-hint">{copied === 'code' ? 'Tersalin' : 'Salin'}</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => copy('link')}>
            {copied === 'link' ? 'Link tersalin' : 'Undang temen'}
          </button>
          <ThemeToggle theme={theme} onChange={onTheme} />
          <button type="button" className="btn" onClick={() => setConfirmLeave(true)}>
            Keluar
          </button>
          <AccountButton theme={theme} />
        </div>
      </header>

      {!connected && (
        <div className="banner" role="status">
          <span className="dot pulse" style={{ background: 'var(--error)', width: 10, height: 10 }} />
          <strong style={{ color: 'var(--error)' }}>Koneksi kamu ke room putus.</strong>
          <span className="muted">Nyambung ulang… Nanti posisinya disamain ke host.</span>
        </div>
      )}

      <div className="layout">
        <main>
          <PlayerCard room={room} you={you} position={position} effectivePlaying={effectivePlaying} lag={lag} behind={behind} memberName={memberName} now={now} />
          {!compact && <SourceCard room={room} isHost={isHost} />}
        </main>
        <aside>
          <Panel room={room} you={you} lag={lag} compact={compact} isHost={isHost} theme={theme} onGive={setGiveTo} onJoinFriend={onJoinFriend} />
        </aside>
      </div>

      {request && !giveTo && !confirmLeave && (
        <ConfirmDialog
          title={`${request.name} pengin jadi host`}
          body="Host bisa ganti video, ngatur mode kalau ada yang ngelag, dan streaming file atau tab. Kamu tetap bisa play, pause, dan loncat."
          confirmLabel="Kasih host"
          cancelLabel="Tolak"
          onCancel={() => socket.emit('host:respond', { accept: false })}
          onConfirm={() => socket.emit('host:respond', { accept: true })}
        />
      )}

      {giveTo && (
        <ConfirmDialog
          title={`Serahin host ke ${giveTo.name}?`}
          body="Setelah ini kamu nggak bisa ganti video atau ngatur mode, kecuali host-nya dikasih balik."
          confirmLabel="Serahin host"
          onCancel={() => setGiveTo(null)}
          onConfirm={() => {
            socket.emit('host:give', { to: giveTo.id });
            setGiveTo(null);
          }}
        />
      )}

      {confirmLeave && (
        <ConfirmDialog
          title="Keluar dari room?"
          body={
            isHost && room.members.length > 1
              ? 'Peran host otomatis pindah ke orang yang paling lama di room. Kamu bisa masuk lagi pakai kode yang sama.'
              : 'Temen-temen kamu tetap bisa lanjut nonton. Kamu bisa masuk lagi pakai kode yang sama.'
          }
          confirmLabel="Keluar room"
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            onLeave();
          }}
        />
      )}
    </div>
  );
}

interface PlayerCardProps {
  room: RoomState;
  you: string;
  position: number;
  effectivePlaying: boolean;
  lag: Map<string, number>;
  behind: Member[];
  memberName(id: string): string;
  now: number;
}

function PlayerCard({ room, you, position, effectivePlaying, lag, behind, memberName, now }: PlayerCardProps) {
  const card = useRef<HTMLElement>(null);
  const [duration, setDuration] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [nativeFs, setNativeFs] = useState(false);
  // Fallback for browsers that refuse element fullscreen (iPhone Safari, embedded webviews).
  const [pseudoFs, setPseudoFs] = useState(false);
  const fullscreen = nativeFs || pseudoFs;
  const captions = useCaptions();

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === card.current;
      setNativeFs(on);
      if (!on) unlockOrientation();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => setDuration(0), [room.media]);

  // On phones, fullscreen should mean landscape without touching the rotation button.
  // Android locks the orientation; where that is refused (iPhone), the CSS fallback rotates the player.
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const onResize = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const rotated = pseudoFs && portrait && isTouch();

  const toggleFullscreen = async () => {
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => undefined);
    try {
      if (!card.current?.requestFullscreen) throw new Error('unsupported');
      await card.current.requestFullscreen();
      if (isTouch()) await lockLandscape().catch(() => undefined);
    } catch {
      setPseudoFs(true);
    }
  };

  // Native fullscreen handles Esc itself; the CSS fallback listens only while it is on.
  useEffect(() => {
    if (!pseudoFs) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setPseudoFs(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pseudoFs]);

  // A shared tab is controlled from the tab itself, so the room clock has nothing to drive.
  const isLive = room.media?.kind === 'stream' && room.media.source === 'tab';
  const hasMedia = room.media !== null && !isLive;
  const waiting = room.holdFor.length > 0;
  const heldOnMe = room.holdFor.includes(you);
  const length = room.duration ?? duration;
  const finished = hasEnded(room, now);
  const showPause = room.playback.playing && !finished;
  const shown = drag ?? position;
  const max = Math.max(length, position, 1);

  const sentDuration = useRef<string | null>(null);
  const reportDuration = (d: number) => {
    setDuration(d);
    const key = JSON.stringify(room.media);
    if (room.duration === null && sentDuration.current !== key) {
      sentDuration.current = key;
      socket.emit('media:duration', { duration: d });
    }
  };

  const commitSeek = () => {
    if (drag !== null) socket.emit('control:seek', { position: drag });
    setDrag(null);
  };

  const playLabel = finished ? 'Putar lagi dari awal' : showPause ? 'Pause buat semua' : 'Play buat semua';
  const togglePlay = () => {
    socket.emit(showPause ? 'control:pause' : 'control:play');
    poke();
  };
  const seekBy = (delta: number) => {
    socket.emit('control:seek', { position: Math.max(0, position + delta) });
    poke();
  };

  // On-video controls: always shown while paused, otherwise they fade after a few idle seconds.
  const [chrome, setChrome] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = !effectivePlaying || drag !== null;
  const visible = chrome || pinned;
  const poke = () => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), CONTROLS_IDLE_MS);
  };
  useEffect(() => {
    if (effectivePlaying) poke();
    return () => clearTimeout(hideTimer.current);
    // Restart the idle timer only when playback starts or stops.
  }, [effectivePlaying]);

  // Mouse: click plays or pauses, like most video players. Touch: tap shows or hides the controls.
  const onHitUp = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      if (hasMedia) togglePlay();
      else poke();
    } else if (visible && !pinned) {
      clearTimeout(hideTimer.current);
      setChrome(false);
    } else {
      poke();
    }
  };

  let chipText = 'Semua sinkron';
  let chipColor = 'var(--on-video-sync)';
  if (waiting) {
    chipText = `Nungguin ${room.holdFor.length} orang`;
    chipColor = 'var(--on-video-wait)';
  } else if (behind.length > 0) {
    chipText = `${names(behind.map((m) => m.name))} lagi nyusul`;
    chipColor = 'var(--on-video-wait)';
  } else if (isLive) {
    chipText = 'Live';
  } else if (finished) {
    chipText = 'Selesai';
  } else if (!room.playback.playing) {
    chipText = 'Di-pause, semua sinkron';
  }

  return (
    <section ref={card} className={['player', pseudoFs && 'pseudo-fs', rotated && 'rotated'].filter(Boolean).join(' ')} aria-label="Pemutar">
      <div className={visible ? 'video' : 'video idle'} onMouseMove={poke}>
        {room.media ? (
          <>
            <MediaSurface
              media={room.media}
              room={room}
              you={you}
              onBuffering={(p) => socket.emit('status:buffering', { position: p })}
              onReady={(p) => socket.emit('status:ready', { position: p })}
              onPosition={(p) => socket.emit('status:position', { position: p })}
              onDuration={reportDuration}
            />
            {room.media.kind === 'url' && isAudioUrl(room.media.url) && (
              <div className="video-empty">
                <span className="display" style={{ fontSize: 20 }}>
                  Lagi muter lagu
                </span>
                <p>{room.media.title}</p>
              </div>
            )}
            <div className="chip">
              <span className="dot" style={{ background: chipColor }} />
              {chipText}
            </div>
          </>
        ) : (
          <div className="video-empty">
            <span className="display" style={{ fontSize: 22 }}>
              Belum ada yang diputar
            </span>
            <p>Host tinggal tempel link YouTube atau link file di bawah.</p>
          </div>
        )}

        {waiting && (
          <div className="wait-overlay" role="status">
            {[
              [12, 22, 0],
              [24, 12, 1.4],
              [71, 30, 0.6],
              [84, 14, 2.2],
              [55, 10, 3],
            ].map(([left, size, delay]) => (
              <span key={left} className="bubble" aria-hidden="true" style={{ left: `${left}%`, width: size, height: size, animationDelay: `${delay}s` }} />
            ))}
            <svg className="spin" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-9-9" />
            </svg>
            <h2>Wait up!</h2>
            <p>
              {heldOnMe
                ? 'Koneksi kamu lagi buffering. Yang lain nungguin kamu.'
                : `Nungguin ${names(room.holdFor.map(memberName))} buffering… video di-pause buat semua orang.`}
            </p>
          </div>
        )}
        {room.media && (
          <div className={visible ? 'ctl visible' : 'ctl'} onFocusCapture={poke}>
            <div className="ctl-hit" aria-hidden="true" onPointerUp={onHitUp} onDoubleClick={toggleFullscreen} />

            {hasMedia && (
              <div className="ctl-center">
                <button type="button" className="ctl-big" aria-label={playLabel} onClick={togglePlay}>
                  <PlayIcon pause={showPause} size={30} />
                </button>
              </div>
            )}

            <div className="ctl-bottom">
              {isLive ? (
                <span className="ctl-live">
                  <span className="dot" style={{ background: 'var(--on-video-wait)' }} />
                  Live dari tab host
                </span>
              ) : (
                <>
                  <span className="ctl-time tabular">
                    {clock(shown)} / {length > 0 ? clock(length) : '--:--'}
                  </span>
                  <label htmlFor="seek" className="sr-only">
                    Posisi video
                  </label>
                  <input
                    id="seek"
                    className="seek"
                    type="range"
                    min={0}
                    max={max}
                    step={1}
                    value={Math.min(shown, max)}
                    style={{ ['--fill' as string]: `${(Math.min(shown, max) / max) * 100}%` }}
                    onChange={(e) => {
                      setDrag(Number(e.target.value));
                      poke();
                    }}
                    onPointerUp={commitSeek}
                    onKeyUp={commitSeek}
                  />
                </>
              )}
              <div className="ctl-row">
                {hasMedia && (
                  <>
                    <button type="button" className="ctl-btn tabular" aria-label="Mundur 10 detik" onClick={() => seekBy(-10)}>
                      −10
                    </button>
                    <button type="button" className="ctl-btn" aria-label={playLabel} onClick={togglePlay}>
                      <PlayIcon pause={showPause} size={22} />
                    </button>
                    <button type="button" className="ctl-btn tabular" aria-label="Maju 10 detik" onClick={() => seekBy(10)}>
                      +10
                    </button>
                  </>
                )}
                <span style={{ flex: '1 1 auto' }} />
                {hasMedia && room.media?.kind !== 'stream' && (
                  <button
                    type="button"
                    className={captions ? 'ctl-btn ctl-cc on' : 'ctl-btn ctl-cc'}
                    aria-pressed={captions}
                    aria-label="Subtitle"
                    title={captions ? 'Matikan subtitle (cuma buat kamu)' : 'Nyalakan subtitle (cuma buat kamu)'}
                    onClick={() => {
                      setCaptions(!captions);
                      poke();
                    }}
                  >
                    CC
                  </button>
                )}
                <button
                  type="button"
                  className="ctl-btn"
                  aria-label={fullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
                  title={fullscreen ? 'Keluar layar penuh (Esc)' : 'Layar penuh (klik dua kali video)'}
                  onClick={toggleFullscreen}
                  autoFocus={pseudoFs}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
                    <path d={fullscreen ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="controls player-below">
        <Convoy room={room} position={position} lag={lag} behind={behind} />
      </div>
    </section>
  );
}

function Convoy({ room, position, lag, behind }: { room: RoomState; position: number; lag: Map<string, number>; behind: Member[] }) {
  const leftFor = (secondsBehind: number) => Math.max(4, Math.min(92, 88 - (secondsBehind / CONVOY_WINDOW) * 84));
  const lagging = new Set(behind.map((m) => m.id));
  const front = room.members.filter((m) => !lagging.has(m.id));
  const groups: { key: string; left: number; members: Member[]; lagging: boolean }[] = [];
  if (front.length) groups.push({ key: 'front', left: leftFor(0), members: front, lagging: false });
  for (const m of behind) groups.push({ key: m.id, left: leftFor(lag.get(m.id) ?? 0), members: [m], lagging: true });

  let label = 'Belum jalan';
  let color = 'var(--muted)';
  if (room.media) {
    if (room.holdFor.length > 0) {
      label = 'Semua nungguin';
      color = 'var(--accent)';
    } else if (behind.length > 0) {
      const worst = behind.reduce((a, b) => ((lag.get(a.id) ?? 0) >= (lag.get(b.id) ?? 0) ? a : b));
      label = `${worst.name} ketinggalan ${(lag.get(worst.id) ?? 0).toFixed(1).replace('.', ',')} dtk`;
      color = 'var(--accent)';
    } else {
      label = 'Semua di detik yang sama';
      color = 'var(--sync)';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Rombongan</span>
        <span style={{ color }}>{label}</span>
      </div>
      <div className="convoy-track" aria-hidden="true" data-position={Math.floor(position)}>
        <div className="convoy-line" />
        {groups.map((g) => (
          <div key={g.key} className="convoy-pos" style={{ transform: `translateX(${g.left}%)` }}>
            <div className="convoy-group">
              {g.members.map((m) => (
                <span key={m.id} className={g.lagging ? 'convoy-bubble lagging' : 'convoy-bubble'}>
                  {initial(m.name)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }} className="muted">
        <span>{CONVOY_WINDOW} detik di belakang</span>
        <span>Posisi room</span>
      </div>
    </div>
  );
}

type SourceTab = 'link' | 'file' | 'tab';

function SourceCard({ room, isHost, embedded = false }: { room: RoomState; isHost: boolean; embedded?: boolean }) {
  const [tab, setTab] = useState<SourceTab>('link');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const local = useHostSource();
  const sharingTab = local?.kind === 'tab' && room.media?.kind === 'stream' && room.media.source === 'tab';
  const streamingFile = local?.kind === 'file' && room.media?.kind === 'stream' && room.media.source === 'file';

  const pickTab = (t: SourceTab) => {
    setTab(t);
    setError('');
  };

  const announce = (source: 'file' | 'tab', title: string) =>
    new Promise<boolean>((resolve) => {
      socket.emit('media:set', { media: { kind: 'stream', source, title } }, (res) => {
        if (!res.ok) setError(res.error);
        resolve(res.ok);
      });
    });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^(video|audio)\//.test(file.type)) {
      setError('File ini bukan video atau audio.');
      return;
    }
    setError('');
    hostFile(file);
    if (!(await announce('file', file.name))) stopHosting();
  };

  const startShare = async () => {
    setError('');
    setBusy(true);
    try {
      await hostTab(() => socket.emit('media:clear'));
      if (!(await announce('tab', 'Tab yang di-share host'))) stopHosting();
    } catch {
      setError('Share tab dibatalkan atau ditolak browser.');
    } finally {
      setBusy(false);
    }
  };

  const stopShare = () => {
    stopHosting();
    socket.emit('media:clear');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const parsed = await parseMediaLink(link);
    if (!parsed.ok) {
      setError(parsed.error);
      setBusy(false);
      return;
    }
    socket.emit('media:set', { media: parsed.media }, (res) => {
      setBusy(false);
      if (res.ok) setLink('');
      else setError(res.error);
    });
  };

  return (
    <section className={embedded ? 'source-card embedded' : 'card source-card'}>
      <div className="source-top">
        <div style={{ minWidth: 0 }}>
          <div className="muted small">Sedang diputar</div>
          <h1 className="now-title">{room.media?.title ?? 'Belum ada video'}</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted small">
            Kalau ada yang ngelag{isHost ? '' : ' (diatur host)'}
          </span>
          <div className="seg" role="group" aria-label="Mode sinkron">
            <button type="button" aria-pressed={room.mode === 'wait'} disabled={!isHost} onClick={() => socket.emit('mode:set', { mode: 'wait' })}>
              Tunggu semua
            </button>
            <button type="button" aria-pressed={room.mode === 'catch'} disabled={!isHost} onClick={() => socket.emit('mode:set', { mode: 'catch' })}>
              Yang ngelag ngejar
            </button>
          </div>
        </div>
      </div>

      <div className="seg seg-fill" role="group" aria-label="Sumber video">
        {(
          [
            ['link', 'Link'],
            ['file', 'File dari PC'],
            ['tab', 'Share tab'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => pickTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'file' && (
        <div className="source-panel">
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontWeight: 700 }}>{streamingFile ? `Lagi di-stream: ${local.file.name}` : 'Putar film atau lagu dari PC kamu'}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              {!isHost
                ? 'Cuma host yang bisa streaming file.'
                : !canStreamFile()
                  ? 'Browser ini belum bisa streaming file. Coba Chrome atau Edge di PC.'
                  : 'Dikirim langsung dari browser kamu ke temen, tanpa upload. Kualitasnya ngikut internet upload kamu, enaknya buat sampai 5 penonton.'}
            </div>
          </div>
          {streamingFile ? (
            <button type="button" className="btn" onClick={stopShare}>
              Berhenti stream
            </button>
          ) : (
            <label className={isHost && canStreamFile() ? 'btn btn-primary file-btn' : 'btn btn-primary file-btn is-disabled'}>
              Pilih file
              <input type="file" accept="video/*,audio/*" className="sr-only" disabled={!isHost || !canStreamFile()} onChange={onFile} />
            </label>
          )}
        </div>
      )}

      {tab === 'tab' && (
        <div className="source-panel">
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontWeight: 700 }}>{sharingTab ? 'Lagi share tab' : 'Share tab browser'}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              {!isHost
                ? 'Cuma host yang bisa share tab.'
                : !canShareTab()
                  ? 'Share tab cuma bisa dari browser PC (Chrome, Edge, atau Firefox).'
                  : 'Buat TikTok, live stream, atau situs lain. Pilih tab-nya, lalu centang "Bagikan audio tab" biar suaranya ikut. Pause dan loncat diatur dari tab itu sendiri.'}
            </div>
          </div>
          {sharingTab ? (
            <button type="button" className="btn" onClick={stopShare}>
              Berhenti share
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!isHost || !canShareTab() || busy} onClick={startShare}>
              {busy ? 'Milih tab…' : 'Mulai share'}
            </button>
          )}
        </div>
      )}

      {tab !== 'link' && error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}

      {tab === 'link' && (
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="link" style={{ fontSize: 14, fontWeight: 700 }}>
          Link YouTube atau file
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            id="link"
            className="input"
            style={{ flex: '1 1 280px' }}
            type="url"
            inputMode="url"
            placeholder="https://youtu.be/… atau https://…/film.mp4"
            value={link}
            disabled={!isHost}
            aria-invalid={error ? true : undefined}
            aria-describedby="link-msg"
            onChange={(e) => {
              setLink(e.target.value);
              setError('');
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!isHost || busy}>
            {busy ? 'Nyiapin…' : 'Putar buat semua'}
          </button>
        </div>
        <div id="link-msg">
          {error ? (
            <span className="error-text" role="alert">
              {error}
            </span>
          ) : (
            !isHost && <span className="muted" style={{ fontSize: 14 }}>Cuma host yang bisa ganti video. Play, pause, dan loncat bisa siapa aja.</span>
          )}
        </div>
      </form>
      )}
    </section>
  );
}

type PanelTab = 'chat' | 'people' | 'friends' | 'log' | 'source';

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

const TAB_ICONS: Record<PanelTab, string> = {
  chat: 'M4 5h16v10H9l-5 4z',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 8c0-3 3-5 6-5s6 2 6 5M16 11a2.5 2.5 0 1 0 0-5M18 14c2 .5 3 2 3 5',
  friends: 'M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4c0 5.2-7 9.6-7 9.6z',
  log: 'M5 6h14M5 12h14M5 18h9',
  source: 'M8 5.5v13l11-6.5z',
};

interface PanelProps {
  room: RoomState;
  you: string;
  lag: Map<string, number>;
  compact: boolean;
  isHost: boolean;
  theme: Theme;
  onGive(m: Member): void;
  onJoinFriend(code: string): void;
}

/** One navigable panel for chat, people, friends and the log; on phones it also hosts the source picker. */
function Panel({ room, you, lag, compact, isHost, theme, onGive, onJoinFriend }: PanelProps) {
  const [tab, setTab] = useState<PanelTab>('chat');
  const tabs: [PanelTab, string][] = [
    ['chat', 'Chat'],
    ['people', 'Orang'],
    ['friends', 'Teman'],
    ['log', 'Log'],
    ...(compact ? ([['source', 'Putar']] as [PanelTab, string][]) : []),
  ];
  const active = !compact && tab === 'source' ? 'chat' : tab;

  // Count chat messages that arrive while another tab is open.
  const chatCount = room.chat.filter((m) => !m.system).length;
  const [seen, setSeen] = useState(chatCount);
  useEffect(() => {
    if (active === 'chat') setSeen(chatCount);
  }, [active, chatCount]);
  const unread = Math.max(0, chatCount - seen);
  const pendingHost = isHost && room.hostRequest !== null;

  return (
    <section className="card panel">
      <nav className="panel-nav" role="tablist" aria-label="Panel room">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={active === id} aria-controls="panel-body" onClick={() => setTab(id)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={TAB_ICONS[id]} />
            </svg>
            <span>{label}</span>
            {id === 'chat' && unread > 0 && <span className="count">{unread}</span>}
            {id === 'people' && (pendingHost ? <span className="count">!</span> : <span className="muted tabular small">{room.members.length}</span>)}
          </button>
        ))}
      </nav>
      <div id="panel-body" className={`panel-body panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`}>
        {active === 'chat' && <ChatPanel room={room} you={you} />}
        {active === 'people' && <PeoplePanel room={room} you={you} lag={lag} onGive={onGive} />}
        {active === 'friends' && <FriendsPanel theme={theme} currentRoom={room.code} onJoin={onJoinFriend} />}
        {active === 'log' && <LogPanel room={room} />}
        {active === 'source' && <SourceCard room={room} isHost={isHost} embedded />}
      </div>
    </section>
  );
}

function PeoplePanel({ room, you, lag, onGive }: { room: RoomState; you: string; lag: Map<string, number>; onGive(m: Member): void }) {
  const isHost = room.hostId === you;
  const req = room.hostRequest;
  const mine = req?.from === you;
  const someoneElse = req !== null && !mine;
  const hostName = room.members.find((m) => m.id === room.hostId)?.name ?? 'host';

  return (
    <div className="people-panel">
      <ul className="people">
        {room.members.map((m) => {
          const behind = (lag.get(m.id) ?? 0) > LAG_SECONDS;
          let status = 'Sinkron';
          let color = 'var(--sync)';
          let flagged = false;
          if (!m.online) {
            status = 'Nyambung ulang…';
            color = 'var(--muted)';
          } else if (m.buffering) {
            status = 'Buffering';
            color = 'var(--accent)';
            flagged = true;
          } else if (behind && room.media) {
            status = 'Ngejar';
            color = 'var(--accent)';
            flagged = true;
          }
          const canGive = isHost && m.id !== you && m.online;
          return (
            <li key={m.id} className={flagged ? 'person lagging' : m.online ? 'person' : 'person offline'}>
              <span className="avatar" style={{ borderColor: flagged ? 'var(--accent)' : 'transparent' }}>
                {m.picture ? <img src={m.picture} alt="" referrerPolicy="no-referrer" /> : initial(m.name)}
              </span>
              <div className="person-main">
                <div className="person-name">
                  <span>{m.name}</span>
                  {m.id === you && <span className="muted">(kamu)</span>}
                  {m.id === room.hostId && <span className="badge">Host</span>}
                </div>
                <div className="person-meta">
                  <span className={flagged ? 'dot pulse' : 'dot'} style={{ background: color }} />
                  <span style={{ color }}>{status}</span>
                  <span className="muted">· {m.device}</span>
                </div>
              </div>
              {canGive && (
                <button type="button" className="btn btn-sm" onClick={() => onGive(m)} aria-label={`Jadikan ${m.name} host`}>
                  Jadikan host
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!isHost && (
        <div className="host-ask">
          {mine ? (
            <>
              <span className="muted">Nunggu {hostName} setuju…</span>
              <button type="button" className="btn btn-sm" onClick={() => socket.emit('host:cancel')}>
                Batal
              </button>
            </>
          ) : someoneElse ? (
            <span className="muted">{room.members.find((m) => m.id === req.from)?.name ?? 'Seseorang'} lagi minta jadi host.</span>
          ) : (
            <>
              <span className="muted">Mau ngatur video?</span>
              <button type="button" className="btn btn-sm" onClick={() => socket.emit('host:request')}>
                Minta jadi host
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

function ChatPanel({ room, you }: { room: RoomState; you: string }) {
  const [draft, setDraft] = useState('');
  const messages = room.chat.filter((m) => !m.system);
  const list = useStickToBottom(messages[messages.length - 1]?.id);
  const myName = room.members.find((m) => m.id === you)?.name;

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    setDraft('');
  };

  return (
    <>
      <div ref={list} className="convo-list" aria-live="polite">
        {messages.length === 0 && <p className="muted empty">Belum ada obrolan. Sapa temen-temen kamu.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.from === myName ? 'msg own' : 'msg'}>
            <div className="msg-head">
              <strong>{m.from}</strong>
              <span className="muted">{hhmm(m.at)}</span>
            </div>
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="convo-form">
        <label htmlFor="chat" className="sr-only">
          Tulis pesan
        </label>
        <input id="chat" className="input" maxLength={500} placeholder="Tulis pesan…" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-primary">
          Kirim
        </button>
      </form>
    </>
  );
}

function LogPanel({ room }: { room: RoomState }) {
  const events = room.chat.filter((m) => m.system);
  const list = useStickToBottom(events[events.length - 1]?.id);
  return (
    <div ref={list} className="convo-list" aria-live="polite">
      {events.length === 0 && <p className="muted empty">Belum ada kejadian.</p>}
      {events.map((m) => (
        <div key={m.id} className="event">
          <span className="muted tabular">{hhmm(m.at)}</span>
          <span>{m.text}</span>
        </div>
      ))}
    </div>
  );
}

interface ConfirmProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * Where overlays must render to be seen: inside the fullscreen element when there is one
 * (anything outside it is invisible in native fullscreen), else inside the CSS-fullscreen player.
 */
function useOverlayTarget(): HTMLElement {
  const pick = () => (document.fullscreenElement as HTMLElement | null) ?? document.querySelector<HTMLElement>('.player.pseudo-fs') ?? document.body;
  const [target, setTarget] = useState<HTMLElement>(pick);
  useEffect(() => {
    const update = () => setTarget(pick());
    document.addEventListener('fullscreenchange', update);
    const obs = new MutationObserver(update);
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => {
      document.removeEventListener('fullscreenchange', update);
      obs.disconnect();
    };
  }, []);
  return target;
}

function ConfirmDialog(props: ConfirmProps) {
  return createPortal(<ConfirmDialogBody {...props} />, useOverlayTarget());
}

function ConfirmDialogBody({ title, body, confirmLabel, cancelLabel = 'Batal', onCancel, onConfirm }: ConfirmProps) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
        <h2 id="dialog-title">{title}</h2>
        <p className="muted">{body}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" autoFocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
