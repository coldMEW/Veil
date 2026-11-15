import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { embedMark, detectMark, createMarkReader } from './index';
function texture(size = 1024) {
  const data = new Uint8ClampedArray(size * size * 4);
  let seed = 7163;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = 4 * (y * size + x);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      for (let c = 0; c < 3; c++)
        data[i + c] =
          125 +
          35 * Math.sin(x / (19 + c * 4)) * Math.cos(y / (31 + c * 3)) +
          30 * Math.sin((x + y) / (47 + c)) +
          20 * Math.cos((x - 2 * y) / (13 + c)) +
          (seed % 9) -
          4;
      data[i + 3] = 255;
    }
  return { width: size, height: size, data };
}
const key = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 3),
  payload = '1234567890123456789';
async function decoded(bytes: Uint8Array) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}
describe('ownership watermark', () => {
  it('survives JPEG75, half resize, and central replacement while meeting PSNR40', async () => {
    const source = texture(),
      start = performance.now(),
      mark = embedMark(source, key, payload);
    let error = 0;
    for (let i = 0; i < mark.data.length; i++)
      if (i % 4 !== 3) error += (mark.data[i]! - source.data[i]!) ** 2;
    const psnr = 10 * Math.log10(255 ** 2 / (error / (source.width * source.height * 3)));
    expect(psnr).toBeGreaterThanOrEqual(40);
    const jpeg = await decoded(
      await sharp(mark.data, { raw: { width: 1024, height: 1024, channels: 4 } })
        .jpeg({ quality: 75 })
        .toBuffer(),
    );
    const half = await decoded(
      await sharp(mark.data, { raw: { width: 1024, height: 1024, channels: 4 } })
        .resize(512, 512)
        .png()
        .toBuffer(),
    );
    const replaced = { ...mark, data: new Uint8ClampedArray(mark.data) },
      side = Math.round(Math.sqrt(0.3) * 1024),
      offset = Math.floor((1024 - side) / 2);
    for (let y = offset; y < offset + side; y++)
      for (let x = offset; x < offset + side; x++) {
        const i = 4 * (y * 1024 + x);
        replaced.data[i] = 45;
        replaced.data[i + 1] = 190;
        replaced.data[i + 2] = 80;
      }
    const crop = await decoded(
      await sharp(mark.data, { raw: { width: 1024, height: 1024, channels: 4 } })
        .extract({ left: 205, top: 0, width: 819, height: 1024 })
        .png()
        .toBuffer(),
    );
    const results = {
      crop20: detectMark(crop, key),
      original: detectMark(mark, key),
      jpeg75: detectMark(jpeg, key),
      half: detectMark(half, key),
      central30: detectMark(replaced, key),
    };
    console.log(JSON.stringify({ psnr, ms: performance.now() - start, results }));
    for (const r of Object.values(results)) {
      expect(r.found).toBe(true);
      expect(r.payload).toBe(payload);
    }
  }, 20000);
  it('rejects 1000 wrong keys and 1000 unmarked keys', () => {
    const source = texture(),
      marked = embedMark(source, key, payload),
      readMarked = createMarkReader(marked),
      readPlain = createMarkReader(source);
    let falseMarked = 0,
      falsePlain = 0;
    for (let i = 0; i < 1000; i++) {
      const k = new Uint8Array(32);
      new DataView(k.buffer).setUint32(0, i + 123, true);
      for (let j = 4; j < 32; j++) k[j] = (i * 31 + j * 17) & 255;
      if (readMarked(k).found) falseMarked++;
      if (readPlain(k).found) falsePlain++;
    }
    console.log('false-positive counts', falseMarked, falsePlain);
    expect(falseMarked).toBe(0);
    expect(falsePlain).toBe(0);
  }, 20000);
  it('rejects malformed keys and payloads', () => {
    const image = texture(128);
    expect(() => embedMark(image, new Uint8Array(8), payload)).toThrow();
    expect(() => embedMark(image, key, -1n)).toThrow();
    expect(() => embedMark(image, key, 1n << 64n)).toThrow();
  });
});
