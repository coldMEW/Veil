import { runLineGeometryCheck } from './lineGeometryCheck';
import type { CheckResult, ShadowCheckOptions, ShadowPair } from './shadowTypes';

/** Call only for correspondences whose single-light assumption the user has confirmed. */
export function runShadowCheck(
  pairs: readonly ShadowPair[], imageAssetId: string, opts: ShadowCheckOptions = {},
): CheckResult {
  return runLineGeometryCheck(pairs, imageAssetId, opts, 'shadow');
}
