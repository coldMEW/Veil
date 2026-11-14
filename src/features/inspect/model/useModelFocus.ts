import { isAndroid } from '../../../lib/native/environment';
import { ensureOptionalModel } from '../../../lib/native/modelConsent';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckResult } from '../../../contracts';
import models from './models.json';
import {
  AI_HIGH, AI_LOW, aiProbabilityDrops, normalizeMagnitudes, OUTPUT_LEANS, OUTPUT_RAISED, OUTPUT_SATURATED, OUTPUT_STRONG,
  outputBand, sigmoid, toAiOverlay, type OutputBand,
} from './preprocess';
import type { FocusResponse, FocusResult } from './focusTypes';

export interface OutputSummary {
  /** The highest band reached by any whole view. */
  band: OutputBand;
  /** How many views reached that band. */
  count: number;
  views: number;
  /** Highest raw logit over the views. */
  maxLogit: number;
}

/** What the detector itself output over the photo's views, before any heatmap. Display bands only. */
export function outputSummary(r: Pick<FocusResult, 'logit' | 'views' | 'crop'>): OutputSummary {
  const views = r.views?.length ? r.views : [{ label: 'center' as const, logit: r.logit, crop: r.crop }];
  const order: OutputBand[] = ['low', 'leans', 'strong'];
  const bands = views.map((v) => outputBand(v.logit));
  const band = bands.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'low' as OutputBand);
  return { band, count: bands.filter((b) => b === band).length, views: views.length, maxLogit: Math.max(...views.map((v) => v.logit)) };
}

/**
 * Caption for the photo when the heatmap is switched on but nothing is coloured. An empty map
 * does not mean "no AI signal": when the detector's output is already high, covering any one
 * area cannot lower it, so the map stays empty exactly when the output is strongest.
 */
export function emptyMapCaption(r: FocusResult): string {
  const s = outputSummary(r);
  if (s.band !== 'low') {
    return `Output already ${s.band === 'strong' ? 'very high' : 'high'}: no single area stands out.`;
  }
  if (sigmoid(s.maxLogit) >= OUTPUT_RAISED) {
    return 'Output raised, but no single area stands out.';
  }
  return 'No area raised the AI signal.';
}

function outputSentence(r: FocusResult): string {
  const s = outputSummary(r);
  const where = s.views === 1 ? 'on the centre crop' : s.count === s.views ? `in all ${s.views} views of the photo` : `in ${s.count} of ${s.views} views of the photo`;
  if (s.band === 'strong') return `This detector's output leans strongly toward "AI-generated" ${where}.`;
  if (s.band === 'leans') return `This detector's output leans toward "AI-generated" ${where}.`;
  // Below the 0.5 line but far above where measured phone photos sat (≤ 0.001): say so, don't call it low.
  if (sigmoid(s.maxLogit) >= OUTPUT_RAISED) {
    return `This detector's output is raised but stays under the ${OUTPUT_LEANS} display line ${s.views === 1 ? 'on the centre crop' : `in all ${s.views} views`}.`;
  }
  return s.views === 1 ? `This detector's output stays low on the centre crop.` : `This detector's output stays low in all ${s.views} views of the photo.`;
}

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
    observation: `${outputSentence(r)} ${strongest >= AI_LOW
      ? `Strongest AI-signal area: ${region} of the model crop. Covering it lowers the detector's AI output by ${Math.round(strongest * 100)} points.`
      : sigmoid(r.logit) >= OUTPUT_SATURATED
        ? `The heatmap stays empty because the output is saturated: covering any one area of the centre crop does not lower it by ${Math.round(AI_LOW * 100)} points.`
        : `No area raised this detector's AI output by ${Math.round(AI_LOW * 100)} points or more.`}`,
    method: `Whole views, then occlusion. The photo is resized (short edge 440); the detector scores the centre 384 × 384 crop and, when the photo is not square, a 384 window at each end of the long edge. The heatmap uses the centre crop only: each of ${r.grid} × ${r.grid} cells is covered with the training mean color, in batches of up to 8. Each cell's contribution is how much covering it lowers the detector's sigmoid output (positive only); cells lowering it by at least ${Math.round(AI_LOW * 100)} points get colour, reaching red at ${Math.round(AI_HIGH * 100)}. Model: ${MODEL_INFO.name}, sha256 ${MODEL_INFO.sha256.slice(0, 8)}…, ONNX Runtime Web (${r.backend.toUpperCase()}, ${r.threads} thread${r.threads === 1 ? '' : 's'}).`,
    assumptions: ['Covering a cell with the training mean color probes its contribution but can also change nearby context.'],
    limitations: [
      'This is a whole-image classifier: the map shows where its signal comes from, not which pixels were generated.',
      'Real photos can show colour.',
      'This is not a probability or a verdict about the photo.',
      'The heatmap covers the centre crop only; the end views add an output, not a map.',
      `The output bands (${OUTPUT_LEANS} and ${OUTPUT_STRONG} on the sigmoid) and the heatmap thresholds are display choices from a handful of images and have not been calibrated.`,
      'A low output does not show a photo came from a camera: new generators, heavy edits and small images can stay low.',
    ],
    reason: 'This classifier diagnostic alone cannot establish whether an image or any region was generated.',
    evidence: {
      rawOutput: r.logit,
      views: (r.views ?? [{ label: 'center', logit: r.logit, crop: r.crop }]).map((v) => ({ ...v, band: outputBand(v.logit) })),
      outputBands: { leans: OUTPUT_LEANS, strong: OUTPUT_STRONG, saturated: OUTPUT_SATURATED, units: 'sigmoid of raw output', purpose: 'display only' },
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
