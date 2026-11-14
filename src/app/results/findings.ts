// Turns each check's state into one plain-language line for the "What we found" summary.
// Evidence, not verdicts: lines say what a check observed and how strong it is, never "real" or "fake".

import type { FocusState } from '../../features/inspect/model/useModelFocus';
import { aiProbabilityDrops, AI_HIGH, AI_LOW } from '../../features/inspect/model/preprocess';
import type { WarpState } from '../../features/inspect/warp/useWarpDetector';
import { HIGH as WARP_HIGH, LOW as WARP_LOW } from '../../features/inspect/warp/preprocess';
import type { ProvenanceState } from '../inspect/useProvenance';

export type FindingTone = 'alert' | 'notice' | 'clear' | 'pending' | 'idle';
export type LayerId = 'ai' | 'face' | 'shadow';

export interface Finding {
  id: string;
  title: string;
  tone: FindingTone;
  headline: string;
  layer?: LayerId;
}

const AI_TYPES = new Set(['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic']);

export function provenanceFinding(p: ProvenanceState): Finding {
  const base = { id: 'provenance', title: 'Content Credentials' };
  if (p.status !== 'done') return { ...base, tone: 'pending', headline: 'Reading the file…' };
  const { credentials: c, hints } = p.result;
  if (p.result.error) return { ...base, tone: 'idle', headline: 'Could not be read in this browser.' };
  const ai = [...c.sourceTypes, ...hints.sourceTypes].some((t) => AI_TYPES.has(t));
  if (c.contentChanged) return { ...base, tone: 'alert', headline: 'Changed after its credentials were signed.' };
  if (c.present && ai) return { ...base, tone: 'alert', headline: `Says it was made by AI${c.generator ? ` (${c.generator})` : ''}, signed by ${c.signer ?? 'the creator'}.` };
  if (c.present) return { ...base, tone: 'clear', headline: `Credentials attached${c.signer ? `, signed by ${c.signer}` : ''}. No AI source declared.` };
  if (ai || hints.toolNames.length) return { ...base, tone: 'notice', headline: `No credentials, but the metadata names ${hints.toolNames.slice(0, 2).join(', ') || 'an AI source'}.` };
  return { ...base, tone: 'idle', headline: 'None found. Most photos have none, and screenshots remove them, so this proves nothing.' };
}

export function aiSignalFinding(f: FocusState): Finding {
  const base = { id: 'ai-signal', title: 'AI-signal heatmap', layer: 'ai' as const };
  if (f.status === 'idle') return { ...base, tone: 'idle', headline: 'Not run yet.' };
  if (f.status === 'loading' || f.status === 'running') return { ...base, tone: 'pending', headline: f.status === 'running' ? `Measuring ${f.done} of ${f.total}…` : 'Loading the detector…' };
  if (f.status === 'failed') return { ...base, tone: 'idle', headline: `Did not finish: ${f.message}` };
  const drops = aiProbabilityDrops(f.result.deltas, f.result.logit);
  const strong = Array.from(drops).filter((d) => d >= AI_HIGH).length;
  const weak = Array.from(drops).filter((d) => d >= AI_LOW && d < AI_HIGH).length;
  const n = drops.length;
  if (strong) return { ...base, tone: 'alert', headline: `Strong AI signal in ${strong} of ${n} areas${weak ? `, weaker in ${weak}` : ''}.` };
  if (weak) return { ...base, tone: 'notice', headline: `Weak AI signal in ${weak} of ${n} areas.` };
  return { ...base, tone: 'clear', headline: 'No area pushed the AI detector toward "AI-generated".' };
}

export function warpFinding(w: WarpState): Finding {
  const base = { id: 'face-warp', title: 'Face warp map', layer: 'face' as const };
  if (w.status === 'idle') return { ...base, tone: 'idle', headline: 'Optional: mark a face to check for reshaping.' };
  if (w.status === 'loading' || w.status === 'running') return { ...base, tone: 'pending', headline: 'Measuring the face…' };
  if (w.status === 'failed') return { ...base, tone: 'idle', headline: `Did not finish: ${w.message}` };
  const max = w.result.maxMagnitude;
  if (max >= WARP_HIGH) return { ...base, tone: 'alert', headline: `Strong predicted warp (up to ${max.toFixed(1)} px).` };
  if (max >= WARP_LOW) return { ...base, tone: 'notice', headline: `Some predicted warp (up to ${max.toFixed(1)} px).` };
  return { ...base, tone: 'clear', headline: 'No notable predicted warp in the marked face.' };
}

export const TONE_LABEL: Record<FindingTone, string> = {
  alert: 'Look closer',
  notice: 'Worth a look',
  clear: 'Nothing flagged',
  pending: 'Checking',
  idle: 'Not run',
};
