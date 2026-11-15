// What Veil concludes from a video, and the record it exports. Kept free of React and of the
// browser so the wording rules can be tested.

import type { ProvenanceResult } from '../inspect/provenance/contentCredentials';
import { OUTPUT_LEANS, OUTPUT_STRONG } from '../inspect/model/preprocess';
import type { VideoAnalysis, VideoSignal } from './analyze';
import { AI_VIDEO_TOOL, formatBytes, stamp, type ContainerFacts } from './container';
import { SCHEMA, type CustodyEvent } from './seal';

export type VideoVerdict = 'checking' | 'fake' | 'suspect' | 'signed' | 'unclear';

export interface Reason {
  /** 'for' = a sign of tampering (shown red); 'against' = a sign it was left alone (shown green). */
  side: 'for' | 'against';
  text: string;
  /** Higher is shown first. Facts about the file outrank model opinions. */
  weight: number;
}

const AI_TYPES = new Set(['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic']);

export interface CredentialFinding {
  state: 'none' | 'changed' | 'ai-label' | 'camera' | 'present' | 'unread';
  signer: string | null;
  generator: string | null;
  note: string;
}

export function credentialFinding(facts: ContainerFacts, provenance: ProvenanceResult | null | 'skipped'): CredentialFinding {
  if (!facts.c2paBoxes) return { state: 'none', signer: null, generator: null, note: 'No Content Credentials in this file. Most videos have none, so this says nothing either way.' };
  if (!provenance || provenance === 'skipped' || provenance.error) {
    return { state: 'unread', signer: null, generator: null, note: 'The file carries Content Credentials, but they could not be checked on this device.' };
  }
  const c = provenance.credentials;
  const failures = c.failures.filter((f) => !/untrusted/i.test(f.code));
  if (c.present && c.contentChanged) return { state: 'changed', signer: c.signer, generator: c.generator, note: `Signed${c.signer ? ` by ${c.signer}` : ''}, but the video no longer matches what was signed.` };
  if (c.present && c.sourceTypes.some((t) => AI_TYPES.has(t)) && !failures.length) {
    return { state: 'ai-label', signer: c.signer, generator: c.generator, note: `Its own signed label says it was made with AI${c.generator ? ` (${c.generator})` : ''}.` };
  }
  if (c.present && c.sourceTypes.includes('digitalCapture') && !failures.length && c.validationState !== 'Invalid') {
    return { state: 'camera', signer: c.signer, generator: c.generator, note: `Signed${c.signer ? ` by ${c.signer}` : ''} as a camera recording, and still matching what was signed.` };
  }
  return { state: c.present ? 'present' : 'unread', signer: c.signer, generator: c.generator, note: c.present ? 'Content Credentials are present and readable, with no claim Veil can use.' : 'A credentials box is present but holds no readable manifest.' };
}

const strongModel = (s: VideoSignal) => s.check === 'face-model' || s.check === 'face-identity' || (s.check === 'ai-frames' && s.end > s.start);

export function videoVerdict(credentials: CredentialFinding | null, analysis: VideoAnalysis | null, busy: boolean): VideoVerdict {
  if (credentials?.state === 'changed' || credentials?.state === 'ai-label') return 'fake';
  if (analysis?.signals.some(strongModel)) return 'suspect';
  if (busy || !analysis) return 'checking';
  if (analysis.signals.some((s) => s.family === 'model')) return 'suspect';
  return credentials?.state === 'camera' ? 'signed' : 'unclear';
}

