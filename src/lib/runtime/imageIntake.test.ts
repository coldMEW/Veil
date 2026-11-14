import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_BYTES,
  checkIntake,
  readJpegSize,
  readPngSize,
  sha256Hex,
  sniffFormat,
} from './imageIntake';

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

function jpegHeader(width: number, height: number, withApp1 = true): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (withApp1) parts.push(0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00); // APP1 "Exif"
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03);
  parts.push(...new Array(9).fill(0));
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

describe('sniffFormat', () => {
  it('identifies JPEG and PNG by magic bytes', () => {
    expect(sniffFormat(jpegHeader(10, 10))).toBe('image/jpeg');
    expect(sniffFormat(pngHeader(10, 10))).toBe('image/png');
  });

  it('rejects other formats regardless of name', () => {
    expect(sniffFormat(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(sniffFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull(); // RIFF / WebP
    expect(sniffFormat(new Uint8Array([]))).toBeNull();
  });
});

describe('header size readers', () => {
  it('reads PNG IHDR size', () => {
    expect(readPngSize(pngHeader(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it('reads JPEG SOF size after an APP1 segment', () => {
    expect(readJpegSize(jpegHeader(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(readJpegSize(jpegHeader(640, 480, false))).toEqual({ width: 640, height: 480 });
  });

  it('returns null for a JPEG with no frame header', () => {
    expect(readJpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('checkIntake', () => {
  it('accepts a 12 MP image at the limit', () => {
    const result = checkIntake(pngHeader(4000, 3000));
    expect(result).toEqual({ ok: true, mimeType: 'image/png', width: 4000, height: 3000 });
  });

  it('rejects images over 12 megapixels with the measured size', () => {
    const result = checkIntake(jpegHeader(4032, 3024));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('4032 × 3024');
  });

  it('rejects files over 10 MiB before reading them', () => {
    const big = new Uint8Array(MAX_INPUT_BYTES + 1);
    big.set(pngHeader(10, 10));
    const result = checkIntake(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('This file is 10.1 MiB. Veil opens files up to 10 MiB.');
  });

  it('names the format, not the size, for a large raw file with a .jpg name', () => {
    const dng = new Uint8Array(MAX_INPUT_BYTES + 3_000_000);
    dng.set([0x49, 0x49, 0x2a, 0x00]); // TIFF / DNG little-endian magic
    const result = checkIntake(dng);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('neither');
  });

  it('rejects empty, unsupported and damaged files', () => {
    expect(checkIntake(new Uint8Array()).ok).toBe(false);
    expect(checkIntake(new TextEncoder().encode('not an image')).ok).toBe(false);
    expect(checkIntake(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])).ok).toBe(false);
    expect(checkIntake(pngHeader(0, 10)).ok).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('hashes the exact bytes', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('isPdf', () => {
  it('recognises the %PDF- header and nothing else', async () => {
    const { isPdf } = await import('./imageIntake');
    expect(isPdf(new TextEncoder().encode('%PDF-1.7\n'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('%PDX-1.7'))).toBe(false);
    expect(isPdf(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });
});
