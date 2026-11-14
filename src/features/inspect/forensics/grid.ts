import { MAX_DECODED_PIXELS } from '../../../lib/runtime/imageIntake';
import type { Overlay } from '../../../contracts';

export interface PixelImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Partial edge cells retain their true pixel area. */
export interface CellGrid {
  values: Float32Array;
  cols: number;
  rows: number;
  width: number;
  height: number;
  cell: number;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Connected selected pixels / image pixels, not bounding-box area. */
  areaFraction: number;
}

export interface AnalysisGeometry {
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  scale: number;
  scaleX: number;
  scaleY: number;
}

export function analysisGeometry(width: number, height: number): AnalysisGeometry {
  assertDimensions(width, height);
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { originalWidth: width, originalHeight: height, width: w, height: h,
    scale, scaleX: w / width, scaleY: h / height };
}

export function assertDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height > MAX_DECODED_PIXELS) throw new RangeError('Image dimensions are outside the supported bounds.');
}

export function assertPixels(rgba: Uint8ClampedArray, width: number, height: number): void {
  assertDimensions(width, height);
  if (rgba.length !== width * height * 4) throw new RangeError('Pixel buffer does not match the image dimensions.');
}

export function makeGrid(width: number, height: number, cell: number): CellGrid {
  assertDimensions(width, height);
  if (!Number.isSafeInteger(cell) || cell < 1) throw new RangeError('Cell size must be a positive integer.');
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  return { values: new Float32Array(cols * rows), cols, rows, width, height, cell };
}

export function assertGrid(grid: CellGrid): void {
  const expected = makeGrid(grid.width, grid.height, grid.cell);
  if (grid.cols !== expected.cols || grid.rows !== expected.rows || grid.values.length !== grid.cols * grid.rows) {
    throw new RangeError('Grid dimensions do not match the image.');
  }
}

export function quantile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

export const median = (values: readonly number[]) => quantile(values, 0.5);
export const mad = (values: readonly number[], center: number) => median(values.map((v) => Math.abs(v - center)));
export const luma = (rgba: Uint8ClampedArray, offset: number) =>
  0.2126 * rgba[offset]! + 0.7152 * rgba[offset + 1]! + 0.0722 * rgba[offset + 2]!;

/** Eight-connected flood fill, bounded to one visit per cell. */
export function connectedRegions(grid: CellGrid, selected: readonly boolean[]): Region[] {
  assertGrid(grid);
  if (selected.length !== grid.values.length) throw new RangeError('Cell selection does not match the grid.');
  const seen = new Uint8Array(selected.length), regions: Region[] = [];
  for (let start = 0; start < selected.length; start++) {
    if (!selected[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let minX = grid.width, minY = grid.height, maxX = 0, maxY = 0, area = 0;
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!, x = index % grid.cols, y = Math.floor(index / grid.cols);
      const left = x * grid.cell, top = y * grid.cell;
      const right = Math.min(grid.width, left + grid.cell), bottom = Math.min(grid.height, top + grid.cell);
      minX = Math.min(minX, left); minY = Math.min(minY, top);
      maxX = Math.max(maxX, right); maxY = Math.max(maxY, bottom);
      area += (right - left) * (bottom - top);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * grid.cols + nx;
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows || seen[next] || !selected[next]) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    const areaFraction = area / (grid.width * grid.height);
    if (areaFraction >= 0.005) regions.push({ x: minX / grid.width, y: minY / grid.height,
      width: (maxX - minX) / grid.width, height: (maxY - minY) / grid.height, areaFraction });
  }
  return regions;
}

export function mapOverlays(grid: CellGrid, values: number[], regions: Region[], label: string): Overlay[] {
  return [{ type: 'raster', width: grid.cols, height: grid.rows, values,
    rect: { x: 0, y: 0, width: 1, height: 1 }, label },
  ...regions.map(({ areaFraction: _area, ...box }): Overlay => ({ type: 'box', ...box, label }))];
}

export function regionName(x: number, y: number): string {
  const col = Math.min(2, Math.floor(x * 3)), row = Math.min(2, Math.floor(y * 3));
  return ['upper left', 'upper center', 'upper right', 'center left', 'center', 'center right',
    'lower left', 'lower center', 'lower right'][row * 3 + col]!;
}