/** Up to three reasons on each side, strongest first. Only things that were actually measured. */
export function videoReasons(facts: ContainerFacts, credentials: CredentialFinding | null, analysis: VideoAnalysis | null): { for: string[]; against: string[] } {
  const reasons: Reason[] = [];
  const add = (side: Reason['side'], weight: number, text: string) => reasons.push({ side, weight, text });

  if (credentials?.state === 'changed') add('for', 100, credentials.note);
  if (credentials?.state === 'ai-label') add('for', 95, credentials.note);
  if (credentials?.state === 'camera') add('against', 95, credentials.note);

  const aiTool = facts.writtenBy.find((t) => AI_VIDEO_TOOL.test(t));
  const editor = facts.writtenBy.find((t) => !AI_VIDEO_TOOL.test(t));
  if (aiTool) add('for', 70, `The file names an AI video tool: ${aiTool}. Anyone can edit this text, so it is a lead.`);
  else if (editor) add('for', 30, `Saved by ${editor}, so this is an export, not the camera's own file.`);

  if (analysis) {
    const s = analysis.signals;
    const scored = analysis.frames.filter((f) => f.ai !== null);
    const high = scored.filter((f) => (f.ai ?? 0) >= OUTPUT_STRONG);
    const identity = s.filter((x) => x.check === 'face-identity');
    const face = s.filter((x) => x.check === 'face-model');
    const faced = analysis.frames.filter((f) => f.faceFake !== null);

    if (identity.length) add('for', 85, `The face stops matching itself inside one shot, at ${stamp(identity[0]!.end)}.`);
    if (face.length) add('for', 80, `The face-forgery model flags the face (${Math.max(...faced.map((f) => f.faceFake ?? 0)).toFixed(2)} of 1) at ${stamp(face[0]!.start)}.`);
    const aiRun = s.filter((x) => x.check === 'ai-frames').sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (aiRun && aiRun.end > aiRun.start) {
      add('for', 75, `Frames from ${stamp(aiRun.start)} to ${stamp(aiRun.end)} lean AI-made on the image model, peaking at ${Math.round(Math.max(...scored.map((f) => f.ai ?? 0)) * 100)} of 100.`);
    } else if (high.length) {
      add('for', 45, `One sampled frame, at ${stamp(high[0]!.time)}, scores ${Math.round((high[0]!.ai ?? 0) * 100)} of 100 for AI-made.`);
    }
    const local = s.filter((x) => x.check === 'local');
    if (local.length) add('for', 25, `One area of the picture changes on its own ${local.length === 1 ? `at ${stamp(local[0]!.end)}` : `${local.length} times`}.`);
    const sound = s.filter((x) => x.check === 'audio');
    if (sound.length) add('for', 20, `The sound changes abruptly ${sound.length === 1 ? `at ${stamp(sound[0]!.start)}` : `${sound.length} times`}.`);

    if (scored.length && !high.length) {
      const top = Math.max(...scored.map((f) => f.ai ?? 0));
      if (top < OUTPUT_LEANS) add('against', 60, `All ${scored.length} sampled frames stay low on the AI-image model (highest ${Math.round(top * 100)} of 100).`);
    }
    if (faced.length >= 2 && !face.length && !identity.length) {
      const calm = Math.max(...faced.map((f) => f.faceFake ?? 0)) < OUTPUT_LEANS;
      add('against', 55, `Inside each shot the face stays the same person, across ${faced.length} frames where it is clear${calm ? ', and the face-forgery model stays low' : ''}.`);
    }
    const cuts = s.filter((x) => x.check === 'cut').length;
    if (!cuts && !local.length && analysis.frames.length >= 8) add('against', 40, `One continuous shot: no cut or patch-like change across ${analysis.frames.length} sampled frames.`);
  }
  if (!facts.writtenBy.length && facts.fastStart === false) add('against', 20, 'The file is laid out the way cameras write it, with no editing software named.');

  const pick = (side: Reason['side']) => reasons.filter((r) => r.side === side).sort((a, b) => b.weight - a.weight).slice(0, 3).map((r) => r.text);
  return { for: pick('for'), against: pick('against') };
}

export interface Note {
  id: string;
  at: string;
  time: number;
  text: string;
}

export interface VideoRecord {
  schema: typeof SCHEMA;
  caseId: string;
  purpose: 'claim' | 'personal';
  createdAt: string;
  asset: { name: string; bytes: number; size: string; mimeType: string; sha256: string };
  container: ContainerFacts;
  credentials: CredentialFinding | null;
  scan: {
    seconds: number;
    width: number;
    height: number;
    took: number;
    backend: string | null;
    checks: VideoAnalysis['checks'];
    frames: Array<{ time: number; ai: number | null; faceFake: number | null; faces: number }>;
    signals: Array<Omit<VideoSignal, 'thumb'>>;
  } | null;
  reasons: { for: string[]; against: string[] };
  notes: Note[];
  events: CustodyEvent[];
  limits: string[];
  software: string;
}

export const LIMITS = [
  'A fingerprint identifies exact bytes. It does not show who recorded the video or that what it shows happened.',
  'Signals are reasons to look at a moment. None is a finding that the video is fake, and none is proof it is real.',
  'Frames are sampled, not every frame is examined; something between samples can be missed.',
  'The model scores are not calibrated for video and can be wrong in both directions.',
  'The device signature shows the record was not altered after sealing. It does not identify the reviewer.',
];

export function buildRecord(input: {
  caseId: string;
  purpose: VideoRecord['purpose'];
  createdAt: string;
  file: { name: string; size: number; type: string };
  sha256: string;
  container: ContainerFacts;
  credentials: CredentialFinding | null;
  analysis: VideoAnalysis | null;
  notes: Note[];
  events: CustodyEvent[];
}): VideoRecord {
  const { analysis } = input;
  return {
    schema: SCHEMA,
    caseId: input.caseId,
    purpose: input.purpose,
    createdAt: input.createdAt,
    asset: { name: input.file.name, bytes: input.file.size, size: formatBytes(input.file.size), mimeType: input.file.type || 'video/mp4', sha256: input.sha256 },
    container: input.container,
    credentials: input.credentials,
    scan: analysis
      ? {
          seconds: analysis.seconds,
          width: analysis.width,
          height: analysis.height,
          took: Number(analysis.took.toFixed(1)),
          backend: analysis.backend,
          checks: analysis.checks,
          // Thumbnails stay on the screen; the record holds numbers only, never pictures of people.
          frames: analysis.frames.map(({ time, ai, faceFake, faces }) => ({ time: Number(time.toFixed(3)), ai, faceFake, faces })),
          signals: analysis.signals.map(({ thumb: _thumb, ...rest }) => rest),
        }
      : null,
    reasons: videoReasons(input.container, input.credentials, analysis),
    notes: input.notes,
    events: input.events,
    limits: LIMITS,
    software: 'Veil video evidence, on-device',
  };
}
