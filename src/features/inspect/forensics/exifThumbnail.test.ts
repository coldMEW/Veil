import { describe, expect, it } from 'vitest';
import { compareThumbnail, exifOrientation, extractExifThumbnail, orientPixels, orientThumbnailLike, thumbnailCheckResult } from './exifThumbnail';
import { checked, exifBytes, pixels } from './testSupport';

describe('bounded EXIF thumbnail extraction', () => {
  it.each([true, false])('extracts exact bytes, little endian = %s', (little) => {
    const { bytes, thumbnail } = exifBytes(little);
    expect(extractExifThumbnail(bytes)).toEqual(thumbnail);
    const padded = new Uint8Array(bytes.length + 20); padded.set(bytes, 7);
    expect(extractExifThumbnail(padded.subarray(7, 7 + bytes.length))).toEqual(thumbnail);
  });

  it('rejects garbage and every truncation inside the APP1 segment without throwing', () => {
    const { bytes } = exifBytes();
    for (let i = 0; i < bytes.length - 2; i++) expect(extractExifThumbnail(bytes.slice(0, i))).toBeNull();
    for (let length = 0; length < 300; length++) {
      const garbage = Uint8Array.from({ length }, (_, i) => (i * 131 + length) % 256);
      expect(extractExifThumbnail(garbage)).toBeNull();
    }
  });

  it.each([true, false])('bounds offsets, counts, tag types, loops and signature (little = %s)', (little) => {
    const mutate = (at: number, value: number, size = 4) => {
      const { bytes, tiffStart } = exifBytes(little), view = new DataView(bytes.buffer);
      if (size === 2) view.setUint16(tiffStart + at, value, little); else view.setUint32(tiffStart + at, value, little);
      expect(extractExifThumbnail(bytes)).toBeNull();
    };
    mutate(4, 0xfffffff0); mutate(8, 1001, 2); mutate(14, 1001, 2);
    mutate(10, 8); mutate(10, 0); mutate(40, 14); mutate(40, 8);
    mutate(24, 0xfffffff0); mutate(36, 0xfffffff0); mutate(18, 3, 2); mutate(20, 2);
    mutate(44, 0); mutate(2, 43, 2);
  });

  it('skips non-EXIF APP1 and other JPEG segments, stopping at scan data', () => {
    const { bytes, thumbnail } = exifBytes();
    const prefixed = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0x01, ...bytes.subarray(2)]);
    expect(extractExifThumbnail(prefixed)).toEqual(thumbnail);
    prefixed[3] = 0xda;
    expect(extractExifThumbnail(prefixed)).toBeNull();
  });
});

describe('thumbnail comparison evidence', () => {
  it('identical images match', () => {
    const image = pixels(64, 64), comparison = compareThumbnail(image, image);
    expect(comparison.meanDifference).toBe(0); expect(comparison.differingCells).toEqual([]);
    const result = checked(thumbnailCheckResult('asset', comparison));
    expect(result.finding).toBe('consistent');
    expect(result.observation).toBe('The embedded thumbnail matches the main image.');
  });

  it('names a changed lower right corner even below the whole-image threshold', () => {
    const thumb = pixels(64, 64), main = pixels(64, 64);
    for (let y = 56; y < 64; y++) for (let x = 56; x < 64; x++) main.rgba.fill(220, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3);
    const comparison = compareThumbnail(thumb, main);
    expect(comparison.meanDifference).toBeLessThan(12);
    expect(comparison.differingCells).toEqual([63]);
    const result = checked(thumbnailCheckResult('asset', comparison));
    expect(result.finding).toBe('inconsistent'); expect(result.observation).toContain('lower right');
  });

  it('reports aspect mismatch independently of pixel difference', () => {
    const comparison = compareThumbnail(pixels(64, 64), pixels(128, 64));
    expect(comparison.aspectRatioDifference).toBe(0.5);
    const result = checked(thumbnailCheckResult('asset', comparison));
    expect(result.finding).toBe('inconsistent'); expect(result.observation).toContain('aspect ratios');
  });

  it('reports a global luma shift and missing thumbnails', () => {
    expect(checked(thumbnailCheckResult('asset', compareThumbnail(pixels(16, 16, 100), pixels(32, 32, 120)))).finding).toBe('inconsistent');
    const missing = checked(thumbnailCheckResult('asset', null));
    expect(missing.finding).toBe('not_applicable');
    expect(missing.reason).toBe("This file has no embedded camera thumbnail; screenshots and most apps don't keep one.");
  });

  it('box-averages main luma, including fractional coverage and small thumbnails', () => {
    const main = pixels(3, 1, 0); main.rgba.fill(90, 4, 7); main.rgba.fill(180, 8, 11);
    const thumb = pixels(2, 1, 30); thumb.rgba.fill(150, 4, 7);
    expect(compareThumbnail(thumb, main).meanDifference).toBeCloseTo(0, 8);
    const checker = pixels(16, 16, 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % 2) checker.rgba.fill(200, (y * 16 + x) * 4, (y * 16 + x) * 4 + 3);
    expect(compareThumbnail(pixels(8, 8, 100), checker).meanDifference).toBeCloseTo(0, 8);
  });
});

describe('thumbnail orientation (regression, 2026-11-14: an upright iPhone photo flagged as a preview mismatch)', () => {
  // Minimal JPEG: SOI + APP1 Exif with IFD0 holding one Orientation entry.
  const withOrientation = (value: number, little = true) => {
    const tiff = new Uint8Array(8 + 2 + 12 + 4), v = new DataView(tiff.buffer);
    tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d]); v.setUint16(2, 42, little); v.setUint32(4, 8, little);
    v.setUint16(8, 1, little); v.setUint16(10, 0x0112, little); v.setUint16(12, 3, little); v.setUint32(14, 1, little); v.setUint16(18, value, little);
    const payload = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
    const len = payload.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xd9]);
  };

  it('reads the main image orientation and defaults to 1 on missing or malformed data', () => {
    expect(exifOrientation(withOrientation(6))).toBe(6);
    expect(exifOrientation(withOrientation(8, false))).toBe(8);
    expect(exifOrientation(withOrientation(42))).toBe(1);
    expect(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
    expect(exifOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
    expect(exifOrientation(withOrientation(6).subarray(0, 20))).toBe(1);
  });

  it('rotates pixels for orientation 6 (90 degrees clockwise) and 8, and flips for 2', () => {
    // 2 x 1 image: left pixel 10, right pixel 200.
    const img = { width: 2, height: 1, rgba: new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]) };
    const r6 = orientPixels(img, 6);
    expect([r6.width, r6.height]).toEqual([1, 2]);
    expect([r6.rgba[0], r6.rgba[4]]).toEqual([10, 200]); // left goes to top
    const r8 = orientPixels(img, 8);
    expect([r8.rgba[0], r8.rgba[4]]).toEqual([200, 10]); // right goes to top
    expect(Array.from(orientPixels(img, 2).rgba.subarray(0, 1))).toEqual([200]);
  });

  it('turns a sideways thumbnail upright to match the main image, and leaves it alone otherwise', () => {
    const thumb = pixels(160, 120);
    expect(orientThumbnailLike(thumb, { width: 3024, height: 4032 }, 6)).toMatchObject({ width: 120, height: 160 });
    expect(orientThumbnailLike(thumb, { width: 4032, height: 3024 }, 6)).toBe(thumb);
    expect(compareThumbnail(orientThumbnailLike(thumb, { width: 120, height: 160 }, 6), pixels(120, 160)).aspectRatioDifference).toBeCloseTo(0, 6);
  });
});
