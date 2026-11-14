import { describe, expect, it } from 'vitest';
import { shadowAngularResidual, solveShadows } from './solveShadows';
import type { Point, ShadowPair } from './shadowTypes';

export function finitePairs(light: Point = { x: 0.4, y: 0.1 }): ShadowPair[] {
  return [{ x: 0.15, y: 0.5 }, { x: 0.5, y: 0.45 }, { x: 0.8, y: 0.55 }, { x: 0.6, y: 0.65 }]
    .map((object, i) => ({
      id: `pair-${i}`, object,
      shadow: { x: object.x + (object.x - light.x) * 0.4, y: object.y + (object.y - light.y) * 0.4 },
    }));
}

export function parallelPairs(): ShadowPair[] {
  return [0.15, 0.45, 0.8].map((y, i) => ({
    id: `parallel-${i}`, object: { x: 0.2, y }, shadow: { x: 0.7, y },
  }));
}

describe('solveShadows', () => {
  it('recovers a finite projected light and angular residuals', () => {
    const result = solveShadows(finitePairs());
    expect(result.lightPoint?.[0]).toBeCloseTo(0.4, 10);
    expect(result.lightPoint?.[1]).toBeCloseTo(0.1, 10);
    expect(result.lightPoint?.[2]).toBe(1);
    expect(result.maxResidual).toBeLessThan(1e-8);
    expect(result.conditioning.illConditioned).toBe(false);
  });

  it('recovers a light at infinity for separated parallel lines', () => {
    const result = solveShadows(parallelPairs());
    expect(result.lightPoint).toEqual([1, 0, 0]);
    expect(result.maxResidual).toBeLessThan(1e-8);
    expect(result.conditioning.illConditioned).toBe(false);
  });

  it('handles a near-infinite light without overflowing', () => {
    const pairs = parallelPairs().map((pair) => ({ ...pair,
      shadow: { x: pair.shadow.x, y: pair.shadow.y + (pair.object.y - 0.3) * 1e-10 },
    }));
    const result = solveShadows(pairs);
    expect(result.lightPoint?.[2]).toBe(0);
    expect(result.maxResidual).toBeLessThan(1e-6);
    expect(result.conditioning.illConditioned).toBe(false);
  });

  it('handles vertical and oblique parallel lines', () => {
    for (const direction of [{ x: 0, y: 0.2 }, { x: 0.2, y: 0.1 }]) {
      const pairs = [0.1, 0.4, 0.7].map((x, i) => ({ id: `${i}`,
        object: { x, y: 0.2 }, shadow: { x: x + direction.x, y: 0.2 + direction.y },
      }));
      const result = solveShadows(pairs);
      expect(result.lightPoint?.[2]).toBe(0);
      expect(result.maxResidual).toBeLessThan(1e-8);
      expect(result.conditioning.illConditioned).toBe(false);
    }
  });

  it('rejects coincident and nearly coincident lines as ill-conditioned', () => {
    for (const separation of [0, 1e-7]) {
      const pairs = parallelPairs().map((pair, i) => ({ ...pair,
        object: { x: 0.2, y: 0.4 + i * separation }, shadow: { x: 0.7, y: 0.4 + i * separation },
      }));
      const result = solveShadows(pairs);
      expect(result.conditioning.illConditioned).toBe(true);
      expect(result.lightPoint).toBeNull();
    }
  });

  it('preserves geometry under a uniform crop-coordinate transform', () => {
    const transform = ({ x, y }: Point) => ({ x: x * 0.7 + 0.1, y: y * 0.7 + 0.05 });
    const result = solveShadows(finitePairs().map((pair) => ({ ...pair,
      object: transform(pair.object), shadow: transform(pair.shadow),
    })));
    expect(result.lightPoint?.[0]).toBeCloseTo(0.38, 10);
    expect(result.lightPoint?.[1]).toBeCloseTo(0.12, 10);
    expect(result.maxResidual).toBeLessThan(1e-8);
  });

  it('reports unavailable geometry for empty input, without non-finite numbers', () => {
    const result = solveShadows([]);
    expect(result.conditioning.illConditioned).toBe(true);
    expect(result.lightPoint).toBeNull();
    expect(result.maxResidual).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('does not mutate inputs and is deterministic', () => {
    const pairs = finitePairs();
    const before = JSON.stringify(pairs);
    expect(solveShadows(pairs)).toEqual(solveShadows(pairs));
    expect(JSON.stringify(pairs)).toBe(before);
  });

  it('measures angles in pixels when non-square dimensions are supplied', () => {
    const pair = { id: 'metric', object: { x: 0.1, y: 0.1 }, shadow: { x: 0.3, y: 0.3 } };
    expect(shadowAngularResidual(pair, [1, 0, 0])).toBeCloseTo(45, 10);
    expect(shadowAngularResidual(pair, [1, 0, 0], { width: 2000, height: 1000 }))
      .toBeCloseTo(Math.atan(0.5) * 180 / Math.PI, 10);
  });

  it('rejects invalid dimensions and infinity thresholds', () => {
    for (const width of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => solveShadows(finitePairs(), { imageSize: { width, height: 800 } })).toThrow(RangeError);
    }
    for (const infinityEpsilon of [0, -1, NaN, Infinity, 0.01]) {
      expect(() => solveShadows(finitePairs(), { infinityEpsilon })).toThrow(RangeError);
    }
  });
});
