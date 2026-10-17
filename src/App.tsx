import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState } from '../shared/protocol.ts';
import { socket } from './lib/socket.ts';
import { deviceLabel } from './lib/format.ts';
import { useTheme } from './lib/theme.ts';
import { Home } from './components/Home.tsx';
import { Room } from './components/Room.tsx';

const NAME_KEY = 'waitup:name';

interface Session {
  code: string;
  name: string;
  you: string;
}

function codeFromPath(): string {
  const m = location.pathname.match(/^\/(\d{6})\/?$/);
  return m ? m[1] : '';
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
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const remember = (name: string) => {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* not remembered, that's fine */
    }
  };

  const enter = useCallback((code: string, name: string, you: string) => {
    setSession({ code, name, you });
    setError('');
    if (location.pathname !== `/${code}`) history.pushState(null, '', `/${code}`);
  }, []);

  const join = useCallback(
    (code: string, name: string) => {
      setBusy(true);
      remember(name);
      socket.emit('room:join', { code, name, device: deviceLabel() }, (res) => {
        setBusy(false);
        if (res.ok) enter(res.data.code, name, res.data.you);
        else {
          setError(res.error);
          setSession(null);
          setRoom(null);
        }
      });
    },
    [enter],
  );

  const create = (name: string) => {
    setBusy(true);
    remember(name);
    socket.emit('room:create', { name, device: deviceLabel() }, (res) => {
      setBusy(false);
      if (res.ok) enter(res.data.code, name, res.data.you);
      else setError(res.error);
    });
  };

  const leave = () => {
    socket.emit('room:leave');
    setSession(null);
    setRoom(null);
    history.pushState(null, '', '/');
  };

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // A reconnect gets a new socket id, so walk back into the room we were in.
      const s = sessionRef.current;
      if (s) join(s.code, s.name);
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: RoomState) => setRoom(s);
    const onPop = () => {
      if (!codeFromPath() && sessionRef.current) {
        socket.emit('room:leave');
        setSession(null);
        setRoom(null);
      }
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    window.addEventListener('popstate', onPop);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      window.removeEventListener('popstate', onPop);
    };
  }, [join]);

  if (session && room && room.code === session.code) {
    return <Room room={room} you={session.you} connected={connected} theme={theme} onTheme={setTheme} onLeave={leave} />;
  }

  return (
    <Home
      theme={theme}
      onTheme={setTheme}
      initialName={savedName()}
      initialCode={codeFromPath()}
      connected={connected}
      error={error}
      busy={busy || (session !== null && room === null)}
      onCreate={create}
      onJoin={join}
    />
  );
}
