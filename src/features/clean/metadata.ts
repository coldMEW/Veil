/**
 * Independent byte-level metadata inspector used to VERIFY exports.
 * (exifr reads metadata; it does not remove it. Removal is done by re-encoding pixels.)
 */

export interface MetadataReport {
  format: 'png' | 'jpeg' | 'unknown';
  /** Chunk/segment names that can carry metadata (EXIF, XMP, text, ICC, comments, thumbnails). */
  metadataBlocks: string[];
  /** All chunk/segment names in order. */
  blocks: string[];
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG chunks that carry pixel/structure info only. */
const PNG_STRUCTURAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'pHYs', 'bKGD']);

export function inspectMetadata(bytes: Uint8Array): MetadataReport {
  if (PNG_SIG.every((b, i) => bytes[i] === b)) return inspectPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  return { format: 'unknown', metadataBlocks: [], blocks: [] };
}

function inspectPng(bytes: Uint8Array): MetadataReport {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks: string[] = [];
  const meta: string[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    blocks.push(type);
    if (!PNG_STRUCTURAL.has(type)) meta.push(type); // tEXt, iTXt, zTXt, eXIf, iCCP, tIME, ...
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return { format: 'png', metadataBlocks: meta, blocks };
}

function inspectJpeg(bytes: Uint8Array): MetadataReport {
  const blocks: string[] = [];
  const meta: string[] = [];
  let off = 2;
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) break;
    const marker = bytes[off + 1]!;
    if (marker === 0xd9 || marker === 0xda) {
      blocks.push(marker === 0xda ? 'SOS' : 'EOI');
      break; // entropy-coded data follows
    }
    const len = (bytes[off + 2]! << 8) | bytes[off + 3]!;
    let name = `FF${marker.toString(16).toUpperCase()}`;
    if (marker >= 0xe0 && marker <= 0xef) {
      const id = String.fromCharCode(...bytes.subarray(off + 4, Math.min(off + 4 + 12, bytes.length))).split('\0')[0]!;
      name = `APP${marker - 0xe0}:${id}`;
      // APP0 JFIF is structural; everything else (Exif, XMP, ICC, IPTC...) is metadata
      if (!(marker === 0xe0 && id.startsWith('JFIF'))) meta.push(name);
    } else if (marker === 0xfe) {
      name = 'COM';
      meta.push(name);
    }
    blocks.push(name);
    off += 2 + len;
  }
  return { format: 'jpeg', metadataBlocks: meta, blocks };
}
