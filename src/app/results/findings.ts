// Turns each check's state into one plain-language line for the "What we found" summary, plus the
// reasons behind it: what was measured, on what basis, and when that basis can be wrong.
// Evidence, not verdicts: each line is one check's flag; there is never an overall answer.

import { outputSummary, type FocusState } from '../../features/inspect/model/useModelFocus';
import { aiProbabilityDrops, AI_HIGH, AI_LOW, OUTPUT_LEANS, OUTPUT_RAISED, OUTPUT_SATURATED, sigmoid } from '../../features/inspect/model/preprocess';
import { viewNames, viewWord } from '../../features/inspect/model/ViewStrip';
import type { FocusResult } from '../../features/inspect/model/focusTypes';
import type { WarpState } from '../../features/inspect/warp/useWarpDetector';
import { HIGH as WARP_HIGH, LOW as WARP_LOW } from '../../features/inspect/warp/preprocess';
import type { ProvenanceState } from '../inspect/useProvenance';
import type { CameraHints } from '../../features/inspect/provenance/cameraHints';
import type { ForensicsState } from '../../features/inspect/forensics/useForensics';

/** alert = red flag, notice = amber flag, clear = this check found nothing, neutral = nothing to go on. */
export type FindingTone = 'alert' | 'notice' | 'clear' | 'neutral' | 'pending' | 'idle';
export type LayerId = 'ai' | 'face' | 'shadow';

export interface Finding {
  id: string;
  title: string;
  tone: FindingTone;
  headline: string;
  layer?: LayerId;
  /** The basis for the flag, in plain sentences: what was measured and what it showed. */
  why?: string[];
  /** When this basis can be wrong. */
  limits?: string;
  /** Detector output per part of the photo, for the visual strip. */
  views?: NonNullable<FocusResult['views']>;
  /** Evidence kind, kept apart in the UI (AGENTS.md rule 3). */
  group: EvidenceGroup;
  /** One short line for the summary at the top, when this check raised a flag. */
  short?: string;
}

export type EvidenceGroup = 'provenance' | 'model' | 'signal' | 'physical';
export const GROUP_LABEL: Record<EvidenceGroup, string> = {
  provenance: 'File and provenance',
  model: 'Pixel patterns',
  signal: 'Image forensics',
  physical: 'Physics',
};

const AI_TYPES = new Set(['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic']);
const SOURCE_TYPE_TEXT: Record<string, string> = {
  trainedAlgorithmicMedia: 'created by a generative AI model',
  compositeWithTrainedAlgorithmicMedia: 'edited with a generative AI model',
  algorithmicMedia: 'created by an algorithm',
  compositeSynthetic: 'a composite that includes generated parts',
};

/** Camera details are shown as information only: EXIF is easy to edit, so they never clear a photo. */
function cameraLine(camera: CameraHints | null | undefined): string[] {
  if (!camera) return [];
  const device = [camera.make, camera.model].filter(Boolean).join(' ');
  const parts = [device && `camera ${device}`, camera.dateTimeOriginal && `taken ${camera.dateTimeOriginal}`, camera.software && `software ${camera.software}`].filter(Boolean);
  return parts.length ? [`The file lists ${parts.join(', ')}. These details are easy to edit, so they are not a flag either way.`] : [];
}

