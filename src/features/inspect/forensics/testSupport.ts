import { expect } from 'vitest';
import { validateCheckResult } from '../../../contracts';
import type { CheckResult } from '../../../contracts';
import type { PixelImage } from './grid';

/** Applied to every check result constructed by these tests, including failures. */
export function checked(result: CheckResult): CheckResult {
  expect(validateCheckResult(result)).toEqual([]);
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(strings)
      : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  for (const value of strings(result)) {
    expect(value).not.toMatch(/\b(real|fake|authentic|genuine|forged|tampered|manipulated|AI-generated)\b/i);
  }
  for (const value of [result.title, result.observation, ...result.limitations]) expect(value).not.toMatch(/%|\bpercent(?:age)?\b/i);
  if (result.execution !== 'complete') expect(result.finding).toBe('inconclusive');
  if (result.finding === 'inconclusive' || result.finding === 'not_applicable') expect(result.reason).toBeTruthy();
  // Report evidence and raster values must serialize without non-finite numbers.
  const numbers = (value: unknown): number[] => typeof value === 'number' ? [value]
    : Array.isArray(value) ? value.flatMap(numbers)
      : value && typeof value === 'object' ? Object.values(value).flatMap(numbers) : [];
  expect(numbers(result).every(Number.isFinite)).toBe(true);
  return result;
}

export function pixels(width: number, height: number, value = 128): PixelImage {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba.fill(value, i * 4, i * 4 + 3); rgba[i * 4 + 3] = 255; }
  return { rgba, width, height };
}

export function noisy(width: number, height: number, sigma: (x: number, y: number) => number): PixelImage {
  const image = pixels(width, height);
  let seed = 0x12345678;
  const uniform = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gaussian = Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    const i = (y * width + x) * 4, value = 128 + sigma(x, y) * gaussian;
    image.rgba.fill(value, i, i + 3);
  }
  return image;
}

export function exifBytes(little = true): { bytes: Uint8Array; thumbnail: Uint8Array; tiffStart: number } {
  const thumbnail = Uint8Array.of(0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9);
  const tiff = new Uint8Array(44 + thumbnail.length), v = new DataView(tiff.buffer);
  tiff[0] = tiff[1] = little ? 0x49 : 0x4d;
  v.setUint16(2, 42, little); v.setUint32(4, 8, little);
  v.setUint16(8, 0, little); v.setUint32(10, 14, little);
  v.setUint16(14, 2, little);
  for (const [at, tag, value] of [[16, 0x0201, 44], [28, 0x0202, thumbnail.length]]) {
    v.setUint16(at!, tag!, little); v.setUint16(at! + 2, 4, little);
    v.setUint32(at! + 4, 1, little); v.setUint32(at! + 8, value!, little);
  }
  tiff.set(thumbnail, 44);
  const length = 2 + 6 + tiff.length;
  const bytes = new Uint8Array(4 + length + 2);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  bytes.set(tiff, 12); bytes.set([0xff, 0xd9], bytes.length - 2);
  return { bytes, thumbnail, tiffStart: 12 };
}
