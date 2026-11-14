import type { Rect } from '../../contracts';

/** Minimal pixel buffer shape (compatible with browser ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major
}

/** Binary mask: 1 = approved for removal, 0 = keep. Row-major, one byte per pixel. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export function emptyMask(width: number, height: number): Mask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error(`invalid mask size ${width}x${height}`);
  return { width, height, data: new Uint8Array(width * height) };
}

/** Convert a normalized rect to an integer pixel rect clamped to the image, rounding outward. */
export function toPixelRect(r: Rect, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(r.x * width));
  const y0 = Math.max(0, Math.floor(r.y * height));
  const x1 = Math.min(width, Math.ceil((r.x + r.w) * width));
  const y1 = Math.min(height, Math.ceil((r.y + r.h) * height));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function fillRect(mask: Mask, r: Rect, value: 0 | 1 = 1): Mask {
  const p = toPixelRect(r, mask.width, mask.height);
  for (let y = p.y; y < p.y + p.h; y++) mask.data.fill(value, y * mask.width + p.x, y * mask.width + p.x + p.w);
  return mask;
}

export function rectsToMask(rects: Rect[], width: number, height: number): Mask {
  const m = emptyMask(width, height);
  for (const r of rects) fillRect(m, r);
  return m;
}

/** Paint a filled circle (brush stroke dab) in pixel coordinates. */
export function paintCircle(mask: Mask, cx: number, cy: number, radius: number, value: 0 | 1 = 1): Mask {
  const r2 = radius * radius;
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + radius));
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(mask.width - 1, Math.ceil(cx + radius));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) mask.data[y * mask.width + x] = value;
  return mask;
}

/**
 * Dilate the mask by `radius` pixels (square structuring element, separable, O(n)).
 * Used to cover glyph edges and anti-aliasing beyond detector boxes.
 */
export function dilate(mask: Mask, radius: number): Mask {
  if (radius <= 0) return { ...mask, data: mask.data.slice() };
  const { width: w, height: h } = mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(radius, w); x++) count += mask.data[row + x]!;
    for (let x = 0; x < w; x++) {
      const add = x + radius;
      if (add < w) count += mask.data[row + add]!;
      const rem = x - radius - 1;
      if (rem >= 0) count -= mask.data[row + rem]!;
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(radius, h); y++) count += tmp[y * w + x]!;
    for (let y = 0; y < h; y++) {
      const add = y + radius;
      if (add < h) count += tmp[add * w + x]!;
      const rem = y - radius - 1;
      if (rem >= 0) count -= tmp[rem * w + x]!;
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

export function maskArea(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) n += mask.data[i]!;
  return n;
}

/** Tight pixel bounding box of set pixels, or null for an empty mask. */
export function maskBounds(mask: Mask): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (mask.data[y * mask.width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Undo/redo history of mask snapshots. */
export class MaskHistory {
  private past: Uint8Array[] = [];
  private future: Uint8Array[] = [];
  mask: Mask;
  private limit: number;
  constructor(mask: Mask, limit = 50) {
    this.mask = mask;
    this.limit = limit;
  }
  /** Call before mutating `mask`. */
  checkpoint() {
    this.past.push(this.mask.data.slice());
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.mask.data);
    this.mask = { ...this.mask, data: prev };
    return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.mask.data);
    this.mask = { ...this.mask, data: next };
    return true;
  }
  reset() {
    this.checkpoint();
    this.mask = { ...this.mask, data: new Uint8Array(this.mask.data.length) };
  }
}