export function provenanceFinding(p: ProvenanceState): Finding {
  const base = { id: 'provenance', title: 'Content Credentials', group: 'provenance' as const };
  if (p.status !== 'done') return { ...base, tone: 'pending', headline: 'Reading the file…' };
  const { credentials: c, hints } = p.result;
  if (p.result.error) return { ...base, tone: 'idle', headline: 'Could not be read in this browser.' };
  const types = [...new Set([...c.sourceTypes, ...hints.sourceTypes])];
  const aiType = types.find((t) => AI_TYPES.has(t));
  const ai = aiType !== undefined;
  const signedBy = c.signer ? ` by ${c.signer}` : '';
  const trust = c.credentialProblem ? "The signer's certificate could not be confirmed as trusted on this device." : null;
  const stripped = 'A screenshot or a re-save in most apps removes it.';
  if (c.contentChanged) {
    return {
      ...base, tone: 'alert', headline: 'Changed after its credentials were signed.', short: 'Changed after it was signed',
      why: [
        `The file carries Content Credentials: a record of how it was made, signed${signedBy}.`,
        'The pixels no longer match what was signed, so the image was changed after signing.',
      ],
      limits: 'It shows that a change happened, not what changed or whether it matters.',
    };
  }
  if (c.present && ai) {
    return {
      ...base, tone: 'alert', headline: `Says it was made by AI${c.generator ? ` (${c.generator})` : ''}, signed by ${c.signer ?? 'the creator'}.`,
      short: `Signed as AI-made${c.signer ? ` by ${c.signer}` : ''}`,
      why: [
        `The file carries Content Credentials: a record of how it was made, signed${signedBy}.`,
        `That record says the image was ${SOURCE_TYPE_TEXT[aiType] ?? 'made with AI'}${c.generator ? `, by ${c.generator}` : ''}.`,
        'Veil checked the signature on this device, and the pixels still match what was signed.',
        ...(trust ? [trust] : []),
      ],
      limits: `This is the strongest signal when present. ${stripped}`,
    };
  }
  if (c.present) {
    return {
      ...base, tone: 'clear', short: 'Signed, no AI declared', headline: `Credentials attached${c.signer ? `, signed by ${c.signer}` : ''}. No AI source declared.`,
      why: [`The file carries Content Credentials, signed${signedBy}.`, 'They do not declare an AI source.', ...(trust ? [trust] : [])],
      limits: 'Credentials only describe what the signing app recorded.',
    };
  }
  if (ai || hints.toolNames.length) {
    return {
      ...base, tone: 'notice', headline: `No credentials, but the metadata names ${hints.toolNames.slice(0, 2).join(', ') || 'an AI source'}.`,
      short: `Unsigned label: ${hints.toolNames[0] ?? 'AI source'}`,
      why: [
        ...(hints.toolNames.length ? [`The file's metadata text names ${hints.toolNames.slice(0, 3).join(', ')}.`] : []),
        ...(aiType ? [`It carries the industry tag for images ${SOURCE_TYPE_TEXT[aiType]} (IPTC "${aiType}").`] : []),
        'This label is not signed, so anyone can add or remove it.',
      ],
      limits: `${stripped} It can also be added to any file.`,
    };
  }
  return {
    ...base, tone: 'neutral', headline: 'None found. Most photos have none, and screenshots remove them, so this proves nothing.', short: 'None in this file',
    why: [
      'No Content Credentials and no AI labels in the file.',
      'Screenshots, messaging apps and most editors remove them, so missing labels are not a flag either way.',
      ...cameraLine(p.result.camera),
    ],
  };
}

const DETECTOR_BASIS = 'Reads texture and noise patterns in the pixels, not the labels, so screenshots work too.';
const DETECTOR_LIMITS = 'New generators, heavy filters, upscaling or tiny images can fool it.';
const CALIBRATION = 'Tested on 8 camera photos (all camera-like): too few for an error rate.';

function partsSentence(r: FocusResult): string {
  const views = r.views?.length ? r.views : [{ label: 'center' as const, logit: r.logit, crop: r.crop }];
  const order = { start: 0, center: 1, end: 2 } as const;
  const sorted = [...views].sort((a, b) => order[a.label] - order[b.label]);
  const names = viewNames(views);
  const words = sorted.map((v) => viewWord(v.logit));
  if (words.every((w) => w === words[0])) return `It scored ${views.length === 1 ? 'the centre crop' : `all ${views.length} parts of the photo`} as ${words[0]}.`;
  return `It scored ${sorted.map((_, i) => `the ${(names[i] ?? 'part').toLowerCase()} ${words[i]}`).join(', ')}.`;
}

