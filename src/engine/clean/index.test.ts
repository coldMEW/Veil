import { describe, it, expect, vi } from 'vitest';
import { inpaintTiled, innerFeatherWeight } from './tiles';
import type { Pixels } from '../../features/clean/mask';
import { emptyMask, fillRect } from '../../features/clean/mask';
import { changedOutsideMask } from '../../features/clean/redact';
import { candidatesFromOcr, textRemovalMask } from '../../features/clean/session';
import { preprocessDetection } from '../../features/clean/ocr/det';
import { scanImage } from '../../features/clean/ocr/pipeline';
import type { TensorData } from '../../features/clean/ocr/types';
describe('Clean engine regressions', () => {
  it('leaves garment branding unselected while preserving manual review', () => {
    const texts = [
      'NIKE',
      'ADIDAS 2020',
      'THE NORTH FACE 1966',
      'EST. 1990',
      'STOP',
      'ST',
      '221B BAKER ST',
      'PINE AVE',
      'ROOM 204',
      'ABC1234',
      'a@example.com',
      '605-555-0142',
    ];
    const out = candidatesFromOcr(
      'synthetic',
      texts.map((text) => ({ text, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, recScore: 0.99 })),
    );
    expect(out.map((c) => c.selected)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(out.every((c) => c.category && c.removal === 'glyph')).toBe(true);
    out[0]!.selected = true;
    expect(out[0]!.selected).toBe(true);
  });
  it('caps dilation on large glyphs to six pixels', () => {
    const src = { width: 400, height: 400, data: new Uint8ClampedArray(400 * 400 * 4).fill(255) };
    const c = candidatesFromOcr('x', [
      { text: 'ROOM 204', rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.5 }, recScore: 1 },
    ]);
    expect(textRemovalMask(src, c).dilatePx).toBe(6);
  });
  it('quarter-turn detector preprocessing preserves channel values and swaps dimensions', () => {
    const data = new Uint8ClampedArray(64 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) {
        let i = 4 * (y * 64 + x);
        data[i] = x;
        data[i + 1] = y;
        data[i + 2] = 90;
        data[i + 3] = 255;
      }
    const tensor = preprocessDetection({ width: 64, height: 32, data }, undefined, 960, undefined, true);
    expect(tensor.dims).toEqual([1, 3, 64, 32]);
    const offset = 2 * 64 * 32;
    expect(tensor.data[offset]).toBeCloseTo((63 / 255 - 0.406) / 0.225, 5);
  });
  it('maps quarter-turn boxes and ordered quads back to the original frame', async () => {
    const detect = vi.fn(async (t: TensorData) => {
      const h = t.dims[2]!,
        w = t.dims[3]!,
        data = new Float32Array(w * h);
      if (h > w) for (let y = 8; y < 14; y++) for (let x = 5; x < 24; x++) data[y * w + x] = 0.95;
      return { data, dims: [1, 1, h, w] };
    });
    const image = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).fill(255) };
    const result = await scanImage(image, {
      detect,
      recognize: async () => ({ data: new Float32Array([0, 1]), dims: [1, 1, 2] }),
      recognitionHeight: 48,
      dictionary: ['', 'A'],
    });
    expect(detect).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    const b = result[0]!;
    expect(b.category).toBe('other_text');
    expect(b.rect.x).toBeGreaterThan(0.5);
    expect(b.rect.y).toBeLessThan(0.3);
    expect(b.quad[1].y).toBeGreaterThan(b.quad[0].y);
  });
  it('tiles native pixels, blends overlaps, feathers inside only and never mutates source', async () => {
    const src = { width: 1000, height: 700, data: new Uint8ClampedArray(1000 * 700 * 4).fill(100) };
    for (let i = 3; i < src.data.length; i += 4) src.data[i] = 255;
    const original = new Uint8ClampedArray(src.data),
      mask = emptyMask(1000, 700);
    fillRect(mask, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    const predict = vi.fn(async (tile: Pixels) => {
      expect(tile.width).toBeLessThanOrEqual(512);
      expect(tile.height).toBeLessThanOrEqual(512);
      const data = new Uint8ClampedArray(tile.data);
      for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 200;
      return { ...tile, data };
    });
    const output = await inpaintTiled(src, mask, { x: 0, y: 0, w: 1000, h: 700 }, predict);
    expect(predict.mock.calls.length).toBeGreaterThan(1);
    expect(src.data.every((v, i) => v === original[i])).toBe(true);
    expect(changedOutsideMask(src, output, mask)).toBe(0);
    expect(output.data[(350 * 1000 + 500) * 4]).toBe(200);
    expect(output.data[(70 * 1000 + 100) * 4]).toBeGreaterThan(100);
    expect(output.data[(70 * 1000 + 100) * 4]).toBeLessThan(200);
    expect(innerFeatherWeight(mask, 100, 70)).toBeCloseTo(1 / 3);
  });
  it('rejects malformed inference outputs', async () => {
    const src = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) },
      mask = emptyMask(64, 64);
    mask.data.fill(1);
    await expect(
      inpaintTiled(src, mask, { x: 0, y: 0, w: 64, h: 64 }, async () => ({ ...src, width: 63 })),
    ).rejects.toThrow('output');
  });
  it('uses recognition confidence when overlapping rotation passes disagree', async () => {
    let call = 0;
    const detect = async (t: TensorData) => {
      const h = t.dims[2]!,
        w = t.dims[3]!,
        data = new Float32Array(w * h),
        rot = call++ === 1;
      for (let y = rot ? 34 : 8; y < (rot ? 54 : 15); y++)
        for (let x = rot ? 8 : 10; x < (rot ? 15 : 30); x++) data[y * w + x] = rot ? 0.99 : 0.8;
      return { data, dims: [1, 1, h, w] };
    };
    let rec = 0;
    const result = await scanImage(
      { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).fill(255) },
      {
        detect,
        recognize: async () => ({
          data: new Float32Array(rec++ === 0 ? [0.01, 0.99, 0] : [0.1, 0.2, 0.7]),
          dims: [1, 1, 3],
        }),
        recognitionHeight: 48,
        dictionary: ['', 'A', 'B'],
      },
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('A');
  });
});
