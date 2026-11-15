import type { HuntHit } from './types';
export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const v = n[0]?.toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '';
    });
}
export function httpUrl(s: unknown, base?: string): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  try {
    const u = new URL(decodeHtml(s.trim()), base);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
/** Prefer host diversity before the60-hit cap; do not let one mirrored image board crowd out other sources. */
export function uniqueHits(hits: HuntHit[]): HuntHit[] {
  const seen = new Set<string>(),
    deduped = hits.filter((h) => {
      const key = h.pageUrl + '\n' + (h.imageUrl ?? '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const hosts = new Set<string>(),
    first: HuntHit[] = [],
    rest: HuntHit[] = [];
  for (const hit of deduped) {
    const host = new URL(hit.pageUrl).hostname;
    if (hosts.has(host)) rest.push(hit);
    else {
      hosts.add(host);
      first.push(hit);
    }
  }
  return [...first, ...rest].slice(0, 60);
}
export function checkResponse(r: { status: number; url: string; text: string }): void {
  if (
    /showcaptcha|captcha\.js|captcha-checkbox|anomaly-modal|verify you are human|enter the characters|challenge-platform/i.test(
      r.url + ' ' + r.text,
    )
  )
    throw Error('captcha');
  if (r.status < 200 || r.status >= 300) throw Error('http-' + r.status);
}
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/** Syntactic public-HTTPS boundary; server adapters should additionally validate resolved DNS addresses. */
export function publicImageUrl(raw: unknown): string | null {
  const safe = httpUrl(raw);
  if (!safe) return null;
  const u = new URL(safe),
    host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    u.protocol !== 'https:' ||
    host === 'localhost' ||
    /\.(localhost|local|internal|test|invalid)$/.test(host) ||
    (!host.includes('.') && !host.includes(':'))
  )
    return null;
  if (host.includes(':')) {
    const first = parseInt(host.split(':')[0]!, 16);
    return first >= 0x2000 && first <= 0x3fff ? safe : null;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return null;
  }
  return safe;
}
export class PartialHuntError extends Error {
  constructor(
    message: string,
    readonly hits: HuntHit[],
  ) {
    super(message);
  }
}
