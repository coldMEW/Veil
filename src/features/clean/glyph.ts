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

/** About a third of the shorter side of the text quad, in pixels: a window a little over half the text height across. */
function defaultRadius(poly: Point[], width: number, height: number): number {
  if (poly.length < 4) return 24;
  const len = (a: Point, b: Point) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  const short = Math.min(len(poly[0]!, poly[1]!), len(poly[1]!, poly[2]!));
  return Math.max(6, Math.min(140, Math.round(short * 0.3)));
}

/**
 * Keep only marked pixels whose brightness stands out from the mean of the window around them, in the
 * text's direction (lighter or darker). The threshold scales with how strong the text is in this region.
 * Works on the region's bounding box only. Returns how many pixels stay marked.
 */
function keepLocalContrast(src: Pixels, region: Mask, fg: Mask, sign: 1 | -1, radius: number): number {
  const w = src.width;
  let x0 = w, y0 = src.height, x1 = -1, y1 = -1;
  for (let i = 0; i < region.data.length; i++)
    if (region.data[i]) {
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return 0;
  // Pad by the radius so windows at the edge of the region see real pixels.
  x0 = Math.max(0, x0 - radius); y0 = Math.max(0, y0 - radius);
  x1 = Math.min(w - 1, x1 + radius); y1 = Math.min(src.height - 1, y1 + radius);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const lum = new Float32Array(bw * bh);
  const integral = new Float64Array((bw + 1) * (bh + 1));
  for (let y = 0; y < bh; y++) {
    let row = 0;
    for (let x = 0; x < bw; x++) {
      const k = ((y + y0) * w + x + x0) * 4;
      const l = 0.299 * src.data[k]! + 0.587 * src.data[k + 1]! + 0.114 * src.data[k + 2]!;
      lum[y * bw + x] = l;
      row += l;
      integral[(y + 1) * (bw + 1) + x + 1] = integral[y * (bw + 1) + x + 1]! + row;
    }
  }
  const contrast = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0;
      if (!region.data[i]) continue;
      const ax = Math.max(0, x - radius), ay = Math.max(0, y - radius), bx = Math.min(bw, x + radius + 1), by = Math.min(bh, y + radius + 1);
      const sum = integral[by * (bw + 1) + bx]! - integral[ay * (bw + 1) + bx]! - integral[by * (bw + 1) + ax]! + integral[ay * (bw + 1) + ax]!;
      const c = (lum[y * bw + x]! - sum / ((bx - ax) * (by - ay))) * sign;
      contrast[y * bw + x] = c;
    }
  // How far a typical marked pixel rises above its surroundings; letters must reach half of that. (The
  // strongest contrast in the box is often sky against the plate, which would set the bar too high.)
  const typical: number[] = [];
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) if (fg.data[(y + y0) * w + x + x0] && contrast[y * bw + x]! > 14) typical.push(contrast[y * bw + x]!);
  typical.sort((a, b) => a - b);
  const need = Math.max(14, (typical.length ? typical[typical.length >> 1]! : 0) * 0.5);
  let kept = 0;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0;
      if (!fg.data[i]) continue;
      if (contrast[y * bw + x]! >= need) kept++;
      else fg.data[i] = 0;
    }
  return kept;
}

/**
 * Remove connected pieces that are not letters:
 * - long and thin compared with the text height (the bright edge of a plate, a wire);
 * - on a coloured sign plate, pieces that are not surrounded by plate colour (sky or a pole showing at
 *   the corners of a tilted text box). A letter on a plate has plate all around it.
 * Returns how many pixels were removed.
 */
function dropNonLetters(src: Pixels, fg: Mask, region: Mask, textHeight: number, colouredPlate: boolean): number {
  const w = fg.width;
  const seen = new Uint8Array(fg.data.length);
  let removed = 0;
  for (let start = 0; start < fg.data.length; start++) {
    if (!fg.data[start] || seen[start] || !region.data[start]) continue;
    const piece: number[] = [];
    const todo = [start];
    seen[start] = 1;
    let x0 = w, x1 = -1, y0 = Infinity, y1 = -1;
    while (todo.length) {
      const i = todo.pop()!;
      piece.push(i);
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= fg.height) continue;
          const n = ny * w + nx;
          if (fg.data[n] && !seen[n]) {
            seen[n] = 1;
            todo.push(n);
          }
        }
    }
    const long = Math.hypot(x1 - x0 + 1, y1 - y0 + 1);
    // Mean thickness of the piece if it were one stroke of that length.
    const thickness = piece.length / long;
    let drop = long > textHeight * 1.25 && thickness < textHeight * 0.09;
    if (!drop && colouredPlate) {
      // Look a few pixels outside the piece in eight directions and count how much of that is coloured.
      const reach = Math.max(4, Math.round(textHeight * 0.06));
      let around = 0, coloured = 0;
      for (let k = 0; k < piece.length; k += 3) {
        const i = piece[k]!;
        const x = i % w, y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx * reach, ny = y + dy * reach;
            if (nx < 0 || nx >= w || ny < 0 || ny >= fg.height) continue;
            const n = ny * w + nx;
            if (fg.data[n]) continue;
            const R = src.data[n * 4]!, G = src.data[n * 4 + 1]!, B = src.data[n * 4 + 2]!;
            const hi = Math.max(R, G, B);
            around++;
            if (hi > 0 && (hi - Math.min(R, G, B)) / hi >= 0.3) coloured++;
          }
      }
      drop = around > 0 && coloured / around < 0.6;
    }
    if (drop) {
      for (const i of piece) fg.data[i] = 0;
      removed += piece.length;
    }
  }
  return removed;
}

