import type { Pixels, Mask } from '../../features/clean/mask';
import { createTiles } from '../../features/clean/ocr/tiles';
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Two-pixel inner feather: never changes a pixel outside the approved binary mask. */
export function innerFeatherWeight(mask: Mask, x: number, y: number, radius = 2): number {
  if (!mask.data[y * mask.width + x]) return 0;
  let distance = radius + 1;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx,
        yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < mask.width && yy < mask.height && !mask.data[yy * mask.width + xx])
        distance = Math.min(distance, Math.max(Math.abs(dx), Math.abs(dy)));
    }
  return Math.min(1, distance / (radius + 1));
}
/** Native-scale overlapping inference tiles, blended by context weights, then feathered inside the mask. */
export async function inpaintTiled(
  src: Pixels,
  mask: Mask,
  crop: Crop,
  predict: (tile: Pixels, mask: Mask) => Promise<Pixels>,
  tileSide = 512,
): Promise<Pixels> {
  if (
    src.width !== mask.width ||
    src.height !== mask.height ||
    !Number.isInteger(tileSide) ||
    tileSide < 64 ||
    tileSide > 512
  )
    throw Error('Invalid inpaint tile dimensions.');
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > src.width || crop.y + crop.h > src.height)
    throw Error('Inpaint crop outside image.');
  const overlap = Math.min(128, Math.floor(tileSide / 4)),
    tiles = createTiles(crop.w, crop.h, tileSide, overlap),
    out = new Uint8ClampedArray(src.data),
    weights = new Uint16Array(src.width * src.height);
  let used = 0;
  for (const local of tiles) {
    const x0 = crop.x + local.x,
      y0 = crop.y + local.y,
      w = local.w,
      h = local.h;
    let hit = false;
    for (let y = 0; y < h && !hit; y++)
      for (let x = 0; x < w; x++)
        if (mask.data[(y + y0) * src.width + x + x0]) {
          hit = true;
          break;
        }
    if (!hit) continue;
    if (++used > 256) throw Error('Inpaint exceeds native tile budget.');
    const data = new Uint8ClampedArray(w * h * 4),
      m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      data.set(
        src.data.subarray(((y + y0) * src.width + x0) * 4, ((y + y0) * src.width + x0 + w) * 4),
        y * w * 4,
      );
      m.set(mask.data.subarray((y + y0) * src.width + x0, (y + y0) * src.width + x0 + w), y * w);
    }
    const result = await predict({ width: w, height: h, data }, { width: w, height: h, data: m });
    if (result.width !== w || result.height !== h || result.data.length !== w * h * 4)
      throw Error('Invalid inpaint tile output.');
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const gi = (y + y0) * src.width + x + x0;
        if (!mask.data[gi]) continue;
        const weight = Math.max(
            1,
            Math.round(256 * Math.min(1, (x + 1) / 64, (w - x) / 64, (y + 1) / 64, (h - y) / 64)),
          ),
          old = weights[gi]!,
          total = old + weight;
        for (let c = 0; c < 3; c++)
          out[4 * gi + c] = Math.round(
            (out[4 * gi + c]! * old + result.data[4 * (y * w + x) + c]! * weight) / total,
          );
        weights[gi] = total;
      }
  }
  for (let y = crop.y; y < crop.y + crop.h; y++)
    for (let x = crop.x; x < crop.x + crop.w; x++) {
      const i = y * src.width + x;
      if (!mask.data[i]) continue;
      const alpha = innerFeatherWeight(mask, x, y);
      for (let c = 0; c < 3; c++)
        out[4 * i + c] = Math.round(src.data[4 * i + c]! * (1 - alpha) + out[4 * i + c]! * alpha);
    }
  return { width: src.width, height: src.height, data: out };
}
