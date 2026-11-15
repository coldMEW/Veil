import { formatTimestamp } from './videoFacts.js';

/**
 * A pinned, browser-executable forensic image model. It is run against
 * representative video frames, so its output is deliberately retained as a
 * review signal rather than promoted to a video-authenticity verdict.
 */
export const SYNTHETIC_MEDIA_MODEL = Object.freeze({
  id: 'detectra-v3',
  modelRepository: 'TensorFold/detectra-v1',
  modelRevision: '2bbc31161daa46932e05ee6f96e7016ee817bbde',
  modelUrl: 'https://huggingface.co/TensorFold/detectra-v1/resolve/2bbc31161daa46932e05ee6f96e7016ee817bbde/model.onnx',
  expectedModelSha256: '1414b9aafaa01a644ed706224973f09b53a1388282104409862df9893b1b962b',
  expectedModelByteLength: 43_684_258,
  license: 'MIT',
  runtime: 'onnxruntime-web@1.22.0 WebAssembly',
  execution: 'browser-local WebAssembly',
  preprocessing: 'shortest edge to 440, center crop 384, ImageNet normalization',
  scope: 'trained synthetic-image classifier applied to evenly sampled video frames and aggregated as a review signal',
  size: 384,
  resize: 440,
  threshold: 0.65,
  output: 'single-logit',
});

const PE_SMALL = Object.freeze({
  id: 'imdet-pe-small',
  modelRepository: 'Deckard618/imdet',
  modelRevision: '17e493fd263f9195999d01dde1eee78ea8956638',
  modelUrl: 'https://huggingface.co/Deckard618/imdet/resolve/17e493fd263f9195999d01dde1eee78ea8956638/pe_small/model.onnx',
  expectedModelSha256: '7c65b8ec821821c298e995db8e2efffe31b4b2293fc72f7be2c7af2432ce9d91',
  expectedModelByteLength: 47_477_440,
  license: 'Apache-2.0',
  runtime: SYNTHETIC_MEDIA_MODEL.runtime,
  execution: SYNTHETIC_MEDIA_MODEL.execution,
  preprocessing: 'shortest edge to 256, center crop 256, RGB scaled to [0, 1]',
  scope: SYNTHETIC_MEDIA_MODEL.scope,
  size: 256,
  resize: 256,
  threshold: 0.8,
  output: 'fake-real-logits',
});

export const SYNTHETIC_MEDIA_DETECTORS = [SYNTHETIC_MEDIA_MODEL, PE_SMALL];
export const SYNTHETIC_MEDIA_SAMPLE_LIMIT = 16;

const ORT_SCRIPT_URL = '/vendor/ort/ort.min.js';
const CHANNEL_MEAN = [0.485, 0.456, 0.406];
const CHANNEL_STD = [0.229, 0.224, 0.225];

let runtimePromise = null;
const sessions = new Map();

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : null;
}

function sigmoid(logit) {
  if (!Number.isFinite(logit)) return null;
  if (logit >= 0) return 1 / (1 + Math.exp(-logit));
  const exponent = Math.exp(logit);
  return exponent / (1 + exponent);
}

function reviewSignal(prediction) {
  const agreed = prediction.matches > 1;
  const [time, thumbnail] = [prediction.time, prediction.thumbnail];
  return {
    id: `synthetic-model-${Math.round(time * 1000)}`,
    source: 'automated',
    kind: 'review_signal',
    check: 'synthetic_media_model',
    timeStart: Number(time.toFixed(3)),
    timeEnd: Number(time.toFixed(3)),
    title: agreed ? 'Both visual detectors flagged this frame' : 'One visual detector flagged this frame',
    observation: `Review the frame at ${formatTimestamp(time)} and the seconds around it. ${agreed ? 'Both tools found patterns associated with AI-generated images.' : prediction.checks.length > 1 ? 'The second tool scored the frame below its review threshold.' : 'Only one tool returned a score for this frame.'}`,
    evidence: {
      matchingDetectors: prediction.matches,
      detectorsScored: prediction.checks.length,
      modelScores: Object.fromEntries(prediction.checks.map(({ id, score }) => [id.replaceAll('-', '_'), score])),
    },
    thumbnail,
    method: 'Compare each detector against its own threshold at the same sampled timestamp.',
    limitations: ['The detectors look at individual frame crops. Compression, edits and unfamiliar generators can affect both.'],
  };
}

