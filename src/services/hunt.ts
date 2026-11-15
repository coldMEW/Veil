import { CapacitorHttp } from '@capacitor/core';
import { isAndroid } from '../platform/environment';
import { scanPage } from './api';
import { examine, type ScanHit } from './trace';
import { persisted, toBase64 } from './store';
import { engines, type Face } from './engines';

/*
 * Search the web for the person's face, by itself:
 *  1. a crop of their face goes to reverse image search (Yandex, Bing; Google Lens with a key);
 *  2. every result page and picture comes back;
 *  3. each picture is checked against their face ON THE DEVICE; only real matches become tickets.
 * The web app does step 1 on our server (/api/hunt); the Android app does it itself over native HTTP.
 */

export interface HuntHit { engine: string; pageUrl: string; imageUrl: string | null; title: string | null; thumbUrl: string | null }
export interface HuntEngineResult { engine: string; ok: boolean; hits: HuntHit[]; error?: string; ms: number }

export interface HuntProgress {
  stage: 'searching' | 'checking' | 'done' | 'failed';
  engines: HuntEngineResult[];
  candidates: number;
  checked: number;
  faces: number;
  hits: ScanHit[];
  error?: string;
}

/** Past searches: what was found and when, so the watchlist can check those pages again. */
export const hunts = persisted<Array<{ at: number; candidates: number; matches: number; pages: string[] }>>('veil.hunts.v1', []);
export const huntConsent = persisted<boolean>('veil.hunt.consent.v1', false);

interface Transport {
  get(url: string, headers?: Record<string, string>): Promise<{ status: number; url: string; headers: Record<string, string>; text: string }>;
  postMultipart(
    url: string,
    fields: Record<string, string>,
    file: { name: string; field: string; type: string; bytes: Uint8Array },
    headers?: Record<string, string>,
  ): Promise<{ status: number; url: string; headers: Record<string, string>; text: string }>;
}

const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
const asText = (d: unknown) => (typeof d === 'string' ? d : JSON.stringify(d));

/** The Android transport: native HTTP, so no CORS and no server. */
const nativeTransport: Transport = {
  async get(url, headers = {}) {
    const r = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: 15000, readTimeout: 20000 });
    return { status: r.status, url: r.url || url, headers: lower(r.headers), text: asText(r.data) };
  },
  async postMultipart(url, fields, file, headers = {}) {
    const data = [
      ...Object.entries(fields).map(([key, value]) => ({ type: 'string', key, value })),
      { type: 'base64File', key: file.field, value: toBase64(file.bytes), fileName: file.name, contentType: file.type },
    ];
    const r = await CapacitorHttp.post({ url, headers: { ...headers, 'Content-Type': 'multipart/form-data' }, data, dataType: 'formData', responseType: 'text', connectTimeout: 15000, readTimeout: 30000 });
    return { status: r.status, url: r.url || url, headers: lower(r.headers), text: asText(r.data) };
  },
};

const huntModule = import.meta.glob('../../server/hunt/index.ts');

async function searchEngines(crop: Blob): Promise<HuntEngineResult[]> {
  const bytes = new Uint8Array(await crop.arrayBuffer());
  if (isAndroid()) {
    const load = huntModule['../../server/hunt/index.ts'];
    if (!load) throw new Error('Web search is not in this build yet.');
    const mod = (await load()) as { hunt: (img: { bytes: Uint8Array; type: string }, t: Transport) => Promise<HuntEngineResult[]> };
    return mod.hunt({ bytes, type: crop.type || 'image/jpeg' }, nativeTransport);
  }
  const res = await fetch('/api/hunt', { method: 'POST', headers: { 'content-type': crop.type || 'image/jpeg' }, body: bytes });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The search answered ${res.status}.`);
  }
  return (await res.json()) as HuntEngineResult[];
}

/** A tight, upright crop of the largest face, sized for image search. */
export async function faceCrop(bitmap: ImageBitmap): Promise<Blob> {
  const fe = await engines.face();
  if (!fe) throw new Error('The face engine is not in this build.');
  const faces: Face[] = await fe.detectFaces(bitmap);
  if (!faces.length) throw new Error('No face found in that picture. Use a clear photo of your face.');
  const f = faces.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0]!;
  const pad = 0.45;
  const x = Math.max(0, (f.box.x - f.box.w * pad) * bitmap.width);
  const y = Math.max(0, (f.box.y - f.box.h * pad) * bitmap.height);
  const w = Math.min(bitmap.width - x, f.box.w * (1 + 2 * pad) * bitmap.width);
  const h = Math.min(bitmap.height - y, f.box.h * (1 + 2 * pad) * bitmap.height);
  const side = Math.min(640, Math.max(w, h));
  const c = new OffscreenCanvas(Math.round((w / Math.max(w, h)) * side), Math.round((h / Math.max(w, h)) * side));
  c.getContext('2d')!.drawImage(bitmap, x, y, w, h, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

/** The whole pipeline. Calls back as it goes; ends with matches already turned into tickets. */
export async function huntFace(crop: Blob, onProgress: (p: HuntProgress) => void, signal?: AbortSignal): Promise<HuntProgress> {
  const p: HuntProgress = { stage: 'searching', engines: [], candidates: 0, checked: 0, faces: 0, hits: [] };
  onProgress({ ...p });
  try {
    p.engines = await searchEngines(crop);
    onProgress({ ...p });
    // Pictures to check: every result image, plus the pictures on result pages that came without one.
    const images = new Map<string, string>();
    const pagesOnly: string[] = [];
    for (const e of p.engines) for (const h of e.hits) {
      const img = h.imageUrl ?? h.thumbUrl;
      if (img) { if (!images.has(img)) images.set(img, h.pageUrl); }
      else pagesOnly.push(h.pageUrl);
    }
    for (const page of [...new Set(pagesOnly)].slice(0, 12)) {
      if (signal?.aborted) break;
      try {
        const s = await scanPage(page);
        for (const im of s.images.slice(0, 20)) if (!images.has(im.url)) images.set(im.url, page);
      } catch {
        /* a page that will not load is skipped */
      }
    }
    const list = [...images].slice(0, 120);
    p.stage = 'checking';
    p.candidates = list.length;
    onProgress({ ...p });
    let next = 0;
    const worker = async () => {
      while (next < list.length && !signal?.aborted) {
        const [img, page] = list[next++]!;
        try {
          const r = await examine(img, page);
          if (r === 'faces') p.faces++;
          else if (r) { p.faces++; p.hits = [...p.hits, r]; }
        } catch {
          /* unreachable or not a picture */
        }
        p.checked++;
        onProgress({ ...p, hits: [...p.hits] });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    p.stage = 'done';
    hunts.set((l) => [{ at: Date.now(), candidates: p.candidates, matches: p.hits.length, pages: [...new Set(p.hits.map((h) => h.pageUrl))] }, ...l].slice(0, 20));
  } catch (e) {
    p.stage = 'failed';
    p.error = e instanceof Error ? e.message : 'The search failed.';
  }
  onProgress({ ...p });
  return p;
}
