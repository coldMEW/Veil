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

describe('textRemovalMask', () => {
  it('removes only text strokes inside the quad and never spreads past the clip quad', async () => {
    const { textRemovalMask } = await import('./session');
    const src = sign(100, 60);
    const cand = {
      id: 'c', assetId: 'a', category: 'address' as const, sourceMethod: 'ocr' as const, selected: true,
      region: { x: 0.18, y: 0.3, w: 0.65, h: 0.4 },
    };
    const { mask } = textRemovalMask(src, [cand], { dilateMaxPx: 1, dilateMinPx: 1 });
    // strokes are inside x 20..80, y 20..40; nothing may be marked in the sky (x >= 90) or far outside the quad
    expect(maskArea(mask)).toBeGreaterThan(6 * 3 * 20 * 0.8);
    for (let y = 0; y < 60; y++) for (let x = 90; x < 100; x++) expect(mask.data[y * 100 + x]).toBe(0);
    expect(textRemovalMask(src, [{ ...cand, selected: false }]).mask.data.some((v) => v === 1)).toBe(false);
  });
});

describe('auto-selection safety', () => {
  it('does not pre-select low-confidence OCR reads (false detections on faces/texture)', async () => {
    const { candidatesFromOcr } = await import('./session');
    const rect = { x: 0.1, y: 0.1, w: 0.1, h: 0.05 };
    const c = candidatesFromOcr('a', [
      { rect, text: '105', recScore: 0.99 },
      { rect, text: '18', recScore: 0.58 },
      { rect, text: '221B Baker St', recScore: 0.9 },
    ]);
    expect(c.map((x) => [x.category, x.selected])).toEqual([
      ['room_or_id_number', true],
      ['room_or_id_number', false],
      ['address', true],
    ]);
  });
});

describe('inpaint outlier repair', () => {
  it('detects a bright blob inside a plausible fill and re-inpaints only it', async () => {
    const { fillOutliers, runClean } = await import('./session');
    const { rectsToMask } = await import('./mask');
    const W = 60, H = 40;
    const data = new Uint8ClampedArray(W * H * 4).fill(120);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const src = { width: W, height: H, data };
    const mask = rectsToMask([{ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }], W, H);
    // plausible fill = same grey; bad fill = grey with a white 4x4 blob in the middle
    const bad = { width: W, height: H, data: new Uint8ClampedArray(data) };
    for (let y = 18; y < 22; y++) for (let x = 28; x < 32; x++) { const i = (y * W + x) * 4; bad.data[i] = bad.data[i + 1] = bad.data[i + 2] = 255; }
    expect(fillOutliers(src, mask)).toBeNull();
    expect(fillOutliers(bad, mask)).not.toBeNull();
    const calls: number[] = [];
    const inpainter = {
      inpaint: async (_s: typeof src, _m: unknown, o?: { maxSide?: number }) => {
        calls.push(o?.maxSide ?? 0);
        return { pixels: calls.length === 1 ? bad : { width: W, height: H, data: new Uint8ClampedArray(data) } };
      },
    };
    const r = await runClean({ src, srcSha256: 'x', mask, expansionPx: 0, method: 'migan_inpaint', inpainter, inpaintMaxSide: 1400 }).catch((e) => e);
    // encodePng needs a browser canvas; in node we only assert the repair call sequence before export
    expect(calls).toEqual([1400, 1024]);
    void r;
  });
});
