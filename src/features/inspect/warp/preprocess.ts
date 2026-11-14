import { resizeBicubic } from '../model/preprocess';
import type { FaceBox, FaceRect } from './warpTypes';

export const SHORTEST_EDGE = 400;
// Flip to true to compare with the original full-frame readback and JS crop.
// Both paths use Pillow-style JS bicubic; the default bitmap operation crops only.
export const EXACT_RESIZE: boolean = false;
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;
// Chosen on 3 images, all with the widened crop: upstream Liquify example max
// 8.76 px, upstream original max 2.25 px, unedited team selfie max 3.41 px.
// Display thresholds in model-scale pixels, not calibrated probabilities.
export const LOW = 2.5;
export const HIGH = 4.5;

function imageSize(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive integers.');
  }
}

/** The user's box already includes the upstream head margin; do not expand it again. */
export function faceRectFromBox(width: number, height: number, face: FaceBox): FaceRect {
  imageSize(width, height);
  const { x, y, w, h } = face;
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
      x + w > 1 + 1e-9 || y + h > 1 + 1e-9) {
    throw new Error('Select a nonempty face box inside the image.');
  }
  // Round outward so the selected head region is fully covered, clamped to the image.
  const left = Math.min(width - 1, Math.floor(x * width));
  const top = Math.min(height - 1, Math.floor(y * height));
  const right = Math.min(width, Math.ceil((x + w) * width));
  const bottom = Math.min(height, Math.ceil((y + h) * height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function resizeGeometry(width: number, height: number) {
  imageSize(width, height);
  // utils/tools.py resize_shorter_side floors the long side (PIL integer geometry).
  const long = Math.floor(SHORTEST_EDGE * Math.max(width, height) / Math.min(width, height));
  return width <= height ? { width: SHORTEST_EDGE, height: long } : { width: long, height: SHORTEST_EDGE };
}

export function cropFaceRgba(rgba: Uint8ClampedArray, width: number, height: number, face: FaceBox) {
  const faceRect = faceRectFromBox(width, height, face);
  if (rgba.length !== width * height * 4) throw new Error('RGBA data does not match the image dimensions.');
  const crop = new Uint8ClampedArray(faceRect.width * faceRect.height * 4);
  for (let y = 0; y < faceRect.height; y++) {
    const start = ((faceRect.y + y) * width + faceRect.x) * 4;
    crop.set(rgba.subarray(start, start + faceRect.width * 4), y * faceRect.width * 4);
  }
  return { rgba: crop, faceRect };
}

/** RGB/255, then ImageNet normalization, channel-first. Alpha is not a model input. */
export function toChw(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  imageSize(width, height);
  const plane = width * height;
  if (rgba.length !== plane * 4) throw new Error('RGBA data does not match the tensor dimensions.');
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) data[c * plane + i] = (rgba[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }
  return data;
}

export function preprocessFace(rgba: Uint8ClampedArray, width: number, height: number, face: FaceBox) {
  const crop = cropFaceRgba(rgba, width, height, face);
  const resized = resizeGeometry(crop.faceRect.width, crop.faceRect.height);
  const pixels = resizeBicubic(crop.rgba, crop.faceRect.width, crop.faceRect.height, resized.width, resized.height);
  return { data: toChw(pixels, resized.width, resized.height), ...resized, faceRect: crop.faceRect };
}

/** Read back only the native-size bitmap crop, then resize in JS; caller owns bitmap. */
export async function preprocessBitmap(bitmap: ImageBitmap, face: FaceBox, exact = EXACT_RESIZE) {
  const faceRect = faceRectFromBox(bitmap.width, bitmap.height, face);
  const { width, height } = resizeGeometry(faceRect.width, faceRect.height);
  let pixels: Uint8ClampedArray;
  let decodeMs = 0;
  if (exact) {
    const t0 = performance.now();
    const full = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = full.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available in this worker.');
    ctx.drawImage(bitmap, 0, 0);
    const fullPixels = ctx.getImageData(0, 0, full.width, full.height).data;
    pixels = cropFaceRgba(fullPixels, full.width, full.height, face).rgba;
    decodeMs = performance.now() - t0;
  } else {
    const t0 = performance.now();
    const cropped = await createImageBitmap(bitmap, faceRect.x, faceRect.y, faceRect.width, faceRect.height);
    try {
      const canvas = new OffscreenCanvas(faceRect.width, faceRect.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas is not available in this worker.');
      ctx.drawImage(cropped, 0, 0);
      pixels = ctx.getImageData(0, 0, faceRect.width, faceRect.height).data;
      decodeMs = performance.now() - t0;
    } finally {
      cropped.close();
    }
  }
  const resizeStart = performance.now();
  const rgba = resizeBicubic(pixels, faceRect.width, faceRect.height, width, height);
  const resizeMs = performance.now() - resizeStart;
  const t0 = performance.now();
  const data = toChw(rgba, width, height);
  const normalizeMs = performance.now() - t0;
  return { data, width, height, faceRect, decodeMs, resizeMs, normalizeMs };
}

/** Read dimensions from the returned flow tensor, never from the input resize. */
export function flowMagnitude(flow: Float32Array, dims: readonly number[]) {
  if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 2) throw new Error('Expected flow float32 [1,2,H,W].');
  const height = dims[2]!;
  const width = dims[3]!;
  imageSize(width, height);
  const plane = width * height;
  if (flow.length !== 2 * plane) throw new Error('Flow data does not match the output dimensions.');
  const magnitude = new Float32Array(plane);
  let maxMagnitude = 0;
  let sum = 0;
  for (let i = 0; i < plane; i++) {
    const value = Math.hypot(flow[i]!, flow[plane + i]!);
    magnitude[i] = value;
    if (!Number.isFinite(magnitude[i])) throw new Error('The model produced a non-finite output.');
    maxMagnitude = Math.max(maxMagnitude, magnitude[i]!);
    sum += magnitude[i]!;
  }
  return { magnitude, width, height, maxMagnitude, meanMagnitude: sum / plane };
}

/** Output pixel centers mapped onto the source face box, independently along each axis. */
export function warpPointToSource(x: number, y: number, width: number, height: number, rect: FaceRect) {
  return { x: rect.x + (x + 0.5) * rect.width / width, y: rect.y + (y + 0.5) * rect.height / height };
}

export function toWarpOverlay(magnitude: Float32Array, width: number, height: number): Uint8ClampedArray {
  imageSize(width, height);
  if (magnitude.length !== width * height) throw new Error('Magnitude data does not match the overlay dimensions.');
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < magnitude.length; i++) {
    const value = magnitude[i]!;
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid predicted warp magnitude.');
    if (value < LOW) continue;
    const t = Math.min(1, (value - LOW) / (HIGH - LOW));
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = Math.round(220 * (1 - t));
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 180;
  }
  return rgba;
}
