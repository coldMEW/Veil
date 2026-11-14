import { describe, expect, it } from 'vitest';
import { elaCheckResult } from './ela';
import { compareThumbnail, thumbnailCheckResult } from './exifThumbnail';
import { makeGrid } from './grid';
import { noiseCheckResult } from './noise';
import { CHECK_IDS, failureResult } from './results';
import { checked, pixels } from './testSupport';

describe('forensics result wording and contract invariants', () => {
  it('validates every public result branch and execution failure', () => {
    const grid = makeGrid(256, 256, 32); grid.values.fill(2);
    checked(elaCheckResult('asset', 'image/png', null));
    checked(elaCheckResult('asset', 'image/jpeg', grid));
    checked(noiseCheckResult('asset', grid));
    grid.values[0] = 50;
    checked(elaCheckResult('asset', 'image/jpeg', grid));
    checked(noiseCheckResult('asset', grid));
    grid.values.fill(NaN);
    checked(noiseCheckResult('asset', grid));
    checked(thumbnailCheckResult('asset', null));
    checked(thumbnailCheckResult('asset', compareThumbnail(pixels(8, 8), pixels(16, 16))));
    checked(thumbnailCheckResult('asset', compareThumbnail(pixels(8, 8), pixels(16, 16, 220))));
    checked(thumbnailCheckResult('asset', compareThumbnail(pixels(8, 8), pixels(16, 8))));
    for (const id of CHECK_IDS) for (const execution of ['failed', 'timeout', 'unavailable'] as const) {
      const result = checked(failureResult(id, 'asset', execution, 'The check did not complete.'));
      expect(result.finding).toBe('inconclusive'); expect(result.overlays).toEqual([]);
    }
  });
});
