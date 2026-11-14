import { useCallback, useEffect, useRef, useState } from 'react';
import type { TransformRecord } from '../../contracts';
import type { Pixels } from '../../features/clean/mask';
import { DiffVaxImmunizer, DIFFVAX_SHA256 } from '../../features/protect/diffvax';
import { runProtect, PROTECT_LABEL } from '../../features/protect/protect';

/** Same-origin copy of the pinned Hugging Face artifact (scripts/export/models.json, verified by SHA-256). */
export const DIFFVAX_URL = '/models/diffvax/diffvax_immunizer.onnx';
export const DIFFVAX_BYTES = 36_640_862;

export type ProtectState =
  | { status: 'idle' }
  | { status: 'downloading'; loaded: number; total: number }
  | { status: 'ready' }
  | { status: 'protecting'; step: string }
  | {
      status: 'done';
      bytes: Uint8Array;
      sha256: string;
      preview: ImageBitmap;
      psnr: number;
      ssim: number;
      transforms: TransformRecord[];
      backend: 'webgpu' | 'wasm';
      ms: number;
    }
  | { status: 'failed'; message: string };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

function bitmapPixels(bitmap: ImageBitmap): Pixels {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not read the photo pixels.');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: img.width, height: img.height, data: img.data };
}

async function fetchWithProgress(url: string, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`The protection model could not be downloaded (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || DIFFVAX_BYTES;
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let loaded = 0;
  const extra: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length <= total) out.set(value, loaded);
    else extra.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  if (!extra.length && loaded === total) return out;
  const all = new Uint8Array(loaded);
  all.set(out.subarray(0, Math.min(loaded, total)));
  let o = total;
  for (const e of extra) {
    all.set(e, o);
    o += e.length;
  }
  return all.subarray(0, loaded);
}

/**
 * Protect: downloads the DiffVax immunizer automatically (once, SHA-256 checked), then on request adds its
 * perturbation to the open photo and exports a new PNG. The original is never changed.
 */
export function useProtect(assetId: string | null, sha256: string | null, bitmap: ImageBitmap | null) {
  const [state, setState] = useState<ProtectState>({ status: 'idle' });
  const immunizer = useRef<DiffVaxImmunizer | null>(null);
  const backend = useRef<'webgpu' | 'wasm'>('wasm');
  const loading = useRef<Promise<void> | null>(null);
  const run = useRef(0);

  useEffect(() => {
    run.current++;
    setState((prev) => {
      if (prev.status === 'done') prev.preview.close();
      return immunizer.current?.state === 'ready' ? { status: 'ready' } : { status: 'idle' };
    });
  }, [assetId]);

  const load = useCallback(() => {
    if (immunizer.current?.state === 'ready') return Promise.resolve();
    loading.current ??= (async () => {
      setState({ status: 'downloading', loaded: 0, total: DIFFVAX_BYTES });
      try {
        const bytes = await fetchWithProgress(DIFFVAX_URL, (loaded, total) => setState({ status: 'downloading', loaded, total }));
        const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
        const order: Array<'webgpu' | 'wasm'> = gpu ? ['webgpu', 'wasm'] : ['wasm'];
        let lastError: unknown = null;
        for (const b of order) {
          const m = new DiffVaxImmunizer();
          try {
            await m.load(DIFFVAX_URL, b, { fetchBytes: async () => bytes });
            immunizer.current = m;
            backend.current = b;
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
          }
        }
        if (lastError) throw lastError;
        setState({ status: 'ready' });
      } catch (e) {
        setState({ status: 'failed', message: message(e) });
        throw e;
      } finally {
        loading.current = null;
      }
    })();
    return loading.current;
  }, []);

  const protect = useCallback(async () => {
    if (!bitmap || !sha256) return;
    const my = ++run.current;
    try {
      await load();
      if (my !== run.current) return;
      setState({ status: 'protecting', step: 'Adding protection' });
      const t0 = performance.now();
      const src = bitmapPixels(bitmap);
      const [out] = await runProtect({ src, srcSha256: sha256, arms: ['diffvax'], seed: 0, immunizer: immunizer.current! });
      if (!out) throw new Error('Protection produced no output.');
      if (my !== run.current) return;
      setState({ status: 'protecting', step: 'Saving a new file' });
      const preview = await createImageBitmap(new ImageData(new Uint8ClampedArray(out.pixels.data), out.pixels.width, out.pixels.height));
      const digest = out.transforms[0]?.outputSha256 ?? '';
      setState({
        status: 'done',
        bytes: out.bytes,
        sha256: digest,
        preview,
        psnr: out.fidelity.psnr,
        ssim: out.fidelity.ssim,
        transforms: out.transforms,
        backend: backend.current,
        ms: Math.round(performance.now() - t0),
      });
    } catch (e) {
      if (my === run.current) setState({ status: 'failed', message: message(e) });
    }
  }, [bitmap, sha256, load]);

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'done') prev.preview.close();
      return immunizer.current?.state === 'ready' ? { status: 'ready' } : { status: 'idle' };
    });
  }, []);

  return { state, load, protect, reset, label: PROTECT_LABEL, modelSha256: DIFFVAX_SHA256 };
}
