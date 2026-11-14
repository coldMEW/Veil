import { describe, expect, it } from 'vitest';
import { DIFFVAX_SIZE, DiffVaxImmunizer, inputTensor } from './diffvax';
import type { Mask, Pixels } from '../clean/mask';

const src = (width = 4, height = 2): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 100; data[i + 1] = 120; data[i + 2] = 140; data[i + 3] = 77; }
  return { width, height, data };
};

async function digest(bytes: Uint8Array) {
  const out = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(out), (v) => v.toString(16).padStart(2, '0')).join('');
}

async function fake(): Promise<DiffVaxImmunizer> {
  const bytes = new Uint8Array([1, 2, 3]); const model = new DiffVaxImmunizer();
  await model.load('memory://fake', 'wasm', {
    fetchBytes: async () => bytes, expectedSha256: await digest(bytes),
    createSession: async () => ({ inputNames: ['image'], outputNames: ['noise'], run: async () => ({ noise: { dims: [1, 3, DIFFVAX_SIZE, DIFFVAX_SIZE], data: new Float32Array(3 * DIFFVAX_SIZE * DIFFVAX_SIZE).fill(.1) } }) }),
  });
  return model;
}

describe('DiffVax adapter', () => {
  it('uses the pinned-sha verifier before a session can load', async () => {
    await expect(new DiffVaxImmunizer().load('memory://bad', 'wasm', { fetchBytes: async () => new Uint8Array([1]) })).rejects.toThrow(/SHA-256/);
  });

  it('resizes the whole frame into the normalized 512 tensor (same mapping the output uses)', () => {
    const prepared = inputTensor(src(8, 4));
    expect(prepared.tensor).toHaveLength(3 * DIFFVAX_SIZE * DIFFVAX_SIZE);
    // Full frame, not a centre crop: the perturbation is mapped back over the full frame in immunize().
    expect(prepared.crop).toEqual({ x: 0, y: 0, width: 8, height: 4 });
    expect(prepared.tensor[0]).toBeGreaterThan(-1);
    expect(prepared.tensor[0]).toBeLessThan(1);
  });

  it('upsamples the perturbation at full resolution and keeps editor-mask pixels exactly unchanged', async () => {
    const image = src(); const mask: Mask = { width: 4, height: 2, data: new Uint8Array([1, 1, 0, 0, 1, 1, 0, 0].map((v) => v * 255)) };
    const output = await (await fake()).immunize(image, mask);
    expect(output.pixels.width).toBe(4);
    for (const i of [0, 4, 16, 20]) expect(output.pixels.data[i]).toBe(image.data[i]);
    for (const i of [8, 12, 24, 28]) expect(output.pixels.data[i]).not.toBe(image.data[i]);
    expect(output.pixels.data[3]).toBe(77);
  });

  it('clamps normalized addition and records whole-image mode without a mask', async () => {
    const image = src(2, 2); image.data[0] = image.data[1] = image.data[2] = 255;
    const output = await (await fake()).immunize(image);
    expect(output.wholeImage).toBe(true);
    expect(output.pixels.data[0]).toBe(255);
  });
});
