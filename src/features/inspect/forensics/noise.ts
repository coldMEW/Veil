import type { CheckResult } from '../../../contracts';
import { assertGrid, assertPixels, connectedRegions, luma, mad, makeGrid, mapOverlays, median } from './grid';
import type { AnalysisGeometry, CellGrid, Region } from './grid';
import { baseResult } from './results';

export interface NoiseSummary {
  median: number;
  mad: number;
  zScale: number;
  zScores: Float32Array;
  usableCells: number;
  usableFraction: number;
  regions: Region[];
}

/**
 * Five-point Laplacian: center minus the mean of its four axial neighbors.
 * Dividing by sqrt(1.25) preserves independent noise scale. Unlike a local
 * median this needs no neighborhood sort, keeping the phone workload linear.
 * Reflect by clamping at borders. Scene edges also contribute to this signal.
 */
export function noiseResidualGrid(rgba: Uint8ClampedArray, width: number, height: number, cell = 32): CellGrid {
  assertPixels(rgba, width, height);
  const grid = makeGrid(width, height, cell), gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = luma(rgba, i * 4);
  for (let cy = 0; cy < grid.rows; cy++) for (let cx = 0; cx < grid.cols; cx++) {
    const residuals: number[] = [];
    let sum = 0;
    for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y++) {
      for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x++) {
        const value = gray[y * width + x]!;
        const neighbors = gray[y * width + Math.max(0, x - 1)]! + gray[y * width + Math.min(width - 1, x + 1)]!
          + gray[Math.max(0, y - 1) * width + x]! + gray[Math.min(height - 1, y + 1) * width + x]!;
        residuals.push((value - neighbors / 4) / Math.sqrt(1.25)); sum += value;
      }
    }
    const mean = sum / residuals.length;
    const level = mad(residuals, median(residuals)) * 1.4826;
    grid.values[cy * grid.cols + cx] = mean < 8 || mean > 247 ? NaN : level;
  }
  // A wholly flat image supplies no reference noise. Keep zero-noise cells in
  // mixed images: a smooth patch surrounded by noise is useful evidence too.
  if (!grid.values.some((value) => Number.isFinite(value) && value > 0)) grid.values.fill(NaN);
  return grid;
}

/** Lowest noise level used before taking a log, in Laplacian units. */
const LOG_FLOOR = 0.25;

export function noiseSummary(grid: CellGrid): NoiseSummary {
  assertGrid(grid);
  if (Array.from(grid.values).some((v) => !Number.isNaN(v) && (!Number.isFinite(v) || v < 0))) {
    throw new RangeError('Noise values must be nonnegative or skipped.');
  }
  const values = Array.from(grid.values).filter(Number.isFinite), center = median(values);
  // Noise level is a scale, so regions are compared as ratios (log domain). In the linear domain the
  // spread of textured scene areas (grass, foliage) swamped a pasted smooth region with a tenth of the
  // noise; measured on 2026-11-14 the log domain found that splice and flagged fewer camera photos.
  const logs = Array.from(grid.values, (v) => Number.isFinite(v) ? Math.log(Math.max(v, LOG_FLOOR)) : NaN);
  const finiteLogs = logs.filter(Number.isFinite), logCenter = median(finiteLogs), deviation = mad(finiteLogs, logCenter);
  // Quantized low-noise cells can share exactly the same MAD; an epsilon denominator would exaggerate
  // one-step differences, so fall back to a fixed ratio (about +-28 percent per unit).
  const robustScale = deviation * 1.4826;
  const denominator = robustScale > 1e-6 ? robustScale : 0.25;
  const zScores = Float32Array.from(logs, (v) => Number.isFinite(v) ? (v - logCenter) / denominator : NaN);
  return { median: center, mad: deviation, zScale: denominator, zScores, usableCells: values.length,
    usableFraction: values.length / grid.values.length,
    regions: connectedRegions(grid, Array.from(zScores, (v) => Number.isFinite(v) && Math.abs(v) >= 3.5)) };
}

export function noiseCheckResult(assetId: string, grid: CellGrid, geometry?: AnalysisGeometry): CheckResult {
  const result = baseResult('noise', assetId), summary = noiseSummary(grid);
  result.method = 'Luma Laplacian residual; per-cell MAD times 1.4826; robust regional z-scores of the log noise level (compared as ratios).';
  result.assumptions = ['Enough image cells contain measurable noise for a regional comparison.'];
  result.limitations = ['Smooth skies, blur, depth of field and heavy denoising change noise naturally.',
    'Generated images can have even noise everywhere, so an even map shows nothing either way.',
    'Scene edges, compression and resizing also affect this residual; small details can be lost at the analysis scale.',
    'Cells near saturation are skipped; a map without any residual spread cannot support a noise comparison.'];
  result.evidence = { ...(geometry ? { geometry } : {}), median: summary.median, mad: summary.mad,
    zScores: Array.from(summary.zScores, (v) => Number.isFinite(v) ? v : null),
    usableCells: summary.usableCells, usableFraction: summary.usableFraction, regions: summary.regions,
    cols: grid.cols, rows: grid.rows, cell: grid.cell, analysisWidth: grid.width, analysisHeight: grid.height,
    zThreshold: 3.5, zScale: summary.zScale,
    zeroMadScale: 0.25, domain: 'log' };
  if (summary.usableCells < 20) {
    result.finding = 'not_applicable';
    result.reason = 'The image is too small or too flat to compare noise across regions.';
    result.observation = result.reason;
    return result;
  }
  result.overlays = mapOverlays(grid, Array.from(summary.zScores, (v) => Number.isFinite(v) ? Math.min(1, Math.abs(v) / 6) : 0),
    summary.regions, 'Noise difference');
  if (summary.regions.length) {
    result.finding = 'inconsistent'; delete result.reason;
    result.observation = 'Highlighted regions have noise levels that differ from the image baseline.';
  } else {
    result.reason = 'No region stands out in this noise map; an even map shows nothing either way.';
    result.observation = 'No region stands out in the noise map.';
  }
  return result;
}
