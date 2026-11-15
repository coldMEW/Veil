import { describe, expect, it, vi } from 'vitest';
import { scanImage } from './pipeline';
import type { OcrModels, TensorData } from './types';

function models(): OcrModels {
  return {
    recognitionHeight: 48,
    dictionary: ['', 'A'],
    detect: vi.fn(async (input: TensorData) => {
      const h = input.dims[2]!,
        w = input.dims[3]!;
      const data = new Float32Array(w * h);
      for (let y = 5; y < 12; y++) for (let x = 5; x < 20; x++) data[y * w + x]! = 0.9;
      return { data, dims: [1, 1, h, w] };
    }),
    recognize: vi.fn(async () => ({ data: new Float32Array([0.01, 0.99]), dims: [1, 1, 2] })),
  };
}
const image = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).fill(255) };

describe('OCR pipeline contract', () => {
  it('returns normalized geometry and text using the same pure adapters as real-model smoke', async () => {
    const m = models();
    const result = await scanImage(image, m, { rotateTiles: false });
    expect(m.detect).toHaveBeenCalledTimes(1); // tiny whole image already covered
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('A');
    expect(result[0]!.quad).toHaveLength(4);
    expect(result[0]!.quad.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    expect(result[0]!.rect.x).toBe(result[0]!.pixelRect.x / 64);
    expect(result[0]!.rect.y).toBe(result[0]!.pixelRect.y / 32);
    expect(result[0]!.rect.x + result[0]!.rect.w).toBeLessThanOrEqual(1);
  });
  it('uses whole-image and overlapping source-tile passes on a larger image', async () => {
    const m = models();
    const progress = vi.fn();
    await scanImage(image, m, { tileSize: 32, overlap: 8, rotateTiles: false }, progress);
    expect(m.detect).toHaveBeenCalledTimes(4); // three tiles plus whole image
    expect(progress).toHaveBeenCalledWith({ stage: 'detect', completed: 4, total: 4 });
  });
  it('fails explicitly on unsupported output shapes or box budgets, never silently returns clean', async () => {
    const m = models();
    m.detect = async () => ({ data: new Float32Array(1), dims: [1] });
    await expect(scanImage(image, m)).rejects.toThrow(/shape/i);
    await expect(scanImage(image, models(), { maxBoxes: 0 })).rejects.toThrow();
  });
  it('propagates model failures and filters genuinely empty recognition', async () => {
    const m = models();
    m.recognize = async () => {
      throw new Error('inference failed');
    };
    await expect(scanImage(image, m)).rejects.toThrow('inference failed');
    m.recognize = async () => ({ data: new Float32Array([1, 0]), dims: [1, 1, 2] });
    expect(await scanImage(image, m)).toEqual([]);
  });
});