export interface GlyphMaskOptions {
  /** Radius in pixels of the window used for the local-contrast double check. Default: half the text height. */
  localRadius?: number;
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

function glyphMaskIn(src: Pixels, poly: Point[], opts: GlyphMaskOptions = {}): GlyphMaskResult {
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
  // On a coloured sign plate, text is close to colourless (white or black) while the plate stays coloured
  // however its brightness varies with reflections and shade. Coloured outliers are plate, not text.
  const bgHi = Math.max(...bg), bgSat = bgHi > 0 ? (bgHi - Math.min(...bg)) / bgHi : 0;
  const plate = bgSat >= 0.3;
  // 1 = lighter outlier, 2 = darker outlier
  const side = new Uint8Array(region.data.length);
  let lighter = 0,
    darker = 0;
  for (let i = 0; i < region.data.length; i++) {
    if (!region.data[i]) continue;
    const R = src.data[i * 4]!, G = src.data[i * 4 + 1]!, B = src.data[i * 4 + 2]!;
    const dr = R - bg[0];
    const dg = G - bg[1];
    const db = B - bg[2];
    if (dr * dr + dg * dg + db * db > t2) {
      if (plate) {
        const hi = Math.max(R, G, B);
        // Very dark pixels have no meaningful colour; otherwise compare with the plate's own saturation.
        if (hi >= 70 && (hi - Math.min(R, G, B)) / hi >= bgSat * 0.72) continue;
      }
      const lum = 0.299 * R + 0.587 * G + 0.114 * B;
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
  // A plate with a reflection, a shadow or a colour gradient differs from its own median colour over large
  // areas, so the test above can mark most of the plate and the whole sign is then repainted (seen on a
  // real street sign: the plate lost its shape). Letters are different: they stand out from what is
  // immediately around them, so only pixels that also contrast with their local surroundings are kept.
  const radius = opts.localRadius ?? defaultRadius(poly, src.width, src.height);  if (keep !== 3 && area > 0) {
    marked = keepLocalContrast(src, region, fg, keep === 1 ? 1 : -1, radius);
    marked -= dropNonLetters(src, fg, region, radius / 0.3, plate);
  }
  return { mask: dilate(fg, opts.dilatePx ?? 4), background: bg, coverage: area ? marked / area : 0 };
}

/**
 * Glyph mask for one text quad. All the pixel work happens on a crop around the quad, never on the whole
 * photo: on a 9-megapixel phone picture that keeps the screen responsive while the mask is built.
 */
export function glyphMask(src: Pixels, poly: Point[], opts: GlyphMaskOptions = {}): GlyphMaskResult {
  const xs = poly.map((p) => p.x * src.width), ys = poly.map((p) => p.y * src.height);
  const pad = (opts.localRadius ?? defaultRadius(poly, src.width, src.height)) + (opts.dilatePx ?? 4) + 8;
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad), y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const x1 = Math.min(src.width - 1, Math.ceil(Math.max(...xs)) + pad), y1 = Math.min(src.height - 1, Math.ceil(Math.max(...ys)) + pad);
  const out = emptyMask(src.width, src.height);
  if (x1 < x0 || y1 < y0) return { mask: out, background: [0, 0, 0], coverage: 0 };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) data.set(src.data.subarray(((y + y0) * src.width + x0) * 4, ((y + y0) * src.width + x0 + cw) * 4), y * cw * 4);
  const local = poly.map((p) => ({ x: (p.x * src.width - x0) / cw, y: (p.y * src.height - y0) / ch }));
  // The window size is measured in pixels of the full photo, so pass it on unchanged.
  const r = glyphMaskIn({ width: cw, height: ch, data }, local, { ...opts, localRadius: opts.localRadius ?? defaultRadius(poly, src.width, src.height) });
  for (let y = 0; y < ch; y++) out.data.set(r.mask.data.subarray(y * cw, (y + 1) * cw), (y + y0) * src.width + x0);
  return { mask: out, background: r.background, coverage: r.coverage };
}