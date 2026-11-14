// Model input geometry for CommunityForensics ViT-S, matching the pinned
// preprocessor_config.json: resize shortest edge to 440 (floor the long edge,
// as transformers and the model card do), then center-crop 384 x 384.

export const SHORTEST_EDGE = 440;
export const CROP = 384;
export const MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
export const STD = [0.26862954, 0.26130258, 0.27577711] as const;

export interface CropGeometry {
  /** Size after the shortest-edge resize. */
  resizedWidth: number;
  resizedHeight: number;
  /** Crop origin in resized pixels. */
  left: number;
  top: number;
  /** The crop expressed in original (orientation-corrected) image pixels. */
  source: { x: number; y: number; width: number; height: number };
}

export function cropGeometry(width: number, height: number): CropGeometry {
  if (!(width > 0 && height > 0)) throw new Error('Image size must be positive');
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const newLong = Math.floor((SHORTEST_EDGE * long) / short);
  const resizedWidth = width <= height ? SHORTEST_EDGE : newLong;
  const resizedHeight = width <= height ? newLong : SHORTEST_EDGE;
  const left = Math.floor((resizedWidth - CROP) / 2);
  const top = Math.floor((resizedHeight - CROP) / 2);
  const sx = width / resizedWidth;
  const sy = height / resizedHeight;
  return {
    resizedWidth,
    resizedHeight,
    left,
    top,
    source: { x: left * sx, y: top * sy, width: CROP * sx, height: CROP * sy },
  };
}

/** Pillow's bicubic kernel (a = -0.5). */
function bicubic(x: number): number {
  const a = -0.5;
  const t = Math.abs(x);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}

/** Per output index: first input index and normalized weights, as Pillow computes them. */
function coefficients(inSize: number, outSize: number) {
  const scale = inSize / outSize;
  const filterScale = Math.max(scale, 1);
  const support = 2 * filterScale;
  const starts = new Int32Array(outSize);
  const weights: Float64Array[] = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize);
    const k = new Float64Array(xmax - xmin);
    let sum = 0;
    for (let x = 0; x < k.length; x++) {
      const w = bicubic((x + xmin - center + 0.5) / filterScale);
      k[x] = w;
      sum += w;
    }
    if (sum !== 0) for (let x = 0; x < k.length; x++) k[x] = (k[x] ?? 0) / sum;
    starts[xx] = xmin;
    weights.push(k);
  }
  return { starts, weights };
}

const clamp8 = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/**
 * Antialiased bicubic resize of RGBA pixels, matching Pillow's
 * `Image.resize(..., BICUBIC)` (horizontal pass, 8-bit round, vertical pass),
 * which is how the model card preprocesses. Alpha is set to 255.
 */
export function resizeBicubic(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const h = coefficients(sw, dw);
  const mid = new Uint8ClampedArray(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let xx = 0; xx < dw; xx++) {
      const k = h.weights[xx]!;
      const x0 = h.starts[xx]!;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < k.length; i++) {
        const p = row + (x0 + i) * 4;
        const w = k[i]!;
        r += src[p]! * w;
        g += src[p + 1]! * w;
        b += src[p + 2]! * w;
      }
      const o = (y * dw + xx) * 4;
      mid[o] = clamp8(r);
      mid[o + 1] = clamp8(g);
      mid[o + 2] = clamp8(b);
    }
  }
  const v = coefficients(sh, dh);
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let yy = 0; yy < dh; yy++) {
    const k = v.weights[yy]!;
    const y0 = v.starts[yy]!;
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < k.length; i++) {
        const p = ((y0 + i) * dw + x) * 4;
        const w = k[i]!;
        r += mid[p]! * w;
        g += mid[p + 1]! * w;
        b += mid[p + 2]! * w;
      }
      const o = (yy * dw + x) * 4;
      out[o] = clamp8(r);
      out[o + 1] = clamp8(g);
      out[o + 2] = clamp8(b);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Cut the 384 x 384 crop out of resized RGBA pixels. */
export function cropRgba(src: Uint8ClampedArray, width: number, left: number, top: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CROP * CROP * 4);
  for (let y = 0; y < CROP; y++) {
    const from = ((top + y) * width + left) * 4;
    out.set(src.subarray(from, from + CROP * 4), y * CROP * 4);
  }
  return out;
}

/** RGBA pixels of the 384 x 384 crop to a CLIP-normalized CHW float tensor. */
export function toChw(rgba: Uint8ClampedArray, out = new Float32Array(3 * CROP * CROP)): Float32Array {
  const plane = CROP * CROP;
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = ((rgba[p] ?? 0) / 255 - MEAN[0]) / STD[0];
    out[plane + i] = ((rgba[p + 1] ?? 0) / 255 - MEAN[1]) / STD[1];
    out[2 * plane + i] = ((rgba[p + 2] ?? 0) / 255 - MEAN[2]) / STD[2];
  }
  return out;
}

/**
 * Copy of `base` with one grid cell set to 0 in every channel, which after
 * normalization is the dataset mean color (a neutral occluder).
 */
export function occlude(base: Float32Array, grid: number, cell: number, out: Float32Array): Float32Array {
  out.set(base);
  const size = CROP / grid;
  const row = Math.floor(cell / grid);
  const col = cell % grid;
  const y0 = Math.round(row * size);
  const y1 = Math.round((row + 1) * size);
  const x0 = Math.round(col * size);
  const x1 = Math.round((col + 1) * size);
  const plane = CROP * CROP;
  for (let c = 0; c < 3; c++) {
    for (let y = y0; y < y1; y++) {
      out.fill(0, c * plane + y * CROP + x0, c * plane + y * CROP + x1);
    }
  }
  return out;
}

/** Scale absolute changes to 0..1 for display. All zeros stay zero. */
export function normalizeMagnitudes(deltas: ArrayLike<number>): Float32Array {
  let max = 0;
  for (let i = 0; i < deltas.length; i++) max = Math.max(max, Math.abs(deltas[i] ?? 0));
  const out = new Float32Array(deltas.length);
  if (max === 0 || !Number.isFinite(max)) return out;
  for (let i = 0; i < deltas.length; i++) out[i] = Math.abs(deltas[i] ?? 0) / max;
  return out;
}
