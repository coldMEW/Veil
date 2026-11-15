// Veil's only server code: fetch a public page or image the person asked to scan, and look up who
// hosts a site. It never receives the person's photo or face data. Shared by the Vite dev/preview
// middleware and the Vercel functions in /api.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const UA = 'VeilScanner/1.0 (+deepfake takedown assistant)';
const PAGE_LIMIT = 3 * 1024 * 1024;
const IMAGE_LIMIT = 15 * 1024 * 1024;
const TIMEOUT_MS = 9000;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]!) : false;
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Only public http(s) addresses: no localhost, no private networks (no SSRF). */
async function assertPublic(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'That is not a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http and https addresses can be scanned.');
  if (url.username || url.password) throw new HttpError(400, 'Addresses with passwords are not scanned.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new HttpError(404, `Could not find ${host}.`);
  if (addresses.some((a) => privateAddress(a.address))) throw new HttpError(400, 'Private network addresses are not scanned.');
  return url;
}

async function guardedFetch(raw: string, accept: string): Promise<Response> {
  let target = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublic(target);
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      target = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    return res;
  }
  throw new HttpError(508, 'Too many redirects.');
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > limit) throw new HttpError(413, 'The file is too large to scan.');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'The file is too large to scan.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export interface ScanResult {
  pageUrl: string;
  status: number;
  title: string | null;
  images: Array<{ url: string; alt: string | null }>;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function extractImages(html: string, base: string): Array<{ url: string; alt: string | null }> {
  const found = new Map<string, string | null>();
  const add = (src: string | undefined, alt: string | null = null) => {
    if (!src || src.startsWith('data:')) return;
    try {
      const abs = new URL(decode(src.trim()), base);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') if (!found.has(abs.href)) found.set(abs.href, alt);
    } catch {
      /* skip malformed */
    }
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/gi)) {
    add(m[0].match(/content=["']([^"']+)["']/i)?.[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? null;
    const srcset = tag.match(/\b(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
    const largest = srcset?.split(',').map((s) => s.trim().split(/\s+/)[0]).pop();
    add(largest ?? tag.match(/\b(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1], alt ? decode(alt) : null);
  }
  for (const m of html.matchAll(/<a\b[^>]+href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) add(m[1]);
  return [...found].slice(0, 80).map(([url, alt]) => ({ url, alt }));
}

export async function scanPage(raw: string): Promise<ScanResult> {
  const res = await guardedFetch(raw, 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5');
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) return { pageUrl: res.url || raw, status: res.status, title: null, images: [] };
  if (type.startsWith('image/')) {
    await res.body?.cancel();
    return { pageUrl: raw, status: res.status, title: null, images: [{ url: raw, alt: null }] };
  }
  const html = new TextDecoder().decode(await readLimited(res, PAGE_LIMIT));
  const title = html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim() ?? null;
  return { pageUrl: raw, status: res.status, title: title ? decode(title) : null, images: extractImages(html, raw) };
}

export async function fetchImage(raw: string): Promise<{ bytes: Uint8Array; type: string; status: number }> {
  const res = await guardedFetch(raw, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8');
  if (!res.ok) throw new HttpError(res.status === 404 || res.status === 410 ? res.status : 502, `The site answered ${res.status}.`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!type.startsWith('image/') || type === 'image/svg+xml') throw new HttpError(415, 'That address is not a photo.');
  return { bytes: await readLimited(res, IMAGE_LIMIT), type, status: res.status };
}

/** Is it still up? Used to close tickets when the image is gone. */
export async function urlStatus(raw: string): Promise<{ status: number; gone: boolean }> {
  try {
    const res = await guardedFetch(raw, '*/*');
    await res.body?.cancel();
    return { status: res.status, gone: res.status === 404 || res.status === 410 || res.status === 451 };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { status: 404, gone: true };
    throw e;
  }
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, unknown]>];
  entities?: RdapEntity[];
}

function rdapFind(entities: RdapEntity[] | undefined, role: string): { name: string | null; email: string | null } | null {
  for (const e of entities ?? []) {
    const card = e.vcardArray?.[1] ?? [];
    const name = (card.find((f) => f[0] === 'fn')?.[3] as string | undefined) ?? null;
    const email = (card.find((f) => f[0] === 'email')?.[3] as string | undefined) ?? null;
    if (e.roles?.includes(role) && (email || name)) return { name, email };
    const nested = rdapFind(e.entities, role);
    if (nested) return { name: nested.name ?? name, email: nested.email };
  }
  return null;
}

async function rdap(path: string): Promise<{ name?: string; entities?: RdapEntity[] } | null> {
  try {
    const res = await fetch(`https://rdap.org/${path}`, { headers: { accept: 'application/rdap+json', 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? ((await res.json()) as { name?: string; entities?: RdapEntity[] }) : null;
  } catch {
    return null;
  }
}

export interface HostInfo {
  host: string;
  ip: string | null;
  hosting: { name: string | null; email: string | null } | null;
  registrar: { name: string | null; email: string | null } | null;
}

/** Who to send it to when the site itself will not answer: the hosting company and the registrar. */
export async function hostInfo(raw: string): Promise<HostInfo> {
  const url = await assertPublic(raw);
  const host = url.hostname;
  const ip = isIP(host) ? host : ((await lookup(host).catch(() => null))?.address ?? null);
  const labels = host.split('.');
  const twoPart = /^(co|com|net|org|ac|gov)\.[a-z]{2}$/.test(labels.slice(-2).join('.'));
  const domain = labels.slice(twoPart ? -3 : -2).join('.');
  const [ipData, domainData] = await Promise.all([ip ? rdap(`ip/${ip}`) : null, isIP(host) ? null : rdap(`domain/${domain}`)]);
  const hostingAbuse = rdapFind(ipData?.entities, 'abuse');
  const hostingOrg = rdapFind(ipData?.entities, 'registrant');
  const registrar = rdapFind(domainData?.entities, 'registrar');
  const registrarAbuse = rdapFind(domainData?.entities, 'abuse');
  return {
    host,
    ip,
    hosting: ipData ? { name: hostingOrg?.name ?? ipData.name ?? null, email: hostingAbuse?.email ?? null } : null,
    registrar: domainData ? { name: registrar?.name ?? null, email: registrarAbuse?.email ?? null } : null,
  };
}

/** Route a request path to a handler. Returns a web Response. */
export async function handleApi(pathname: string, params: URLSearchParams): Promise<Response> {
  const target = params.get('url') ?? '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  try {
    if (!target) throw new HttpError(400, 'Add a web address.');
    if (pathname.endsWith('/scan')) return json(await scanPage(target));
    if (pathname.endsWith('/host')) return json(await hostInfo(target));
    if (pathname.endsWith('/status')) return json(await urlStatus(target));
    if (pathname.endsWith('/image')) {
      const img = await fetchImage(target);
      return new Response(img.bytes as BodyInit, {
        status: 200,
        headers: { 'content-type': img.type, 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' },
      });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    const message = e instanceof HttpError ? e.message : e instanceof Error && e.name === 'TimeoutError' ? 'The site took too long to answer.' : 'The site could not be reached.';
    return json({ error: message }, status);
  }
}
