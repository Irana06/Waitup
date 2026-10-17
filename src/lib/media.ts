import type { Media } from '../../shared/protocol.ts';

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
const DIRECT_EXT = /\.(mp4|webm|ogv|mp3|m4a|ogg|oga|wav|flac)$/i;

export function youtubeId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!YT_HOSTS.includes(u.hostname)) return null;
  if (u.hostname === 'youtu.be') return clean(u.pathname.slice(1));
  const v = u.searchParams.get('v');
  if (v) return clean(v);
  const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
  return m ? clean(m[2]) : null;
}

function clean(id: string): string | null {
  const m = id.match(/^[\w-]{6,20}/);
  return m ? m[0] : null;
}

export function isAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|ogg|oga|wav|flac)$/i.test(new URL(url).pathname);
}

async function youtubeTitle(id: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { title?: string };
      if (data.title) return data.title;
    }
  } catch {
    /* fall through to the generic title */
  }
  return 'Video YouTube';
}

export type ParseResult = { ok: true; media: Media } | { ok: false; error: string };

export async function parseMediaLink(raw: string): Promise<ParseResult> {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Tempel link-nya dulu.' };

  const id = youtubeId(text);
  if (id) return { ok: true, media: { kind: 'youtube', videoId: id, title: await youtubeTitle(id) } };

  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: 'Itu bukan link. Coba tempel link lengkap yang diawali https://' };
  }
  if (DIRECT_EXT.test(u.pathname)) {
    const name = decodeURIComponent(u.pathname.split('/').pop() ?? 'Video');
    return { ok: true, media: { kind: 'url', url: u.toString(), title: name } };
  }
  return { ok: false, error: 'Link ini belum bisa diputar. Coba link YouTube, atau file .mp4, .webm, .mp3.' };
}
