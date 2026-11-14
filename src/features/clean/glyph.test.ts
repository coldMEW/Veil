import { describe, expect, it } from 'vitest';
import { glyphMask, pointInPolygon, polygonMask } from './glyph';
import { maskArea, type Pixels } from './mask';

function sign(w: number, h: number): Pixels {
  // green background, white stroke bars inside x 20..80, y 20..40, sky (white) for x >= 90
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sky = x >= 90;
      const stroke = !sky && y >= 20 && y < 40 && x >= 20 && x < 80 && x % 10 < 3;
      const c = (sky || stroke ? [240, 240, 240] : [20, 110, 90]) as [number, number, number];
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('glyph mask', () => {
  it('point in polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
  });
  it('rasterizes a normalized polygon', () => {
    const m = polygonMask([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }], 10, 10);
    expect(maskArea(m)).toBe(25);
  });
  it('marks only strokes inside the polygon, not background or sky outside it', () => {
    const src = sign(100, 60);
    const poly = [{ x: 0.05, y: 0.1 }, { x: 0.87, y: 0.1 }, { x: 0.87, y: 0.9 }, { x: 0.05, y: 0.9 }];
    const { mask, background, coverage } = glyphMask(src, poly, { dilatePx: 0 });
    expect(background).toEqual([20, 110, 90]);
    expect(maskArea(mask)).toBe(6 * 3 * 20);
    expect(coverage).toBeLessThan(0.2);
    expect(mask.data[30 * 100 + 95]).toBe(0);
    expect(maskArea(glyphMask(src, poly, { dilatePx: 1 }).mask)).toBeGreaterThan(6 * 3 * 20);
  });
  it('auto polarity ignores a darker shadow when the text is lighter', () => {
    const src = sign(100, 60);
    // add a dark shadow band (darker than background) inside the sign at y 45..50
    for (let y = 45; y < 50; y++)
      for (let x = 10; x < 80; x++) {
        const i = (y * 100 + x) * 4;
        src.data[i] = 0;
        src.data[i + 1] = 20;
        src.data[i + 2] = 10;
      }
    const poly = [{ x: 0.05, y: 0.1 }, { x: 0.87, y: 0.1 }, { x: 0.87, y: 0.9 }, { x: 0.05, y: 0.9 }];
    expect(maskArea(glyphMask(src, poly, { dilatePx: 0 }).mask)).toBe(6 * 3 * 20);
    expect(maskArea(glyphMask(src, poly, { dilatePx: 0, polarity: 'any' }).mask)).toBe(6 * 3 * 20 + 70 * 5);
  });
});
