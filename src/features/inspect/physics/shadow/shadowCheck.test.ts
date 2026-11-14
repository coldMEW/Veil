import { describe, expect, it } from 'vitest';
import { runShadowCheck } from './shadowCheck';
import type { ShadowPair } from './shadowTypes';

const subsetLight = { x: 0.55, y: 0.05 };
function goodSubsetPairs(count: number): ShadowPair[] {
  return [{ x: 0.2, y: 0.45 }, { x: 0.5, y: 0.4 }, { x: 0.85, y: 0.5 },
    { x: 0.3, y: 0.6 }, { x: 0.7, y: 0.6 }].slice(0, count).map((object, i) => ({
    id: `P${i + 1}`, object, shadow: {
      x: object.x + (object.x - subsetLight.x) * 0.4,
      y: object.y + (object.y - subsetLight.y) * 0.4,
    },
  }));
}
const badPair: ShadowPair = { id: 'bad', object: { x: 0.2, y: 0.75 }, shadow: { x: 0.75, y: 0.75 } };

const finitePairs = (): ShadowPair[] => [
  { id: 'left', object: { x: 0.2, y: 0.4 }, shadow: { x: 0.1, y: 0.55 } },
  { id: 'middle', object: { x: 0.5, y: 0.4 }, shadow: { x: 0.55, y: 0.55 } },
  { id: 'right', object: { x: 0.7, y: 0.4 }, shadow: { x: 0.85, y: 0.55 } },
];

