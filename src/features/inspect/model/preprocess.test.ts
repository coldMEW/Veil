import { describe, expect, it } from 'vitest';
import { AI_HIGH, AI_LOW, aiProbabilityDrops, CROP, cropGeometry, normalizeMagnitudes, occlude, selectFocusGrid, toAiOverlay, toChw } from './preprocess';
import { validateCheckResult } from '../../../contracts';
import { toCheckResult } from './useModelFocus';
import type { FocusResult } from './focusTypes';

describe('cropGeometry', () => {
  it('landscape: short edge to 440, long edge floored, centered crop', () => {
    const g = cropGeometry(1600, 1067);
    expect(g.resizedHeight).toBe(440);
    expect(g.resizedWidth).toBe(Math.floor((440 * 1600) / 1067)); // 659
    expect(g.left).toBe(Math.floor((659 - 384) / 2)); // 137
    expect(g.top).toBe(28);
  });

  it('portrait', () => {
    const g = cropGeometry(3024, 4032);
    expect(g.resizedWidth).toBe(440);
    expect(g.resizedHeight).toBe(586);
    expect(g.left).toBe(28);
    expect(g.top).toBe(101);
  });

  it('square', () => {
    const g = cropGeometry(1000, 1000);
    expect(g).toMatchObject({ resizedWidth: 440, resizedHeight: 440, left: 28, top: 28 });
    expect(g.source.x).toBeCloseTo(63.636, 2);
    expect(g.source.width).toBeCloseTo(872.727, 2);
  });

  it('maps the crop back inside the original image, centered', () => {
    for (const [w, h] of [
      [1600, 1067],
      [3024, 4032],
      [500, 500],
      [441, 2000],
    ] as const) {
      const { source } = cropGeometry(w, h);
      expect(source.x).toBeGreaterThanOrEqual(0);
      expect(source.y).toBeGreaterThanOrEqual(0);
      expect(source.x + source.width).toBeLessThanOrEqual(w + 1e-9);
      expect(source.y + source.height).toBeLessThanOrEqual(h + 1e-9);
      // Centered to within one resized pixel.
      expect(Math.abs(source.x - (w - source.width - source.x))).toBeLessThanOrEqual(w / 440 + 1e-9);
    }
  });

  it('upscales small images to the 440 short edge', () => {
    const g = cropGeometry(300, 200);
    expect(g.resizedHeight).toBe(440);
    expect(g.resizedWidth).toBe(660);
  });

  it('rejects empty sizes', () => {
    expect(() => cropGeometry(0, 10)).toThrow();
  });
});

describe('tensor helpers', () => {
  it('CLIP-normalizes RGB into CHW planes', () => {
    const rgba = new Uint8ClampedArray(CROP * CROP * 4).fill(255);
    const t = toChw(rgba);
    expect(t[0]).toBeCloseTo((1 - 0.48145466) / 0.26862954, 5);
    expect(t[CROP * CROP]).toBeCloseTo((1 - 0.4578275) / 0.26130258, 5);
    expect(t[2 * CROP * CROP]).toBeCloseTo((1 - 0.40821073) / 0.27577711, 5);
  });

  it('occludes exactly one cell in every channel', () => {
    const base = new Float32Array(3 * CROP * CROP).fill(1);
    const out = occlude(base, 8, 9, new Float32Array(base.length)); // row 1, col 1
    const plane = CROP * CROP;
    let zeros = 0;
    for (const v of out) if (v === 0) zeros++;
    expect(zeros).toBe(3 * 48 * 48);
    expect(out[48 * CROP + 48]).toBe(0);
    expect(out[plane + 95 * CROP + 95]).toBe(0);
    expect(out[47 * CROP + 48]).toBe(1);
    expect(base[48 * CROP + 48]).toBe(1); // base untouched
  });

  it('keeps legacy scalar display positive-only, in probability points, absolute across photos', () => {
    // A strongly "real" output (-7.65): even a +1.42 logit cell barely moves the sigmoid, so no colour.
    expect(Array.from(normalizeMagnitudes([1.42, -4, 0], -7.65))).toEqual([0, 0, 0]);
    // An AI-leaning output (+1.51): a +1.95 cell drops the sigmoid by ~0.43, so full strength.
    expect(normalizeMagnitudes([1.95], 1.51)[0]).toBe(1);
    expect(Array.from(normalizeMagnitudes([0, 0], 0))).toEqual([0, 0]);
  });
});

