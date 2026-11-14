import { describe, expect, it } from 'vitest';
import { dilate, emptyMask, fillRect, maskArea, maskBounds, MaskHistory, paintCircle, rectsToMask, toPixelRect, type Pixels } from './mask';
import { changedOutsideMask, compositeCrop, solidRedact, workingCrop } from './redact';
import { inspectMetadata } from './metadata';
import { classifyText } from './filter';
import { maskSha256, sha256Hex } from './hash';

function gradient(w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = (i * 7) % 256;
    data[i * 4 + 2] = (i * 13) % 256;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

describe('mask geometry', () => {
  it('rounds normalized rects outward and clamps', () => {
    expect(toPixelRect({ x: 0.1, y: 0.1, w: 0.25, h: 0.25 }, 10, 10)).toEqual({ x: 1, y: 1, w: 3, h: 3 });
    expect(toPixelRect({ x: -0.5, y: 0.9, w: 1, h: 1 }, 10, 10)).toEqual({ x: 0, y: 9, w: 5, h: 1 });
  });
  it('fills rect masks with correct polarity (1 = remove)', () => {
    const m = rectsToMask([{ x: 0, y: 0, w: 0.5, h: 0.5 }], 4, 4);
    expect(Array.from(m.data)).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('dilates by radius and stays inside the image', () => {
    const m = emptyMask(7, 7);
    m.data[3 * 7 + 3] = 1;
    const d = dilate(m, 2);
    expect(maskArea(d)).toBe(25);
    expect(maskBounds(d)).toEqual({ x: 1, y: 1, w: 5, h: 5 });
    const corner = emptyMask(4, 4);
    corner.data[0] = 1;
    expect(maskArea(dilate(corner, 1))).toBe(4);
  });
  it('paints brush circles', () => {
    const m = paintCircle(emptyMask(9, 9), 4, 4, 1);
    expect(maskArea(m)).toBe(5);
  });
  it('supports undo/redo/reset', () => {
    const h = new MaskHistory(emptyMask(4, 4));
    h.checkpoint();
    fillRect(h.mask, { x: 0, y: 0, w: 1, h: 1 });
    expect(maskArea(h.mask)).toBe(16);
    expect(h.undo()).toBe(true);
    expect(maskArea(h.mask)).toBe(0);
    expect(h.redo()).toBe(true);
    expect(maskArea(h.mask)).toBe(16);
    h.reset();
    expect(maskArea(h.mask)).toBe(0);
    h.undo();
    expect(maskArea(h.mask)).toBe(16);
  });
});

describe('removal', () => {
  it('solid redaction changes only masked pixels and never mutates the source', () => {
    const src = gradient(32, 16);
    const before = src.data.slice();
    const mask = rectsToMask([{ x: 0.25, y: 0.25, w: 0.25, h: 0.5 }], 32, 16);
    const out = solidRedact(src, mask);
    expect(src.data).toEqual(before);
    expect(changedOutsideMask(src, out, mask)).toBe(0);
    for (let i = 0; i < mask.data.length; i++)
      if (mask.data[i]) expect([out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2], out.data[i * 4 + 3]]).toEqual([0, 0, 0, 255]);
  });

  it('composite takes only masked pixels from the inpainted crop', () => {
    const src = gradient(20, 20);
    const mask = rectsToMask([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 20, 20);
    const crop = { x: 4, y: 4, w: 10, h: 10 };
    const inp: Pixels = { width: 10, height: 10, data: new Uint8ClampedArray(400).fill(200) };
    const out = compositeCrop(src, inp, crop, mask);
    expect(changedOutsideMask(src, out, mask)).toBe(0);
    const i = 7 * 20 + 7; // inside mask
    expect(out.data[i * 4]).toBe(200);
    expect(() => compositeCrop(src, inp, { x: 15, y: 15, w: 10, h: 10 }, mask)).toThrow(/bounds/);
  });

  it('working crop covers the mask, respects min size and image bounds', () => {
    const c = workingCrop({ x: 950, y: 10, w: 40, h: 20 }, 1000, 800, 64, 512);
    expect(c).toEqual({ x: 488, y: 0, w: 512, h: 512 });
    const small = workingCrop({ x: 10, y: 10, w: 5, h: 5 }, 100, 60);
    expect(small).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  });
});

describe('metadata inspector', () => {
  const chunk = (type: string, len = 0) => {
    const b = new Uint8Array(12 + len);
    new DataView(b.buffer).setUint32(0, len);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    return b;
  };
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('flags PNG text/exif chunks and passes a clean PNG', () => {
    const dirty = concat(sig, chunk('IHDR', 13), chunk('tEXt', 5), chunk('eXIf', 4), chunk('IDAT', 3), chunk('IEND'));
    expect(inspectMetadata(dirty).metadataBlocks).toEqual(['tEXt', 'eXIf']);
    const clean = concat(sig, chunk('IHDR', 13), chunk('IDAT', 3), chunk('IEND'));
    expect(inspectMetadata(clean)).toMatchObject({ format: 'png', metadataBlocks: [] });
  });

  it('flags JPEG EXIF APP1 and comments but not JFIF', () => {
    const seg = (marker: number, payload: string) => {
      const body = new TextEncoder().encode(payload);
      const len = body.length + 2;
      return new Uint8Array([0xff, marker, len >> 8, len & 255, ...body]);
    };
    const jpeg = concat(
      new Uint8Array([0xff, 0xd8]),
      seg(0xe0, 'JFIF\0xxxxxxxxx'),
      seg(0xe1, 'Exif\0\0yyyy'),
      seg(0xfe, 'hello'),
      new Uint8Array([0xff, 0xda, 0, 2]),
    );
    const r = inspectMetadata(jpeg);
    expect(r.format).toBe('jpeg');
    expect(r.metadataBlocks).toEqual(['APP1:Exif', 'COM']);
  });
});

describe('privacy filter', () => {
  it.each([
    ['221B Baker St', 'address'],
    ['1600 Pennsylvania Avenue NW', 'address'],
    ['Maple Street', 'address'],
    ['jane.doe@example.com', 'email'],
    ['(605) 555-0142', 'phone'],
    ['+1 605 555 0142', 'phone'],
    ['Room 204', 'room_or_id_number'],
    ['Classroom 118B', 'room_or_id_number'],
    ['7ABC123', 'plate'],
    ['ABC-1234', 'plate'],
    ['57069', 'address'],
    ['118', 'room_or_id_number'],
    ['STOP', 'other_text'],
    ['Welcome', 'other_text'],
  ])('%s -> %s', (text, cat) => {
    expect(classifyText(text).category).toBe(cat);
  });
});

describe('hashing', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('mask hash depends on dimensions as well as bits', async () => {
    const a = await maskSha256({ width: 2, height: 2, data: new Uint8Array(4) });
    const b = await maskSha256({ width: 4, height: 1, data: new Uint8Array(4) });
    expect(a).not.toBe(b);
  });
});
