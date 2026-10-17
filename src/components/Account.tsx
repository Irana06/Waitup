import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { acceptFriendRequest, addFriend, removeFriendship, renderGoogleButton, signOut, useAccount, useFriends } from '../lib/account.ts';
import { initial } from '../lib/format.ts';
import type { Theme } from '../lib/theme.ts';
import type { FriendEntry } from '../../shared/protocol.ts';

function Avatar({ name, picture, size = 32 }: { name: string; picture: string | null | undefined; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" /> : initial(name)}
    </span>
  );
}

export function GoogleSignInButton({ theme, onDone }: { theme: Theme; onDone?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (box.current) void renderGoogleButton(box.current, theme, () => done.current?.(), setError);
  }, [theme]);
  return (
    <div className="gsi">
      <div ref={box} className="gsi-button" />
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function SignInDialog({ theme, onClose }: { theme: Theme; onClose(): void }) {
  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="signin-title">Masuk ke Waitup</h2>
        <p className="muted">Akun cuma dipakai buat daftar teman, biar bisa join tanpa nanya kode. Tanpa akun kamu tetap bisa bikin dan join room.</p>
        <GoogleSignInButton theme={theme} onDone={onClose} />
        <div className="dialog-actions">
          <button type="button" className="btn" autoFocus onClick={onClose}>
            Nanti aja
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AccountButton({ theme }: { theme: Theme }) {
  const { ready, user, googleClientId } = useAccount();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !user) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, user]);

  if (!ready || (!user && !googleClientId)) return null;

  if (!user) {
    return (
      <>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Masuk
        </button>
        {open && <SignInDialog theme={theme} onClose={() => setOpen(false)} />}
      </>
    );
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(user.friendCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Kode teman kamu:', user.friendCode);
    }
  };

  return (
    <div className="account" ref={wrap}>
      <button type="button" className="account-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Avatar name={user.name} picture={user.picture} size={28} />
        <span className="account-name">{user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <strong>{user.name}</strong>
            {user.email && <span className="muted small">{user.email}</span>}
          </div>
          <button type="button" role="menuitem" className="menu-item" onClick={copyCode}>
            <span>Kode teman</span>
            <strong className="tabular">{copied ? 'Tersalin' : user.friendCode}</strong>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            Keluar akun
          </button>
        </div>
      )}
    </div>
  );
}

function describe(f: FriendEntry): string {
  if (f.status === 'incoming') return 'Pengin berteman sama kamu';
  if (f.status === 'outgoing') return 'Nunggu diterima';
  if (!f.online) return 'Offline';
  if (!f.room) return 'Online';
  if (f.room.hosting) return f.room.title ? `Nge-host · ${f.room.title}` : 'Nge-host room, belum muter apa-apa';
  return f.room.title ? `Nonton · ${f.room.title}` : `Di room ${f.room.code}`;
}

interface FriendsPanelProps {
  theme: Theme;
  currentRoom?: string;
  onJoin(code: string): void;
}

export function FriendsPanel({ theme, currentRoom, onJoin }: FriendsPanelProps) {
  const { user, googleClientId } = useAccount();
  const { friends, loading, error, refresh } = useFriends();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <div className="friends-panel">
        <p className="muted">Masuk pakai Google buat punya daftar teman. Nanti kelihatan siapa yang lagi nge-host, dan kamu tinggal join tanpa nanya kode.</p>
        {googleClientId ? <GoogleSignInButton theme={theme} /> : <p className="muted small">Login Google belum disetel di server ini.</p>}
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      setMsg({ text: await addFriend(code), error: false });
      setCode('');
      refresh();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Gagal nambah teman.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } finally {
      refresh();
    }
  };

  const incoming = friends.filter((f) => f.status === 'incoming');
  const accepted = friends
    .filter((f) => f.status === 'accepted')
    .sort((a, b) => Number(!!b.room) - Number(!!a.room) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const outgoing = friends.filter((f) => f.status === 'outgoing');

  return (
    <div className="friends-panel">
      <form onSubmit={submit} className="friend-add">
        <label htmlFor="friend-code" className="small" style={{ fontWeight: 700 }}>
          Tambah teman pakai kode
        </label>
        <div className="row">
          <input
            id="friend-code"
            className="input tabular"
            placeholder="ABCD-2345"
            autoComplete="off"
            maxLength={9}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setMsg(null);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
            Tambah
          </button>
        </div>
        <span className="muted small">
          Kode kamu: <strong className="tabular">{user.friendCode}</strong>
        </span>
        {msg && (
          <span className={msg.error ? 'error-text' : 'small'} role={msg.error ? 'alert' : 'status'}>
            {msg.text}
          </span>
        )}
      </form>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {incoming.length > 0 && (
        <div className="friend-group">
          <h3>Permintaan</h3>
          {incoming.map((f) => (
            <div key={f.id} className="friend">
              <Avatar name={f.name} picture={f.picture} />
              <div className="friend-main">
                <strong>{f.name}</strong>
                <span className="muted small">{describe(f)}</span>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => act(() => acceptFriendRequest(f.id))}>
                Terima
              </button>
              <button type="button" className="btn btn-sm" onClick={() => act(() => removeFriendship(f.id))}>
                Tolak
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="friend-group">
        <h3>Teman {accepted.length > 0 && <span className="muted small">{accepted.filter((f) => f.online).length} online</span>}</h3>
        {accepted.length === 0 && !loading && <p className="muted small">Belum ada teman. Bagikan kode kamu, atau masukkan kode teman di atas.</p>}
        {accepted.map((f) => {
          const joinable = f.room && f.room.code !== currentRoom;
          return (
            <div key={f.id} className={f.online ? 'friend' : 'friend offline'}>
              <span className="friend-avatar">
                <Avatar name={f.name} picture={f.picture} />
                <span className={f.online ? 'presence on' : 'presence'} aria-hidden="true" />
              </span>
              <div className="friend-main">
                <strong>{f.name}</strong>
                <span className={f.room?.hosting ? 'small hosting' : 'muted small'}>{describe(f)}</span>
              </div>
              {joinable && f.room && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onJoin(f.room!.code)} aria-label={`Join room ${f.name}`}>
                  Join
                </button>
              )}
              {f.room && f.room.code === currentRoom && <span className="muted small">Di sini</span>}
            </div>
          );
        })}
      </div>

      {outgoing.length > 0 && (
        <div className="friend-group">
          <h3>Terkirim</h3>
          {outgoing.map((f) => (
            <div key={f.id} className="friend">
              <Avatar name={f.name} picture={f.picture} />
              <div className="friend-main">
                <strong>{f.name}</strong>
                <span className="muted small">{describe(f)}</span>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => act(() => removeFriendship(f.id))}>
                Batal
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
