import { isAndroid } from '../platform/environment';

/** The web build calls its own origin; the Android build calls the deployed site. */
const BASE = isAndroid() ? ((import.meta.env.VITE_API_BASE as string | undefined) ?? '') : '';

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

async function call<T>(action: string, url: string): Promise<T> {
  const res = await fetch(`${BASE}/api/${action}?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The scanner answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

export async function scanPage(url: string): Promise<ScanResult> {
  if (isLocal(url)) {
    const abs = new URL(url, window.location.href).href;
    const res = await fetch(abs);
    if (!res.ok) return { pageUrl: abs, status: res.status, title: null, images: [] };
    if ((res.headers.get('content-type') ?? '').startsWith('image/')) return { pageUrl: abs, status: 200, title: null, images: [{ url: abs, alt: null }] };
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const images = [...doc.querySelectorAll('img')].map((img) => ({ url: new URL(img.getAttribute('src') ?? '', abs).href, alt: img.getAttribute('alt') }));
    return { pageUrl: abs, status: 200, title: doc.title || null, images };
  }
  return call<ScanResult>('scan', url);
}

export async function fetchImageBytes(url: string): Promise<Blob> {
  const res = isLocal(url) ? await fetch(url) : await fetch(`${BASE}/api/image?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not load the image (${res.status}).`);
  }
  return res.blob();
}

export const hostInfo = (url: string) => call<HostInfo>('host', url);

export async function urlStatus(url: string): Promise<{ status: number; gone: boolean }> {
  if (isLocal(url)) {
    const res = await fetch(url, { method: 'HEAD' });
    return { status: res.status, gone: res.status === 404 || res.status === 410 };
  }
  return call('status', url);
}
