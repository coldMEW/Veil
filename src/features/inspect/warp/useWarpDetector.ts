import { isAndroid } from '../../../lib/native/environment';
import { ensureOptionalModel } from '../../../lib/native/modelConsent';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckResult } from '../../../contracts';
import { EXACT_RESIZE, HIGH, LOW, SHORTEST_EDGE, warpPointToSource } from './preprocess';
import { MODEL_INFO, type FaceBox, type WarpRequest, type WarpResponse, type WarpResult } from './warpTypes';

export { FACE_BOX_HINT, MODEL_INFO } from './warpTypes';

export type WarpState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'running' }
  | { status: 'done'; result: WarpResult; checkResult: CheckResult }
  | { status: 'failed'; message: string };

const TIMEOUT_MS = 120_000;

// One model session for this page. The named preload() and the hook share it,
// so the UI can start loading before the user has selected a face box.
type Reply = Extract<WarpResponse, { type: 'ready' | 'result' }>;
let worker: Worker | null = null;
let nextId = 0;
let ready = false;
let preloading: Promise<void> | null = null;
const pending = new Map<number, {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: number;
  progress?: (stage: 'loading' | 'running') => void;
}>();

function cancelWorker(error = new Error('The face-warp run was cancelled.')) {
  worker?.terminate();
  worker = null;
  ready = false;
  preloading = null;
  for (const task of pending.values()) {
    window.clearTimeout(task.timer);
    task.reject(error);
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./warp.worker.ts', import.meta.url), { type: 'module' });
  worker = created;
  created.onmessage = (event: MessageEvent<WarpResponse>) => {
    if (worker !== created) return;
    const message = event.data;
    const task = pending.get(message.id);
    if (!task) return;
    if (message.type === 'progress') {
      task.progress?.(message.stage);
      return;
    }
    pending.delete(message.id);
    window.clearTimeout(task.timer);
    if (message.type === 'error') task.reject(new Error(message.message));
    else task.resolve(message);
  };
  // Fatal worker errors and timeouts cancel outstanding work, including computation.
  created.onerror = () => {
    if (worker === created) cancelWorker(new Error('The model worker stopped unexpectedly.'));
  };
  created.onmessageerror = () => {
    if (worker === created) cancelWorker(new Error('The model worker returned an unreadable response.'));
  };
  return created;
}

function request(message: WarpRequest, transfer: Transferable[] = [], progress?: (stage: 'loading' | 'running') => void) {
  const target = getWorker();
  return new Promise<Reply>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      // A timeout is a cancellation: rejecting alone would leave the model running.
      cancelWorker(new Error('Timed out after 2 minutes, so the run was stopped.'));
    }, TIMEOUT_MS);
    pending.set(message.id, { resolve, reject, timer, progress });
    try {
      target.postMessage(message, transfer);
    } catch (error) {
      pending.delete(message.id);
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error('The face-warp request could not be sent.'));
    }
  });
}

/** Verify and warm up the model on a 400 x 400 zero tensor, without sending a user image. */
export function preload(): Promise<void> {
  if (ready) return Promise.resolve();
  if (preloading) return preloading;
  try {
    const target = getWorker();
    const loading = request({ type: 'preload', id: ++nextId }).then((reply) => {
      if (worker !== target) throw new Error('Model preloading was cancelled.');
      if (reply.type !== 'ready') throw new Error('The model worker did not finish preloading.');
      ready = true;
    });
    preloading = loading;
    // Clear failed preload promises so the same worker can retry the download.
    const clear = () => { if (preloading === loading) preloading = null; };
    void loading.then(clear, clear);
    return loading;
  } catch (error) {
    return Promise.reject(error);
  }
}

