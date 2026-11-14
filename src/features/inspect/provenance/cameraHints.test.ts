import { describe, expect, it } from 'vitest';
import { readCameraHints, type CameraHints } from './cameraHints';

const EMPTY: CameraHints = { make: null, model: null, software: null, dateTimeOriginal: null };
const SAMPLE = { make: 'Acme', model: 'Pocket Camera', software: 'Photo Editor', dateTimeOriginal: '2026:11:14 10:20:30' };
const ascii = (text: string) => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Minimal synthetic TIFF, with no private photos or external image dependencies. */
function tiff(little = true, values: Partial<CameraHints> = SAMPLE): Uint8Array {
  const fields = [
    { tag: 0x010f, value: values.make },
    { tag: 0x0110, value: values.model },
    { tag: 0x0131, value: values.software },
  ].filter((field): field is { tag: number; value: string } => typeof field.value === 'string');
  const hasDate = typeof values.dateTimeOriginal === 'string';
  const count = fields.length + (hasDate ? 1 : 0);
  const exifOffset = 8 + 2 + count * 12 + 4;
  let cursor = exifOffset + (hasDate ? 18 : 0);
  const bytes = new Uint8Array(cursor + fields.reduce((sum, field) => sum + field.value.length + 1, 0) + (values.dateTimeOriginal?.length ?? 0) + 1);
  const data = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => data.setUint16(offset, value, little);
  const u32 = (offset: number, value: number) => data.setUint32(offset, value, little);
  bytes.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  u16(2, 42);
  u32(4, 8);
  u16(8, count);
  const entry = (offset: number, tag: number, value: string) => {
    const encoded = ascii(`${value}\0`);
    u16(offset, tag); u16(offset + 2, 2); u32(offset + 4, encoded.length);
    if (encoded.length <= 4) bytes.set(encoded, offset + 8);
    else { u32(offset + 8, cursor); bytes.set(encoded, cursor); cursor += encoded.length; }
  };
  fields.forEach((field, i) => entry(10 + i * 12, field.tag, field.value));
  if (hasDate) {
    const pointer = 10 + fields.length * 12;
    u16(pointer, 0x8769); u16(pointer + 2, 4); u32(pointer + 4, 1); u32(pointer + 8, exifOffset);
    u16(exifOffset, 1);
    entry(exifOffset + 2, 0x9003, values.dateTimeOriginal!);
  }
  return bytes.subarray(0, cursor);
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4);
  bytes.set([0xff, marker]);
  new DataView(bytes.buffer).setUint16(2, payload.length + 2);
  bytes.set(payload, 4);
  return bytes;
}

function jpeg(bytes: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0xff, 0xd8]), segment(0xe0, ascii('JFIF\0')), segment(0xe1, concat(ascii('Exif\0\0'), bytes)), new Uint8Array([0xff, 0xd9]));
}

function chunk(type: string, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(payload.length + 12);
  new DataView(bytes.buffer).setUint32(0, payload.length);
  bytes.set(ascii(type), 4);
  bytes.set(payload, 8);
  // CRC is outside this metadata reader's scope; leave synthetic CRC bytes zeroed.
  return bytes;
}

function png(bytes: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('eXIf', bytes), chunk('IEND'));
}

