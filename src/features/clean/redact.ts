import type { Mask, Pixels } from './mask';

export type RGB = [number, number, number];

function assertSameSize(p: { width: number; height: number }, m: { width: number; height: number }) {
  if (p.width !== m.width || p.height !== m.height)
    throw new Error(`size mismatch: image ${p.width}x${p.height} vs mask ${m.width}x${m.height}`);
}

/**
 * Solid opaque redaction: every masked pixel becomes `color` with alpha 255.
 * Returns a NEW buffer; the original is never mutated. Unmasked pixels are byte-identical.
 */
export function solidRedact(src: Pixels, mask: Mask, color: RGB = [0, 0, 0]): Pixels {
  assertSameSize(src, mask);
  const out = new Uint8ClampedArray(src.data);
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    const o = i * 4;
    out[o] = color[0];
    out[o + 1] = color[1];
    out[o + 2] = color[2];
    out[o + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}

/**
 * Composite an inpainted crop back into the original.
 * Only pixels where mask=1 inside `crop` are taken from `inpainted`; everything else is
 * copied from `src` unchanged. `inpainted` must be exactly crop.w x crop.h.
 */
export function compositeCrop(
  src: Pixels,
  inpainted: Pixels,
  crop: { x: number; y: number; w: number; h: number },
  mask: Mask,
): Pixels {
  assertSameSize(src, mask);
  if (inpainted.width !== crop.w || inpainted.height !== crop.h)
    throw new Error(`inpainted crop is ${inpainted.width}x${inpainted.height}, expected ${crop.w}x${crop.h}`);
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > src.width || crop.y + crop.h > src.height)
    throw new Error('crop out of bounds');
  const out = new Uint8ClampedArray(src.data);
  for (let cy = 0; cy < crop.h; cy++) {
    for (let cx = 0; cx < crop.w; cx++) {
      const gi = (crop.y + cy) * src.width + (crop.x + cx);
      if (!mask.data[gi]) continue;
      const si = (cy * crop.w + cx) * 4;
      const o = gi * 4;
      out[o] = inpainted.data[si]!;
      out[o + 1] = inpainted.data[si + 1]!;
      out[o + 2] = inpainted.data[si + 2]!;
      out[o + 3] = 255;
    }
  }
  return { width: src.width, height: src.height, data: out };
}

/** Count of differing pixels outside the mask (must be 0 after a correct removal). */
export function changedOutsideMask(a: Pixels, b: Pixels, mask: Mask): number {
  assertSameSize(a, mask);
  assertSameSize(b, mask);
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]) continue;
    const o = i * 4;
    if (
      a.data[o] !== b.data[o] ||
      a.data[o + 1] !== b.data[o + 1] ||
      a.data[o + 2] !== b.data[o + 2] ||
      a.data[o + 3] !== b.data[o + 3]
    )
      n++;
  }
  return n;
}

/**
 * Working crop around mask bounds with `pad` context pixels, at least `minSize`
 * (model input, e.g. 512) per side where the image allows, clamped to the image.
 */
export function workingCrop(
  bounds: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
  pad = 64,
  minSize = 512,
) {
  const w = Math.min(imgW, Math.max(minSize, bounds.w + 2 * pad));
  const h = Math.min(imgH, Math.max(minSize, bounds.h + 2 * pad));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), imgW - w));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), imgH - h));
  return { x, y, w, h };
}
