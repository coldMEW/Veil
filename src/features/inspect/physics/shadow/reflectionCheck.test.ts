import { describe, expect, it } from 'vitest';
import { reflectionCheck, type ReflectionPair } from './reflectionCheck';
import { runShadowCheck } from './shadowCheck';
import type { ShadowCheckOptions } from './shadowTypes';

type Vec3 = [number, number, number];
const imageSize = { width: 1200, height: 800 };
const focalLength = 600;
const project = ([x, y, z]: Vec3) => ({
  x: 0.5 + focalLength * x / (z * imageSize.width),
  y: 0.5 + focalLength * y / (z * imageSize.height),
});

/** Reflect 3D scene points across n dot X = offset, then use a pinhole camera. */
function mirrorScene(normal: Vec3 = [0.8, 0.2, 0.3], offset = 1): ReflectionPair[] {
  const points: Vec3[] = [[-1.4, -1.1, 6], [-0.4, 0.9, 7], [0.7, -0.8, 8],
    [1.3, 1.4, 9], [-1, 0.3, 10], [0.5, -1.5, 11]];
  const squaredLength = normal.reduce((sum, v) => sum + v * v, 0);
  return points.map((point, i) => {
    const distance = (normal.reduce((sum, v, j) => sum + v * point[j]!, 0) - offset) / squaredLength;
    const reflected = point.map((v, j) => v - 2 * distance * normal[j]!) as Vec3;
    expect(point[2]).toBeGreaterThan(0);
    expect(reflected[2]).toBeGreaterThan(0);
    return { id: `P${i + 1}`, object: project(point), reflection: project(reflected) };
  });
}

const solverPairs = (pairs: readonly ReflectionPair[]) => pairs.map(({ reflection, ...pair }) => ({ ...pair, shadow: reflection }));
const banned = /\b(real|fake|authentic|genuine|tampered|manipulated|AI-generated|forged|score|percentage)\b|%/i;

