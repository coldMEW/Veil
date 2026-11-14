import { describe, expect, it } from 'vitest';
import { computeSpectrum, fft1d, spectrumCheck, type RgbaImage } from './spectrum';
import { validateCheckResult } from '../../../contracts';

function img(w: number, h: number, f: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = f(x, y);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('fft1d', () => {
  it('matches a naive DFT', () => {
    const n = 16;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 3));
    const re = new Float64Array(x);
    const im = new Float64Array(n);
    fft1d(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += x[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        si += x[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
  });
});

describe('spectrum', () => {
  it('finds peaks of a diagonal periodic grid at the right frequency', () => {
    const g = img(256, 256, (x, y) => 128 + 60 * Math.sin((2 * Math.PI * (x + y)) / 8));
    const s = computeSpectrum(g, 256);
    const top = s.peaks[0]!;
    expect(Math.abs(top.u)).toBe(32);
    expect(Math.abs(top.v)).toBe(32);
    expect(Math.sign(top.u)).toBe(Math.sign(top.v));
  });
  it('is deterministic and reports no peaks on a smooth gradient', () => {
    const g = img(300, 200, (x) => (x * 255) / 300);
    const a = computeSpectrum(g, 128);
    const b = computeSpectrum(g, 128);
    expect(a.logMagnitude).toEqual(b.logMagnitude);
    expect(a.peaks).toHaveLength(0);
    expect(a.crop).toEqual({ x: 50, y: 0, size: 200 });
  });
  it('wraps into a valid, honest CheckResult', () => {
    const r = spectrumCheck('a1', img(128, 128, (x, y) => (x ^ y) & 255), 128);
    expect(validateCheckResult(r)).toEqual([]);
    expect(r.kind).toBe('signal');
    expect(r.finding).toBe('inconclusive');
    expect(JSON.stringify(r)).not.toMatch(/fake|ai-generated|diffusion fingerprint/i);
    const tiny = spectrumCheck('a2', img(10, 10, () => 0), 128);
    expect(tiny.execution).toBe('failed');
    expect(validateCheckResult(tiny)).toEqual([]);
  });
});
