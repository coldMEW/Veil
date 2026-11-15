import { it, expect } from 'vitest';
import { comparisonFromResult } from './compareResult';
import { compareImages } from '../features/inspect/compare';
it('does not turn zero-score raster coverage into changed pixels', () => {
  const result = comparisonFromResult({
    execution: 'complete',
    observation: '0 areas differ',
    overlays: [
      {
        type: 'raster',
        width: 2,
        height: 2,
        values: [0, 0, 0, 0],
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    ],
  });
  expect(result).toEqual({ says: '0 areas differ', regions: [], changed: false });
});
it('maps actual changed boxes using their direct coordinates', () => {
  const result = comparisonFromResult({
    execution: 'complete',
    observation: '1 area differs',
    overlays: [{ type: 'box', x: 0.2, y: 0.3, width: 0.4, height: 0.1 }],
  });
  expect(result).toEqual({
    says: '1 area differs',
    regions: [{ x: 0.2, y: 0.3, w: 0.4, h: 0.1 }],
    changed: true,
  });
});
it('does not turn a failed comparison into a changed verdict', () =>
  expect(
    comparisonFromResult({
      execution: 'failed',
      observation: 'Comparison failed',
      overlays: [{ type: 'box', x: 0, y: 0, width: 1, height: 1 }],
    }).changed,
  ).toBe(false));
it('passes an identical textured image through the real comparator and integration', () => {
  const width = 256,
    height = 192,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      data[i] = 120 + 50 * Math.sin(x / 13) * Math.cos(y / 17);
      data[i + 1] = 90 + 40 * Math.sin((x + y) / 19);
      data[i + 2] = 100 + 30 * Math.cos((x - 2 * y) / 23);
      data[i + 3] = 255;
    }
  const image = { width, height, data },
    result = compareImages(image, image, 'identical-control');
  expect(result.overlays.some((o) => o.type === 'raster')).toBe(true);
  expect(comparisonFromResult(result)).toMatchObject({ regions: [], changed: false });
});
