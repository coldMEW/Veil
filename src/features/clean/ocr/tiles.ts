import type { Detection, PixelRect } from './types';
import { clipRect } from './image';

export function createTiles(width: number, height: number, tileSize = 960, overlap = 128): PixelRect[] {
  if (
    ![width, height, tileSize, overlap].every(Number.isInteger) ||
    width <= 0 ||
    height <= 0 ||
    tileSize < 32 ||
    overlap < 0 ||
    overlap >= tileSize
  )
    throw new Error('Invalid OCR tile dimensions or overlap.');
  const starts = (length: number) => {
    const positions = [0];
    while (positions[positions.length - 1]! + tileSize < length) {
      positions.push(Math.min(positions[positions.length - 1]! + tileSize - overlap, length - tileSize));
    }
    return positions;
  };
  return starts(height).flatMap((y) =>
    starts(width).map((x) => ({ x, y, w: Math.min(tileSize, width), h: Math.min(tileSize, height) })),
  );
}

export function mapToOriginal(box: PixelRect, tile: PixelRect, width: number, height: number) {
  const local = clipRect(box, tile.w, tile.h);
  const pixelRect = clipRect({ ...local, x: local.x + tile.x, y: local.y + tile.y }, width, height);
  return {
    pixelRect,
    rect: {
      x: pixelRect.x / width,
      y: pixelRect.y / height,
      w: pixelRect.w / width,
      h: pixelRect.h / height,
    },
  };
}

export function intersectionOverUnion(a: PixelRect, b: PixelRect): number {
  const intersection =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Score-ordered NMS across both tile and whole-image passes. */
export function mergeDetections<T extends Pick<Detection, 'pixelRect' | 'detScore'>>(
  boxes: T[],
  threshold = 0.5,
  rank: (box: T) => number = (box) => box.detScore,
): T[] {
  const kept: T[] = [];
  for (const box of [...boxes].sort((a, b) => rank(b) - rank(a))) {
    if (!kept.some((other) => intersectionOverUnion(box.pixelRect, other.pixelRect) > threshold))
      kept.push(box);
  }
  return kept;
}
