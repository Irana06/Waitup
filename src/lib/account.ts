import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Account, FriendEntry } from '../../shared/protocol.ts';
import { reconnect, socket } from './socket.ts';

/** Signing in is optional: guests use Waitup exactly as before, accounts add a friend list. */

interface AccountState {
  ready: boolean;
  user: Account | null;
  googleClientId: string | null;
}

let state: AccountState = { ready: false, user: null, googleClientId: null };
const listeners = new Set<() => void>();

function set(next: Partial<AccountState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function loadAccount(): Promise<void> {
  try {
    const [config, me] = await Promise.all([
      fetch('/api/config').then((r) => json<{ googleClientId: string | null }>(r)),
      fetch('/api/me', { credentials: 'same-origin' }).then((r) => json<Account | null>(r)),
    ]);
    set({ ready: true, user: me, googleClientId: config.googleClientId });
  } catch {
    set({ ready: true });
  }
}

// ---------- Google Identity Services ----------

interface GoogleId {
  initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; use_fedcm_for_prompt?: boolean }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gsi: Promise<GoogleId> | null = null;

function loadGsi(): Promise<GoogleId> {
  if (!gsi) {
    gsi = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => (window.google ? resolve(window.google.accounts.id) : reject(new Error('gsi')));
      s.onerror = () => reject(new Error('gsi'));
      document.head.appendChild(s);
    });
  }
  return gsi;
}

/** Draws Google's own sign-in button into `el`. Resolves once the user is signed in. */
export async function renderGoogleButton(el: HTMLElement, theme: 'light' | 'dark', onSignedIn: (u: Account) => void, onError: (msg: string) => void) {
  if (!state.googleClientId) {
    onError('Login Google belum disetel di server.');
    return;
  }
  try {
    const id = await loadGsi();
    id.initialize({
      client_id: state.googleClientId,
      callback: async ({ credential }) => {
        try {
          const user = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ credential }),
          }).then((r) => json<Account>(r));
          set({ user });
          reconnect();
          onSignedIn(user);
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Login gagal.');
        }
      },
    });
    el.innerHTML = '';
    id.renderButton(el, { type: 'standard', theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'id' });
  } catch {
    onError('Tombol Google nggak bisa dimuat. Cek koneksi internet kamu.');
  }
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  window.google?.accounts.id.disableAutoSelect();
  set({ user: null });
  reconnect();
}

// ---------- Friends ----------

export function useFriends(): { friends: FriendEntry[]; loading: boolean; error: string; refresh: () => void } {
  const { user } = useAccount();
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!user) {
      setFriends([]);
      return;
    }
    let stop = false;
    setLoading(true);
    // Phones drop requests while switching networks; one quiet retry covers most of those.
    const load = (attempt: number): Promise<void> =>
      fetch('/api/friends', { credentials: 'same-origin' })
        .then((r) => json<{ friends: FriendEntry[] }>(r))
        .then((d) => {
          if (stop) return;
          setFriends(d.friends);
          setError('');
        })
        .catch((e: Error) => {
          if (stop) return;
          if (e instanceof TypeError && attempt === 0) return new Promise<void>((r) => setTimeout(r, 1500)).then(() => load(1));
          // Keep the last list on screen; only say what went wrong.
          setError(e instanceof TypeError ? 'Daftar teman gagal dimuat. Cek koneksi kamu.' : e.message);
        });
    void load(0).finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [user, tick]);

  // Live updates from the server, a slow poll in case an event was missed, and a refresh
  // whenever the phone comes back online or the tab becomes visible again.
  useEffect(() => {
    if (!user) return;
    const onChange = () => refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    socket.on('friends:changed', onChange);
    socket.on('connect', onChange);
    window.addEventListener('online', onChange);
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(refresh, 30_000);
    return () => {
      socket.off('friends:changed', onChange);
      socket.off('connect', onChange);
      window.removeEventListener('online', onChange);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
    };
  }, [user]);

  return { friends, loading, error, refresh };
}

export async function addFriend(code: string): Promise<string> {
  const res = await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ code }),
  }).then((r) => json<{ result: 'requested' | 'accepted' | 'already'; name: string }>(r));
  if (res.result === 'accepted') return `Kamu sekarang berteman dengan ${res.name}.`;
  if (res.result === 'already') return `${res.name} udah ada di daftar teman kamu.`;
  return `Permintaan terkirim ke ${res.name}.`;
}

export async function acceptFriendRequest(id: string): Promise<void> {
  await fetch(`/api/friends/${encodeURIComponent(id)}/accept`, { method: 'POST', credentials: 'same-origin' }).then((r) => json(r));
}

export async function removeFriendship(id: string): Promise<void> {
  await fetch(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).then((r) => json(r));
}