describe('runShadowCheck', () => {
  it('returns an asset-bound physical result for consistent finite lines', () => {
    const result = runShadowCheck(finitePairs(), 'sha256-input');
    expect(result).toMatchObject({ id: 'physics.shadow_geometry', assetId: 'sha256-input',
      kind: 'physical', execution: 'complete', finding: 'consistent', source: 'live' });
    expect(result.evidence.maxResidual).toBeLessThan(1e-8);
    expect(result.overlays.filter((overlay) => overlay.type === 'lines')).toHaveLength(3);
    expect(result.overlays.some((overlay) => overlay.type === 'points')).toBe(true);
  });

  it('shows a direction for parallel constraints', () => {
    const result = runShadowCheck([0.2, 0.5, 0.8].map((y, i) => ({ id: `${i}`,
      object: { x: 0.2, y }, shadow: { x: 0.7, y },
    })), 'asset');
    expect(result.finding).toBe('consistent');
    expect(result.evidence.lightPoint).toEqual([1, 0, 0]);
    expect(result.overlays.some((overlay) => overlay.type === 'rays')).toBe(true);
  });

  it('names a corrupted pair that exceeds the default tolerance', () => {
    const result = runShadowCheck([...finitePairs(), { id: 'corrupted',
      object: { x: 0.2, y: 0.8 }, shadow: { x: 0.7, y: 0.8 },
    }], 'asset');
    expect(result.finding).toBe('inconsistent');
    expect(result.observation).toContain('corrupted');
    expect(result.evidence.maxResidual).toBeGreaterThan(5);
  });

  it('names the missing prerequisite for two pairs', () => {
    const result = runShadowCheck(finitePairs().slice(0, 2), 'asset');
    expect(result.finding).toBe('not_applicable');
    expect(result.reason).toContain('needs at least 3 object-shadow pairs');
    expect(result.execution).toBe('complete');
  });

  it('drops and lists a pair shorter than 0.01', () => {
    const result = runShadowCheck([...finitePairs(), { id: 'tiny',
      object: { x: 0.5, y: 0.5 }, shadow: { x: 0.505, y: 0.5 },
    }], 'asset');
    expect(result.finding).toBe('consistent');
    expect(result.evidence.droppedPairIds).toEqual(['tiny']);
    expect(result.limitations.join(' ')).toContain('tiny');
    expect(result.overlays.filter((overlay) => overlay.type === 'lines')).toHaveLength(3);
  });

  it('rechecks the usable count after dropping a zero-length pair', () => {
    const pairs = finitePairs();
    pairs[0]!.shadow = { ...pairs[0]!.object };
    const result = runShadowCheck(pairs, 'asset');
    expect(result.finding).toBe('not_applicable');
    expect(result.reason).toContain('needs at least 3 object-shadow pairs');
  });

  it('does not count duplicated or reversed constraints as independent pairs', () => {
    const pairs = finitePairs().slice(0, 2);
    const first = pairs[0]!;
    const result = runShadowCheck([...pairs, { ...first, id: 'duplicate' },
      { id: 'reversed', object: first.shadow, shadow: first.object }], 'asset');
    expect(result.finding).toBe('not_applicable');
    expect(result.limitations.join(' ')).toContain('duplicate');
    expect(result.limitations.join(' ')).toContain('reversed');
  });

  it('returns inconclusive with a reason for ill-conditioned geometry', () => {
    const result = runShadowCheck([0.1, 0.3, 0.5].map((x, i) => ({ id: `${i}`,
      object: { x, y: 0.4 }, shadow: { x: x + 0.2, y: 0.4 },
    })), 'asset');
    expect(result.finding).toBe('inconclusive');
    expect(result.reason).toContain('ill-conditioned');
    expect(result.overlays.every((overlay) => overlay.type === 'lines')).toBe(true);
  });

  it('does not silently remove a non-finite or out-of-range coordinate', () => {
    for (const x of [NaN, Infinity, -0.1, 1.1]) {
      const result = runShadowCheck([...finitePairs(), { id: 'invalid',
        object: { x, y: 0.2 }, shadow: { x: 0.5, y: 0.5 },
      }], 'asset');
      expect(result.finding).toBe('inconclusive');
      expect(result.execution).toBe('failed');
      expect(result.reason).toContain('normalized');
      expect(result.overlays).toEqual([]);
    }
  });

  it('supports a declared tolerance and rejects invalid options', () => {
    const pairs = finitePairs();
    pairs[2]!.shadow.y += 0.03;
    const strict = runShadowCheck(pairs, 'asset', { toleranceDeg: 0.1 });
    const loose = runShadowCheck(pairs, 'asset', { toleranceDeg: 10 });
    expect(strict.finding).toBe('inconsistent');
    expect(loose.finding).toBe('consistent');
    for (const toleranceDeg of [-1, NaN, Infinity, 91]) {
      const result = runShadowCheck(pairs, 'asset', { toleranceDeg });
      expect(result.execution).toBe('failed');
      expect(result.finding).toBe('inconclusive');
    }
  });

  it('records the assumptions and keeps the report deterministic', () => {
    const result = runShadowCheck(finitePairs(), 'asset');
    expect(result).toEqual(runShadowCheck(finitePairs(), 'asset'));
    expect(result.limitations.join(' ')).toMatch(/single dominant light/);
    expect(result.limitations.join(' ')).toMatch(/planar ground.*not required/);
    expect(result.limitations.join(' ')).toMatch(/cast by the marked point/);
    expect(result.limitations.join(' ')).toMatch(/marking error/);
    expect(JSON.stringify(result)).not.toMatch(/\b(real|fake|authentic|score|percentage)\b/i);
  });

  it('rejects duplicate ids rather than ambiguously attaching evidence', () => {
    const pairs = finitePairs();
    pairs[1]!.id = pairs[0]!.id;
    const result = runShadowCheck(pairs, 'asset');
    expect(result.execution).toBe('failed');
    expect(result.finding).toBe('inconclusive');
    expect(result.reason).toContain('unique');
  });

  it('does not propagate numeric overflow from explicitly off-image annotations', () => {
    const result = runShadowCheck([...finitePairs(), { id: 'extreme',
      object: { x: Number.MAX_VALUE, y: 0.2 }, shadow: { x: -Number.MAX_VALUE, y: 0.3 },
    }], 'asset', { allowOffImagePoints: true });
    expect(result.execution).toBe('failed');
    expect(result.finding).toBe('inconclusive');
    expect(result.reason).toContain('numeric range');
  });

  for (const goodCount of [3, 5]) {
    it(`uses the unique agreeing group for ${goodCount} good pairs and one bad pair`, () => {
      const good = goodSubsetPairs(goodCount);
      const result = runShadowCheck([...good, badPair], 'asset');
      expect(result.finding).toBe('inconsistent');
      expect(result.evidence.offendingPairIds).toEqual(['bad']);
      expect(result.evidence.fitSubsetPairIds).toEqual(good.map((pair) => pair.id));
      const light = result.evidence.lightPoint as number[];
      expect(Math.abs(light[0]! - subsetLight.x)).toBeLessThan(0.01);
      expect(Math.abs(light[1]! - subsetLight.y)).toBeLessThan(0.01);
      expect(light[2]).toBe(1);
      const angles = result.evidence.perPairResidual as { pairId: string; residualDeg: number }[];
      expect(angles).toHaveLength(goodCount + 1);
      expect(angles.filter((pair) => pair.pairId !== 'bad').every((pair) => pair.residualDeg < 1e-8)).toBe(true);
      expect(angles.find((pair) => pair.pairId === 'bad')!.residualDeg).toBeGreaterThan(5);
      expect(result.observation).toContain('share one projected light');
      const point = result.overlays.find((overlay) => overlay.type === 'points');
      expect(point?.points[0]?.x).toBeCloseTo(subsetLight.x, 10);
      expect(point?.points[0]?.y).toBeCloseTo(subsetLight.y, 10);
    });
  }

  it('keeps the pooled fit when two agreeing pairs plus two other pairs have no qualifying group', () => {
    const pairs: ShadowPair[] = [
      { id: 'good-1', object: { x: 0.2, y: 0.2 }, shadow: { x: 0.8, y: 0.2 } },
      { id: 'good-2', object: { x: 0.2, y: 0.8 }, shadow: { x: 0.8, y: 0.8 } },
      { id: 'bad-1', object: { x: 0.2, y: 0.2 }, shadow: { x: 0.2, y: 0.8 } },
      { id: 'bad-2', object: { x: 0.8, y: 0.2 }, shadow: { x: 0.8, y: 0.8 } },
    ];
    const result = runShadowCheck(pairs, 'asset');
    expect(result.finding).toBe('inconsistent');
    expect(result.evidence.fitSubsetPairIds).toBeUndefined();
    expect(result.evidence.subsetSearch).toMatchObject({ status: 'none', checkedCandidates: 4 });
    expect(result.observation).toContain('No subset of 3 or more');
    expect(result.evidence.lightPoint).toEqual((result.evidence.pooledFit as { lightPoint: number[] }).lightPoint);
  });

  it('keeps the pooled fit when equally large groups tie', () => {
    const from = (id: string, lightX: number, object: { x: number; y: number }): ShadowPair => ({
      id, object, shadow: { x: object.x + (object.x - lightX) * 0.3, y: object.y + (object.y - 0.1) * 0.3 },
    });
    const pairs = [from('A1', 0.2, { x: 0.15, y: 0.5 }), from('A2', 0.2, { x: 0.35, y: 0.6 }),
      { id: 'shared', object: { x: 0.4, y: 0.1 }, shadow: { x: 0.6, y: 0.1 } },
      from('B1', 0.8, { x: 0.65, y: 0.5 }), from('B2', 0.8, { x: 0.85, y: 0.6 })];
    const result = runShadowCheck(pairs, 'asset');
    expect(result.finding).toBe('inconsistent');
    expect(result.evidence.fitSubsetPairIds).toBeUndefined();
    expect(result.evidence.subsetSearch).toMatchObject({ status: 'ambiguous', bestSubsetSize: 3 });
    expect(result.observation).toContain('No unique subset');
  });

  for (const count of [12, 13]) {
    it(`bounds the subset search for ${count} unrelated pairs`, () => {
      let seed = 781;
      const coordinate = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return 0.1 + seed / 4294967296 * 0.8;
      };
      const pairs = Array.from({ length: count }, (_, i) => ({ id: `unrelated-${i}`,
        object: { x: coordinate(), y: coordinate() }, shadow: { x: coordinate(), y: coordinate() },
      }));
      const result = runShadowCheck(pairs, 'asset', { toleranceDeg: 0.000001 });
      expect(result.finding).toBe('inconsistent');
      expect(result.evidence.fitSubsetPairIds).toBeUndefined();
      expect(result.evidence.subsetSearch).toMatchObject(count === 12
        ? { status: 'none', checkedCandidates: 4016, candidateLimit: 4096 }
        : { status: 'limit_reached', checkedCandidates: 256, candidateLimit: 256 });
    });
  }
});
