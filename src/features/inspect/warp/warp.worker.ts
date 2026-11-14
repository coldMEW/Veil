/// <reference lib="webworker" />
import { modelResponse } from '../../../lib/native/modelStore';
// Cancellation terminates this worker, including model fetch and computation.
import { configureOrt, hasWebGpu } from '../../../lib/runtime/ortEnv';
import { EXACT_RESIZE, faceRectFromBox, flowMagnitude, preprocessBitmap, SHORTEST_EDGE } from './preprocess';
import { MODEL_INFO, type WarpRequest, type WarpResponse, type WarpRunRequest } from './warpTypes';

const ort = configureOrt();
let session: Awaited<ReturnType<typeof ort.InferenceSession.create>> | null = null;
let backend: 'webgpu' | 'wasm' = 'wasm';
let loadMs = 0;
let warmupMs = 0;
// Serialize preload and inference requests, retaining the verified session between runs.
let queue = Promise.resolve();

const post = (message: WarpResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer);

async function warmup(s: NonNullable<typeof session>) {
  const input = new ort.Tensor('float32', new Float32Array(3 * SHORTEST_EDGE * SHORTEST_EDGE), [1, 3, SHORTEST_EDGE, SHORTEST_EDGE]);
  let outputs: Awaited<ReturnType<typeof s.run>> | undefined;
  const t0 = performance.now();
  try {
    // Compile shaders before ready is sent. The public model input remains NCHW;
    // preferredLayout changes internal WebGPU operators, not the ONNX I/O contract.
    outputs = await s.run({ image: input });
  } finally {
    warmupMs += performance.now() - t0;
    input.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
  }
}

async function releaseSession() {
  try { await session?.release(); } catch { /* A failed GPU session must not prevent WASM fallback. */ }
  session = null;
}

async function getSession() {
  if (session) return session;
  if (!/^[a-f0-9]{64}$/i.test(MODEL_INFO.sha256) || !Number.isSafeInteger(MODEL_INFO.bytes) || MODEL_INFO.bytes <= 0) {
    throw new Error('The face-warp model is unavailable until its checksum and byte count are pinned in models.json.');
  }
  const t0 = performance.now();
  warmupMs = 0;
  const response = await modelResponse(MODEL_INFO.servedAs);
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== MODEL_INFO.bytes) throw new Error('The model file does not match its pinned byte count.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== MODEL_INFO.sha256.toLowerCase()) throw new Error('The model file does not match its pinned checksum.');
  if (await hasWebGpu()) {
    try {
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: [{ name: 'webgpu', preferredLayout: 'NHWC' }], graphOptimizationLevel: 'all',
      });
      backend = 'webgpu';
      await warmup(session);
    } catch {
      await releaseSession();
    }
  }
  if (!session) {
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    backend = 'wasm';
    try {
      await warmup(session);
    } catch (error) {
      await releaseSession();
      throw error;
    }
  }
  loadMs = Math.max(0, performance.now() - t0 - warmupMs);
  return session;
}

async function run({ id, bitmap, face }: WarpRunRequest) {
  const started = performance.now();
  try {
    faceRectFromBox(bitmap.width, bitmap.height, face);
    if (!session) post({ type: 'progress', id, stage: 'loading' });
    const s = await getSession();
    const t0 = performance.now();
    const input = await preprocessBitmap(bitmap, face, EXACT_RESIZE);
    const preprocessMs = performance.now() - t0;
    post({ type: 'progress', id, stage: 'running' });
    const tensor = new ort.Tensor('float32', input.data, [1, 3, input.height, input.width]);
    let outputs: Awaited<ReturnType<typeof s.run>> | undefined;
    try {
      const t1 = performance.now();
      outputs = await s.run({ image: tensor });
      const inferenceMs = performance.now() - t1;
      const t2 = performance.now();
      const flow = outputs.flow;
      if (!flow || flow.type !== 'float32' || !(flow.data instanceof Float32Array)) {
        throw new Error('Model returned no float32 flow tensor.');
      }
      const result = flowMagnitude(flow.data, flow.dims);
      const postprocessMs = performance.now() - t2;
      post({
        type: 'result', id, ...result, faceRect: input.faceRect,
        backend, threads: ort.env.wasm.numThreads ?? 1,
        timings: {
          loadMs, warmupMs, preprocessMs, decodeMs: input.decodeMs, resizeMs: input.resizeMs,
          normalizeMs: input.normalizeMs, inferenceMs, postprocessMs, totalMs: performance.now() - started,
        },
      }, [result.magnitude.buffer]);
    } finally {
      tensor.dispose();
      if (outputs) for (const output of Object.values(outputs)) output.dispose();
    }
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WarpRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    if (request.type === 'preload') {
      post({ type: 'progress', id: request.id, stage: 'loading' });
      await getSession();
      post({ type: 'ready', id: request.id });
    } else {
      await run(request);
    }
  }).catch((error: unknown) => {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : 'The face-warp run failed.' });
  });
};
