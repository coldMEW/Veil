import type { Pixels } from './mask';
import { inspectMetadata, type MetadataReport } from './metadata';
import { sha256Hex } from './hash';

/**
 * Fresh PNG export: pixels are drawn onto a new canvas and encoded from scratch,
 * so no EXIF/XMP/ICC/comments/thumbnails from the source are copied.
 */
export async function encodePng(px: Pixels): Promise<Uint8Array> {
  const img = new ImageData(new Uint8ClampedArray(px.data), px.width, px.height);
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(px.width, px.height);
    c.getContext('2d')!.putImageData(img, 0, 0);
    blob = await c.convertToBlob({ type: 'image/png' });
  } else {
    const c = document.createElement('canvas');
    c.width = px.width;
    c.height = px.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decode file bytes into pixels, applying EXIF orientation (browser default 'from-image'). */
export async function decodeToPixels(bytes: Uint8Array, mime = 'image/png'): Promise<Pixels> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

export interface ExportVerification {
  sha256: string;
  byteLength: number;
  metadata: MetadataReport;
  /** Decoded exported bytes; feed to the OCR re-scan. */
  decoded: Pixels;
  /** Pixels whose decoded value differs from what we intended to export (PNG is lossless: expect 0). */
  roundTripMismatches: number;
}

/** Re-open the EXPORTED BYTES (not the in-memory buffer) and check them. */
export async function verifyExport(intended: Pixels, bytes: Uint8Array): Promise<ExportVerification> {
  const decoded = await decodeToPixels(bytes);
  let mismatches = 0;
  if (decoded.width !== intended.width || decoded.height !== intended.height) mismatches = -1;
  else
    for (let i = 0; i < intended.data.length; i += 4)
      if (
        decoded.data[i] !== intended.data[i] ||
        decoded.data[i + 1] !== intended.data[i + 1] ||
        decoded.data[i + 2] !== intended.data[i + 2]
      )
        mismatches++;
  return {
    sha256: await sha256Hex(bytes),
    byteLength: bytes.byteLength,
    metadata: inspectMetadata(bytes),
    decoded,
    roundTripMismatches: mismatches,
  };
}
