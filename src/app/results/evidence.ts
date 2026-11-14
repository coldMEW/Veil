// One view model for every evidence row, on desktop and in the phone sheet.
// Method and limitations come from the check's own CheckResult once it has run; before that
// the row states how the check works and that it has not produced anything yet.

import type { CheckResult } from '../../contracts';
import type { NormRect } from '../../components/canvas/ImageCanvas';
import { TONE_LABEL, type Finding, type FindingTone } from './findings';

export interface EvidenceItem {
  id: string;
  number: number;
  title: string;
  tone: FindingTone;
  /** The pill text. */
  label: string;
  headline: string;
  method: string;
  assumptions: string[];
  limitations: string[];
  numbers: Array<[string, string]>;
  /** The part of the photo this check looked at, normalized. Null when it has not looked yet. */
  region: NormRect | null;
  regionLabel: string;
  layer?: { visible: boolean; available: boolean; toggle: () => void };
}

const ABOUT: Record<string, { method: string; limitations: string[]; regionLabel: string }> = {
  provenance: {
    method: 'Reads and validates any Content Credentials (C2PA) in the original file bytes, and looks for metadata that names an editing or AI tool.',
    limitations: ['Most photos carry no credentials, and screenshots or re-saving remove them, so a missing credential proves nothing.'],
    regionLabel: 'Whole file',
  },
  'ai-signal': {
    method: 'A local classifier looks at a 384 × 384 crop. Each area is covered in turn to measure how much it moves the score toward "AI-generated".',
    limitations: ['One classifier’s signal, not proof. It can be wrong on compressed, filtered or unusual photos, and it only sees the crop.'],
    regionLabel: 'Area the classifier saw',
  },
  'face-warp': {
    method: 'A local model predicts where a face you mark may have been reshaped, and by how many pixels.',
    limitations: ['Only covers the face you mark. Strong lens distortion and heavy compression can look like warping.'],
    regionLabel: 'Face you marked',
  },
  shadows: {
    method: 'You mark points on objects and the matching points on their shadows. The lines are tested against one dominant light source.',
    limitations: ['Needs at least two clear object and shadow pairs. Several lights or soft shadows make the test inconclusive.'],
    regionLabel: 'Points you marked',
  },
};

function numbersFrom(evidence: CheckResult['evidence']): Array<[string, string]> {
  return Object.entries(evidence)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    .slice(0, 6)
    .map(([k, v]) => [k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase(), typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v)]);
}

export function toEvidence(
  findings: Finding[],
  checks: Partial<Record<string, CheckResult>>,
  regions: Partial<Record<string, NormRect | null>>,
  layers: Partial<Record<string, EvidenceItem['layer']>>,
): EvidenceItem[] {
  return findings.map((f, i) => {
    const about = ABOUT[f.id] ?? { method: 'Runs on this device.', limitations: [], regionLabel: 'Area checked' };
    const check = checks[f.id];
    return {
      id: f.id,
      number: i + 1,
      title: f.title,
      tone: f.tone,
      label: f.headline.startsWith('Did not finish') || f.headline.startsWith('Could not') ? 'Didn’t finish' : f.tone === 'idle' && check ? 'Nothing found' : TONE_LABEL[f.tone],
      headline: f.headline,
      method: check?.method || about.method,
      assumptions: check?.assumptions ?? [],
      limitations: check?.limitations.length ? check.limitations : about.limitations,
      numbers: check ? numbersFrom(check.evidence) : [],
      region: regions[f.id] ?? null,
      regionLabel: about.regionLabel,
      layer: f.layer ? layers[f.layer] : undefined,
    };
  });
}
