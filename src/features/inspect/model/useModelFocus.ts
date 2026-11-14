import { isAndroid } from '../../../lib/native/environment';
import { ensureOptionalModel } from '../../../lib/native/modelConsent';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckResult } from '../../../contracts';
import models from './models.json';
import { AI_HIGH, AI_LOW, aiProbabilityDrops, normalizeMagnitudes, toAiOverlay } from './preprocess';
import type { FocusResponse, FocusResult } from './focusTypes';

export const MODEL_INFO = models['communityforensics-vit-s-fp32'];
export { AI_HIGH, AI_LOW, toAiOverlay } from './preprocess';

export type FocusState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; result: FocusResult; magnitudes: Float32Array; overlay: Uint8ClampedArray; checkResult: CheckResult }
  | { status: 'failed'; message: string };

/** Phones get the smaller occlusion grid: fewer passes, same method. */
function isCoarse(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
}

const TIMEOUT_MS = 120_000;

export function toCheckResult(assetId: string, r: FocusResult): CheckResult {
  // Validate the signed contributions before turning them into any observation.
  toAiOverlay(r.deltas, r.grid, r.logit);
  if (!Number.isFinite(r.logit)) throw new Error('The model produced a non-finite output.');
  const drops = aiProbabilityDrops(r.deltas, r.logit);
  let strongest = 0;
  let peak = 0;
  for (let i = 0; i < drops.length; i++) {
    if (drops[i]! > strongest) { strongest = drops[i]!; peak = i; }
  }
  const col = Math.min(2, Math.floor((peak % r.grid) * 3 / r.grid));
  const row = Math.min(2, Math.floor(Math.floor(peak / r.grid) * 3 / r.grid));
  const region = ['upper left', 'upper center', 'upper right', 'middle left', 'center', 'middle right', 'lower left', 'lower center', 'lower right'][row * 3 + col];
  return {
    id: 'model-focus',
    assetId,
    kind: 'model',
    execution: 'complete',
    finding: 'inconclusive',
    title: 'AI-signal heatmap',
    observation: strongest >= AI_LOW
      ? `Strongest AI-signal area: ${region} of the model crop. Covering it lowers the detector's AI output by ${Math.round(strongest * 100)} points.`
      : `No area raised this detector's AI output by ${Math.round(AI_LOW * 100)} points or more.`,
    method: `Occlusion. The photo is resized (short edge 440) and center-cropped to 384 × 384. Each of ${r.grid} × ${r.grid} cells is covered with the training mean color, in batches of up to 8. Each cell's contribution is how much covering it lowers the detector's sigmoid output (positive only); cells lowering it by at least ${Math.round(AI_LOW * 100)} points get colour, reaching red at ${Math.round(AI_HIGH * 100)}. Model: ${MODEL_INFO.name}, sha256 ${MODEL_INFO.sha256.slice(0, 8)}…, ONNX Runtime Web (${r.backend.toUpperCase()}, ${r.threads} thread${r.threads === 1 ? '' : 's'}).`,
    assumptions: ['Covering a cell with the training mean color probes its contribution but can also change nearby context.'],
    limitations: [
      'This is a whole-image classifier: the map shows where its signal comes from, not which pixels were generated.',
      'Real photos can show colour.',
      'This is not a probability or a verdict about the photo.',
      'Areas outside the center crop were never seen by the model.',
      'The display thresholds are placeholders and have not been calibrated.',
    ],
    reason: 'This classifier diagnostic alone cannot establish whether an image or any region was generated.',
    evidence: {
      rawOutput: r.logit,
      grid: r.grid,
      deltas: Array.from(r.deltas),
      thresholds: { low: AI_LOW, high: AI_HIGH, units: 'probability points (sigmoid drop)', purpose: 'display only' },
      strongestPositiveDelta: strongest,
      signConvention: MODEL_INFO.io.signConvention,
      signConventionSource: MODEL_INFO.io.signConventionSource,
      crop: r.crop,
      backend: r.backend,
      threads: r.threads,
      timingsMs: r.timings,
      model: { upstream: MODEL_INFO.upstream, revision: MODEL_INFO.revision, sha256: MODEL_INFO.sha256 },
    },
    overlays: [],
    source: 'live',
  };
}

/**
 * Owns the model worker for the open photo. A new photo, cancel or unmount
 * terminates the worker, which stops computation, not just the promise.
 */
export function useModelFocus(assetId: string | null, bitmap: ImageBitmap | null) {
  const [state, setState] = useState<FocusState>({ status: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const runId = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    window.clearTimeout(timer.current);
    runId.current++;
  }, []);

  useEffect(() => {
    stop();
    setState({ status: 'idle' });
    return stop;
  }, [assetId, stop]);

  const run = useCallback(async () => {
    if (!assetId || !bitmap) return;
    try { if (isAndroid()) await ensureOptionalModel('focus'); }
    catch (e) { setState({ status: 'failed', message: String(e) }); return; }
    stop();
    const id = ++runId.current;
    setState({ status: 'loading' });
    const worker = new Worker(new URL('./focus.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    timer.current = window.setTimeout(() => {
      if (runId.current !== id) return;
      stop();
      setState({ status: 'failed', message: 'Timed out after 2 minutes, so the run was stopped.' });
    }, TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<FocusResponse>) => {
      const msg = event.data;
      if (msg.id !== id || runId.current !== id) return;
      if (msg.type === 'progress') {
        setState(msg.stage === 'loading' ? { status: 'loading' } : { status: 'running', done: msg.done, total: msg.total });
      } else if (msg.type === 'error') {
        stop();
        setState({ status: 'failed', message: msg.message });
      } else {
        window.clearTimeout(timer.current);
        const { type: _t, id: _i, ...result } = msg;
        setState({
          status: 'done',
          result,
          magnitudes: normalizeMagnitudes(result.deltas, result.logit),
          overlay: toAiOverlay(result.deltas, result.grid, result.logit),
          checkResult: toCheckResult(assetId, result),
        });
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = () => {
      if (runId.current !== id) return;
      stop();
      setState({ status: 'failed', message: 'The model worker stopped unexpectedly.' });
    };

    // Send a copy; the open photo keeps its own bitmap.
    const copy = await createImageBitmap(bitmap);
    if (runId.current !== id) {
      copy.close();
      return;
    }
    worker.postMessage({ id, bitmap: copy, coarse: isCoarse() }, [copy]);
  }, [assetId, bitmap, stop]);

  const cancel = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  return { state, run, cancel };
}
