import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** Accounts, sessions and friendships. Rooms are not here; they live in memory and in data/rooms.json. */

const FILE = process.env.WAITUP_DB ?? path.resolve('data/waitup.db');
mkdirSync(path.dirname(FILE), { recursive: true });

const db = new DatabaseSync(FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    picture TEXT,
    friend_code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS friendships (
    a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    requested_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );
`);

export interface User {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
  friendCode: string;
}

const SESSION_DAYS = 60;
// No 0/O or 1/I/L, so codes survive being read out loud.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

type Row = Record<string, string | number | null>;

function toUser(row: Row | undefined): User | null {
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    email: row.email === null ? null : String(row.email),
    picture: row.picture === null ? null : String(row.picture),
    friendCode: String(row.friend_code),
  };
}

function newFriendCode(): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 8; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
    const code = `${s.slice(0, 4)}-${s.slice(4)}`;
    if (!db.prepare('SELECT 1 FROM users WHERE friend_code = ?').get(code)) return code;
  }
}

export function upsertGoogleUser(p: { sub: string; name: string; email: string | null; picture: string | null }): User {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(p.sub);
  if (existing) {
    db.prepare('UPDATE users SET name = ?, email = ?, picture = ? WHERE id = ?').run(p.name, p.email, p.picture, p.sub);
  } else {
    db.prepare('INSERT INTO users (id, name, email, picture, friend_code, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      p.sub, p.name, p.email, p.picture, newFriendCode(), Date.now(),
    );
  }
  return userById(p.sub)!;
}

export function userById(id: string): User | null {
  return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined);
}

export function userByFriendCode(code: string): User | null {
  return toUser(db.prepare('SELECT * FROM users WHERE friend_code = ?').get(code.toUpperCase()) as Row | undefined);
}

export function createSession(userId: string): { token: string; maxAgeSec: number } {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSec = SESSION_DAYS * 24 * 3600;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + maxAgeSec * 1000);
  return { token, maxAgeSec };
}

export function userBySession(token: string | undefined): User | null {
  if (!token) return null;
  const row = db.prepare('SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token) as Row | undefined;
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    deleteSession(token);
    return null;
  }
  return toUser(row);
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export interface FriendLink {
  user: User;
  status: 'accepted' | 'incoming' | 'outgoing';
}

export function friendLinks(me: string): FriendLink[] {
  const rows = db.prepare('SELECT * FROM friendships WHERE a = ? OR b = ?').all(me, me) as Row[];
  const out: FriendLink[] = [];
  for (const r of rows) {
    const other = r.a === me ? String(r.b) : String(r.a);
    const user = userById(other);
    if (!user) continue;
    const status = r.status === 'accepted' ? 'accepted' : r.requested_by === me ? 'outgoing' : 'incoming';
    out.push({ user, status });
  }
  return out;
}

export function acceptedFriendIds(me: string): string[] {
  return friendLinks(me).filter((l) => l.status === 'accepted').map((l) => l.user.id);
}

/** Sends a request, or accepts straight away when the other person already asked. */
export function requestFriend(me: string, other: string): 'requested' | 'accepted' | 'already' {
  const [a, b] = pair(me, other);
  const row = db.prepare('SELECT * FROM friendships WHERE a = ? AND b = ?').get(a, b) as Row | undefined;
  if (row?.status === 'accepted') return 'already';
  if (row && row.requested_by !== me) {
    db.prepare("UPDATE friendships SET status = 'accepted' WHERE a = ? AND b = ?").run(a, b);
    return 'accepted';
  }
  if (row) return 'already';
  db.prepare("INSERT INTO friendships (a, b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)").run(a, b, me, Date.now());
  return 'requested';
}

export function acceptFriend(me: string, other: string): boolean {
  const [a, b] = pair(me, other);
  const res = db.prepare("UPDATE friendships SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending' AND requested_by = ?").run(a, b, other);
  return Number(res.changes) > 0;
}

export function removeFriend(me: string, other: string): void {
  const [a, b] = pair(me, other);
  db.prepare('DELETE FROM friendships WHERE a = ? AND b = ?').run(a, b);
}
