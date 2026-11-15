import { formatTimestamp } from './videoFacts.js';
import {
  analyzeSyntheticFrames,
  createFrameCapture,
  SYNTHETIC_MEDIA_DETECTORS,
  SYNTHETIC_MEDIA_SAMPLE_LIMIT,
} from './syntheticMediaModel.js';

export const ANALYSIS_ENGINE = Object.freeze({
  id: 'veil-browser-evidence-scan',
  version: '0.5.0',
  mode: 'two local frame classifiers with separate temporal, face and audio checks',
});

const MAX_SAMPLES = 42;
const MIN_SAMPLES = SYNTHETIC_MEDIA_SAMPLE_LIMIT;
const GRID_COLUMNS = 6;
const GRID_ROWS = 4;
const MAX_AUDIO_DECODE_BYTES = 120 * 1024 * 1024;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustThreshold(values, floor, multiplier) {
  const centre = median(values);
  const deviation = median(values.map((value) => Math.abs(value - centre)));
  return Math.max(floor, centre + multiplier * deviation * 1.4826);
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function signal(id, check, time, title, observation, evidence, thumbnail = null) {
  return {
    id,
    source: 'automated',
    kind: 'review_signal',
    check,
    timeStart: Number(time.toFixed(3)),
    timeEnd: Number(time.toFixed(3)),
    title,
    observation,
    evidence,
    thumbnail,
    method: ANALYSIS_ENGINE.mode,
    assumptions: ['The original file decodes consistently in this browser.', 'A signal is a reason to review a moment, not an authenticity conclusion.'],
    limitations: ['Camera movement, edits, compression, lighting changes, and normal subject motion can trigger the same patterns.'],
  };
}

function deduplicateSignals(signals, seconds = 1.2) {
  const accepted = [];
  for (const candidate of signals.sort((a, b) => a.timeStart - b.timeStart)) {
    const duplicate = accepted.find((existing) => existing.check === candidate.check && Math.abs(existing.timeStart - candidate.timeStart) < seconds);
    if (!duplicate) accepted.push(candidate);
  }
  return accepted.slice(0, 16);
}

/** Pure analysis of frame descriptors. Kept separate so thresholds can be tested without a browser. */
export function analyzeTemporalDescriptors(frames) {
  if (!Array.isArray(frames) || frames.length < 3) {
    return { signals: [], metrics: { sampledFrames: frames?.length ?? 0, transitionCount: 0, sceneThreshold: null, localThreshold: null } };
  }
  const transitions = frames.slice(1).filter((frame) => Number.isFinite(frame.globalDifference));
  const globalDifferences = transitions.map((frame) => frame.globalDifference);
  const sceneThreshold = robustThreshold(globalDifferences, 0.17, 5);
  const localScores = transitions.map((frame) => {
    const cells = frame.cellDifferences?.filter(Number.isFinite) ?? [];
    return cells.length ? Math.max(...cells) - mean(cells) : 0;
  });
  const localThreshold = robustThreshold(localScores, 0.1, 4);
  const luminanceDeltas = transitions.map((frame, index) => Math.abs(frame.meanLuminance - frames[index].meanLuminance));
  const luminanceThreshold = robustThreshold(luminanceDeltas, 0.13, 5);
  const signals = [];

  transitions.forEach((frame, index) => {
    const previous = frames[index];
    const localScore = localScores[index];
    const luminanceDelta = luminanceDeltas[index];
    if (frame.globalDifference >= sceneThreshold) {
      signals.push(
        signal(
          `scene-${index}-${Math.round(frame.time * 1000)}`,
          'temporal_edit',
          frame.time,
          'Abrupt full-frame transition',
          `Frame change at ${formatTimestamp(frame.time)} is substantially larger than nearby sampled transitions. Review for a cut, splice, overlay change, or natural scene transition.`,
          { globalDifference: frame.globalDifference, threshold: sceneThreshold, previousTime: previous.time },
          frame.thumbnail,
        ),
      );
    } else if (localScore >= localThreshold && frame.globalDifference > 0.015) {
      const cell = frame.cellDifferences.indexOf(Math.max(...frame.cellDifferences));
      const column = ['left', 'center', 'right'][Math.floor((cell % GRID_COLUMNS) * 3 / GRID_COLUMNS)];
      const row = ['upper', 'middle', 'lower'][Math.floor(Math.floor(cell / GRID_COLUMNS) * 3 / GRID_ROWS)];
      signals.push(
        signal(
          `local-${index}-${Math.round(frame.time * 1000)}`,
          'localized_temporal_change',
          frame.time,
          `Picture change in the ${row} ${column}`,
          `Between ${formatTimestamp(previous.time)} and ${formatTimestamp(frame.time)}, the ${row} ${column} of the picture changed more than the rest. Compare that area at the two times.`,
          { globalDifference: frame.globalDifference, localDifferenceSpread: localScore, threshold: localThreshold, cellDifferences: frame.cellDifferences, previousTime: previous.time },
          frame.thumbnail,
        ),
      );
    }
    if (luminanceDelta >= luminanceThreshold && frame.globalDifference < sceneThreshold) {
      signals.push(
        signal(
          `light-${index}-${Math.round(frame.time * 1000)}`,
          'lighting_transition',
          frame.time,
          'Abrupt exposure or lighting change',
          `Average luminance changes unusually at ${formatTimestamp(frame.time)} without reaching the full-frame scene-transition threshold. Review natural exposure adjustment, an edit, or a lighting inconsistency.`,
          { luminanceDelta, threshold: luminanceThreshold, previousTime: previous.time },
          frame.thumbnail,
        ),
      );
    }
    const priorMotion = index > 0 ? transitions[index - 1]?.globalDifference ?? 0 : 0;
    if (frame.globalDifference < 0.002 && priorMotion > Math.max(0.05, sceneThreshold * 0.35)) {
      signals.push(
        signal(
          `repeat-${index}-${Math.round(frame.time * 1000)}`,
          'repeated_frame_pattern',
          frame.time,
          'Possible held or repeated frame',
          `A near-identical sampled frame follows a materially changing frame near ${formatTimestamp(frame.time)}. Review for a freeze, repeat, decoder artifact, or normal pause.`,
          { globalDifference: frame.globalDifference, priorDifference: priorMotion, previousTime: previous.time },
          frame.thumbnail,
        ),
      );
    }
  });

  return {
    signals: deduplicateSignals(signals),
    metrics: {
      sampledFrames: frames.length,
      transitionCount: transitions.length,
      sceneThreshold,
      localThreshold,
      luminanceThreshold,
      medianTransitionDifference: median(globalDifferences),
    },
  };
}

function buildSampleTimes(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = clamp(Math.ceil(duration / 1.4), MIN_SAMPLES, MAX_SAMPLES);
  const margin = Math.min(0.25, duration / (count + 2));
  return Array.from({ length: count }, (_, index) => margin + ((duration - margin * 2) * (index + 1)) / (count + 1));
}

export function describeFlaggedPassage(frames, { timeStart, timeEnd }) {
  // Saved signal timestamps are rounded to milliseconds. Keep the adjacent
  // comparison frame even when the signal covers just one sample.
  const candidates = frames.map((after, index) => ({ before: frames[index - 1], after }))
    .filter(({ before, after }) => before && after.time >= timeStart - 0.001 && before.time <= timeEnd + 0.001)
    .filter(({ after }) => Number.isFinite(after.globalDifference));
  const pair = candidates.sort((a, b) => b.after.globalDifference - a.after.globalDifference)[0];
  if (!pair) return null;
  const { before, after } = pair;
  const cells = after.cellDifferences;
  const peak = Math.max(...cells);
  const cell = cells.indexOf(peak);
  const column = ['left', 'center', 'right'][Math.floor((cell % GRID_COLUMNS) * 3 / GRID_COLUMNS)];
  const row = ['upper', 'middle', 'lower'][Math.floor(Math.floor(cell / GRID_COLUMNS) * 3 / GRID_ROWS)];
  const brightness = after.meanLuminance - before.meanLuminance;
  let description;
  let highlightedCell = null;
  if (after.globalDifference < 0.01) {
    description = 'The two neighboring samples look nearly identical. The local flag comes from the appearance of the frame itself.';
  } else if (Math.abs(brightness) >= 0.08 && peak < after.globalDifference * 2) {
    description = brightness > 0 ? 'Most of the picture gets brighter.' : 'Most of the picture gets darker.';
  } else if (peak >= after.globalDifference * 1.8 && peak >= 0.06) {
    description = `The strongest change is in the ${row} ${column} of the picture. Compare that area in the two samples below.`;
    highlightedCell = cell;
  } else {
    description = 'The change is spread across the picture. Compare the two samples for a cut or a change in camera position.';
  }
  return {
    before: { time: before.time, thumbnail: before.thumbnail },
    after: { time: after.time, thumbnail: after.thumbnail },
    description,
    highlightedCell,
    pictureDifference: after.globalDifference,
    brightestRegionChange: peak,
  };
}

function waitFor(video, eventName, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video ${eventName}.`));
    }, timeoutMs);
    const complete = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('The browser could not decode this video.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, complete);
      video.removeEventListener('error', fail);
    };
    video.addEventListener(eventName, complete, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}

async function seek(video, time) {
  if (video.currentTime === time) return;
  const waiting = waitFor(video, 'seeked');
  video.currentTime = time;
  await waiting;
}

function createCanvasFor(video) {
  const scale = Math.min(1, 256 / video.videoWidth, 192 / video.videoHeight);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function selectEvenlyIndexes(length, maximum) {
  if (length <= maximum) return new Set(Array.from({ length }, (_, index) => index));
  return new Set(Array.from({ length: maximum }, (_, index) => Math.round((index * (length - 1)) / (maximum - 1))));
}

function describePixels(imageData, width, height) {
  const { data } = imageData;
  const cells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, () => ({ total: 0, count: 0 }));
  let luminanceTotal = 0;
  let luminanceSquareTotal = 0;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const luminance = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
      luminanceTotal += luminance;
      luminanceSquareTotal += luminance * luminance;
      pixels += 1;
      const column = Math.min(GRID_COLUMNS - 1, Math.floor((x / width) * GRID_COLUMNS));
      const row = Math.min(GRID_ROWS - 1, Math.floor((y / height) * GRID_ROWS));
      const cell = cells[row * GRID_COLUMNS + column];
      cell.total += luminance;
      cell.count += 1;
    }
  }
  const meanLuminance = pixels ? luminanceTotal / pixels : 0;
  return {
    meanLuminance,
    contrast: Math.sqrt(Math.max(0, luminanceSquareTotal / pixels - meanLuminance * meanLuminance)),
    cells: cells.map((cell) => (cell.count ? cell.total / cell.count : 0)),
  };
}

function comparePixels(previous, current, width, height) {
  const cells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, () => ({ total: 0, count: 0 }));
  let total = 0;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const difference = (Math.abs(previous[offset] - current[offset]) + Math.abs(previous[offset + 1] - current[offset + 1]) + Math.abs(previous[offset + 2] - current[offset + 2])) / (255 * 3);
      total += difference;
      pixels += 1;
      const column = Math.min(GRID_COLUMNS - 1, Math.floor((x / width) * GRID_COLUMNS));
      const row = Math.min(GRID_ROWS - 1, Math.floor((y / height) * GRID_ROWS));
      const cell = cells[row * GRID_COLUMNS + column];
      cell.total += difference;
      cell.count += 1;
    }
  }
  return { globalDifference: pixels ? total / pixels : 0, cellDifferences: cells.map((cell) => (cell.count ? cell.total / cell.count : 0)) };
}

function availableFaceDetector() {
  const Detector = globalThis.FaceDetector;
  if (typeof Detector !== 'function') return null;
  try {
    return new Detector({ fastMode: true, maxDetectedFaces: 3 });
  } catch {
    return null;
  }
}

function normalizeFaces(faces, width, height) {
  return faces
    .map((face) => face.boundingBox)
    .filter(Boolean)
    .map((box) => ({ x: box.x / width, y: box.y / height, width: box.width / width, height: box.height / height }))
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

function faceSignals(frames, faceStatus) {
  if (faceStatus !== 'complete') return [];
  const signals = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (current.globalDifference >= 0.17) continue;
    const prior = previous.faces?.[0];
    const face = current.faces?.[0];
    if (prior && face) {
      const priorCentre = { x: prior.x + prior.width / 2, y: prior.y + prior.height / 2 };
      const centre = { x: face.x + face.width / 2, y: face.y + face.height / 2 };
      const distance = Math.hypot(priorCentre.x - centre.x, priorCentre.y - centre.y);
      if (distance > 0.36) {
        signals.push(
          signal(
            `face-track-${index}-${Math.round(current.time * 1000)}`,
            'face_track_discontinuity',
            current.time,
            'Face-track discontinuity',
            `The browser face detector reports a large face-position change near ${formatTimestamp(current.time)} without a sampled scene cut. Review camera motion, subject motion, tracking error, or a composited region.`,
            { normalizedFaceMotion: distance, priorFace: prior, currentFace: face },
            current.thumbnail,
          ),
        );
      }
    } else if (Boolean(prior) !== Boolean(face) && current.globalDifference > 0.025) {
      signals.push(
        signal(
          `face-appear-${index}-${Math.round(current.time * 1000)}`,
          'face_track_discontinuity',
          current.time,
          'Face detection changed abruptly',
          `A face appears or disappears in browser face detection near ${formatTimestamp(current.time)}. Review the source frame; detector availability and ordinary occlusion can cause this result.`,
          { previousFaceCount: previous.faces?.length ?? 0, currentFaceCount: current.faces?.length ?? 0 },
          current.thumbnail,
        ),
      );
    }
  }
  return deduplicateSignals(signals);
}

async function analyzeAudio(file, onProgress) {
  if (file.size > MAX_AUDIO_DECODE_BYTES) {
    return {
      status: 'unavailable',
      reason: `Audio transition scan is skipped above ${Math.round(MAX_AUDIO_DECODE_BYTES / (1024 * 1024))} MiB to keep this browser-local review stable.`,
      signals: [],
      metrics: null,
    };
  }
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return { status: 'unavailable', reason: 'Web Audio is unavailable in this browser.', signals: [], metrics: null };
  let context;
  try {
    context = new Context();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const channel = decoded.getChannelData(0);
    const blockSeconds = 0.5;
    const blockSize = Math.max(1, Math.floor(decoded.sampleRate * blockSeconds));
    const windows = [];
    const maxWindows = 180;
    const stride = Math.max(blockSize, Math.floor(channel.length / maxWindows));
    for (let start = 0; start < channel.length; start += stride) {
      let energy = 0;
      let crossings = 0;
      const end = Math.min(channel.length, start + blockSize);
      for (let index = start + 1; index < end; index += 1) {
        const sample = channel[index];
        energy += sample * sample;
        if ((channel[index - 1] >= 0) !== (sample >= 0)) crossings += 1;
      }
      const rms = Math.sqrt(energy / Math.max(1, end - start - 1));
      windows.push({ time: start / decoded.sampleRate, rms, zeroCrossRate: crossings / Math.max(1, end - start - 1) });
    }
    const deltas = windows.slice(1).map((window, index) => Math.abs(20 * Math.log10((window.rms + 1e-6) / (windows[index].rms + 1e-6))));
    const threshold = robustThreshold(deltas, 14, 4);
    const signals = [];
    windows.slice(1).forEach((window, index) => {
      const delta = deltas[index];
      const textureChange = Math.abs(window.zeroCrossRate - windows[index].zeroCrossRate);
      if (delta >= threshold && textureChange > 0.015) {
        signals.push(
          signal(
            `audio-${index}-${Math.round(window.time * 1000)}`,
            'audio_transition',
            window.time,
            'Abrupt audio transition',
            `Audio energy and waveform texture change sharply near ${formatTimestamp(window.time)}. Review for a natural edit, cut, dubbed segment, or capture transition.`,
            { energyDeltaDb: delta, thresholdDb: threshold, textureDelta: textureChange, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels },
          ),
        );
      }
    });
    onProgress?.({ phase: 'audio', completed: 1, total: 1 });
    return { status: 'complete', reason: null, signals: deduplicateSignals(signals), metrics: { sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, duration: decoded.duration, windows: windows.length, transitionThresholdDb: threshold } };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Audio could not be decoded in this browser.', signals: [], metrics: null };
  } finally {
    await context?.close?.();
  }
}

/** Runs browser-local, review-oriented video checks without uploading a frame or calling an AI service. */
export async function analyzeVideoFile(file, onProgress) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;
  try {
    await waitFor(video, 'loadedmetadata');
    const sampleTimes = buildSampleTimes(video.duration);
    if (!sampleTimes.length || !video.videoWidth || !video.videoHeight) throw new Error('The video did not provide a readable duration or frame size.');
    const canvas = createCanvasFor(video);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The browser could not create a frame-analysis canvas.');
    const modelCaptures = SYNTHETIC_MEDIA_DETECTORS.map((model) => [model.id, createFrameCapture(model)]);
    const modelFrameIndexes = selectEvenlyIndexes(sampleTimes.length, SYNTHETIC_MEDIA_SAMPLE_LIMIT);
    const faceDetector = availableFaceDetector();
    const frames = [];
    let previousPixels = null;
    for (let index = 0; index < sampleTimes.length; index += 1) {
      const time = sampleTimes[index];
      await seek(video, time);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const descriptor = describePixels(imageData, canvas.width, canvas.height);
      const transition = previousPixels ? comparePixels(previousPixels, imageData.data, canvas.width, canvas.height) : { globalDifference: null, cellDifferences: [] };
      let faces = [];
      if (faceDetector) {
        try {
          faces = normalizeFaces(await faceDetector.detect(canvas), canvas.width, canvas.height);
        } catch {
          // FaceDetector is an optional browser capability. A failure simply leaves this check unavailable.
          faces = [];
        }
      }
      frames.push({
        time,
        ...descriptor,
        ...transition,
        faces,
        thumbnail: canvas.toDataURL('image/jpeg', 0.72),
        modelPixels: modelFrameIndexes.has(index)
          ? Object.fromEntries(modelCaptures.map(([id, capture]) => [id, capture(video)]))
          : null,
      });
      previousPixels = imageData.data;
      onProgress?.({ phase: 'frames', completed: index + 1, total: sampleTimes.length });
    }
    onProgress?.({ phase: 'model', stage: 'load', completed: 0, total: 1 });
    const syntheticMedia = await analyzeSyntheticFrames(frames, (progress) => {
      onProgress?.({ phase: 'model', ...progress });
    });
    for (const signal of syntheticMedia.signals) {
      const comparison = describeFlaggedPassage(frames, signal);
      if (!comparison) continue;
      signal.comparison = comparison;
      signal.evidence.comparison = {
        beforeTime: comparison.before.time,
        afterTime: comparison.after.time,
        pictureDifference: comparison.pictureDifference,
        largestRegionDifference: comparison.brightestRegionChange,
        highlightedCell: comparison.highlightedCell,
      };
      signal.observation = comparison.description;
    }
    const temporal = analyzeTemporalDescriptors(frames);
    const faceStatus = faceDetector ? 'complete' : 'unavailable';
    const face = {
      status: faceStatus,
      reason: faceDetector ? null : 'This browser does not expose the optional FaceDetector API.',
      signals: faceSignals(frames, faceStatus),
      metrics: faceDetector ? { sampledFrames: frames.length, framesWithFaces: frames.filter((frame) => frame.faces.length > 0).length } : null,
    };
    onProgress?.({ phase: 'audio', completed: 0, total: 1 });
    const audio = await analyzeAudio(file, onProgress);
    const otherSignals = deduplicateSignals([...temporal.signals, ...face.signals, ...audio.signals]);
    const signals = [...syntheticMedia.signals, ...otherSignals].sort((a, b) => a.timeStart - b.timeStart);
    return {
      engine: ANALYSIS_ENGINE,
      status: 'complete',
      inspectedAt: new Date().toISOString(),
      sampledFrames: frames.length,
      frameIntervalEstimate: frames.length > 1 ? frames[1].time - frames[0].time : null,
      syntheticMedia,
      temporal,
      face,
      audio,
      unavailableChecks: [
        { id: 'lip_sync', reason: 'Requires a separately validated audiovisual speech model; Veil does not infer lip-sync from simple motion heuristics.' },
        { id: 'voice_clone', reason: 'Requires a separately validated voice-authenticity model and consented reference material.' },
        ...syntheticMedia.detectors.filter(({ status }) => status !== 'complete').map(({ engine, reason }) => ({ id: engine.id, reason })),
      ],
      signals,
      limitations: [
        'The scan samples frames rather than evaluating every frame.',
        'Both models evaluate sampled frame crops. Their scores and agreement have not been calibrated for video authenticity.',
        'Temporal, audio, and face-track patterns can arise in genuine media.',
        'Signals are review prompts, never an AI-generation or fraud verdict.',
      ],
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
