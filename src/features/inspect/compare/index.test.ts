import { describe, it, expect } from 'vitest';
import { compareImages, type Pixels } from './index';
import { validateCheckResult } from '../../../contracts';
export function scene(seed = 1): Pixels {
  const width = 320,
    height = 240,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v =
        110 +
        35 * Math.sin(x * 0.065 + seed) +
        30 * Math.cos(y * 0.091 + seed * 0.9) +
        20 * Math.sin((x + y) * 0.033);
      data[i] = v;
      data[i + 1] = v + 15 * Math.cos(x * 0.041);
      data[i + 2] = v + 20 * Math.sin(y * 0.052);
      data[i + 3] = 255;
    }
  for (let k = 0; k < 30; k++) {
    const cx = (k * 79 + seed * 31) % width,
      cy = (k * 53 + seed * 17) % height;
    for (let y = Math.max(0, cy - 5); y < Math.min(height, cy + 5); y++)
      for (let x = Math.max(0, cx - 7); x < Math.min(width, cx + 7); x++) {
        const i = (y * width + x) * 4;
        data[i] = (k * 59) % 220;
        data[i + 1] = (k * 91) % 230;
        data[i + 2] = (k * 23) % 240;
      }
  }
  return { width, height, data };
}
export function transform(a: Pixels, s = 0.8, crop = 12, noise = 0, tone = false, object = false) {
  const width = Math.round((a.width - 2 * crop) * s),
    height = Math.round((a.height - 2 * crop) * s),
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const ax = (x + 0.5) / s + crop - 0.5,
        ay = (y + 0.5) / s + crop - 0.5,
        ix = Math.floor(ax),
        iy = Math.floor(ay),
        dx = ax - ix,
        dy = ay - iy;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let j = 0; j < 2; j++)
          for (let i = 0; i < 2; i++)
            v +=
              a.data[(Math.min(a.height - 1, iy + j) * a.width + Math.min(a.width - 1, ix + i)) * 4 + c]! *
              (i ? dx : 1 - dx) *
              (j ? dy : 1 - dy);
        data[(y * width + x) * 4 + c] =
          v * (tone ? 1.03 : 1) + (tone ? 10 : 0) + noise * Math.sin(x * 53 + y * 97 + c);
      }
      data[(y * width + x) * 4 + 3] = 255;
    }
  const rect = { x: 0.55, y: 0.55, w: 0.15, h: 0.15 };
  if (object)
    for (let y = Math.floor(rect.y * height); y < Math.floor((rect.y + rect.h) * height); y++)
      for (let x = Math.floor(rect.x * width); x < Math.floor((rect.x + rect.w) * width); x++) {
        const i = (y * width + x) * 4;
        data[i] = 245;
        data[i + 1] = 20;
        data[i + 2] = 30;
      }
  return { b: { width, height, data }, rect };
}
const regions = (r: ReturnType<typeof compareImages>) =>
  r.evidence.regions as { rect: { x: number; y: number; w: number; h: number } }[];
const iou = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => {
  const n =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return n / (a.w * a.h + b.w * b.h - n);
};
describe('comparison', () => {
  it('identical has no regions and is contract valid', () => {
    const a = scene();
    const r = compareImages(a, a);
    expect(regions(r)).toHaveLength(0);
    expect(validateCheckResult(r)).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/fake|real|authentic|manipulat|ai-generated/i);
  });
  it('recovers scale/crop with bounded noise without regions', () => {
    const a = scene(),
      { b } = transform(a, 0.85, 12, 3);
    const r = compareImages(a, b);
    const t = r.evidence.alignment as { scale: number; tx: number; ty: number };
    expect(t).not.toBeNull();
    expect(t.scale).toBeCloseTo(0.85, 1);
    expect(Math.abs(t.scale / 0.85 - 1)).toBeLessThan(0.02);
    expect(Math.abs(t.tx + 12 * 0.85)).toBeLessThan(2);
    expect(Math.abs(t.ty + 12 * 0.85)).toBeLessThan(2);
    expect(regions(r)).toHaveLength(0);
  });
  for (const tone of [false, true])
    it(`localizes added square, tone=${tone}`, () => {
      const a = scene(),
        { b, rect } = transform(a, 0.8, 12, 0, tone, true);
      const r = compareImages(a, b);
      expect(regions(r)).toHaveLength(1);
      expect(iou(regions(r)[0]!.rect, rect)).toBeGreaterThan(0.6);
    });
  it('rejects unrelated images', () => {
    const unrelated = scene(13);
    let seed = 12345;
    for (let i = 0; i < unrelated.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      unrelated.data[i] = seed >>> 24;
      unrelated.data[i + 1] = (seed >>> 16) & 255;
      unrelated.data[i + 2] = (seed >>> 8) & 255;
    }
    const r = compareImages(scene(), unrelated);
    expect(r.reason).toBe('Could not align the two images; they may not be the same scene.');
  });
});

it('JPEG quality80 recompression is a no-region control', async () => {
  const { default: sharp } = await import('sharp');
  const a = scene();
  const bytes = await sharp(a.data, { raw: { width: a.width, height: a.height, channels: 4 } })
    .jpeg({ quality: 80 })
    .toBuffer();
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = compareImages(a, { width: info.width, height: info.height, data: new Uint8ClampedArray(data) });
  expect(r.evidence.alignment).not.toBeNull();
  expect(regions(r)).toHaveLength(0);
});
it('flat scenes are refused instead of receiving a spurious registration', () => {
  const a = scene();
  a.data.fill(120);
  const r = compareImages(a, a);
  expect(r.reason).toContain('Could not align');
});
it('limits the raster to overlap when the suspect has added borders', () => {
  const a = scene();
  const width = a.width + 36;
  const height = a.height + 24;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < a.height; y++) {
    data.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), ((y + 12) * width + 18) * 4);
  }
  const result = compareImages(a, { width, height, data });
  expect(result.evidence.alignment).not.toBeNull();
  const raster = result.overlays?.find((overlay) => overlay.type === 'raster');
  expect(raster?.type).toBe('raster');
  if (raster?.type !== 'raster' || !raster.rect) throw Error('Missing overlap raster');
  expect(raster.rect.x).toBeGreaterThan(0);
  expect(raster.rect.y).toBeGreaterThan(0);
  expect(raster.rect.x + raster.rect.width).toBeLessThan(1);
  expect(raster.rect.y + raster.rect.height).toBeLessThan(1);
  expect(regions(result)).toHaveLength(0);
  expect(validateCheckResult(result)).toEqual([]);
});