/** Pure score aggregation, kept independent from browser inference for repeatable tests. */
export function summarizeSyntheticScores(predictions, requestedFrames = Array.isArray(predictions) ? predictions.length : 0, threshold = SYNTHETIC_MEDIA_MODEL.threshold) {
  const usable = (Array.isArray(predictions) ? predictions : [])
    .filter((prediction) => Number.isFinite(prediction?.syntheticScore))
    .map((prediction) => ({ ...prediction, syntheticScore: clamp(prediction.syntheticScore, 0, 1) }));
  const scores = usable.map((prediction) => prediction.syntheticScore);
  const ranked = [...scores].sort((a, b) => b - a);
  const topCount = Math.max(1, Math.ceil(ranked.length / 4));
  return {
    requestedFrames: Math.max(0, Number.isFinite(requestedFrames) ? Math.trunc(requestedFrames) : 0),
    sampledFrames: usable.length,
    unscoredFrames: Math.max(0, (Number.isFinite(requestedFrames) ? Math.trunc(requestedFrames) : 0) - usable.length),
    medianSyntheticScore: median(scores),
    meanSyntheticScore: mean(scores),
    upperQuartileMean: mean(ranked.slice(0, topCount)),
    maxSyntheticScore: ranked[0] ?? null,
    flaggedFrames: usable.filter((prediction) => prediction.syntheticScore >= threshold).length,
  };
}

export function compareDetectorResults(frames, detectors) {
  const scoresByTime = detectors.map(({ predictions }) => new Map(predictions.map(({ time, syntheticScore }) => [time, syntheticScore])));
  const compared = frames.map(({ time, thumbnail }) => {
    const checks = detectors.flatMap(({ engine }, index) => {
      const score = scoresByTime[index].get(time);
      return Number.isFinite(score) ? [{ id: engine.id, score, threshold: engine.threshold }] : [];
    });
    return { time, thumbnail, checks, matches: checks.filter(({ score, threshold }) => score >= threshold).length };
  });
  const flagged = compared.filter(({ matches }) => matches > 0);
  const highlights = [];
  for (const frame of [...flagged].sort((a, b) => b.matches - a.matches || a.time - b.time)) {
    if (highlights.every(({ time }) => Math.abs(time - frame.time) >= 1)) highlights.push(frame);
    if (highlights.length === 8) break;
  }
  return {
    flaggedFrames: flagged.length,
    agreementFrames: flagged.filter(({ matches }) => matches > 1).length,
    scoredFrames: compared.filter(({ checks }) => checks.length > 0).length,
    signals: highlights.map(reviewSignal),
  };
}

function loadOrtRuntime() {
  if (globalThis.ort?.InferenceSession && globalThis.ort?.Tensor) return Promise.resolve(globalThis.ort);
  if (runtimePromise) return runtimePromise;
  runtimePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = ORT_SCRIPT_URL;
    script.onload = () => {
      if (globalThis.ort?.InferenceSession && globalThis.ort?.Tensor) resolve(globalThis.ort);
      else reject(new Error('The local ONNX runtime loaded without its inference API.'));
    };
    script.onerror = () => reject(new Error('The local ONNX runtime could not be loaded.'));
    document.head.append(script);
  }).catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot fingerprint the downloaded model artifact.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function downloadModelArtifact(model, onProgress) {
  const response = await fetch(model.modelUrl, { cache: 'force-cache', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`The trained model download failed (${response.status}).`);
  if (!response.body) throw new Error('The model download returned no data.');
  const output = new Uint8Array(model.expectedModelByteLength);
  const reader = response.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > output.length) {
      await reader.cancel();
      throw new Error('The model download exceeded its expected size.');
    }
    output.set(value, received);
    received += value.byteLength;
    onProgress?.({ stage: 'download', completed: received, total: output.length });
  }
  if (received !== output.length) throw new Error('The model download did not finish.');
  const sha256 = await sha256Hex(output.buffer);
  if (sha256 !== model.expectedModelSha256) throw new Error('The downloaded model did not match its pinned SHA-256 fingerprint.');
  return { bytes: output.buffer, sha256 };
}

