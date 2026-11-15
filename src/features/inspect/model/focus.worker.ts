/// <reference lib="webworker" />
import { modelResponse } from '../../../platform/modelStore';
// Runs the model-focus diagnostic off the main thread. The page cancels a run
// by terminating this worker, which also stops any computation in flight.

import { configureOrt, hasWebGpu } from '../../../lib/runtime/ortEnv';
import models from './models.json';
import { CROP, cropGeometry, cropRgba, occlude, resizeBicubic, selectFocusGrid, toChw, viewWindows } from './preprocess';
import type { FocusRequest, FocusResponse, FocusResult } from './focusTypes';

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
  const res = await modelResponse(MODEL.servedAs);
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
  let outputs: Awaited<ReturnType<typeof s.run>> | undefined;
  try {
    outputs = await s.run({ pixel_values: input });
    const tensor = outputs.logits;
    if (!tensor || tensor.type !== 'float32' || !(tensor.data instanceof Float32Array) ||
        tensor.dims.length !== 2 || tensor.dims[0] !== n || tensor.dims[1] !== 1 || tensor.data.length !== n) {
      throw new Error('Model returned no float32 logits [N,1].');
    }
    if (tensor.data.some((value) => !Number.isFinite(value))) throw new Error('The model produced a non-finite output.');
    return Float32Array.from(tensor.data);
  } finally {
    input.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
  }
}

async function run(req: FocusRequest) {
  const { id, bitmap } = req;
  const started = performance.now();
  post({ type: 'progress', id, stage: 'loading', done: 0, total: 0 });
  const s = await getSession();
  // 64 GPU / 36 WASM occlusions in batches of 8; phones use 16 on either backend.
  // These are workload choices, not a browser/phone performance guarantee.
  const grid = selectFocusGrid(backend, req.coarse, req.grid);

  // Preprocess exactly as the model card: Pillow-style bicubic resize of the
  // short edge to 440, then center-crop 384.
  const preprocessStart = performance.now();
  const g = cropGeometry(bitmap.width, bitmap.height);
  const full = new OffscreenCanvas(bitmap.width, bitmap.height);
  const fctx = full.getContext('2d', { willReadFrequently: true });
  if (!fctx) throw new Error('2D canvas is not available in this worker.');
  fctx.drawImage(bitmap, 0, 0);
  const pixels = fctx.getImageData(0, 0, full.width, full.height).data;
  const resized = resizeBicubic(pixels, full.width, full.height, g.resizedWidth, g.resizedHeight);
  const crop = cropRgba(resized, g.resizedWidth, g.left, g.top);
  const base = toChw(crop);
  // The ends of the long edge, at the same scale, so the model also sees what the centre crop leaves out.
  const windows = viewWindows(g);
  const extra = windows.filter((w) => w.label !== 'center');
  const extraBatch = new Float32Array(extra.length * 3 * CROP * CROP);
  extra.forEach((w, k) => toChw(cropRgba(resized, g.resizedWidth, w.left, w.top), extraBatch.subarray(k * 3 * CROP * CROP, (k + 1) * 3 * CROP * CROP)));
  const preprocessMs = performance.now() - preprocessStart;

  const total = grid * grid + 1 + (extra.length ? 1 : 0);
  const t0 = performance.now();
  const baseLogit = (await logits(s, base, 1))[0] ?? Number.NaN;
  const baseMs = performance.now() - t0;
  post({ type: 'progress', id, stage: 'running', done: 1, total });

  const views: NonNullable<FocusResult['views']> = [{ label: 'center', logit: baseLogit, crop: g.source }];
  if (extra.length) {
    const out = await logits(s, extraBatch, extra.length);
    extra.forEach((w, k) => views.push({ label: w.label, logit: out[k] ?? Number.NaN, crop: w.source }));
    post({ type: 'progress', id, stage: 'running', done: 2, total });
  }
  const viewOffset = extra.length ? 2 : 1;

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
    post({ type: 'progress', id, stage: 'running', done: viewOffset + start + n, total });
  }
  const occlusionMs = performance.now() - t1;

  if (!Number.isFinite(baseLogit) || deltas.some((d) => !Number.isFinite(d)) || views.some((v) => !Number.isFinite(v.logit))) {
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
      views,
      backend,
      threads: ort.env.wasm.numThreads ?? 1,
      timings: { loadMs, preprocessMs, baseMs, occlusionMs, totalMs: performance.now() - started },
    },
    [deltas.buffer],
  );
}

self.onmessage = (event: MessageEvent<FocusRequest>) => {
  run(event.data).catch((error: unknown) => {
    post({ type: 'error', id: event.data.id, message: error instanceof Error ? error.message : String(error) });
  }).finally(() => event.data.bitmap.close());
};
