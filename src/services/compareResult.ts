import type { CheckResult } from '../contracts';
/** Raster coverage is the compared area, never evidence of changed pixels. */
export function comparisonFromResult(result: Pick<CheckResult, 'execution' | 'observation' | 'overlays'>) {
  const regions =
    result.execution === 'complete'
      ? result.overlays.flatMap((overlay) =>
          overlay.type === 'box' ? [{ x: overlay.x, y: overlay.y, w: overlay.width, h: overlay.height }] : [],
        )
      : [];
  return { says: result.observation, regions, changed: regions.length > 0 };
}
