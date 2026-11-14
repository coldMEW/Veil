import { describe, expect, it } from 'vitest';
import { CROP, cropGeometry, normalizeMagnitudes, occlude, toChw } from './preprocess';

describe('cropGeometry', () => {
  it('landscape: short edge to 440, long edge floored, centered crop', () => {
    const g = cropGeometry(1600, 1067);
    expect(g.resizedHeight).toBe(440);
    expect(g.resizedWidth).toBe(Math.floor((440 * 1600) / 1067)); // 659
    expect(g.left).toBe(Math.floor((659 - 384) / 2)); // 137
    expect(g.top).toBe(28);
  });

  it('portrait', () => {
    const g = cropGeometry(3024, 4032);
    expect(g.resizedWidth).toBe(440);
    expect(g.resizedHeight).toBe(586);
    expect(g.left).toBe(28);
    expect(g.top).toBe(101);
  });

  it('square', () => {
    const g = cropGeometry(1000, 1000);
    expect(g).toMatchObject({ resizedWidth: 440, resizedHeight: 440, left: 28, top: 28 });
    expect(g.source.x).toBeCloseTo(63.636, 2);
    expect(g.source.width).toBeCloseTo(872.727, 2);
  });

  it('maps the crop back inside the original image, centered', () => {
    for (const [w, h] of [
      [1600, 1067],
      [3024, 4032],
      [500, 500],
      [441, 2000],
    ] as const) {
      const { source } = cropGeometry(w, h);
      expect(source.x).toBeGreaterThanOrEqual(0);
      expect(source.y).toBeGreaterThanOrEqual(0);
      expect(source.x + source.width).toBeLessThanOrEqual(w + 1e-9);
      expect(source.y + source.height).toBeLessThanOrEqual(h + 1e-9);
      // Centered to within one resized pixel.
      expect(Math.abs(source.x - (w - source.width - source.x))).toBeLessThanOrEqual(w / 440 + 1e-9);
    }
  });

  it('upscales small images to the 440 short edge', () => {
    const g = cropGeometry(300, 200);
    expect(g.resizedHeight).toBe(440);
    expect(g.resizedWidth).toBe(660);
  });

  it('rejects empty sizes', () => {
    expect(() => cropGeometry(0, 10)).toThrow();
  });
});

describe('tensor helpers', () => {
  it('CLIP-normalizes RGB into CHW planes', () => {
    const rgba = new Uint8ClampedArray(CROP * CROP * 4).fill(255);
    const t = toChw(rgba);
    expect(t[0]).toBeCloseTo((1 - 0.48145466) / 0.26862954, 5);
    expect(t[CROP * CROP]).toBeCloseTo((1 - 0.4578275) / 0.26130258, 5);
    expect(t[2 * CROP * CROP]).toBeCloseTo((1 - 0.40821073) / 0.27577711, 5);
  });

  it('occludes exactly one cell in every channel', () => {
    const base = new Float32Array(3 * CROP * CROP).fill(1);
    const out = occlude(base, 8, 9, new Float32Array(base.length)); // row 1, col 1
    const plane = CROP * CROP;
    let zeros = 0;
    for (const v of out) if (v === 0) zeros++;
    expect(zeros).toBe(3 * 48 * 48);
    expect(out[48 * CROP + 48]).toBe(0);
    expect(out[plane + 95 * CROP + 95]).toBe(0);
    expect(out[47 * CROP + 48]).toBe(1);
    expect(base[48 * CROP + 48]).toBe(1); // base untouched
  });

  it('normalizes magnitudes to 0..1', () => {
    expect(Array.from(normalizeMagnitudes([2, -4, 0]))).toEqual([0.5, 1, 0]);
    expect(Array.from(normalizeMagnitudes([0, 0]))).toEqual([0, 0]);
  });
});
