/** Editable camera metadata is information, not a flag in either direction. */
export interface CameraHints {
  make: string | null;
  model: string | null;
  software: string | null;
  dateTimeOriginal: string | null;
}

function readTiff(bytes: Uint8Array): CameraHints | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (offset: number, size: number) => offset >= 0 && size >= 0 && offset <= bytes.length - size;
  if (!fits(0, 8)) return null;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return null;
  const u16 = (offset: number) => data.getUint16(offset, little);
  const u32 = (offset: number) => data.getUint32(offset, little);
  if (u16(2) !== 42) return null;
  const hints: CameraHints = { make: null, model: null, software: null, dateTimeOriginal: null };
  const visited = new Set<number>();

  const ascii = (entry: number): string | null => {
    if (u16(entry + 2) !== 2) return null;
    const count = u32(entry + 4);
    const start = count <= 4 ? entry + 8 : u32(entry + 8);
    if (!count || (count > 4 && start < 8) || !fits(start, count)) return null;
    // Locate padding without allocating a string proportional to an untrusted count.
    let end = start + count;
    while (end > start && (bytes[end - 1] === 0 || /\s/.test(String.fromCharCode(bytes[end - 1]!)))) end--;
    let begin = start;
    while (begin < end && /\s/.test(String.fromCharCode(bytes[begin]!))) begin++;
    let value = '';
    for (let i = begin; i < Math.min(end, begin + 100); i++) {
      const byte = bytes[i]!;
      // ASCII metadata must not contain embedded NULs or non-ASCII/control bytes.
      if (byte === 0) break;
      if (byte > 0x7f || (byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 13)) return null;
      value += String.fromCharCode(byte);
    }
    return value.trim() || null;
  };

  const readIfd = (offset: number, exif: boolean): void => {
    if (offset < 8 || visited.has(offset) || !fits(offset, 2)) return;
    visited.add(offset);
    const count = u16(offset);
    if (count > 1000 || !fits(offset + 2, count * 12 + 4)) return;
    let exifOffset: number | null = null;
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      const tag = u16(entry);
      if (exif) {
        if (tag === 0x9003) hints.dateTimeOriginal = ascii(entry);
      } else {
        if (tag === 0x010f) hints.make = ascii(entry);
        if (tag === 0x0110) hints.model = ascii(entry);
        if (tag === 0x0131) hints.software = ascii(entry);
        if (tag === 0x8769 && u16(entry + 2) === 4 && u32(entry + 4) === 1) exifOffset = u32(entry + 8);
      }
    }
    // Only the requested Exif directory is followed; next-IFD chains/thumbnails are ignored.
    if (exifOffset !== null) readIfd(exifOffset, true);
  };

  readIfd(u32(4), false);
  return Object.values(hints).some((value) => value !== null) ? hints : null;
}

/** Read only camera hints from bounded JPEG APP1 or PNG eXIf payloads. Never throws. */
export function readCameraHints(bytes: Uint8Array): CameraHints | null {
  try {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) return null;
        while (offset < bytes.length && bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === undefined || marker === 0xda || marker === 0xd9 || marker === 0) return null;
        if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) return null;
        const length = data.getUint16(offset);
        if (length < 2 || length > bytes.length - offset) return null;
        const payload = offset + 2;
        const end = offset + length;
        if (marker === 0xe1 && length >= 8 && bytes[payload] === 0x45 && bytes[payload + 1] === 0x78 &&
          bytes[payload + 2] === 0x69 && bytes[payload + 3] === 0x66 && bytes[payload + 4] === 0 && bytes[payload + 5] === 0) {
          const hints = readTiff(bytes.subarray(payload + 6, end));
          if (hints) return hints;
        }
        offset = end;
      }
    } else if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) {
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length = data.getUint32(offset);
        if (length > bytes.length - offset - 12) return null;
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === 'eXIf') {
          const hints = readTiff(bytes.subarray(offset + 8, offset + 8 + length));
          if (hints) return hints;
        }
        if (type === 'IEND') return null;
        offset += length + 12;
      }
    }
    return null;
  } catch {
    return null;
  }
}
