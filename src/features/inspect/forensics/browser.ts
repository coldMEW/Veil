import { recompressJpeg } from './ela';
import type { PixelImage } from './grid';

/** White compositing gives transparent PNG pixels a deterministic luma. */
export function readBitmap(bitmap: ImageBitmap, width = bitmap.width, height = bitmap.height): PixelImage {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Image canvas is unavailable.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bitmap, 0, 0, width, height);
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** Worker capability failure falls back to the page, including HTML canvas encoding. */
export async function recompressOnMain(image: PixelImage): Promise<PixelImage> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height));
    try { return await recompressJpeg(bitmap); }
    catch { /* A present OffscreenCanvas can still lack JPEG encoding; try HTML canvas. */ }
    finally { bitmap.close(); }
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('JPEG canvas is unavailable.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) =>
    value?.type === 'image/jpeg' ? resolve(value) : reject(new Error('JPEG encoding is unavailable.')), 'image/jpeg', 0.9));
  const bitmap = await createImageBitmap(blob);
  try { return readBitmap(bitmap); } finally { bitmap.close(); }
}