describe('readCameraHints', () => {
  it.each([true, false])('reads JPEG IFD0 and ExifIFD fields (little endian: %s)', (little) => {
    expect(readCameraHints(jpeg(tiff(little)))).toEqual(SAMPLE);
  });

  it.each([true, false])('reads short inline ASCII and offset values (little endian: %s)', (little) => {
    expect(readCameraHints(jpeg(tiff(little, { make: 'ABC', model: 'Long model name', software: 'XY' }))))
      .toEqual({ ...EMPTY, make: 'ABC', model: 'Long model name', software: 'XY' });
  });

  it.each([true, false])('reads PNG eXIf TIFF payloads (little endian: %s)', (little) => {
    expect(readCameraHints(png(tiff(little)))).toEqual(SAMPLE);
  });

  it('trims trailing NULs and whitespace and caps strings at one hundred characters', () => {
    expect(readCameraHints(jpeg(tiff(true, { make: '  ACME \0\0 \t', model: 'M'.repeat(150), software: ' \t ' }))))
      .toEqual({ ...EMPTY, make: 'ACME', model: 'M'.repeat(100) });
  });

  it('returns null when all fields are missing or empty', () => {
    expect(readCameraHints(jpeg(tiff(true, {})))).toBeNull();
    expect(readCameraHints(jpeg(tiff(true, { make: ' ', software: '' })))).toBeNull();
  });

  it('respects Uint8Array offsets and never mutates the input', () => {
    const image = jpeg(tiff());
    const padded = concat(new Uint8Array(17), image, new Uint8Array(11));
    const before = padded.slice();
    expect(readCameraHints(padded.subarray(17, 17 + image.length))).toEqual(SAMPLE);
    expect(padded).toEqual(before);
  });

  it('skips unrelated APP1 metadata and JPEG standalone/fill markers', () => {
    const image = concat(new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0x01]), segment(0xe1, ascii('not EXIF')), jpeg(tiff()).subarray(2));
    expect(readCameraHints(image)).toEqual(SAMPLE);
  });

  it('returns null for a JPEG without APP1 and does not search entropy-coded data', () => {
    expect(readCameraHints(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readCameraHints(concat(new Uint8Array([0xff, 0xd8]), segment(0xe0, ascii('JFIF')), new Uint8Array([0xff, 0xd9])))).toBeNull();
    expect(readCameraHints(concat(new Uint8Array([0xff, 0xd8, 0xff, 0xda]), jpeg(tiff())))).toBeNull();
  });

  it.each([true, false])('bounds-checks each field independently (little endian: %s)', (little) => {
    const bytes = tiff(little);
    const data = new DataView(bytes.buffer);
    data.setUint32(18, bytes.length + 5, little); // Make value offset.
    data.setUint32(26, 0xffffffff, little); // Model character count.
    expect(readCameraHints(jpeg(bytes))).toEqual({ ...SAMPLE, make: null, model: null });
  });

  it('does not let a TIFF offset read into the following JPEG segment', () => {
    const bytes = tiff(true, { make: 'Offset value' });
    new DataView(bytes.buffer).setUint32(18, bytes.length, true);
    expect(readCameraHints(concat(jpeg(bytes).subarray(0, -2), segment(0xe2, ascii('Outside payload\0')), new Uint8Array([0xff, 0xd9])))).toBeNull();
  });

  it.each([0, 8, 0xffffffff])('ignores invalid or looping ExifIFD pointers (%s)', (pointer) => {
    const bytes = tiff();
    new DataView(bytes.buffer).setUint32(54, pointer, true);
    expect(readCameraHints(jpeg(bytes))).toEqual({ ...SAMPLE, dateTimeOriginal: null });
  });

  it('ignores next-IFD loops rather than traversing thumbnail chains', () => {
    const bytes = tiff();
    new DataView(bytes.buffer).setUint32(58, 8, true);
    expect(readCameraHints(jpeg(bytes))).toEqual(SAMPLE);
  });

  it.each([1001, 65535])('rejects absurd IFD entry counts (%s)', (count) => {
    const bytes = tiff();
    new DataView(bytes.buffer).setUint16(8, count, true);
    expect(readCameraHints(jpeg(bytes))).toBeNull();
  });

  it('rejects bad TIFF headers, directories, field types and pointer counts', () => {
    for (const offset of [0, 2]) {
      const bytes = tiff(); bytes[offset] = 0;
      expect(readCameraHints(jpeg(bytes))).toBeNull();
    }
    const root = tiff(); new DataView(root.buffer).setUint32(4, root.length, true);
    expect(readCameraHints(jpeg(root))).toBeNull();
    const types = tiff();
    const data = new DataView(types.buffer);
    data.setUint16(12, 3, true); // Make is not ASCII.
    data.setUint32(50, 2, true); // Exif pointer is not a single LONG.
    expect(readCameraHints(jpeg(types))).toEqual({ ...SAMPLE, make: null, dateTimeOriginal: null });
    expect(readCameraHints(jpeg(tiff().subarray(0, 40)))).toBeNull();
  });

  it('rejects oversized PNG chunks and respects IEND', () => {
    const image = png(tiff()); new DataView(image.buffer).setUint32(8, 0xffffffff);
    expect(readCameraHints(image)).toBeNull();
    expect(readCameraHints(concat(png(new Uint8Array()), chunk('eXIf', tiff())))).toBeNull();
  });

  it('never throws on truncated or garbage buffers', () => {
    for (const image of [jpeg(tiff()), png(tiff())]) {
      for (let length = 0; length < image.length; length++) {
        expect(() => readCameraHints(image.subarray(0, length))).not.toThrow();
      }
    }
    for (let length = 0; length < 256; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 73 + length * 19) & 255);
      expect(() => readCameraHints(bytes)).not.toThrow();
      expect(readCameraHints(bytes)).toBeNull();
    }
  });
});
