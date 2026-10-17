import { useState, type FormEvent } from 'react';
import { Lockup } from './Logo.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import type { Theme } from '../lib/theme.ts';

interface Props {
  theme: Theme;
  onTheme(t: Theme): void;
  initialName: string;
  initialCode: string;
  connected: boolean;
  error: string;
  busy: boolean;
  onCreate(name: string): void;
  onJoin(code: string, name: string): void;
}

export function Home({ theme, onTheme, initialName, initialCode, connected, error, busy, onCreate, onJoin }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [nameError, setNameError] = useState('');
  const [codeError, setCodeError] = useState('');

  const checkName = (): boolean => {
    if (!name.trim()) {
      setNameError('Isi nama kamu dulu, biar temen tahu siapa yang join.');
      return false;
    }
    setNameError('');
    return true;
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (checkName()) onCreate(name.trim());
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const okName = checkName();
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Kode room itu 6 angka.');
      return;
    }
    setCodeError('');
    if (okName) onJoin(code, name.trim());
  };

  return (
    <div className="home">
      <header className="app-header">
        <Lockup height={30} />
        <ThemeToggle theme={theme} onChange={onTheme} />
      </header>

      <main className="home-main">
        <div className="home-hero">
          <h1>Nobar bareng, nggak ada yang ditinggal.</h1>
          <p>Bikin room, bagi kodenya, lalu putar video YouTube atau link file. Kalau ada temen yang buffering, video di-pause buat semua sampai dia siap.</p>
        </div>

        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="name">Nama kamu</label>
          <input
            id="name"
            className="input"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'name-err' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {nameError && (
            <span id="name-err" className="error-text" role="alert">
              {nameError}
            </span>
          )}
        </div>

        {!connected && (
          <p className="muted" role="status" style={{ margin: 0 }}>
            Nyambung ke server…
          </p>
        )}
        {error && (
          <p className="error-text" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}

        <div className="home-grid">
          <form className="card" onSubmit={create}>
            <h2>Jadi host</h2>
            <p className="muted" style={{ margin: 0 }}>
              Kamu yang milih video. Temen join pakai kode 6 angka atau link room.
            </p>
            <button type="submit" className="btn btn-primary" disabled={!connected || busy}>
              {busy ? 'Bikin room…' : 'Bikin room baru'}
            </button>
          </form>

          <form className="card" onSubmit={join}>
            <h2>Join room temen</h2>
            <div className="field">
              <label htmlFor="code">Kode room</label>
              <input
                id="code"
                className="input tabular"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="482913"
                value={code}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'code-err' : undefined}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ letterSpacing: '0.12em', fontWeight: 700 }}
              />
              {codeError && (
                <span id="code-err" className="error-text" role="alert">
                  {codeError}
                </span>
              )}
            </div>
            <button type="submit" className="btn btn-primary" disabled={!connected || busy}>
              {busy ? 'Masuk…' : 'Masuk ke room'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
