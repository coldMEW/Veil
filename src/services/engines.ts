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

export const engines = {
  face: () => (face ??= load<FaceEngine>('face')),
  fingerprint: () => (fingerprint ??= load<FingerprintEngine>('fingerprint')),
  watermark: () => (watermark ??= load<WatermarkEngine>('watermark')),
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
