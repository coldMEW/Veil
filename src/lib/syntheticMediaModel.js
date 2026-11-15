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
});

export const SYNTHETIC_MEDIA_SAMPLE_LIMIT = 12;
export const SYNTHETIC_MEDIA_INPUT_SIZE = 384;
export const SYNTHETIC_MEDIA_RESIZE_SIZE = 440;

const ORT_SCRIPT_URL = '/vendor/ort/ort.min.js';
const IMAGE_SIZE = SYNTHETIC_MEDIA_INPUT_SIZE;
const REVIEW_THRESHOLD = 0.65;
const CHANNEL_MEAN = [0.485, 0.456, 0.406];
const CHANNEL_STD = [0.229, 0.224, 0.225];

let runtimePromise = null;
let sessionPromise = null;
let modelArtifactPromise = null;

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

function selectEvenly(items, maximum) {
  if (items.length <= maximum) return items;
  return Array.from({ length: maximum }, (_, index) => items[Math.round((index * (items.length - 1)) / (maximum - 1))]);
}

function sigmoid(logit) {
  if (!Number.isFinite(logit)) return null;
  if (logit >= 0) return 1 / (1 + Math.exp(-logit));
  const exponent = Math.exp(logit);
  return exponent / (1 + exponent);
}

function describeScore(score) {
  return `${Math.round(score * 100)} / 100`;
}

function reviewSignal(prediction, summary, ordinal, engine) {
  return {
    id: `synthetic-model-${ordinal}-${Math.round(prediction.time * 1000)}`,
    source: 'automated',
    kind: 'review_signal',
    check: 'synthetic_media_model',
    timeStart: Number(prediction.time.toFixed(3)),
    timeEnd: Number(prediction.time.toFixed(3)),
    title: 'Model-based synthetic-media signal',
    observation: `The locally run trained frame classifier produced a synthetic-media review score of ${describeScore(prediction.syntheticScore)} at ${formatTimestamp(prediction.time)}. Compare this sampled frame with the original video, provenance evidence, and other review signals; this is not an authenticity verdict.`,
    evidence: {
      modelId: engine.id,
      modelRepository: engine.modelRepository,
      modelRevision: engine.modelRevision,
      modelSha256: engine.modelSha256,
      expectedModelSha256: engine.expectedModelSha256,
      frameSyntheticScore: prediction.syntheticScore,
      videoMedianSyntheticScore: summary.medianSyntheticScore,
      reviewThreshold: REVIEW_THRESHOLD,
      sampledFrameCount: summary.sampledFrames,
    },
    thumbnail: prediction.thumbnail,
    method: engine.scope,
    assumptions: ['The pinned model artifact passed its SHA-256 integrity check before inference.', 'The selected sampled frame represents a meaningful moment in the original video.'],
    limitations: ['This is a frame classifier, not a calibrated universal video-authenticity model.', 'Scores can be affected by compression, screenshots, animation, edits, and generators outside the model’s training distribution.'],
  };
}

/** Pure score aggregation, kept independent from browser inference for repeatable tests. */
export function summarizeSyntheticScores(predictions, requestedFrames = Array.isArray(predictions) ? predictions.length : 0) {
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
    flaggedFrames: usable.filter((prediction) => prediction.syntheticScore >= REVIEW_THRESHOLD).length,
  };
}

