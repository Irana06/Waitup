import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState } from '../shared/protocol.ts';
import { clientId, socket } from './lib/socket.ts';
import { deviceLabel } from './lib/format.ts';
import { useTheme } from './lib/theme.ts';
import { stopHosting } from './lib/hostStream.ts';
import { loadAccount, useAccount } from './lib/account.ts';
import { Home } from './components/Home.tsx';
import { Room } from './components/Room.tsx';
import { Privacy } from './components/Privacy.tsx';

const NAME_KEY = 'waitup:name';
/** The room this tab is in, kept across refreshes so a reload walks straight back in. */
const SESSION_KEY = 'waitup:session';

interface Session {
  code: string;
  name: string;
}

function codeFromPath(): string {
  const m = location.pathname.match(/^\/(\d{6})\/?$/);
  return m ? m[1] : '';
}

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: unknown) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: refresh won't auto-rejoin */
  }
}

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [theme, setTheme] = useTheme();
  const { user } = useAccount();
  const [connected, setConnected] = useState(socket.connected);
  // Resume the room from before a refresh, as long as the address still points at it.
  const [session, setSession] = useState<Session | null>(() => {
    const s = read<Session>(sessionStorage, SESSION_KEY);
    return s && (codeFromPath() === s.code || codeFromPath() === '') ? s : null;
  });
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    void loadAccount();
  }, []);

  const enter = useCallback((code: string, name: string) => {
    const s = { code, name };
    setSession(s);
    write(sessionStorage, SESSION_KEY, s);
    setError('');
    if (location.pathname !== `/${code}`) history.pushState(null, '', `/${code}`);
  }, []);

  const forget = useCallback(() => {
    setSession(null);
    setRoom(null);
    write(sessionStorage, SESSION_KEY, null);
  }, []);

  const join = useCallback(
    (code: string, name: string) => {
      setBusy(true);
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        /* name not remembered */
      }
      socket.emit('room:join', { code, name, device: deviceLabel() }, (res) => {
        setBusy(false);
        if (res.ok) enter(res.data.code, name);
        else {
          setError(res.error);
          forget();
        }
      });
    },
    [enter, forget],
  );

  const create = (name: string) => {
    setBusy(true);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* name not remembered */
    }
    socket.emit('room:create', { name, device: deviceLabel() }, (res) => {
      setBusy(false);
      if (res.ok) enter(res.data.code, name);
      else setError(res.error);
    });
  };

  const leave = () => {
    stopHosting();
    socket.emit('room:leave');
    forget();
    history.pushState(null, '', '/');
  };

  /** Join a friend's room from the friend list, leaving the current one first. */
  const joinFriend = (code: string) => {
    if (sessionRef.current?.code === code) return;
    const name = sessionRef.current?.name || savedName() || user?.name.slice(0, 24) || 'Tamu';
    if (sessionRef.current) {
      stopHosting();
      socket.emit('room:leave');
      setRoom(null);
    }
    join(code, name);
  };

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Same tab id as before, so the server hands back the same seat (and host role).
      const s = sessionRef.current;
      if (s) join(s.code, s.name);
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: RoomState) => setRoom(s);
    const onPop = () => {
      if (!codeFromPath() && sessionRef.current) {
        socket.emit('room:leave');
        forget();
      }
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    window.addEventListener('popstate', onPop);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      window.removeEventListener('popstate', onPop);
    };
  }, [join, forget]);

  if (location.pathname === '/privasi') return <Privacy />;

  if (session && room && room.code === session.code) {
    return (
      <Room room={room} you={clientId} connected={connected} theme={theme} onTheme={setTheme} onLeave={leave} onJoinFriend={joinFriend} />
    );
  }

  return (
    <Home
      theme={theme}
      onTheme={setTheme}
      initialName={savedName() || user?.name.slice(0, 24) || ''}
      initialCode={codeFromPath()}
      connected={connected}
      error={error}
      busy={busy || session !== null}
      resuming={session !== null}
      onCreate={create}
      onJoin={join}
      onJoinFriend={joinFriend}
    />
  );
}
