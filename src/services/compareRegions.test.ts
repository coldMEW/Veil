import { describe, expect, it } from 'vitest';
import { compareImages } from '../features/inspect/compare';
import { changedRegions } from './compareRegions';

/** A textured, photo-like picture: smooth gradients plus pseudo-random grain and some shapes. */
function photo(w = 480, h = 360) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, n = rnd() * 24;
      const disc = (x - 150) ** 2 + (y - 120) ** 2 < 3600 ? 60 : 0;
      const bar = x > 300 && x < 330 ? -50 : 0;
      data[i] = 90 + (x / w) * 110 + n + disc;
      data[i + 1] = 70 + (y / h) * 120 + n + bar;
      data[i + 2] = 110 + Math.sin(x / 17) * 40 + Math.cos(y / 13) * 30 + n;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('compare with the original', () => {
  it('reports no changed areas when both pictures are the same file', () => {
    const a = photo();
    const r = compareImages(a, { ...a, data: new Uint8ClampedArray(a.data) });
    expect(changedRegions(r)).toEqual([]);
    expect(r.finding).not.toBe('inconsistent');
  });

  it('reports a changed area when an object is replaced', () => {
    const a = photo(), b = photo();
    for (let y = 200; y < 290; y++)
      for (let x = 60; x < 170; x++) {
        const i = (y * b.width + x) * 4;
        b.data[i] = 240; b.data[i + 1] = 30; b.data[i + 2] = 30;
      }
    const regions = changedRegions(compareImages(a, b));
    expect(regions.length).toBeGreaterThan(0);
    const hit = regions.some((g) => g.x < 170 / 480 && g.x + g.w > 60 / 480 && g.y < 290 / 360 && g.y + g.h > 200 / 360);
    expect(hit).toBe(true);
  });
});