function deduplicateModelSignals(predictions, summary, engine) {
  const signals = [];
  for (const prediction of predictions) {
    if (prediction.syntheticScore < REVIEW_THRESHOLD) continue;
    const nearby = signals.some((signal) => Math.abs(signal.timeStart - prediction.time) < 2.5);
    if (!nearby) signals.push(reviewSignal(prediction, summary, signals.length + 1, engine));
  }
  return signals.slice(0, 8);
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

async function downloadModelArtifact(onProgress) {
  const response = await fetch(SYNTHETIC_MEDIA_MODEL.modelUrl, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`The trained model download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || SYNTHETIC_MEDIA_MODEL.expectedModelByteLength;
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    const sha256 = await sha256Hex(bytes);
    if (sha256 !== SYNTHETIC_MEDIA_MODEL.expectedModelSha256) throw new Error('The downloaded model did not match its pinned SHA-256 fingerprint.');
    return { bytes, sha256 };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({ stage: 'download', completed: received, total });
  }
  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const sha256 = await sha256Hex(output.buffer);
  if (sha256 !== SYNTHETIC_MEDIA_MODEL.expectedModelSha256) throw new Error('The downloaded model did not match its pinned SHA-256 fingerprint.');
  return { bytes: output.buffer, sha256 };
}

function getModelArtifact(onProgress) {
  if (modelArtifactPromise) return modelArtifactPromise;
  modelArtifactPromise = downloadModelArtifact(onProgress).catch((error) => {
    modelArtifactPromise = null;
    throw error;
  });
  return modelArtifactPromise;
}

function getSession(onProgress) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      const [ort, artifact] = await Promise.all([loadOrtRuntime(), getModelArtifact(onProgress)]);
      ort.env.wasm.wasmPaths = '/vendor/ort/';
      ort.env.wasm.numThreads = 1;
      onProgress?.({ stage: 'initialize', completed: 0, total: 1 });
      const session = await ort.InferenceSession.create(artifact.bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      onProgress?.({ stage: 'initialize', completed: 1, total: 1 });
      return {
        ort,
        session,
        engine: {
          ...SYNTHETIC_MEDIA_MODEL,
          modelSha256: artifact.sha256,
          modelByteLength: artifact.bytes.byteLength,
          integrityVerified: true,
        },
      };
    } finally {
      modelArtifactPromise = null;
    }
  })().catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A sampled video frame could not be decoded for model analysis.'));
    image.src = source;
  });
}

function modelInput(image, isPreprocessedCrop) {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not create a model-analysis canvas.');
  if (isPreprocessedCrop) {
    context.drawImage(image, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  } else {
    const scale = 440 / Math.min(image.width, image.height);
    const sourceCrop = IMAGE_SIZE / scale;
    const sourceX = (image.width - sourceCrop) / 2;
    const sourceY = (image.height - sourceCrop) / 2;
    context.drawImage(image, sourceX, sourceY, sourceCrop, sourceCrop, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  }
  const pixels = context.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data;
  const pixelCount = IMAGE_SIZE * IMAGE_SIZE;
  const values = new Float32Array(3 * pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      values[channel * pixelCount + index] = (pixels[offset + channel] / 255 - CHANNEL_MEAN[channel]) / CHANNEL_STD[channel];
    }
  }
  return values;
}

async function scoreFrame(frame, runtime) {
  const source = frame.modelThumbnail || frame.thumbnail;
  const image = await loadImage(source);
  const input = new runtime.ort.Tensor('float32', modelInput(image, Boolean(frame.modelThumbnail)), [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
  const outputs = await runtime.session.run({ pixel_values: input });
  const outputName = runtime.session.outputNames.includes('logit') ? 'logit' : runtime.session.outputNames[0];
  const score = sigmoid(Number(outputs[outputName]?.data?.[0]));
  if (score === null) throw new Error('The trained model returned an invalid score for a sampled frame.');
  return score;
}

/**
 * Runs a pinned ONNX classifier over evenly selected, in-memory video frames.
 * The video and its frames stay in the browser; only the public model artifact
 * is retrieved on first use.
 */
export async function analyzeSyntheticFrames(frames, onProgress) {
  const allCandidates = (Array.isArray(frames) ? frames : []).filter((frame) => (frame?.modelThumbnail || frame?.thumbnail) && Number.isFinite(frame?.time));
  const preparedCandidates = allCandidates.filter((frame) => frame.modelThumbnail);
  const candidates = preparedCandidates.length ? preparedCandidates : allCandidates;
  if (!candidates.length) {
    return { status: 'unavailable', reason: 'No decoded frame thumbnails were available for model analysis.', engine: SYNTHETIC_MEDIA_MODEL, predictions: [], metrics: null, signals: [] };
  }
  const selected = selectEvenly(candidates, SYNTHETIC_MEDIA_SAMPLE_LIMIT);
  try {
    onProgress?.({ stage: 'load', completed: 0, total: 1 });
    const runtime = await getSession(onProgress);
    const predictions = [];
    for (let index = 0; index < selected.length; index += 1) {
      onProgress?.({ stage: 'frames', completed: index, total: selected.length });
      try {
        predictions.push({
          time: selected[index].time,
          thumbnail: selected[index].thumbnail,
          syntheticScore: await scoreFrame(selected[index], runtime),
        });
      } catch {
        // One transient image-decode failure should not erase the usable model review.
      }
      onProgress?.({ stage: 'frames', completed: index + 1, total: selected.length });
    }
    if (!predictions.length) throw new Error('The trained model could not score any sampled video frames.');
    const metrics = summarizeSyntheticScores(predictions, selected.length);
    return {
      status: 'complete',
      reason: metrics.unscoredFrames ? `${metrics.unscoredFrames} sampled frame${metrics.unscoredFrames === 1 ? '' : 's'} could not be scored by the trained model.` : null,
      engine: runtime.engine,
      predictions,
      metrics,
      signals: deduplicateModelSignals(predictions, metrics, runtime.engine),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'The local trained synthetic-media model could not run in this browser.',
      engine: SYNTHETIC_MEDIA_MODEL,
      predictions: [],
      metrics: null,
      signals: [],
    };
  }
}
