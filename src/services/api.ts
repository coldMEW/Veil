import { CapacitorHttp } from '@capacitor/core';
import { isAndroid } from '../platform/environment';
import { extractImages } from '../../server/extract';

export interface ScanResult {
  pageUrl: string;
  status: number;
  title: string | null;
  images: Array<{ url: string; alt: string | null }>;
}
export interface HostInfo {
  host: string;
  ip: string | null;
  hosting: { name: string | null; email: string | null } | null;
  registrar: { name: string | null; email: string | null } | null;
}

/** Addresses on this site (the demo pages) are read directly. */
export function isLocal(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/*
 * Where requests go:
 * - the web build asks its own server (/api/*), because browsers block reading other sites;
 * - the Android app reads the web directly with the native HTTP client (no CORS there, no server needed).
 * Either way only the page or picture the person asked for is fetched; their photo and face never go with it.
 */
const native = isAndroid();
const UA = 'Mozilla/5.0 (Linux; Android 14) VeilScanner/1.0';

/** Private, loopback, link-local and reserved IPv4 ranges. */
export function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const hostChecked = new Map<string, boolean>();
/**
 * The phone fetches pages itself, so it must refuse anything that is not on the public internet:
 * a page being scanned could otherwise point Veil at a router or another device on the home network.
 * Hostnames are resolved over DNS-over-HTTPS first; names that do not resolve to public addresses are refused.
 */
export async function assertPublicHost(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses can be scanned.');
  if (u.username || u.password) throw new Error('Addresses with passwords are not scanned.');
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[') || host.includes(':')) throw new Error('IPv6 addresses are not scanned.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (privateV4(host)) throw new Error('Private network addresses are not scanned.');
    return u;
  }
  if (host === 'localhost' || !host.includes('.') || /\.(local|internal|lan|home|localhost)$/.test(host)) throw new Error('Private network addresses are not scanned.');
  let ok = hostChecked.get(host);
  if (ok === undefined) {
    const r = await CapacitorHttp.get({ url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, headers: { accept: 'application/dns-json' }, connectTimeout: 8000, readTimeout: 8000 });
    const data = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as { Answer?: Array<{ type: number; data: string }> };
    const ips = (data.Answer ?? []).filter((x) => x.type === 1).map((x) => x.data);
    ok = ips.length > 0 && !ips.some(privateV4);
    hostChecked.set(host, ok);
  }
  if (!ok) throw new Error('That address is not on the public internet, so Veil will not open it.');
  return u;
}

/** Native GET with every redirect hop checked before it is followed. */
async function nativeGet(url: string, responseType: 'text' | 'blob') {
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(target);
    const r = await CapacitorHttp.get({ url: target, headers: { 'user-agent': UA }, responseType, connectTimeout: 9000, readTimeout: 15000, disableRedirects: true });
    const headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (r.status >= 300 && r.status < 400 && headers.location) {
      target = new URL(headers.location, target).href;
      continue;
    }
    const type = String(headers['content-type'] ?? '').split(';')[0]!.trim();
    return { status: r.status, type, data: r.data as string, url: target };
  }
  throw new Error('Too many redirects.');
}

async function call<T>(action: string, url: string): Promise<T> {
  const res = await fetch(`/api/${action}?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The scanner answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

function publicHttp(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses can be scanned.');
  return u;
}

export async function scanPage(url: string): Promise<ScanResult> {
  if (isLocal(url)) {
    const abs = new URL(url, window.location.href).href;
    const res = await fetch(abs);
    if (!res.ok) return { pageUrl: abs, status: res.status, title: null, images: [] };
    if ((res.headers.get('content-type') ?? '').startsWith('image/')) return { pageUrl: abs, status: 200, title: null, images: [{ url: abs, alt: null }] };
    const html = await res.text();
    return { pageUrl: abs, status: 200, title: new DOMParser().parseFromString(html, 'text/html').title || null, images: extractImages(html, abs) };
  }
  if (native) {
    publicHttp(url);
    const r = await nativeGet(url, 'text');
    if (r.status >= 400) return { pageUrl: url, status: r.status, title: null, images: [] };
    if (r.type.startsWith('image/')) return { pageUrl: url, status: r.status, title: null, images: [{ url, alt: null }] };
    const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    const title = html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim() ?? null;
    return { pageUrl: url, status: r.status, title, images: extractImages(html, r.url).slice(0, 80) };
  }
  return call<ScanResult>('scan', url);
}

export async function fetchImageBytes(url: string): Promise<Blob> {
  if (isLocal(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the image (${res.status}).`);
    return res.blob();
  }
  if (native) {
    publicHttp(url);
    const r = await nativeGet(url, 'blob');
    if (r.status >= 400) throw new Error(`The site answered ${r.status}.`);
    if (!r.type.startsWith('image/') || r.type === 'image/svg+xml') throw new Error('That address is not a photo.');
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: r.type });
  }
  const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not load the image (${res.status}).`);
  }
  return res.blob();
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
async function nativeJson<T>(url: string): Promise<T | null> {
  try {
    const r = await CapacitorHttp.get({ url, headers: { accept: 'application/dns-json, application/rdap+json, application/json' }, connectTimeout: 9000, readTimeout: 9000 });
    if (r.status >= 400) return null;
    return (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as T;
  } catch {
    return null;
  }
}

export async function hostInfo(url: string): Promise<HostInfo> {
  if (!native) return call<HostInfo>('host', url);
  const host = publicHttp(url).hostname;
  const dns = await nativeJson<{ Answer?: Array<{ type: number; data: string }> }>(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`);
  const ip = dns?.Answer?.find((a) => a.type === 1)?.data ?? null;
  const labels = host.split('.');
  const twoPart = /^(co|com|net|org|ac|gov)\.[a-z]{2}$/.test(labels.slice(-2).join('.'));
  const domain = labels.slice(twoPart ? -3 : -2).join('.');
  const [ipData, domainData] = await Promise.all([
    ip ? nativeJson<{ name?: string; entities?: RdapEntity[] }>(`https://rdap.org/ip/${ip}`) : null,
    nativeJson<{ name?: string; entities?: RdapEntity[] }>(`https://rdap.org/domain/${domain}`),
  ]);
  const abuse = rdapFind(ipData?.entities, 'abuse');
  const org = rdapFind(ipData?.entities, 'registrant');
  return {
    host,
    ip,
    hosting: ipData ? { name: org?.name ?? ipData.name ?? null, email: abuse?.email ?? null } : null,
    registrar: domainData ? { name: rdapFind(domainData.entities, 'registrar')?.name ?? null, email: rdapFind(domainData.entities, 'abuse')?.email ?? null } : null,
  };
}

export async function urlStatus(url: string): Promise<{ status: number; gone: boolean }> {
  if (isLocal(url)) {
    const res = await fetch(url, { method: 'HEAD' });
    return { status: res.status, gone: res.status === 404 || res.status === 410 };
  }
  if (native) {
    const r = await nativeGet(url, 'text');
    return { status: r.status, gone: r.status === 404 || r.status === 410 || r.status === 451 };
  }
  return call('status', url);
}
