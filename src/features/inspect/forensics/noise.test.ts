import { describe, expect, it } from 'vitest';
import { noiseCheckResult, noiseResidualGrid, noiseSummary } from './noise';
import { analysisGeometry, makeGrid } from './grid';
import { checked, noisy, pixels } from './testSupport';

describe('noise consistency evidence', () => {
  it('isolates one block with a stronger noise level', () => {
    const image = noisy(512, 512, (x, y) => x >= 320 && x < 384 && y >= 320 && y < 384 ? 12 : 2);
    const grid = noiseResidualGrid(image.rgba, image.width, image.height), summary = noiseSummary(grid);
    expect(summary.median).toBeCloseTo(2, 0);
    expect(summary.usableFraction).toBe(1);
    expect(summary.regions).toHaveLength(1);
    expect(summary.regions[0]).toEqual({ x: 0.625, y: 0.625, width: 0.125, height: 0.125, areaFraction: 0.015625 });
    const result = checked(noiseCheckResult('asset', grid, analysisGeometry(512, 512)));
    expect(result.finding).toBe('inconsistent');
    expect(result.overlays[0]).toMatchObject({ type: 'raster', width: 16, height: 16 });
  });

  it('even Gaussian-like noise has no qualifying region', () => {
    const image = noisy(512, 512, () => 2), grid = noiseResidualGrid(image.rgba, image.width, image.height);
    expect(noiseSummary(grid).regions).toEqual([]);
    expect(checked(noiseCheckResult('asset', grid)).finding).toBe('inconclusive');
  });

  it('retains zero-noise patches within a noisy image for lower-noise comparison', () => {
    const image = noisy(512, 512, (x, y) => x >= 320 && x < 384 && y >= 320 && y < 384 ? 0 : 12);
    const grid = noiseResidualGrid(image.rgba, 512, 512), summary = noiseSummary(grid);
    expect(grid.values[10 * grid.cols + 10]).toBe(0);
    expect(summary.regions).toHaveLength(1);
    expect(summary.regions[0]).toEqual({ x: 0.625, y: 0.625, width: 0.125, height: 0.125, areaFraction: 0.015625 });
    expect(checked(noiseCheckResult('asset', grid)).finding).toBe('inconsistent');
  });

  it.each([[32, 32, 128], [256, 256, 0], [256, 256, 255], [256, 256, 128]])('skips tiny or flat images %i %i %i', (w, h, value) => {
    const image = pixels(w, h, value), grid = noiseResidualGrid(image.rgba, w, h);
    expect(grid.values.every(Number.isNaN)).toBe(true);
    const result = checked(noiseCheckResult('asset', grid));
    expect(result.finding).toBe('not_applicable');
    expect(result.reason).toBe('The image is too small or too flat to compare noise across regions.');
  });

  it('requires twenty usable cells, including for tiny noisy images', () => {
    const image = noisy(64, 64, () => 2);
    expect(checked(noiseCheckResult('asset', noiseResidualGrid(image.rgba, 64, 64))).finding).toBe('not_applicable');
    const grid = makeGrid(160, 128, 32); grid.values.fill(2);
    expect(noiseSummary(grid).usableCells).toBe(20);
    expect(checked(noiseCheckResult('asset', grid)).finding).toBe('inconclusive');
    grid.values[0] = NaN;
    expect(noiseSummary(grid).usableFraction).toBe(19 / 20);
    expect(checked(noiseCheckResult('asset', grid)).finding).toBe('not_applicable');
  });

  it('keeps robust scores finite at zero global MAD and detects lower noise too', () => {
    const grid = makeGrid(256, 256, 32); grid.values.fill(10);
    grid.values[63] = 1;
    const summary = noiseSummary(grid);
    expect(summary.zScores[0]).toBe(0); expect(summary.zScores[63]).toBeLessThan(-3.5);
    expect(summary.regions).toHaveLength(1);
    checked(noiseCheckResult('asset', grid));
  });
});

describe('noise consistency on textured scenes (regression, 2026-11-14)', () => {
  it('finds a smooth pasted block among widely varying texture, which the linear scale missed', () => {
    // 16 x 16 cells of 32 px: scene texture varies 30..120 (grass, deck), a 4 x 4 pasted block sits at 4.
    const cols = 16, rows = 16, cell = 32;
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const values = Float32Array.from({ length: cols * rows }, (_, i) => {
      const x = i % cols, y = Math.floor(i / cols);
      return x >= 9 && x < 13 && y >= 9 && y < 13 ? 4 : 30 + rand() * 90;
    });
    const summary = noiseSummary({ values, cols, rows, cell, width: cols * cell, height: rows * cell });
    expect(summary.regions).toHaveLength(1);
    const [region] = summary.regions;
    expect(region!.x).toBeCloseTo(9 / cols, 2);
    expect(region!.y).toBeCloseTo(9 / rows, 2);
  });

  it('does not flag texture that varies widely but evenly', () => {
    let seed = 11;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const values = Float32Array.from({ length: 256 }, () => 30 + rand() * 90);
    expect(noiseSummary({ values, cols: 16, rows: 16, cell: 32, width: 512, height: 512 }).regions).toHaveLength(0);
  });
});

describe('analysis bounds', () => {
  it('accepts a full-size "12 MP" phone photo, the same limit intake allows', () => {
    expect(analysisGeometry(4032, 3024)).toMatchObject({ width: 2048, height: 1536 });
    expect(analysisGeometry(3024, 4032)).toMatchObject({ width: 1536, height: 2048 });
    expect(() => analysisGeometry(4033, 3024)).toThrow(RangeError);
  });
});
