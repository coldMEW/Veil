import type { Point } from '../../contracts';
import { dilate, emptyMask, type Mask, type Pixels } from './mask';

/**
 * Glyph-level text mask. Instead of erasing a whole box (large holes inpaint badly), mark only the
 * pixels inside `polygon` that differ from the region's dominant background colour, then dilate to
 * cover anti-aliased edges. Typical use: white/black text on a sign, label or plate. The inpainter
 * then fills thin strokes from the surrounding background, which looks natural.
 */

/** Even-odd point-in-polygon in pixel coordinates. */
export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Rasterize a normalized polygon into a mask. */
export function polygonMask(poly: Point[], width: number, height: number): Mask {
  const m = emptyMask(width, height);
  const px = poly.map((p) => ({ x: p.x * width, y: p.y * height }));
  const ys = px.map((p) => p.y);
  const xs = px.map((p) => p.x);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (pointInPolygon(x + 0.5, y + 0.5, px)) m.data[y * width + x] = 1;
  return m;
}

const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1]! : 0;
};

export interface GlyphMaskOptions {
  /** RGB distance from the background colour that counts as foreground text (0..441). */
  threshold?: number;
  /** Dilation radius in pixels to cover anti-aliasing and halos. */
  dilatePx?: number;
  /**
   * Text polarity relative to the background. 'auto' keeps only the majority side (lighter or darker),
   * so shadows/creases (darker) are not mistaken for white text, and vice versa.
   */
  polarity?: 'auto' | 'lighter' | 'darker' | 'any';
}

export interface GlyphMaskResult {
  mask: Mask;
  background: [number, number, number];
  /** Fraction of the polygon marked as text. Very high values mean the region isn't text-on-background. */
  coverage: number;
}

export function glyphMask(src: Pixels, poly: Point[], opts: GlyphMaskOptions = {}): GlyphMaskResult {
  const threshold = opts.threshold ?? 70;
  const region = polygonMask(poly, src.width, src.height);
  const r: number[] = [],
    g: number[] = [],
    b: number[] = [];
  let area = 0;
  for (let i = 0; i < region.data.length; i++)
    if (region.data[i]) {
      area++;
      if (area % 3 === 0) {
        r.push(src.data[i * 4]!);
        g.push(src.data[i * 4 + 1]!);
        b.push(src.data[i * 4 + 2]!);
      }
    }
  const bg: [number, number, number] = [median(r), median(g), median(b)];
  const fg = emptyMask(src.width, src.height);
  const t2 = threshold * threshold;
  const bgLum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  // 1 = lighter outlier, 2 = darker outlier
  const side = new Uint8Array(region.data.length);
  let lighter = 0,
    darker = 0;
  for (let i = 0; i < region.data.length; i++) {
    if (!region.data[i]) continue;
    const dr = src.data[i * 4]! - bg[0];
    const dg = src.data[i * 4 + 1]! - bg[1];
    const db = src.data[i * 4 + 2]! - bg[2];
    if (dr * dr + dg * dg + db * db > t2) {
      const lum = 0.299 * src.data[i * 4]! + 0.587 * src.data[i * 4 + 1]! + 0.114 * src.data[i * 4 + 2]!;
      if (lum >= bgLum) {
        side[i] = 1;
        lighter++;
      } else {
        side[i] = 2;
        darker++;
      }
    }
  }
  const pol = opts.polarity ?? 'auto';
  const keep = pol === 'any' ? 3 : pol === 'lighter' ? 1 : pol === 'darker' ? 2 : lighter >= darker ? 1 : 2;
  let marked = 0;
  for (let i = 0; i < side.length; i++)
    if (side[i] && (keep === 3 || side[i] === keep)) {
      fg.data[i] = 1;
      marked++;
    }
  return { mask: dilate(fg, opts.dilatePx ?? 4), background: bg, coverage: area ? marked / area : 0 };
}
