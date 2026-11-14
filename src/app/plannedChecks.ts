// Placeholder cards for checks that are not built yet. They render through the
// real CheckResult card, marked unavailable, so nothing looks like a result.
// Each owner replaces their entry when their feature lands.

import type { CheckResult, EvidenceKind } from '../contracts';

interface Planned {
  id: string;
  kind: EvidenceKind;
  title: string;
  method: string;
}

const INSPECT_PLANNED: Planned[] = [
  {
    id: 'shadow-geometry',
    kind: 'physical',
    title: 'Shadow and light geometry',
    method: 'You mark object points and their shadow points; the lines are tested against a single dominant light.',
  },
  {
    id: 'eye-observations',
    kind: 'physical',
    title: 'Eye highlight observations',
    method: 'Paired eye crops with their bright highlight regions shown side by side.',
  },
  {
    id: 'model-focus',
    kind: 'model',
    title: 'Model-focus map',
    method: 'Where one classifier attends inside the 384 × 384 crop it sees. Not a map of edited pixels.',
  },
  {
    id: 'spectrum',
    kind: 'signal',
    title: 'Frequency spectrum',
    method: 'Radial frequency profile of the image after a fixed resize and window.',
  },
  {
    id: 'provenance',
    kind: 'provenance',
    title: 'Content credentials',
    method: 'Reads and validates any C2PA manifest in the original file bytes.',
  },
];

export function plannedInspectChecks(assetId: string): CheckResult[] {
  return INSPECT_PLANNED.map((p) => ({
    id: p.id,
    assetId,
    kind: p.kind,
    execution: 'unavailable',
    finding: 'inconclusive',
    title: p.title,
    observation: 'Not built yet in this version, so this photo was not examined by this check.',
    method: p.method,
    assumptions: [],
    limitations: ['This check has not run. Nothing is known from it about this photo.'],
    evidence: {},
    overlays: [],
    source: 'live',
  }));
}
