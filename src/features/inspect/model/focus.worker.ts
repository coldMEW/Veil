/// <reference lib="webworker" />
// Runs the model-focus diagnostic off the main thread. The page cancels a run
// by terminating this worker, which also stops any computation in flight.

import { configureOrt, hasWebGpu } from '../../../lib/runtime/ortEnv';
import models from './models.json';
import { CROP, cropGeometry, cropRgba, occlude, resizeBicubic, toChw } from './preprocess';
import type { FocusRequest, FocusResponse } from './focusTypes';

const MODEL = models['communityforensics-vit-s-fp32'];
const BATCH = 8;

const ort = configureOrt();
let session: Awaited<ReturnType<typeof ort.InferenceSession.create>> | null = null;
let loadMs = 0;
let backend: 'webgpu' | 'wasm' = 'wasm';

const post = (msg: FocusResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function getSession() {
  if (session) return session;
  const t0 = performance.now();
  const res = await fetch(MODEL.servedAs);
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== MODEL.sha256) throw new Error('The model file does not match its pinned checksum.');
  // Probe WebGPU first; any failure falls back to the separately tested WASM path.
  if (await hasWebGpu()) {
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      backend = 'webgpu';
    } catch {
      session = null;
    }
  }
  if (!session) {
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    backend = 'wasm';
  }
  loadMs = performance.now() - t0;
  return session;
}

async function logits(s: NonNullable<typeof session>, data: Float32Array, n: number): Promise<Float32Array> {
  const input = new ort.Tensor('float32', data, [n, 3, CROP, CROP]);
  const out = await s.run({ pixel_values: input });
  const logitsTensor = out.logits;
  if (!logitsTensor) throw new Error('Model returned no logits.');
  const values = logitsTensor.data as Float32Array;
  input.dispose();
  logitsTensor.dispose();
  return values;
}

async function run(req: FocusRequest) {
  const { id, bitmap } = req;
  post({ type: 'progress', id, stage: 'loading', done: 0, total: 0 });
  const s = await getSession();
  // Measured on a laptop (Intel Xe-LPG): WebGPU ~0.27 s per pass, so 6 x 6 fits
  // the 10 s budget; WASM is ~0.6 s per pass, so it and phones use 4 x 4.
  const grid = req.grid ?? (backend === 'webgpu' && !req.coarse ? 6 : 4);

  // Preprocess exactly as the model card: Pillow-style bicubic resize of the
  // short edge to 440, then center-crop 384.
  const g = cropGeometry(bitmap.width, bitmap.height);
  const full = new OffscreenCanvas(bitmap.width, bitmap.height);
  const fctx = full.getContext('2d', { willReadFrequently: true });
  if (!fctx) throw new Error('2D canvas is not available in this worker.');
  fctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = fctx.getImageData(0, 0, full.width, full.height).data;
  const resized = resizeBicubic(pixels, full.width, full.height, g.resizedWidth, g.resizedHeight);
  const crop = cropRgba(resized, g.resizedWidth, g.left, g.top);
  const base = toChw(crop);

  const total = grid * grid + 1;
  const t0 = performance.now();
  const baseLogit = (await logits(s, base, 1))[0] ?? Number.NaN;
  const baseMs = performance.now() - t0;
  post({ type: 'progress', id, stage: 'running', done: 1, total });

  const cells = grid * grid;
  const deltas = new Float32Array(cells);
  const one = 3 * CROP * CROP;
  const t1 = performance.now();
  for (let start = 0; start < cells; start += BATCH) {
    const n = Math.min(BATCH, cells - start);
    const batch = new Float32Array(n * one);
    for (let k = 0; k < n; k++) occlude(base, grid, start + k, batch.subarray(k * one, (k + 1) * one));
    const out = await logits(s, batch, n);
    for (let k = 0; k < n; k++) deltas[start + k] = baseLogit - (out[k] ?? Number.NaN);
    post({ type: 'progress', id, stage: 'running', done: 1 + start + n, total });
  }
  const occlusionMs = performance.now() - t1;

  if (!Number.isFinite(baseLogit) || deltas.some((d) => !Number.isFinite(d))) {
    throw new Error('The model produced a non-finite output.');
  }

  post(
    {
      type: 'result',
      id,
      logit: baseLogit,
      deltas,
      grid,
      crop: g.source,
      backend,
      threads: ort.env.wasm.numThreads ?? 1,
      timings: { loadMs, baseMs, occlusionMs },
    },
    [deltas.buffer],
  );
}

self.onmessage = (event: MessageEvent<FocusRequest>) => {
  run(event.data).catch((error: unknown) => {
    post({ type: 'error', id: event.data.id, message: error instanceof Error ? error.message : String(error) });
  });
};
