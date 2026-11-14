import type { CheckResult } from '../../../contracts';
import { assertGrid, assertPixels, connectedRegions, mad, makeGrid, mapOverlays, median, quantile } from './grid';
import type { AnalysisGeometry, CellGrid, PixelImage, Region } from './grid';
import { baseResult } from './results';

export interface ElaSummary {
  median: number;
  p95: number;
  max: number;
  mad: number;
  threshold: number;
  outlierCells: number[];
  outlierFraction: number;
  regions: Region[];
}

export function elaGrid(original: Uint8ClampedArray, recompressed: Uint8ClampedArray,
  width: number, height: number, cell = 16): CellGrid {
  assertPixels(original, width, height); assertPixels(recompressed, width, height);
  const grid = makeGrid(width, height, cell);
  for (let cy = 0; cy < grid.rows; cy++) for (let cx = 0; cx < grid.cols; cx++) {
    let sum = 0, count = 0;
    for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y++) {
      for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) sum += Math.abs(original[i + c]! - recompressed[i + c]!);
        count += 3;
      }
    }
    grid.values[cy * grid.cols + cx] = sum / count;
  }
  return grid;
}

export function elaSummary(grid: CellGrid): ElaSummary {
  assertGrid(grid);
  const values = Array.from(grid.values);
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new RangeError('Recompression values must be finite and nonnegative.');
  const center = median(values), deviation = mad(values, center);
  const threshold = Math.max(3 * center, center + 4 * deviation);
  const selected = values.map((v) => v > threshold);
  const outlierCells = values.flatMap((_, i) => selected[i] ? [i] : []);
  let area = 0;
  for (const i of outlierCells) area += Math.min(grid.cell, grid.width - i % grid.cols * grid.cell)
    * Math.min(grid.cell, grid.height - Math.floor(i / grid.cols) * grid.cell);
  return { median: center, p95: quantile(values, 0.95), max: values.reduce((max, v) => Math.max(max, v), 0), mad: deviation,
    threshold, outlierCells, outlierFraction: area / (grid.width * grid.height), regions: connectedRegions(grid, selected) };
}

/** Passing null is useful for a non-JPEG: no pixels need to be processed. */
export function elaCheckResult(assetId: string, mimeType: string, grid: CellGrid | null,
  geometry?: AnalysisGeometry): CheckResult {
  const result = baseResult('ela', assetId);
  result.method = 'JPEG recompression at quality 0.9; per-cell mean absolute RGB difference and robust regional outliers.';
  result.assumptions = ['The input is the original JPEG, decoded in the same orientation as the displayed image.'];
  result.limitations = ['High-contrast edges and text naturally show higher error.',
    'A photo re-saved many times flattens the map.',
    'This shows regions saved differently, not what changed or how.',
    'Resizing and JPEG encoder differences affect the map; small details can be lost at the analysis scale.'];
  result.evidence = { ...(geometry ? { geometry } : {}), quality: 0.9 };
  if (mimeType !== 'image/jpeg') {
    result.finding = 'not_applicable';
    result.reason = mimeType === 'image/png'
      ? 'Recompression analysis needs the original JPEG; this file is PNG.'
      : 'Recompression analysis needs the original JPEG.';
    result.observation = result.reason;
    return result;
  }
  if (!grid) throw new RangeError('Recompression pixels are missing.');
  const summary = elaSummary(grid);
  result.evidence = { ...result.evidence, ...summary, cols: grid.cols, rows: grid.rows, cell: grid.cell,
    analysisWidth: grid.width, analysisHeight: grid.height };
  result.overlays = mapOverlays(grid, Array.from(grid.values, (v) => summary.p95 > 0 ? Math.min(1, v / summary.p95) : 0),
    summary.regions, 'Recompression difference');
  if (summary.regions.length) {
    result.finding = 'inconsistent'; delete result.reason;
    result.observation = 'Highlighted regions have higher recompression error than the surrounding image.';
  } else {
    result.reason = 'No region stands out in this recompression map; an even map shows nothing either way.';
    result.observation = 'No region stands out in the recompression map.';
  }
  return result;
}

/** Thin browser adapter; the caller owns the source bitmap. */
export async function recompressJpeg(bitmap: ImageBitmap, quality = 0.9): Promise<PixelImage> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('JPEG canvas is unavailable.');
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  if (blob.type !== 'image/jpeg') throw new Error('JPEG encoding is unavailable.');
  const decoded = await createImageBitmap(blob);
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(decoded, 0, 0);
    return { rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  } finally { decoded.close(); }
}
