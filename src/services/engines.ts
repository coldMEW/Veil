// Engines are built on the pivot/engine branch (face, fingerprint, watermark). They are loaded
// lazily so the first screen stays light, and the app keeps working (and says so) when one is absent.

export interface Face {
  box: { x: number; y: number; w: number; h: number };
  score: number;
  landmarks: Array<[number, number]>;
}

export interface FaceEngine {
  detectFaces(image: ImageBitmap | ImageData): Promise<Face[]>;
  embedFace(image: ImageBitmap | ImageData, face: Face): Promise<Float32Array>;
  compareFaces(a: Float32Array, b: Float32Array): { cosine: number; match: 'same' | 'possible' | 'different' };
  scoreFaceForgery?(image: ImageBitmap | ImageData, face: Face): Promise<number>;
  FACE_FAKE_LEAD?: number;
}

export interface FingerprintEngine {
  pdqHash(image: ImageData): { hash: string; quality: number } | Promise<{ hash: string; quality: number }>;
  hamming(a: string, b: string): number;
  PDQ_MATCH_THRESHOLD?: number;
}

export interface MarkResult {
  found: boolean;
  payload?: bigint | string;
  confidence: number;
  bitErrors?: number;
}

export interface WatermarkEngine {
  embedMark(image: ImageData, key: Uint8Array, payload: bigint): ImageData | Promise<ImageData>;
  detectMark(image: ImageData, key: Uint8Array): MarkResult | Promise<MarkResult>;
}

const modules = import.meta.glob('../engine/*/index.ts');

async function load<T>(name: string): Promise<T | null> {
  const loader = modules[`../engine/${name}/index.ts`];
  if (!loader) return null;
  try {
    return (await loader()) as T;
  } catch (error) {
    console.warn(`Engine ${name} failed to load`, error);
    return null;
  }
}

let face: Promise<FaceEngine | null> | null = null;
let fingerprint: Promise<FingerprintEngine | null> | null = null;
let watermark: Promise<WatermarkEngine | null> | null = null;

/**
 * A worker that answers `{ id, value }` or `{ id, error }`. Hiding or reading a mark in a 9-megapixel
 * photo takes over a second; done on the page's own thread it froze the screen for that long.
 */
function rpc(make: () => Worker) {
  let worker: Worker | null = null;
  let seq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  return <T,>(message: object): Promise<T> => {
    if (!worker) {
      worker = make();
      worker.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
        const w = waiting.get(event.data.id);
        if (!w) return;
        waiting.delete(event.data.id);
        if (event.data.error) w.reject(new Error(event.data.error));
        else w.resolve(event.data.value);
      };
      worker.onerror = () => {
        for (const w of waiting.values()) w.reject(new Error('The engine worker stopped.'));
        waiting.clear();
        worker = null;
      };
    }
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker!.postMessage({ id, ...message });
    });
  };
}

/** The watermark engine with the pixel work moved to its worker. Falls back to the page thread if workers are unavailable. */
async function watermarkEngine(): Promise<WatermarkEngine | null> {
  const direct = await load<WatermarkEngine>('watermark');
  if (!direct || typeof Worker === 'undefined') return direct;
  const call = rpc(() => new Worker(new URL('../engine/watermark/watermark.worker.ts', import.meta.url), { type: 'module' }));
  return {
    embedMark: (image, key, payload) => call<ImageData>({ kind: 'embed', image, key, payload }).catch(() => direct.embedMark(image, key, payload)),
    detectMark: (image, key) => call<MarkResult>({ kind: 'detect', image, key }).catch(() => direct.detectMark(image, key)),
  };
}

async function fingerprintEngine(): Promise<FingerprintEngine | null> {
  const direct = await load<FingerprintEngine>('fingerprint');
  if (!direct || typeof Worker === 'undefined') return direct;
  const call = rpc(() => new Worker(new URL('../engine/fingerprint/fingerprint.worker.ts', import.meta.url), { type: 'module' }));
  return {
    ...direct,
    pdqHash: (image) => call<{ hash: string; quality: number }>({ image }).catch(() => direct.pdqHash(image)),
    hamming: direct.hamming,
  };
}

export const engines = {
  face: () => (face ??= load<FaceEngine>('face')),
  fingerprint: () => (fingerprint ??= fingerprintEngine()),
  watermark: () => (watermark ??= watermarkEngine()),
  has: (name: 'face' | 'fingerprint' | 'watermark') => Boolean(modules[`../engine/${name}/index.ts`]),
};

export const PDQ_MATCH = 31;

/** Pixels of a bitmap, scaled so the long edge is at most maxSide (in memory only). */
export function bitmapToImageData(bitmap: ImageBitmap, maxSide = 0): ImageData {
  const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)) : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not read the image pixels.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** A small JPEG data URL used as the evidence thumbnail on tickets (kept on this device). */
export async function thumbnail(bitmap: ImageBitmap, maxSide = 320): Promise<string> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}
