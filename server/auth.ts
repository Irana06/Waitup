import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Google sign-in uses the ID token from Google Identity Services. Only the public client ID is
 * needed: the token's signature, issuer and audience are checked against Google's published keys.
 */

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const SESSION_COOKIE = 'waitup_session';

export interface GoogleProfile {
  sub: string;
  name: string;
  email: string | null;
  picture: string | null;
}

export async function verifyGoogleCredential(credential: string, clientId: string): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(credential, GOOGLE_KEYS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token without subject');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    sub: payload.sub,
    name: (str(payload.name) ?? str(payload.email) ?? 'Pengguna Google').slice(0, 40),
    email: payload.email_verified === false ? null : str(payload.email),
    picture: str(payload.picture),
  };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
