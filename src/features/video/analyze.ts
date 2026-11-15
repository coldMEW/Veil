// Looks through a video on this device: samples frames across its length, runs Veil's own models
// on each one, and turns what it finds into timed signals a person can jump to and judge.
// A signal is a reason to look at a moment. It is never a verdict about the whole video.

import { isAndroid } from '../../platform/environment';
import { ensureOptionalModel } from '../../platform/modelConsent';
import { engines, type Face } from '../../services/engines';
import { OUTPUT_LEANS, OUTPUT_STRONG, sigmoid } from '../inspect/model/preprocess';
import type { FocusResponse } from '../inspect/model/focusTypes';
import { stamp } from './container';
import { describeFrame, findMoments, median, passages, robustThreshold, shotOf, type FrameStats } from './temporal';

export type SignalCheck = 'ai-frames' | 'face-model' | 'face-identity' | 'cut' | 'local' | 'light' | 'held' | 'audio';

export interface VideoSignal {
  id: string;
  check: SignalCheck;
  /** 'model' signals come from a trained detector; 'picture' and 'sound' ones are plain measurements. */
  family: 'model' | 'picture' | 'sound';
  start: number;
  end: number;
  title: string;
  says: string;
  how: string;
  /** An ordinary explanation for the same pattern, so nobody reads a signal as proof. */
  innocent: string;
  thumb: string | null;
}

export interface SampledFrame {
  time: number;
  thumb: string;
  /** AI-image model, 0..1, highest over the views of the frame. Null when the model did not run. */
  ai: number | null;
  /** Face-forgery model on the largest face, 0..1. Null when there is no face big enough. */
  faceFake: number | null;
  faces: number;
}

export interface CheckStatus {
  id: 'frames' | 'ai' | 'face' | 'sound';
  label: string;
  ran: boolean;
  note: string;
}

export interface VideoAnalysis {
  seconds: number;
  width: number;
  height: number;
  frames: SampledFrame[];
  signals: VideoSignal[];
  checks: CheckStatus[];
  /** Seconds the whole scan took, and what the AI model ran on. */
  took: number;
  backend: string | null;
}

export interface Progress {
  phase: 'opening' | 'frames' | 'sound' | 'done';
  done: number;
  total: number;
  /** Thumbnail of the frame just examined, so the screen can show the scan moving. */
  thumb?: string;
  time?: number;
}

const coarse = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;

export function sampleTimes(seconds: number, phone = false): number[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const count = Math.max(phone ? 10 : 12, Math.min(phone ? 16 : 30, Math.ceil(seconds / 1.2)));
  const margin = Math.min(0.25, seconds / (count + 2));
  return Array.from({ length: count }, (_, i) => margin + ((seconds - margin * 2) * (i + 0.5)) / count);
}

function once(video: HTMLVideoElement, event: string, ms = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { clear(); resolve(); };
    const fail = () => { clear(); reject(new Error('This browser could not play that video. Try an MP4 (H.264).')); };
    const timer = window.setTimeout(() => { clear(); reject(new Error('The video took too long to respond.')); }, ms);
    const clear = () => { window.clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); };
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}

/** One long-lived worker for the AI-image model, so the model loads once for the whole video. */
function frameModel() {
  let worker: Worker | null = null;
  let n = 0;
  let backend: string | null = null;
  const waiting = new Map<number, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const start = () => {
    worker = new Worker(new URL('../inspect/model/focus.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FocusResponse>) => {
      const msg = event.data;
      const w = waiting.get(msg.id);
      if (!w || msg.type === 'progress') return;
      waiting.delete(msg.id);
      if (msg.type === 'error') return w.reject(new Error(msg.message));
      backend = `${msg.backend}${msg.backend === 'wasm' ? `, ${msg.threads} thread${msg.threads === 1 ? '' : 's'}` : ''}`;
      const logits = msg.views?.length ? msg.views.map((v) => v.logit) : [msg.logit];
      w.resolve(sigmoid(Math.max(...logits)));
    };
    worker.onerror = () => {
      for (const w of waiting.values()) w.reject(new Error('The model worker stopped.'));
      waiting.clear();
    };
  };
  return {
    async score(bitmap: ImageBitmap): Promise<number> {
      if (!worker) start();
      const id = ++n;
      const copy = await createImageBitmap(bitmap);
      // The first frame also loads the model. A frame that never answers must not hold the scan up.
      const limit = backend ? 30_000 : 90_000;
      return new Promise<number>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`The AI-image model did not answer within ${limit / 1000} seconds on this device.`));
        }, limit);
        waiting.set(id, {
          resolve: (v) => { window.clearTimeout(timer); resolve(v); },
          reject: (e) => { window.clearTimeout(timer); reject(e); },
        });
        worker!.postMessage({ id, bitmap: copy, coarse: coarse(), viewsOnly: true }, [copy]);
      });
    },
    backend: () => backend,
    stop() {
      worker?.terminate();
      worker = null;
    },
  };
}

