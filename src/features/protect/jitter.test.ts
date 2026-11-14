import { describe, expect, it } from 'vitest';
import { applyJitter, psnr, ssim } from './jitter';
import type { Pixels } from '../clean/mask';

function img(w: number, h: number, f: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = f(x, y);
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('layer 0 jitter', () => {
  const src = img(64, 64, (x, y) => (x * 3 + y * 2) % 256);
  it('is deterministic for the same seed and differs for another seed', () => {
    const a = applyJitter(src, { seed: 42, amplitude: 2 });
    const b = applyJitter(src, { seed: 42, amplitude: 2 });
    const c = applyJitter(src, { seed: 43, amplitude: 2 });
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
  });
  it('stays within amplitude, keeps alpha, never mutates the source', () => {
    const before = src.data.slice();
    const a = applyJitter(src, { seed: 7, amplitude: 3 });
    expect(src.data).toEqual(before);
    for (let i = 0; i < a.data.length; i++) {
      if (i % 4 === 3) expect(a.data[i]).toBe(255);
      else expect(Math.abs(a.data[i]! - src.data[i]!)).toBeLessThanOrEqual(3);
    }
  });
  it('rejects invalid params', () => {
    expect(() => applyJitter(src, { seed: 1, amplitude: 0 })).toThrow();
    expect(() => applyJitter(src, { seed: -1, amplitude: 2 })).toThrow();
  });
});

describe('fidelity metrics', () => {
  it('psnr: identical = Infinity, uniform +1 offset = 48.13 dB', () => {
    const a = img(16, 16, () => 100);
    const b = img(16, 16, () => 101);
    expect(psnr(a, a)).toBe(Infinity);
    expect(psnr(a, b)).toBeCloseTo(10 * Math.log10(255 * 255), 2);
  });
  it('ssim: identical = 1, jittered slightly below 1, noise image much lower', () => {
    const a = img(64, 64, (x, y) => (x * 4 + y) % 256);
    expect(ssim(a, a)).toBeCloseTo(1, 6);
    const j = ssim(a, applyJitter(a, { seed: 1, amplitude: 2 }));
    expect(j).toBeLessThan(1);
    expect(j).toBeGreaterThan(0.9);
    const noise = img(64, 64, (x, y) => ((x * 7919 + y * 104729) >>> 0) % 256);
    expect(ssim(a, noise)).toBeLessThan(0.5);
  });
});