export function toCheckResult(assetId: string, r: WarpResult): CheckResult {
  const gridSize = 3;
  const sums = new Array<number>(9).fill(0);
  const counts = new Array<number>(9).fill(0);
  const maxima = new Array<number>(9).fill(0);
  let peak = 0;
  for (let i = 0; i < r.magnitude.length; i++) {
    if (r.magnitude[i]! > r.magnitude[peak]!) peak = i;
    const col = Math.min(2, Math.floor((i % r.width) * gridSize / r.width));
    const row = Math.min(2, Math.floor(Math.floor(i / r.width) * gridSize / r.height));
    const cell = row * gridSize + col;
    sums[cell]! += r.magnitude[i]!;
    counts[cell]!++;
    maxima[cell] = Math.max(maxima[cell]!, r.magnitude[i]!);
  }
  const px = peak % r.width;
  const py = Math.floor(peak / r.width);
  const col = Math.min(2, Math.floor(px * 3 / r.width));
  const row = Math.min(2, Math.floor(py * 3 / r.height));
  const region = [
    'upper left', 'upper center', 'upper right',
    'middle left', 'center', 'middle right',
    'lower left', 'lower center', 'lower right',
  ][row * 3 + col];
  return {
    id: 'face-warp', assetId, kind: 'model', execution: 'complete', finding: 'inconclusive',
    title: 'Predicted face warp',
    observation: r.maxMagnitude === 0
      ? 'Largest predicted warp: 0.0 px across the face box.'
      : `Largest predicted warp: ${r.maxMagnitude.toFixed(1)} px near the ${region} of the face box (at the 400-pixel short-side scale).`,
    method: `Wang et al., ICCV 2019, Detecting Photoshopped Faces by Scripting Photoshop. Model: ${MODEL_INFO.name}, sha256 ${MODEL_INFO.sha256 || 'unavailable (placeholder)'}. Face crop resized with Pillow-style bicubic interpolation to shorter side ${SHORTEST_EDGE}, long side floored; ImageNet-normalized RGB; predicted flow magnitude. ONNX Runtime Web (${r.backend.toUpperCase()}, ${r.threads} thread${r.threads === 1 ? '' : 's'}).`,
    assumptions: [
      'The face box was drawn eyebrows-to-chin and ear-to-ear; Veil widens it the way the training crops were widened (width/2.5 on the sides and below, width/1.5 above).',
      'One face is in the box.',
    ],
    limitations: [
      'Trained only on Photoshop Face-Aware Liquify.',
      'Does not detect AI generation or other edits.',
      'Real faces can show some predicted warp.',
      'Only the face box was analysed.',
      'Magnitudes and display thresholds are not calibrated probabilities or an authenticity verdict.',
    ],
    reason: 'Predicted warp from this model alone cannot establish whether the image was edited.',
    evidence: {
      maxMagnitude: r.maxMagnitude, meanMagnitude: r.meanMagnitude,
      units: 'pixels at the 400-pixel short-side scale',
      thresholds: { low: LOW, high: HIGH, purpose: 'display only' },
      gridSummary: { width: gridSize, height: gridSize, order: 'row-major', counts,
        mean: sums.map((sum, i) => counts[i]! ? sum / counts[i]! : null), max: maxima.map((max, i) => counts[i]! ? max : null) },
      outputSize: { width: r.width, height: r.height }, faceRect: r.faceRect,
      peak: { column: px, row: py, source: warpPointToSource(px, py, r.width, r.height, r.faceRect) },
      backend: r.backend, threads: r.threads, timingsMs: r.timings, model: MODEL_INFO,
      resizeMode: 'pil-exact', cropMode: EXACT_RESIZE ? 'rgba-crop' : 'bitmap-crop',
    },
    overlays: [], source: 'live',
  };
}

/** Reuse the page's verified session; cancel/unmount (including timeout cancellation) terminate it. */
export function useWarpDetector(assetId: string | null, bitmap: ImageBitmap | null) {
  const [state, setState] = useState<WarpState>({ status: 'idle' });
  const runId = useRef(0);

  useEffect(() => {
    // Invalidate stale image results without throwing away the model session.
    runId.current++;
    setState({ status: 'idle' });
  }, [assetId, bitmap]);

  useEffect(() => () => {
    runId.current++;
    cancelWorker();
  }, []);

  const preloadModel = useCallback(async () => {
    const id = ++runId.current;
    setState({ status: 'loading' });
    try {
      if (isAndroid()) await ensureOptionalModel('warp');
      await preload();
      if (runId.current === id) setState({ status: 'idle' });
    } catch (error) {
      if (runId.current === id) setState({ status: 'failed', message: `${error instanceof Error ? error.message : 'Model preloading failed.'} The result is inconclusive.` });
    }
  }, []);

  const run = useCallback(async (face: FaceBox) => {
    if (!assetId || !bitmap) return;
    const id = ++runId.current;
    setState({ status: ready ? 'running' : 'loading' });
    let copy: ImageBitmap | null = null;
    try {
      if (isAndroid()) await ensureOptionalModel('warp');
      await preload();
      if (runId.current !== id) return;
      // Transfer a copy; the open photo keeps its own bitmap.
      copy = await createImageBitmap(bitmap);
      if (runId.current !== id) {
        copy.close();
        return;
      }
      setState({ status: 'running' });
      const response = request({ type: 'run', id: ++nextId, bitmap: copy, face }, [copy], (stage) => {
        if (runId.current === id) setState({ status: stage });
      });
      // postMessage transfers synchronously. If it failed, this closes the untransferred copy.
      try {
        const message = await response;
        if (runId.current !== id) return;
        if (message.type !== 'result') throw new Error('The model worker returned no predicted warp.');
        const { type: _type, id: _id, ...result } = message;
        setState({ status: 'done', result, checkResult: toCheckResult(assetId, result) });
      } finally {
        copy.close();
        copy = null;
      }
    } catch (error) {
      copy?.close();
      if (runId.current !== id) return;
      setState({ status: 'failed', message: `${error instanceof Error ? error.message : 'The face-warp run failed.'} The result is inconclusive.` });
    }
  }, [assetId, bitmap]);

  const cancel = useCallback(() => {
    runId.current++;
    cancelWorker();
    setState({ status: 'idle' });
  }, []);

  return { state, run, cancel, preload: preloadModel };
}