/** Sharp jumps in loudness together with a change in the sound's texture. */
async function soundMoments(file: Blob): Promise<{ ran: boolean; note: string; times: Array<{ time: number; db: number }> }> {
  if (file.size > 120 * 1024 * 1024) return { ran: false, note: 'Skipped: the file is over 120 MB, too large to decode sound on this device.', times: [] };
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return { ran: false, note: 'This browser cannot decode sound.', times: [] };
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const channel = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(audio.sampleRate * 0.5));
    const stride = Math.max(block, Math.floor(channel.length / 180));
    const windows: Array<{ time: number; rms: number; zcr: number }> = [];
    for (let start = 0; start < channel.length; start += stride) {
      const end = Math.min(channel.length, start + block);
      let energy = 0;
      let crossings = 0;
      for (let i = start + 1; i < end; i++) {
        const s = channel[i]!;
        energy += s * s;
        if (channel[i - 1]! >= 0 !== s >= 0) crossings++;
      }
      const len = Math.max(1, end - start - 1);
      windows.push({ time: start / audio.sampleRate, rms: Math.sqrt(energy / len), zcr: crossings / len });
    }
    if (windows.every((w) => w.rms < 1e-4)) return { ran: true, note: 'The sound track is silent.', times: [] };
    const deltas = windows.slice(1).map((w, i) => Math.abs(20 * Math.log10((w.rms + 1e-6) / (windows[i]!.rms + 1e-6))));
    const threshold = robustThreshold(deltas, 14, 4);
    const times: Array<{ time: number; db: number }> = [];
    windows.slice(1).forEach((w, i) => {
      if (deltas[i]! >= threshold && Math.abs(w.zcr - windows[i]!.zcr) > 0.015 && !times.some((t) => Math.abs(t.time - w.time) < 1.2)) {
        times.push({ time: w.time, db: deltas[i]! });
      }
    });
    return { ran: true, note: `Listened to ${Math.round(audio.duration)} seconds of sound.`, times: times.slice(0, 8) };
  } catch {
    return { ran: false, note: 'No sound track, or this browser could not decode it.', times: [] };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

interface Working extends FrameStats {
  thumb: string;
  ai: number | null;
  faceFake: number | null;
  faces: number;
  embedding: Float32Array | null;
}

/** Turns per-frame numbers into the signals shown to the person. Pure, so it can be tested without a browser. */
export function buildSignals(
  frames: Array<Pick<Working, 'time' | 'thumb' | 'ai' | 'faceFake' | 'luminance' | 'difference' | 'cells'> & { identityDrop?: number | null }>,
  sound: Array<{ time: number; db: number }>,
  faceLead: number,
): VideoSignal[] {
  const signals: VideoSignal[] = [];
  const span = (list: Array<{ time: number }>) => ({ start: list[0]!.time, end: list.at(-1)!.time });

  // AI-image model: a stretch starts at a frame over the strong line and runs through neighbours that
  // still lean AI-made, so one passage is not broken up by a frame that dips. A stretch with no frame
  // over the strong line is not shown at all. One lone frame is a weaker lead than a stretch.
  for (const run of passages(frames, (f) => f.ai !== null && f.ai >= OUTPUT_LEANS)) {
    const top = Math.max(...run.map((f) => f.ai ?? 0));
    if (top < OUTPUT_STRONG) continue;
    const peak = run.find((f) => f.ai === top) ?? run[0]!;
    signals.push({
      id: `ai-${Math.round(run[0]!.time * 1000)}`,
      check: 'ai-frames',
      family: 'model',
      ...span(run),
      title: run.length > 1 ? 'Frames look AI-made' : 'One frame looks AI-made',
      says: `${run.length > 1 ? `${run.length} sampled frames in a row lean AI-made on our image model, peaking at` : 'One sampled frame scores'} ${Math.round(top * 100)} out of 100${run.length > 1 ? '' : ' for AI-made on our image model'}.`,
      how: 'Community Forensics ViT (MIT), the same model as photo Check, run on this device on each sampled frame.',
      innocent: 'Heavy compression, filters, screen recordings and animation can score high too.',
      thumb: peak.thumb,
    });
  }

  // Face-forgery model: on a single photo one score over the line is a lead. Across a video the same
  // model gets many tries, so one frame over the line is expected by chance now and then (it wrongly
  // flagged 2 of 60 real faces in our tests). Veil therefore needs two neighbouring frames to agree.
  const facedFrames = frames.filter((f) => f.faceFake !== null).length;
  for (const run of passages(frames, (f) => f.faceFake !== null && f.faceFake >= faceLead)) {
    if (run.length < 2 && facedFrames > 1) continue;
    const top = Math.max(...run.map((f) => f.faceFake ?? 0));
    const peak = run.find((f) => f.faceFake === top) ?? run[0]!;
    signals.push({
      id: `face-${Math.round(run[0]!.time * 1000)}`,
      check: 'face-model',
      family: 'model',
      ...span(run),
      title: 'The face looks manipulated',
      says: `Our face-forgery model scores the face ${top.toFixed(2)} out of 1 for swapped or generated${run.length > 1 ? ` across ${run.length} sampled frames` : ''}.`,
      how: 'Deep-Fake-Detector v2 (ViT, Apache-2.0) on the face crop, on this device. In our tests this level caught 25 of 60 known fakes and wrongly flagged 2 of 60 real faces.',
      innocent: 'Beauty filters, strong make-up, motion blur and low light can raise this score.',
      thumb: peak.thumb,
    });
  }

  frames.forEach((f, i) => {
    if (f.identityDrop == null) return;
    signals.push({
      id: `identity-${Math.round(f.time * 1000)}`,
      check: 'face-identity',
      family: 'model',
      start: frames[i - 1]?.time ?? f.time,
      end: f.time,
      title: 'The face stops matching itself',
      says: `Within one continuous shot, the face at ${stamp(f.time)} no longer matches the face just before it (similarity ${f.identityDrop.toFixed(2)}; the same person normally stays above 0.36).`,
      how: 'Veil measures each face as 128 numbers and compares neighbouring frames of the same shot. Nothing is compared across a cut.',
      innocent: 'A second person stepping in, a sharp head turn, or a hand over the face does the same.',
      thumb: f.thumb,
    });
  });

  const { moments } = findMoments(frames);
  for (const m of moments) {
    const frame = frames.find((f) => f.time === m.time);
    const at = stamp(m.time);
    const base = { id: `${m.kind}-${Math.round(m.time * 1000)}`, family: 'picture' as const, start: m.previousTime, end: m.time, thumb: frame?.thumb ?? null, how: 'Each sampled frame compared with the one before it, against this video\'s own normal amount of change.' };
    if (m.kind === 'cut') signals.push({ ...base, check: 'cut', title: 'The whole picture changes', says: `At ${at} the picture changes far more than anywhere nearby: a cut, a splice or a new scene.`, innocent: 'Ordinary editing: most videos have cuts.' });
    if (m.kind === 'local') signals.push({ ...base, check: 'local', title: `One area changes: ${m.where}`, says: `Just before ${at}, the ${m.where} of the picture changes while the rest holds still.`, innocent: 'Someone or something moving in that part of the frame.' });
    if (m.kind === 'light') signals.push({ ...base, check: 'light', title: 'Brightness jumps', says: `At ${at} the overall brightness shifts suddenly without the scene changing.`, innocent: 'A phone camera adjusting exposure, or a light switching on.' });
    if (m.kind === 'held') signals.push({ ...base, check: 'held', title: 'A frame is held', says: `Around ${at} the picture freezes right after it was moving.`, innocent: 'A paused recording, a dropped frame or a still subject.' });
  }

  for (const s of sound) {
    signals.push({
      id: `sound-${Math.round(s.time * 1000)}`,
      check: 'audio',
      family: 'sound',
      start: s.time,
      end: s.time,
      title: 'The sound changes abruptly',
      says: `At ${stamp(s.time)} the loudness jumps by ${Math.round(s.db)} dB and the character of the sound changes with it.`,
      how: 'Loudness and waveform texture measured in half-second windows of the decoded sound track.',
      innocent: 'A cut between takes, a dubbed section, or someone starting to speak.',
      thumb: null,
    });
  }
  return signals.sort((a, b) => a.start - b.start);
}

/** The largest face in a frame, when it is big enough to judge. */
function mainFace(faces: Face[], width: number): Face | null {
  const big = faces.filter((f) => f.box.w * width >= 72).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  return big[0] ?? null;
}

export async function analyzeVideo(file: Blob, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<VideoAnalysis> {
  const started = performance.now();
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  const model = frameModel();
  const stopped = () => {
    if (signal?.aborted) throw new DOMException('Stopped.', 'AbortError');
  };
  try {
    onProgress({ phase: 'opening', done: 0, total: 1 });
    await once(video, 'loadeddata');
    const seconds = video.duration;
    const times = sampleTimes(seconds, coarse());
    if (!times.length || !video.videoWidth) throw new Error('This video has no readable length or picture.');

    // Small canvas for the frame-to-frame maths and the thumbnail; larger one for the models.
    const s = Math.min(1, 256 / video.videoWidth, 192 / video.videoHeight);
    const small = new OffscreenCanvas(Math.max(1, Math.round(video.videoWidth * s)), Math.max(1, Math.round(video.videoHeight * s)));
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    const m = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const big = new OffscreenCanvas(Math.round(video.videoWidth * m), Math.round(video.videoHeight * m));
    const bctx = big.getContext('2d')!;
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = small.width;
    thumbCanvas.height = small.height;

    let aiNote = '';
    let aiOk = true;
    try {
      if (isAndroid()) await ensureOptionalModel('focus');
    } catch (e) {
      aiOk = false;
      aiNote = e instanceof Error ? e.message : 'The AI-image model is not on this phone yet.';
    }
    const faceEngine = await engines.face();
    let faceNote = faceEngine ? '' : 'The face models are not available in this build.';

    const frames: Working[] = [];
    let previous: Uint8ClampedArray | null = null;
    for (let i = 0; i < times.length; i++) {
      stopped();
      const time = times[i]!;
      if (Math.abs(video.currentTime - time) > 0.001) {
        const seeked = once(video, 'seeked');
        video.currentTime = time;
        await seeked;
      }
      sctx.drawImage(video, 0, 0, small.width, small.height);
      const pixels = sctx.getImageData(0, 0, small.width, small.height).data;
      const stats = describeFrame(time, pixels, previous, small.width, small.height);
      previous = pixels;
      thumbCanvas.getContext('2d')!.drawImage(small, 0, 0);
      const thumb = thumbCanvas.toDataURL('image/jpeg', 0.72);

      bctx.drawImage(video, 0, 0, big.width, big.height);
      const bitmap = big.transferToImageBitmap();
      let ai: number | null = null;
      let faceFake: number | null = null;
      let embedding: Float32Array | null = null;
      let faces = 0;
      try {
        if (aiOk) {
          try {
            ai = await model.score(bitmap);
          } catch (e) {
            aiOk = false;
            aiNote = e instanceof Error ? e.message : 'The AI-image model stopped.';
          }
        }
        if (faceEngine) {
          try {
            const found = await faceEngine.detectFaces(bitmap);
            faces = found.length;
            const face = mainFace(found, bitmap.width);
            if (face) {
              embedding = await faceEngine.embedFace(bitmap, face);
              if (faceEngine.scoreFaceForgery) faceFake = await faceEngine.scoreFaceForgery(bitmap, face);
            }
          } catch (e) {
            faceNote = e instanceof Error ? e.message : 'The face models stopped.';
          }
        }
      } finally {
        bitmap.close();
      }
      frames.push({ ...stats, thumb, ai, faceFake, faces, embedding });
      onProgress({ phase: 'frames', done: i + 1, total: times.length, thumb, time });
    }

    // Identity continuity: only between neighbouring samples inside one shot, both with a clear face.
    const { cuts } = findMoments(frames);
    const withIdentity = frames.map((f, i) => {
      const before = frames[i - 1];
      if (!faceEngine || !before?.embedding || !f.embedding || shotOf(before.time, cuts) !== shotOf(f.time, cuts)) return { ...f, identityDrop: null };
      const { cosine, match } = faceEngine.compareFaces(before.embedding, f.embedding);
      return { ...f, identityDrop: match === 'different' ? cosine : null };
    });

    stopped();
    onProgress({ phase: 'sound', done: 0, total: 1 });
    const sound = await soundMoments(file);

    const scored = frames.filter((f) => f.ai !== null).length;
    const faced = frames.filter((f) => f.embedding).length;
    const checks: CheckStatus[] = [
      { id: 'frames', label: 'Frame-to-frame changes', ran: true, note: `${frames.length} frames sampled across ${stamp(seconds)}; typical change between samples ${(median(frames.slice(1).map((f) => f.difference ?? 0)) * 100).toFixed(1)}%.` },
      { id: 'ai', label: 'AI-image model', ran: scored > 0, note: scored > 0 ? `${scored} of ${frames.length} frames scored${model.backend() ? ` (${model.backend()})` : ''}.` : aiNote || 'The model did not run.' },
      { id: 'face', label: 'Face checks', ran: Boolean(faceEngine) && !faceNote, note: faceNote || (faced ? `A face was clear enough in ${faced} of ${frames.length} frames.` : 'No face was large enough to judge in the sampled frames.') },
      { id: 'sound', label: 'Sound', ran: sound.ran, note: sound.note },
    ];

    onProgress({ phase: 'done', done: 1, total: 1 });
    return {
      seconds,
      width: video.videoWidth,
      height: video.videoHeight,
      frames: frames.map(({ time, thumb, ai, faceFake, faces }) => ({ time, thumb, ai, faceFake, faces })),
      signals: buildSignals(withIdentity, sound.times, faceEngine?.FACE_FAKE_LEAD ?? 0.85),
      checks,
      took: (performance.now() - started) / 1000,
      backend: model.backend(),
    };
  } finally {
    model.stop();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
