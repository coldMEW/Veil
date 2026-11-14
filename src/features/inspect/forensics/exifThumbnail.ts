import type { CheckResult } from '../../../contracts';
import { readJpegSize } from '../../../lib/runtime/imageIntake';
import { assertDimensions, assertPixels, luma, regionName } from './grid';
import type { PixelImage } from './grid';
import { baseResult } from './results';

/** Parse only the bounded APP1 payload; TIFF offsets are relative to its header. */
function tiffThumbnail(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 14 || ![0x45, 0x78, 0x69, 0x66, 0, 0].every((v, i) => payload[i] === v)) return null;
  const tiff = payload.subarray(6), view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const inBounds = (at: number, size: number) => Number.isSafeInteger(at) && at >= 0 && at <= tiff.length - size;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) return null;
  const visited = new Set<number>();
  const readIfd = (at: number) => {
    if (at < 8 || visited.has(at) || !inBounds(at, 2)) return null;
    visited.add(at);
    const count = u16(at);
    if (count > 1000 || !inBounds(at + 2, count * 12 + 4)) return null;
    return { at, count, end: at + 2 + count * 12, next: u32(at + 2 + count * 12) };
  };
  const ifd0 = readIfd(u32(4));
  if (!ifd0 || !ifd0.next) return null;
  const ifd1 = readIfd(ifd0.next);
  if (!ifd1 || (ifd1.next !== 0 && visited.has(ifd1.next))) return null;
  // Reject overlapping directories as well as cyclic next pointers.
  if (ifd0.at < ifd1.end + 4 && ifd1.at < ifd0.end + 4) return null;
  let offset: number | null = null, length: number | null = null;
  for (let i = 0; i < ifd1.count; i++) {
    const entry = ifd1.at + 2 + i * 12, tag = u16(entry);
    if (tag !== 0x0201 && tag !== 0x0202) continue;
    if (u16(entry + 2) !== 4 || u32(entry + 4) !== 1) return null;
    if (tag === 0x0201) { if (offset !== null) return null; offset = u32(entry + 8); }
    else { if (length !== null) return null; length = u32(entry + 8); }
  }
  if (offset === null || length === null || offset < 8 || length < 2 || !inBounds(offset, length)) return null;
  if (tiff[offset] !== 0xff || tiff[offset + 1] !== 0xd8) return null;
  return tiff.slice(offset, offset + length);
}

/** JPEG marker walk stops before scan data. Malformed/untrusted bytes never throw. */
export function extractExifThumbnail(bytes: Uint8Array): Uint8Array | null {
  try {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === undefined || marker === 0xda || marker === 0xd9 || marker === 0) return null;
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.length) return null;
      const length = bytes[at]! * 256 + bytes[at + 1]!;
      if (length < 2 || at + length > bytes.length) return null;
      if (marker === 0xe1) {
        const thumbnail = tiffThumbnail(bytes.subarray(at + 2, at + length));
        if (thumbnail) return thumbnail;
      }
      at += length;
    }
    return null;
  } catch { return null; }
}

export interface ThumbnailComparison {
  aspectRatioDifference: number;
  meanDifference: number;
  grid: Float32Array;
  cols: 8;
  rows: 8;
  differingCells: number[];
}

/** Fractional box coverage avoids aliasing when dimensions are not integer multiples. */
function boxLuma(main: PixelImage, left: number, top: number, right: number, bottom: number): number {
  let sum = 0, area = 0;
  for (let y = Math.floor(top); y < Math.ceil(bottom); y++) for (let x = Math.floor(left); x < Math.ceil(right); x++) {
    if (x < 0 || y < 0 || x >= main.width || y >= main.height) continue;
    const weight = (Math.min(x + 1, right) - Math.max(x, left)) * (Math.min(y + 1, bottom) - Math.max(y, top));
    sum += luma(main.rgba, (y * main.width + x) * 4) * weight; area += weight;
  }
  return sum / area;
}

export function compareThumbnail(thumb: PixelImage, main: PixelImage): ThumbnailComparison {
  assertPixels(thumb.rgba, thumb.width, thumb.height); assertPixels(main.rgba, main.width, main.height);
  const totals = new Float64Array(64), counts = new Uint32Array(64);
  const sx = main.width / thumb.width, sy = main.height / thumb.height;
  let total = 0;
  for (let y = 0; y < thumb.height; y++) for (let x = 0; x < thumb.width; x++) {
    const difference = Math.abs(luma(thumb.rgba, (y * thumb.width + x) * 4)
      - boxLuma(main, x * sx, y * sy, Math.min(main.width, (x + 1) * sx), Math.min(main.height, (y + 1) * sy)));
    const cell = Math.min(7, Math.floor(y * 8 / thumb.height)) * 8 + Math.min(7, Math.floor(x * 8 / thumb.width));
    totals[cell] = totals[cell]! + difference; counts[cell] = counts[cell]! + 1; total += difference;
  }
  const grid = Float32Array.from(totals, (value, i) => counts[i] ? value / counts[i]! : 0);
  return { aspectRatioDifference: Math.abs((thumb.width / thumb.height) / (main.width / main.height) - 1),
    meanDifference: total / (thumb.width * thumb.height), grid, cols: 8, rows: 8,
    differingCells: Array.from(grid).flatMap((value, i) => value > 30 ? [i] : []) };
}

export function thumbnailCheckResult(assetId: string, comparison: ThumbnailComparison | null): CheckResult {
  const result = baseResult('exif-thumbnail', assetId);
  result.method = 'Compare the EXIF IFD1 JPEG thumbnail with box-averaged main-image luma and an eight by eight difference grid.';
  result.assumptions = ['Thumbnail and main image are compared in their decoded orientations.'];
  result.limitations = ['Some apps rotate or crop and regenerate thumbnails.',
    'A matching thumbnail can be regenerated by an editor, so a match shows nothing either way.',
    'Orientation differences, color processing and compression can also change this comparison.'];
  if (!comparison) {
    result.finding = 'not_applicable';
    result.reason = "This file has no embedded camera thumbnail; screenshots and most apps don't keep one.";
    result.observation = result.reason;
    return result;
  }
  const aspectMismatch = comparison.aspectRatioDifference > 0.02, meanMismatch = comparison.meanDifference > 12;
  const parts = [...new Set(comparison.differingCells.map((cell) => regionName((cell % 8 + 0.5) / 8,
    (Math.floor(cell / 8) + 0.5) / 8)))];
  result.evidence = { ...comparison, grid: Array.from(comparison.grid), aspectThreshold: 0.02, meanThreshold: 12, cellThreshold: 30 };
  result.finding = aspectMismatch || meanMismatch || parts.length ? 'inconsistent' : 'consistent';
  delete result.reason;
  const observations: string[] = [];
  if (aspectMismatch) observations.push('The embedded thumbnail and main image have different aspect ratios.');
  if (meanMismatch) observations.push('Their average luma differs across the image.');
  if (parts.length) observations.push(`Thumbnail detail differs in the ${parts.join(', ')}.`);
  result.observation = observations.length ? observations.join(' ') : 'The embedded thumbnail matches the main image.';
  return result;
}

export async function decodeThumbnail(bytes: Uint8Array): Promise<ImageBitmap> {
  const size = readJpegSize(bytes);
  if (!size) throw new Error('The embedded thumbnail header could not be read.');
  assertDimensions(size.width, size.height);
  // Copy to an owned ArrayBuffer for Blob's DOM typing and bounded byte range.
  return createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
}
