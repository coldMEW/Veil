import { describe, expect, it } from 'vitest';
import { elaCheckResult, elaGrid, elaSummary } from './ela';
import { analysisGeometry, connectedRegions, makeGrid } from './grid';
import { checked, noisy } from './testSupport';

describe('JPEG recompression evidence', () => {
  it('isolates one synthetic square and maps it to normalized image coordinates', () => {
    const { rgba, width, height } = noisy(256, 256, () => 2);
    const copy = new Uint8ClampedArray(rgba);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      const i = (y * width + x) * 4 + c;
      copy[i] = rgba[i]! + (x >= 128 && x < 192 && y >= 160 && y < 224 ? 40 : 1);
    }
    const grid = elaGrid(rgba, copy, width, height), summary = elaSummary(grid);
    expect(grid.values).toBeInstanceOf(Float32Array);
    expect([grid.cols, grid.rows]).toEqual([16, 16]);
    expect(summary.regions).toEqual([{ x: 0.5, y: 0.625, width: 0.25, height: 0.25, areaFraction: 0.0625 }]);
    expect(summary.outlierCells).toHaveLength(16);
    expect(summary.outlierFraction).toBe(0.0625);
    expect(summary).toMatchObject({ median: 1, mad: 0, threshold: 3, max: 40, p95: 40 });
    const result = checked(elaCheckResult('asset', 'image/jpeg', grid, analysisGeometry(width, height)));
    expect(result.finding).toBe('inconsistent');
    expect(result.overlays.filter((o) => o.type === 'box')).toHaveLength(1);
    expect(result.overlays[0]).toMatchObject({ type: 'raster', width: 16, height: 16 });
    expect(result.evidence.geometry).toMatchObject({ scale: 1 });
  });

  it.each([0, 3])('uniform difference %i has no region and remains inconclusive', (difference) => {
    const { rgba, width, height } = noisy(128, 128, () => 2), copy = new Uint8ClampedArray(rgba);
    for (let i = 0; i < rgba.length; i++) if (i % 4 !== 3) copy[i] = rgba[i]! + difference;
    const grid = elaGrid(rgba, copy, width, height);
    expect(elaSummary(grid).regions).toEqual([]);
    const result = checked(elaCheckResult('asset', 'image/jpeg', grid));
    expect(result.finding).toBe('inconclusive'); expect(result.observation).toContain('No region stands out');
  });

  it('skips PNG before needing recompressed pixels', () => {
    const result = checked(elaCheckResult('asset', 'image/png', null));
    expect(result.finding).toBe('not_applicable');
    expect(result.reason).toBe('Recompression analysis needs the original JPEG; this file is PNG.');
    expect(result.overlays).toEqual([]);
    checked(elaCheckResult('asset', 'image/other', null));
  });

  it('uses eight-connectivity, true selected area, and clips partial edge cells', () => {
    const grid = makeGrid(100, 100, 10), mask = Array<boolean>(100).fill(false);
    mask[0] = mask[11] = true;
    expect(connectedRegions(grid, mask)).toEqual([{ x: 0, y: 0, width: 0.2, height: 0.2, areaFraction: 0.02 }]);
    const edge = makeGrid(101, 101, 10), selected = Array<boolean>(121).fill(false);
    selected[120] = true;
    expect(connectedRegions(edge, selected)).toEqual([]); // one pixel, below minimum region area
    selected[119] = selected[118] = selected[117] = selected[116] = selected[115] = selected[114] = true;
    expect(connectedRegions(edge, selected)[0]).toMatchObject({ x: 40 / 101, y: 100 / 101, width: 61 / 101, height: 1 / 101 });
  });

  it('ignores alpha and rejects inconsistent buffer dimensions', () => {
    expect(elaGrid(Uint8ClampedArray.of(0, 0, 0, 0), Uint8ClampedArray.of(3, 6, 9, 255), 1, 1).values[0]).toBe(6);
    expect(() => elaGrid(new Uint8ClampedArray(), new Uint8ClampedArray(), 1, 1)).toThrow();
    expect(() => elaGrid(new Uint8ClampedArray(4), new Uint8ClampedArray(4), 1, 1, 0)).toThrow();
  });

  it('caps the analysis long edge and records both rounded scales', () => {
    expect(analysisGeometry(4000, 3000)).toMatchObject({ width: 2048, height: 1536, scale: 0.512 });
    expect(analysisGeometry(1, 10000)).toMatchObject({ width: 1, height: 2048, scaleX: 1, scaleY: 0.2048 });
  });
});
