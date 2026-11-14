import type { EvaluationArm, EvaluationStatus, ResultSource } from '../../contracts';
import { PROTECT_LABEL } from './protect';

export interface G3bResult {
  fixtureId: string;
  arm: EvaluationArm;
  seed: number;
  promptId: string;
  clipScore: number;
  psnr: number;
  ssim: number;
  outputSha256: string;
}

export interface ProofColumn {
  arm: Exclude<EvaluationArm, 'clean_control'>;
  runs: number;
  medianClipScore: number | null;
  lowerThanControl: number;
  matchedRuns: number;
  status: EvaluationStatus;
  text: string;
}

export interface ProtectProofCard {
  source: ResultSource;
  label: typeof PROTECT_LABEL;
  columns: ProofColumn[];
  limitations: readonly string[];
}

const ARMS: readonly Exclude<EvaluationArm, 'clean_control'>[] = ['jitter_only', 'diffvax_only', 'combined'];
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Converts frozen, recorded G3b numbers into plain evidence rather than a performance claim. */
export function buildProtectProofCard(results: readonly G3bResult[]): ProtectProofCard {
  const controls = new Map(results.filter((r) => r.arm === 'clean_control').map((r) => [`${r.fixtureId}\u0000${r.seed}\u0000${r.promptId}`, r]));
  const columns = ARMS.map((arm): ProofColumn => {
    const rows = results.filter((r) => r.arm === arm);
    const matched = rows.filter((r) => controls.has(`${r.fixtureId}\u0000${r.seed}\u0000${r.promptId}`));
    const lower = matched.filter((r) => r.clipScore < controls.get(`${r.fixtureId}\u0000${r.seed}\u0000${r.promptId}`)!.clipScore).length;
    const status: EvaluationStatus = !rows.length ? 'not_tested' : !matched.length ? 'unavailable' : lower ? 'measured' : 'no_improvement_observed';
    const text = !rows.length
      ? 'No recorded runs for this arm.'
      : !matched.length
        ? 'Recorded runs lack matched clean controls.'
        : `In ${lower} of ${matched.length} runs the edit scored lower than the clean control.`;
    return { arm, runs: rows.length, medianClipScore: median(rows.map((r) => r.clipScore)), lowerThanControl: lower, matchedRuns: matched.length, status, text };
  });
  return {
    source: 'recorded_fixture', label: PROTECT_LABEL, columns,
    limitations: ['Five consented photos only.', 'CPU 20-step Stable Diffusion edit configuration only.', 'One frozen model and configuration; untested transformations remain unknown.'],
  };
}