export function aiSignalFinding(f: FocusState): Finding {
  const base = { id: 'ai-signal', title: 'AI-image detector', layer: 'ai' as const, group: 'model' as const };
  if (f.status === 'idle') return { ...base, tone: 'idle', headline: 'Not run yet.' };
  if (f.status === 'loading' || f.status === 'running') return { ...base, tone: 'pending', headline: f.status === 'running' ? `Measuring ${f.done} of ${f.total}…` : 'Loading the detector…' };
  if (f.status === 'failed') return { ...base, tone: 'idle', headline: `Did not finish: ${f.message}` };
  // What the detector itself output comes first; the heatmap only says where it came from, and a
  // saturated output leaves the heatmap empty even when the output is at its strongest.
  const r = f.result;
  const out = outputSummary(r);
  const drops = aiProbabilityDrops(r.deltas, r.logit);
  const strong = Array.from(drops).filter((d) => d >= AI_HIGH).length;
  const weak = Array.from(drops).filter((d) => d >= AI_LOW && d < AI_HIGH).length;
  const n = drops.length;
  const mapParts = [
    strong ? `${strong} of ${n} areas by ${Math.round(AI_HIGH * 100)} points or more (red on the photo)` : '',
    weak ? `${weak} by ${Math.round(AI_LOW * 100)} points or more (yellow)` : '',
  ].filter(Boolean);
  const map = mapParts.length
    ? [`Covering parts of the centre crop lowered its AI output: ${mapParts.join(', ')}.`]
    : sigmoid(r.logit) >= OUTPUT_SATURATED
      ? ['The heatmap stays empty because the output is already at its top: no single area changes it.']
      : [];
  const extra = { why: [DETECTOR_BASIS, partsSentence(r), ...map, CALIBRATION], limits: DETECTOR_LIMITS, views: r.views };
  const where = out.views === 1 ? 'on the centre crop' : `in ${out.count} of ${out.views} parts of the photo`;
  const partsShort = out.views === 1 ? '' : ` in ${out.count} of ${out.views} parts`;
  if (out.band === 'strong') return { ...base, ...extra, tone: 'alert', short: `Pixels look very AI-like${partsShort}`, headline: `AI-like patterns in the pixels: the detector leans strongly toward "AI-generated" ${where}.` };
  if (out.band === 'leans') return { ...base, ...extra, tone: 'notice', short: `Pixels look AI-like${partsShort}`, headline: `Some AI-like patterns: the detector leans toward "AI-generated" ${where}.` };
  if (strong) return { ...base, ...extra, tone: 'alert', short: `Strong AI signal in ${strong} area${strong === 1 ? '' : 's'}`, headline: `Strong AI signal in ${strong} of ${n} areas${weak ? `, weaker in ${weak}` : ''}.` };
  if (weak) return { ...base, ...extra, tone: 'notice', short: `Weak AI signal in ${weak} area${weak === 1 ? '' : 's'}`, headline: `Weak AI signal in ${weak} of ${n} areas.` };
  const all = out.views === 1 ? 'on the centre crop' : `in all ${out.views} parts`;
  if (sigmoid(out.maxLogit) >= OUTPUT_RAISED) return { ...base, ...extra, tone: 'notice', short: 'Detector output raised', headline: `The detector's output is raised but under the ${OUTPUT_LEANS} display line ${all}.` };
  return { ...base, ...extra, tone: 'clear', short: `Camera-like${partsShort}`, headline: `The detector's output stays camera-like ${all}.` };
}

export function warpFinding(w: WarpState): Finding {
  const base = { id: 'face-warp', title: 'Face warp map', layer: 'face' as const, group: 'model' as const };
  if (w.status === 'idle') return { ...base, tone: 'idle', headline: 'Optional: mark a face to check for reshaping.' };
  if (w.status === 'loading' || w.status === 'running') return { ...base, tone: 'pending', headline: 'Measuring the face…' };
  if (w.status === 'failed') return { ...base, tone: 'idle', headline: `Did not finish: ${w.message}` };
  const max = w.result.maxMagnitude;
  const extra = {
    why: [
      "A model trained on faces edited with Photoshop's Face-Aware Liquify predicts how far each part of the marked face was pushed or pulled.",
      `Its largest predicted shift in the marked face is ${max.toFixed(1)} pixels.`,
    ],
    limits: 'It only looks for that kind of reshaping, not AI generation or other edits, and expressions or lens distortion can look similar.',
  };
  if (max >= WARP_HIGH) return { ...base, ...extra, tone: 'alert', short: 'Face looks reshaped', headline: `Strong predicted warp (up to ${max.toFixed(1)} px).` };
  if (max >= WARP_LOW) return { ...base, ...extra, tone: 'notice', short: 'Face may be reshaped', headline: `Some predicted warp (up to ${max.toFixed(1)} px).` };
  return { ...base, ...extra, tone: 'clear', short: 'No reshaping found', headline: 'No notable predicted warp in the marked face.' };
}