function getSession(model, onProgress) {
  if (sessions.has(model.id)) return sessions.get(model.id);
  const pending = (async () => {
    const ort = await loadOrtRuntime();
    const artifact = await downloadModelArtifact(model, onProgress);
    if (typeof document !== 'undefined') {
      ort.env.wasm.wasmPaths = new URL('/vendor/ort/', document.baseURI).href;
    }
    ort.env.wasm.numThreads = 1;
    onProgress?.({ stage: 'initialize', completed: 0, total: 1 });
    const session = await ort.InferenceSession.create(artifact.bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    onProgress?.({ stage: 'initialize', completed: 1, total: 1 });
    return {
      ort,
      session,
      engine: {
        ...model,
        modelSha256: artifact.sha256,
        modelByteLength: artifact.bytes.byteLength,
        integrityVerified: true,
      },
    };
  })().catch((error) => {
    sessions.delete(model.id);
    throw error;
  });
  sessions.set(model.id, pending);
  return pending;
}

export function createFrameCapture(model) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = model.size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return (video) => {
    if (!context) return null;
    const crop = model.size / model.resize * Math.min(video.videoWidth, video.videoHeight);
    const x = (video.videoWidth - crop) / 2;
    const y = (video.videoHeight - crop) / 2;
    context.drawImage(video, x, y, crop, crop, 0, 0, model.size, model.size);
    return context.getImageData(0, 0, model.size, model.size).data;
  };
}

async function scoreFrame(pixels, { ort, session, engine }) {
  const pixelCount = engine.size ** 2;
  const values = new Float32Array(3 * pixelCount);
  const normalized = engine.output === 'single-logit';
  for (let index = 0; index < pixelCount; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[index * 4 + channel] / 255;
      values[channel * pixelCount + index] = normalized ? (value - CHANNEL_MEAN[channel]) / CHANNEL_STD[channel] : value;
    }
  }
  const input = new ort.Tensor('float32', values, [1, 3, engine.size, engine.size]);
  const outputName = normalized ? 'logit' : 'logits';
  const outputs = await session.run({ [normalized ? 'pixel_values' : 'image']: input }, [outputName]);
  const logits = outputs[outputName].data;
  return sigmoid(normalized ? logits[0] : logits[0] - logits[1]);
}

/**
 * Runs one pinned ONNX classifier over the in-memory frame crops.
 */
async function runDetector(selected, model, onProgress) {
  let engine = model;
  try {
    if (!selected.some(({ modelPixels }) => modelPixels[model.id])) throw new Error('No readable frames were prepared for this detector.');
    onProgress?.({ stage: 'load', completed: 0, total: 1 });
    const runtime = await getSession(model, onProgress);
    engine = runtime.engine;
    const predictions = [];
    let frameError = null;
    for (let index = 0; index < selected.length; index += 1) {
      const { modelPixels, time } = selected[index];
      try {
        const pixels = modelPixels[model.id];
        const syntheticScore = pixels ? await scoreFrame(pixels, runtime) : null;
        if (syntheticScore !== null) predictions.push({ time, syntheticScore });
      } catch (error) {
        frameError = error;
      }
      onProgress?.({ stage: 'frames', completed: index + 1, total: selected.length });
    }
    if (!predictions.length) throw frameError ?? new Error('The model could not score any sampled frames.');
    const metrics = summarizeSyntheticScores(predictions, selected.length, model.threshold);
    return {
      status: metrics.unscoredFrames ? 'partial' : 'complete',
      reason: metrics.unscoredFrames ? `${metrics.unscoredFrames} sampled frame${metrics.unscoredFrames === 1 ? '' : 's'} could not be scored by the trained model.` : null,
      engine,
      predictions,
      metrics,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'The local trained synthetic-media model could not run in this browser.',
      engine,
      predictions: [],
      metrics: null,
    };
  }
}

export async function analyzeSyntheticFrames(frames, onProgress) {
  const selected = frames.filter(({ modelPixels }) => modelPixels);
  const detectors = [];
  for (const model of SYNTHETIC_MEDIA_DETECTORS) {
    const check = await runDetector(selected, model, (progress) => onProgress?.({
      ...progress,
      detector: detectors.length + 1,
      detectorCount: SYNTHETIC_MEDIA_DETECTORS.length,
    }));
    detectors.push(check);
  }
  const comparison = compareDetectorResults(selected, detectors);
  const complete = detectors.every(({ status }) => status === 'complete');
  return {
    ...comparison,
    status: complete ? 'complete' : comparison.scoredFrames ? 'partial' : 'unavailable',
    requestedFrames: selected.length,
    detectors,
  };
}