describe('reflectionCheck', () => {
  it('recovers the analytic finite vanishing point from projected 3D reflections', () => {
    const pairs = mirrorScene();
    const result = reflectionCheck(pairs, 'synthetic', { imageSize });
    expect(result).toMatchObject({ id: 'reflection-geometry', assetId: 'synthetic', kind: 'physical',
      title: 'Reflection geometry', execution: 'complete', finding: 'consistent', source: 'live' });
    const analytic = project([0.8, 0.2, 0.3]);
    const point = result.evidence.vanishingPoint as number[];
    expect(point[0]).toBeCloseTo(analytic.x, 9);
    expect(point[1]).toBeCloseTo(analytic.y, 9);
    expect(point[2]).toBe(1);
    expect(result.evidence.maxResidual).toBeLessThan(1e-8);
    expect(result.overlays.filter((o) => o.type === 'lines')).toHaveLength(6);
    expect(result.overlays.find((o) => o.type === 'points')?.label).toBe('Estimated reflection vanishing point');
    expect(result.limitations.join(' ')).toContain('outside the image');
  });

  it('identifies the moved reflection using the unique largest agreeing subset', () => {
    const pairs = mirrorScene().slice(0, 5);
    pairs[4]!.reflection = { x: 0.8, y: 0.1 };
    const result = reflectionCheck(pairs, 'synthetic', { imageSize });
    expect(result.finding).toBe('inconsistent');
    expect(result.evidence.offendingPairIds).toEqual(['P5']);
    expect(result.evidence.fitSubsetPairIds).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(result.evidence.vanishingPoint).toEqual(expect.arrayContaining([1]));
    expect(result.observation).toContain('P5');
  });

  it('keeps a sideways mirror at infinity and shows both directions', () => {
    const result = reflectionCheck(mirrorScene([1, 0, 0], 0), 'synthetic', { imageSize });
    expect(result.finding).toBe('consistent');
    expect(result.evidence.vanishingPoint).toEqual([1, 0, 0]);
    const overlay = result.overlays.find((o) => o.type === 'rays');
    expect(overlay?.label).toBe('Reflection axis at infinity (either direction)');
    expect(overlay?.rays).toHaveLength(2);
  });

  it('treats point-to-reflection lines as undirected', () => {
    const pairs = mirrorScene();
    const reversed = pairs.map((pair, i) => i % 2 ? pair : ({
      ...pair, object: pair.reflection, reflection: pair.object,
    }));
    const first = reflectionCheck(pairs, 'synthetic', { imageSize });
    const second = reflectionCheck(reversed, 'synthetic', { imageSize });
    expect(second.finding).toBe('consistent');
    const a = first.evidence.vanishingPoint as number[];
    const b = second.evidence.vanishingPoint as number[];
    a.forEach((value, i) => expect(b[i]).toBeCloseTo(value, 9));
  });

  it('preserves the conservative two-group ambiguity guard', () => {
    const first = mirrorScene().slice(0, 3);
    const second = mirrorScene([-0.8, 0.2, 0.3]).slice(3);
    const result = reflectionCheck([...first, ...second], 'synthetic', { imageSize });
    expect(result.finding).toBe('inconclusive');
    expect(result.reason).toContain('two separate reflecting surfaces or ambiguous marks');
    expect(result.evidence.surfaceGroupSearch).toMatchObject({ groups: expect.any(Array) });
    expect(result.overlays.every((o) => o.type === 'lines')).toBe(true);
  });

  it('has the same prerequisite, duplicate, short-segment and unstable-line outcomes as shadows', () => {
    const pairs = mirrorScene();
    const first = pairs[0]!;
    const cases = [[], pairs.slice(0, 1), pairs.slice(0, 2),
      [...pairs.slice(0, 2), { ...first, id: 'duplicate' },
        { id: 'reversed', object: first.reflection, reflection: first.object }],
      [...pairs.slice(0, 2), { ...first, id: 'zero', reflection: first.object }],
      [...pairs, { ...first, id: 'short', reflection: { x: first.object.x + 0.001, y: first.object.y } }],
      [0.1, 0.3, 0.5].map((x, i) => ({ id: `${i}`, object: { x, y: 0.4 }, reflection: { x: x + 0.2, y: 0.4 } })),
    ];
    for (const input of cases) {
      const shadow = runShadowCheck(solverPairs(input), 'synthetic', { imageSize });
      const result = reflectionCheck(input, 'synthetic', { imageSize });
      expect(result.execution).toBe(shadow.execution);
      expect(result.finding).toBe(shadow.finding);
      expect(result.reason).toBe(shadow.reason?.replaceAll('object-shadow', 'object-reflection')
        .replaceAll('Object-shadow', 'Object-reflection').replaceAll('light direction', 'reflection direction'));
      expect(result.evidence.droppedPairs).toEqual(shadow.evidence.droppedPairs);
      if (['not_applicable', 'inconclusive'].includes(result.finding)) expect(result.reason).toBeTruthy();
    }
  });

  it('fails closed for invalid coordinates, labels and options, matching the shadow guards', () => {
    const pairs = mirrorScene();
    const cases: [ReflectionPair[], ShadowCheckOptions][] = [
      [pairs.map((p) => ({ ...p, id: 'repeat' })), {}],
      ...[NaN, Infinity, -0.1, 1.1].map((x): [ReflectionPair[], ShadowCheckOptions] => [
        [{ ...pairs[0]!, object: { x, y: 0.2 } }, ...pairs.slice(1)], {},
      ]),
      ...[-1, NaN, Infinity, 91].map((toleranceDeg): [ReflectionPair[], ShadowCheckOptions] => [pairs, { toleranceDeg }]),
      [pairs, { infinityEpsilon: 0 }], [pairs, { imageSize: { width: 0, height: 800 } }],
      [[...pairs, { id: 'extreme', object: { x: Number.MAX_VALUE, y: 0.2 },
        reflection: { x: -Number.MAX_VALUE, y: 0.3 } }], { allowOffImagePoints: true }],
    ];
    for (const [input, opts] of cases) {
      const result = reflectionCheck(input, 'synthetic', opts);
      expect(result).toMatchObject({ execution: 'failed', finding: 'inconclusive', reason: expect.any(String), overlays: [] });
      expect(result.finding).toBe(runShadowCheck(solverPairs(input), 'synthetic', opts).finding);
      expect(JSON.stringify(result)).not.toMatch(banned);
    }
  });

  it('records reflection assumptions, calculation limits and deterministic evidence without verdict language', () => {
    const pairs = mirrorScene();
    const before = JSON.stringify(pairs);
    const result = reflectionCheck(pairs, 'synthetic', { imageSize });
    expect(result).toEqual(reflectionCheck(pairs, 'synthetic', { imageSize }));
    expect(JSON.stringify(pairs)).toBe(before);
    const text = result.limitations.join(' ');
    for (const phrase of ['flat reflecting surface', 'marked point', 'marking error', 'blurry', 'rippled',
      'car body', 'spoon', 'wavy water', 'several mirrors', 'fits this check', 'least-squares', 'undirected']) {
      expect(text).toContain(phrase);
    }
    expect(JSON.stringify(result)).not.toMatch(/\b(real|fake|authentic|score|percentage)\b/i);
    expect(JSON.stringify(result)).not.toMatch(banned);
    expect(JSON.stringify(result)).not.toMatch(/shadow|light/i);
  });
});
