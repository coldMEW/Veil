// Mapping between image pixels (orientation-corrected) and the on-screen view.
// Shared by every overlay and annotation tool so zoom and device pixel ratio
// never leak into stored coordinates.

export interface Fit {
  scale: number; // view pixels per image pixel
  offsetX: number;
  offsetY: number;
  width: number; // drawn image size in view pixels
  height: number;
}

/** Contain the image inside the view, centered, never upscaled past 1:1 when `allowUpscale` is false. */
export function containFit(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
  allowUpscale = true,
): Fit {
  if (imageWidth <= 0 || imageHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
    return { scale: 0, offsetX: 0, offsetY: 0, width: 0, height: 0 };
  }
  let scale = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
  if (!allowUpscale) scale = Math.min(scale, 1);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { scale, offsetX: (viewWidth - width) / 2, offsetY: (viewHeight - height) / 2, width, height };
}

export function imageToView(fit: Fit, x: number, y: number): { x: number; y: number } {
  return { x: fit.offsetX + x * fit.scale, y: fit.offsetY + y * fit.scale };
}

/** Returns null when the view point is outside the drawn image. */
export function viewToImage(
  fit: Fit,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (fit.scale === 0) return null;
  const ix = (x - fit.offsetX) / fit.scale;
  const iy = (y - fit.offsetY) / fit.scale;
  if (ix < 0 || iy < 0 || ix > imageWidth || iy > imageHeight) return null;
  return { x: ix, y: iy };
}

/** Image pixels to the normalized 0..1 frame used by CheckResult overlays. */
export function normalize(x: number, y: number, imageWidth: number, imageHeight: number) {
  return { x: x / imageWidth, y: y / imageHeight };
}
