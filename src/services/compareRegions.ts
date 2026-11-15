import type { CheckResult } from '../contracts';

export interface ChangedRegion { x: number; y: number; w: number; h: number }

/**
 * The areas a comparison actually flagged. Only 'box' overlays are changed areas; the 'raster' overlay's
 * `rect` is just the part of the picture that was compared, and is present even when nothing differs.
 */
export function changedRegions(result: Pick<CheckResult, 'overlays'>): ChangedRegion[] {
  return (result.overlays ?? []).flatMap((o) => (o.type === 'box' ? [{ x: o.x, y: o.y, w: o.width, h: o.height }] : []));
}