describe('AI-signal display', () => {
  it('measures each cell as a drop in the sigmoid output, positive only', () => {
    const drops = aiProbabilityDrops([1.95, -1, 0], 1.51);
    expect(drops[0]).toBeCloseTo(1 / (1 + Math.exp(-1.51)) - 1 / (1 + Math.exp(0.44)), 6);
    expect(drops[1]).toBe(0);
    expect(drops[2]).toBe(0);
    expect(Math.max(...aiProbabilityDrops([1.42, 1.29, 1.14], -7.65))).toBeLessThan(0.002);
  });

  it('uses probability-point thresholds and the warp-style yellow/orange/red ramp', () => {
    expect(AI_LOW).toBe(0.05);
    expect(AI_HIGH).toBe(0.2);
    // Base logit 0 (sigmoid 0.5): pick deltas whose drops are exactly LOW, midway, HIGH and far above.
    const logitFor = (p: number) => Math.log(p / (1 - p));
    const deltaForDrop = (drop: number) => 0 - logitFor(0.5 - drop);
    const rgba = toAiOverlay([AI_LOW, (AI_LOW + AI_HIGH) / 2, AI_HIGH, 0.45].map(deltaForDrop), 2, 0);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 220, 0, 180]);
    expect(Array.from(rgba.subarray(8, 12))).toEqual([255, 0, 0, 180]);
    expect(Array.from(rgba.subarray(12, 16))).toEqual([255, 0, 0, 180]);
  });

  it('gives no colour to negative contributions, zeros, weak changes or strongly real outputs', () => {
    expect(Array.from(toAiOverlay([-100, -2, 0, 0.01], 2, 0))).toEqual(Array(16).fill(0));
    expect(Array.from(toAiOverlay([1.42, 1.29, 1.14, 0.9], 2, -7.65))).toEqual(Array(16).fill(0));
  });

  it('does not rescale a cell when an unrelated cell changes', () => {
    const first = toAiOverlay([1, 0.6, 0, -1], 2, 0.5);
    const second = toAiOverlay([1, 999, 0, -1], 2, 0.5);
    expect(first.subarray(0, 4)).toEqual(second.subarray(0, 4));
  });

  it('rejects invalid grids and non-finite values instead of displaying a clean map', () => {
    for (const grid of [0, 9, 1.5, Infinity]) expect(() => toAiOverlay([], grid, 0)).toThrow();
    expect(() => toAiOverlay([1, 2], 2, 0)).toThrow();
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => toAiOverlay([value], 1, 0)).toThrow(/non-finite/);
      expect(() => normalizeMagnitudes([value], 0)).toThrow(/non-finite/);
    }
    expect(() => toAiOverlay([1], 1, NaN)).toThrow(/non-finite/);
  });
});

describe('occlusion grid selection', () => {
  it.each([
    ['webgpu', false, 6], ['wasm', false, 4], ['webgpu', true, 4], ['wasm', true, 4],
  ] as const)('selects %s / coarse=%s -> %s', (backend, coarse, grid) => {
    expect(selectFocusGrid(backend, coarse)).toBe(grid);
  });

  it('allows bounded explicit test grids and rejects invalid overrides', () => {
    expect(selectFocusGrid('webgpu', false, 2)).toBe(2);
    for (const grid of [0, 9, 1.5, NaN, Infinity]) expect(() => selectFocusGrid('wasm', false, grid)).toThrow();
  });
});

describe('AI-signal observation', () => {
  const result: FocusResult = {
    logit: 3.25, deltas: new Float32Array([0.1, 0, -100, 0, 0.6, 0, 1.25, 0.8, -2]), grid: 3,
    crop: { x: 20, y: 10, width: 384, height: 384 }, backend: 'webgpu', threads: 1,
    timings: { loadMs: 10, baseMs: 2, occlusionMs: 20 },
  };

  it('reports the strongest positive cell rather than the largest absolute change', () => {
    const check = toCheckResult('asset', result);
    expect(validateCheckResult(check)).toEqual([]);
    expect(check).toMatchObject({ kind: 'model', finding: 'inconclusive', assetId: 'asset', source: 'live' });
    expect(check.observation).toMatch(/^Strongest AI-signal area: lower left of the model crop\. Covering it lowers the detector's AI output by \d+ points\.$/);
    expect(check.evidence).toMatchObject({ rawOutput: 3.25, deltas: Array.from(result.deltas) });
    expect(check.evidence.thresholds).toEqual({ low: AI_LOW, high: AI_HIGH, units: 'probability points (sigmoid drop)', purpose: 'display only' });
    expect(check.evidence.signConvention).toContain('Higher logits support AI-generated');
    expect(check.limitations).toEqual(expect.arrayContaining([
      'This is a whole-image classifier: the map shows where its signal comes from, not which pixels were generated.',
      'Real photos can show colour.', 'This is not a probability or a verdict about the photo.',
    ]));
  });

  it('reports no above-threshold area for weak or purely negative responses', () => {
    for (const [deltas, logit] of [[new Float32Array(9).fill(1.4), -7.65], [new Float32Array(9).fill(-10), 3.25], [new Float32Array(9), 0]] as const) {
      const check = toCheckResult('asset', { ...result, deltas, logit });
      expect(check.observation).toBe("No area raised this detector's AI output by 5 points or more.");
      expect(check.finding).toBe('inconclusive');
      expect(validateCheckResult(check)).toEqual([]);
    }
  });
});
