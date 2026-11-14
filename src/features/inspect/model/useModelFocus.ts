import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckResult } from '../../../contracts';
import models from './models.json';
import { normalizeMagnitudes } from './preprocess';
import type { FocusResponse, FocusResult } from './focusTypes';

export const MODEL_INFO = models['communityforensics-vit-s-fp32'];

export type FocusState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; result: FocusResult; magnitudes: Float32Array; checkResult: CheckResult }
  | { status: 'failed'; message: string };

/** Phones get the smaller occlusion grid: fewer passes, same method. */
function isCoarse(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
}

const TIMEOUT_MS = 120_000;

export function toCheckResult(assetId: string, r: FocusResult): CheckResult {
  return {
    id: 'model-focus',
    assetId,
    kind: 'model',
    execution: 'complete',
    finding: 'inconclusive',
    title: 'Model-focus map',
    observation:
      'Highlighted cells are where covering part of the image changed this model’s output the most. The hatched area was outside the model’s view.',
    method: `Occlusion. The photo is resized (short edge 440) and center-cropped to 384 × 384, as the model expects. Each of ${r.grid} × ${r.grid} cells is then covered with the average color and the change in the model’s raw output is measured. Model: ${MODEL_INFO.name}, sha256 ${MODEL_INFO.sha256.slice(0, 8)}…, ONNX Runtime Web (${r.backend.toUpperCase()}, ${r.threads} thread${r.threads === 1 ? '' : 's'}).`,
    assumptions: ['Covering a cell with the average color removes the information in that cell without adding a new cue.'],
    limitations: [
      'Shows where one classifier responds, not which pixels were edited or generated.',
      'This is not a probability or a verdict about the photo.',
      'Areas outside the center crop were never seen by the model.',
    ],
    evidence: {
      rawOutput: r.logit,
      grid: r.grid,
      deltas: Array.from(r.deltas),
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
          magnitudes: normalizeMagnitudes(result.deltas),
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