export const SHADOW_WHY = 'With one light, such as the sun, the line from each object point through its shadow points to the same place.';
export const SHADOW_LIMITS = 'It depends on accurate marks; soft shadows, several lights or curved ground make it unreliable.';

export const TONE_LABEL: Record<FindingTone, string> = {
  alert: 'Red flag',
  notice: 'Amber flag',
  clear: 'No flag',
  neutral: 'No signal',
  pending: 'Checking',
  idle: 'Not run',
};

export type EvidenceLevel = 'checking' | 'strong' | 'some' | 'none' | 'unknown';

/**
 * The strongest flag any single check raised. Not a count, vote or score: one red flag from one
 * check is enough for "strong", and checks are never added together.
 */
export function evidenceLevel(findings: Finding[]): EvidenceLevel {
  if (findings.some((f) => f.tone === 'alert')) return 'strong';
  if (findings.some((f) => f.tone === 'pending')) return 'checking';
  if (findings.some((f) => f.tone === 'notice')) return 'some';
  if (findings.some((f) => f.tone === 'clear')) return 'none';
  return 'unknown';
}

export const LEVEL_TEXT: Record<EvidenceLevel, { title: string; body: string }> = {
  checking: { title: 'Checking…', body: '' },
  strong: { title: 'Strong signs of AI or editing', body: '' },
  some: { title: 'Some signs worth a look', body: '' },
  none: { title: 'No signs found', body: 'Not proof it came from a camera.' },
  unknown: { title: 'Not enough to go on', body: 'No check could measure this photo.' },
};

type ForensicKey = 'ela' | 'noise' | 'thumbnail';
const FORENSIC: Record<ForensicKey, { id: string; title: string; group: EvidenceGroup; basis: string; limits: string; flag: string; even: string; na: string }> = {
  thumbnail: {
    id: 'exif-thumbnail', title: 'Embedded preview', group: 'provenance',
    basis: 'Cameras save a small preview inside the file. Edits made later often leave the old preview behind.',
    limits: 'Some apps rotate, crop or regenerate the preview; a match shows nothing either way.',
    flag: 'Preview differs from the photo', even: 'Preview matches the photo', na: 'No camera preview in the file',
  },
  ela: {
    id: 'ela', title: 'JPEG recompression map', group: 'signal',
    basis: 'Re-saves the JPEG once and compares. Pasted or edited areas often recompress differently.',
    limits: 'Edges, text and repeated re-saves change the map.',
    flag: 'Some areas recompress differently', even: 'Recompresses evenly', na: 'Needs the original JPEG',
  },
  noise: {
    id: 'noise', title: 'Noise consistency map', group: 'signal',
    basis: 'Camera noise is usually even across a photo. Pasted or generated areas often carry different noise.',
    limits: 'Sky, blur, depth of field and denoising change noise; generated images can be even everywhere.',
    flag: 'Noise differs in some areas', even: 'Noise is even', na: 'Too small or flat to compare',
  },
};

/**
 * Classic forensics checks. These maps also react to ordinary edges, sky and blur, so a standing-out
 * region is an amber flag at most, never red.
 */
export function forensicsFinding(key: ForensicKey, s: ForensicsState): Finding {
  const m = FORENSIC[key];
  const base = { id: m.id, title: m.title, group: m.group };
  if (s.status === 'idle') return { ...base, tone: 'idle', headline: 'Not run yet.' };
  if (s.status === 'running') return { ...base, tone: 'pending', headline: 'Checking…' };
  // A failure is not a result either way, but it must be visible, not folded into "not run".
  if (s.status === 'failed') return { ...base, tone: 'neutral', short: 'Did not finish', headline: `Did not finish: ${s.message}` };
  const r = s.checkResult;
  const why = [m.basis, r.observation];
  if (r.finding === 'not_applicable') return { ...base, tone: 'neutral', short: m.na, headline: r.observation, why, limits: m.limits };
  if (r.finding === 'inconsistent') return { ...base, tone: 'notice', short: m.flag, headline: r.observation, why, limits: m.limits };
  return { ...base, tone: 'clear', short: m.even, headline: r.observation, why, limits: m.limits };
}
