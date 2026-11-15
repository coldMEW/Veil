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
  const { width: w, height: h } = mask;
  const out = new Uint8Array(w * h);
  if (radius <= 0) {
    out.set(mask.data);
    return { width: w, height: h, data: out };
  }
  // Work only on the part of the image the mask touches (grown by the radius). On a 9-megapixel phone
  // photo with a small mask this is hundreds of times less work than sweeping the whole frame.
  const b = maskBounds(mask);
  if (!b) return { width: w, height: h, data: out };
  const x0 = Math.max(0, b.x - radius), y0 = Math.max(0, b.y - radius);
  const x1 = Math.min(w - 1, b.x + b.w - 1 + radius), y1 = Math.min(h - 1, b.y + b.h - 1 + radius);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const tmp = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const row = (y + y0) * w + x0;
    let count = 0;
    for (let x = 0; x < Math.min(radius, bw); x++) count += mask.data[row + x]!;
    for (let x = 0; x < bw; x++) {
      const add = x + radius;
      if (add < bw) count += mask.data[row + add]!;
      const rem = x - radius - 1;
      if (rem >= 0) count -= mask.data[row + rem]!;
      tmp[y * bw + x] = count > 0 ? 1 : 0;
    }
  }
  const counts = new Uint16Array(bw);
  for (let y = 0; y < Math.min(radius, bh); y++) for (let x = 0; x < bw; x++) counts[x] = counts[x]! + tmp[y * bw + x]!;
  for (let y = 0; y < bh; y++) {
    const add = y + radius, rem = y - radius - 1;
    for (let x = 0; x < bw; x++) {
      let c = counts[x]!;
      if (add < bh) c += tmp[add * bw + x]!;
      if (rem >= 0) c -= tmp[rem * bw + x]!;
      counts[x] = c;
      if (c > 0) out[(y + y0) * w + x + x0] = 1;
    }
  }
  return { width: w, height: h, data: out };
}
/**
 * Fill enclosed holes: unmasked pixels that cannot reach the edge of the mask's bounding box (+1 px)
 * without crossing the mask become masked. Removes islands such as a glossy highlight on a sticker
 * letter that the colour test kept, which the inpainter would otherwise preserve as a visible patch.
 */
export function fillHoles(mask: Mask, maxHoleArea = Infinity): Mask {
  const { width: w, height: h } = mask;
  const b = maskBounds(mask);
  const out = { width: w, height: h, data: mask.data.slice() };
  if (!b) return out;
  const x0 = Math.max(0, b.x - 1);
  const y0 = Math.max(0, b.y - 1);
  const x1 = Math.min(w - 1, b.x + b.w);
  const y1 = Math.min(h - 1, b.y + b.h);
  const bw = x1 - x0 + 1;
  const reach = new Uint8Array(bw * (y1 - y0 + 1));
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const li = (y - y0) * bw + (x - x0);
    if (reach[li] || mask.data[y * w + x]) return;
    reach[li] = 1;
    stack.push(x, y);
  };
  for (let x = x0; x <= x1; x++) {
    push(x, y0);
    push(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    push(x0, y);
    push(x1, y);
  }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x > x0) push(x - 1, y);
    if (x < x1) push(x + 1, y);
    if (y > y0) push(x, y - 1);
    if (y < y1) push(x, y + 1);
  }
  // Each enclosed hole is filled only when it is small (`maxHoleArea` pixels at most): the inside of a letter
  // is, the gap between two letters that happen to be joined by a plate edge is not.
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const li = (y - y0) * bw + (x - x0);
      if (mask.data[y * w + x] || reach[li]) continue;
      const hole: number[] = [];
      const todo = [x, y];
      reach[li] = 1;
      while (todo.length) {
        const cy = todo.pop()!;
        const cx = todo.pop()!;
        hole.push(cy * w + cx);
        const visit = (nx: number, ny: number) => {
          if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return;
          const ni = (ny - y0) * bw + (nx - x0);
          if (reach[ni] || mask.data[ny * w + nx]) return;
          reach[ni] = 1;
          todo.push(nx, ny);
        };
        visit(cx - 1, cy); visit(cx + 1, cy); visit(cx, cy - 1); visit(cx, cy + 1);
      }
      if (hole.length <= maxHoleArea) for (const i of hole) out.data[i] = 1;
    }
  return out;
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
