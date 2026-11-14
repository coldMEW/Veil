// Image intake: decide from the file's own bytes whether Veil will open it.
// Pure functions only, so the rules are unit-tested without a browser.

export const MAX_INPUT_BYTES = 80 * 1024 * 1024; // safety ceiling for what a phone can hold in memory
export const MAX_INPUT_PIXELS = 150_000_000; // safety ceiling before decoding (larger than any camera photo)
/** Larger photos are scaled down to this many pixels when they open; the original bytes and hash are kept. */
// Exactly a "12 MP" phone sensor (4032 x 3024). A round 12,000,000 resamples every full-size phone photo
// by 0.8%, which shifts its JPEG 8x8 block grid and blinds the recompression check.
export const WORKING_PIXELS = 4032 * 3024;
/** Largest bitmap any analysis receives (a phone's "12 MP" 4032 × 3024); opened photos are at most WORKING_PIXELS. */
export const MAX_DECODED_PIXELS = 4032 * 3024;

/** The size a photo is worked on at: unchanged up to WORKING_PIXELS, otherwise scaled down evenly. */
export function workingSize(width: number, height: number): { width: number; height: number; scaled: boolean } {
  const pixels = width * height;
  if (pixels <= WORKING_PIXELS) return { width, height, scaled: false };
  const k = Math.sqrt(WORKING_PIXELS / pixels);
  return { width: Math.max(1, Math.floor(width * k)), height: Math.max(1, Math.floor(height * k)), scaled: true };
}

export type SupportedMime = 'image/jpeg' | 'image/png';

export type IntakeResult =
  | { ok: true; mimeType: SupportedMime; width: number; height: number }
  | { ok: false; reason: string };

/** True when the bytes start with a PDF header (%PDF-). Documents take a separate, non-image path. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** Identify JPEG or PNG by magic bytes. File names and browser MIME types are not trusted. */
export function sniffFormat(bytes: Uint8Array): SupportedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) {
    return 'image/png';
  }
  return null;
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32be(bytes: Uint8Array, at: number): number {
  return (((bytes[at] ?? 0) << 24) >>> 0) + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0);
}

/** Width and height as stored in the PNG IHDR chunk. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // Signature (8) + chunk length (4) + "IHDR" (4), then width and height.
  if (bytes.length < 24) return null;
  const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isIhdr) return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Width and height from the first JPEG start-of-frame marker. */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    while (bytes[i] === 0xff) i++; // fill bytes
    const marker = bytes[i];
    i++;
    if (marker === undefined) return null;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or scan data before a frame header
    const length = u16be(bytes, i);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 7 > bytes.length) return null;
      return { height: u16be(bytes, i + 3), width: u16be(bytes, i + 5) };
    }
    i += length;
  }
  return null;
}

/** Rounded up, so a file just over the limit never displays as equal to it. */
function formatMiB(bytes: number): string {
  return `${(Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MiB`;
}

/** Apply Veil's input rules before any decoding. Every rejection carries a readable reason. */
export function checkIntake(bytes: Uint8Array): IntakeResult {
  if (bytes.length === 0) {
    return { ok: false, reason: 'This file is empty.' };
  }
  // Format first, so a large raw file (e.g. a phone DNG named .jpg) gets the accurate reason.
  const mimeType = sniffFormat(bytes);
  if (!mimeType) {
    return { ok: false, reason: 'Veil opens JPEG and PNG photos. This file is neither, whatever its name says.' };
  }
  if (bytes.length > MAX_INPUT_BYTES) {
    return {
      ok: false,
      reason: `This file is ${formatMiB(bytes.length)}. Veil opens files up to ${MAX_INPUT_BYTES / (1024 * 1024)} MiB.`,
    };
  }
  const size = mimeType === 'image/png' ? readPngSize(bytes) : readJpegSize(bytes);
  if (!size || size.width === 0 || size.height === 0) {
    return { ok: false, reason: 'The image header could not be read, so the file may be damaged.' };
  }
  const pixels = size.width * size.height;
  if (pixels > MAX_INPUT_PIXELS) {
    return {
      ok: false,
      reason: `This image is ${size.width} × ${size.height} (${(pixels / 1e6).toFixed(1)} megapixels). Veil opens images up to ${MAX_INPUT_PIXELS / 1e6} megapixels.`,
    };
  }
  return { ok: true, mimeType, width: size.width, height: size.height };
}

/** Lowercase hex SHA-256 of the exact bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
