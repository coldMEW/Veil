import { runLineGeometryCheck } from './lineGeometryCheck';
import type { CheckResult, Point, ShadowCheckOptions, ShadowPair } from './shadowTypes';

export interface ReflectionPair {
  id: string;
  object: Point;
  reflection: Point;
}

/**
 * One flat reflecting surface and correctly matched points must be confirmed by the person marking.
 * The existing annotation/canvas uses the `shadow` slot for a pair's second point; accept that
 * representation too. Both endpoints define an undirected line in the unchanged shadow solver.
 * Evidence uses `vanishingPoint` and `surfaceGroupSearch` for the reflection interpretation.
 */
export function reflectionCheck(
  pairs: readonly (ReflectionPair | ShadowPair)[], assetId: string, opts: ShadowCheckOptions = {},
): CheckResult {
  const constraints = pairs.map((pair): ShadowPair => 'reflection' in pair
    ? { id: pair.id, object: pair.object, shadow: pair.reflection } : pair);
  return runLineGeometryCheck(constraints, assetId, opts, 'reflection');
}
