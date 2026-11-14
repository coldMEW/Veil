import type { CheckResult, Execution } from '../../../contracts';

export type ForensicsId = 'ela' | 'noise' | 'exif-thumbnail';
export const CHECK_IDS: readonly ForensicsId[] = ['ela', 'noise', 'exif-thumbnail'];

export function baseResult(id: ForensicsId, assetId: string): CheckResult {
  return { id, assetId, kind: id === 'exif-thumbnail' ? 'provenance' : 'signal', execution: 'complete',
    finding: 'inconclusive', title: { ela: 'JPEG recompression map', noise: 'Noise consistency map',
      'exif-thumbnail': 'Embedded thumbnail' }[id], observation: 'The check has no result.',
    reason: 'The check has no result.', method: '', assumptions: [], limitations: [], evidence: {}, overlays: [], source: 'live' };
}

/** A failed check never carries forward evidence or overlays from a different run. */
export function failureResult(id: ForensicsId, assetId: string, execution: Exclude<Execution, 'complete'>,
  message: string): CheckResult {
  return { ...baseResult(id, assetId), execution, observation: 'The check did not complete.', reason: message };
}
