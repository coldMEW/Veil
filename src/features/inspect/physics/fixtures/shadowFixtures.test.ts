import { describe, expect, it } from 'vitest';
import { SHADOW_FIXTURES, angleOffLightDeg, distPointToLinePx, toPx, type ShadowFixture } from './shadowFixtures';

const get = (id: string): ShadowFixture => {
  const f = SHADOW_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`missing fixture ${id}`);
  return f;
};

describe('shadow fixtures have the geometry they claim', () => {
  it('ids are unique and every fixture has a reason code', () => {
    const ids = SHADOW_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of SHADOW_FIXTURES) expect(f.reasonCode).toBeTruthy();
  });

  it('valid: every object->shadow line passes through the light (within 1e-6 px)', () => {
    const f = get('valid-finite-light');
    for (const p of f.pairs) expect(distPointToLinePx(f.lightPx!, toPx(p.object, f.image), toPx(p.shadow, f.image))).toBeLessThan(1e-6);
  });

  it('crop/zoom copy is still exact for the transformed light', () => {
    const f = get('crop-zoom-of-valid');
    for (const p of f.pairs) expect(distPointToLinePx(f.lightPx!, toPx(p.object, f.image), toPx(p.shadow, f.image))).toBeLessThan(1e-6);
  });

  it('noisy: every pair is within 1.5 degrees of the light ray', () => {
    const f = get('valid-finite-light-noisy');
    for (const p of f.pairs) expect(angleOffLightDeg(p, f.lightPx!, f.image)).toBeLessThan(1.5);
  });

  it('outlier: only the marked pair is far (>20 degrees) from the light ray', () => {
    const f = get('outlier-extra-pair');
    f.pairs.forEach((p, i) => {
      const a = angleOffLightDeg(p, f.lightPx!, f.image);
      if (i === f.outlierIndex) expect(a).toBeGreaterThan(20);
      else expect(a).toBeLessThan(1e-6);
    });
  });

  it('parallel: all directions are identical (light at infinity)', () => {
    const f = get('parallel-light-at-infinity');
    const dirs = f.pairs.map((p) => {
      const o = toPx(p.object, f.image);
      const s = toPx(p.shadow, f.image);
      return Math.atan2(s.y - o.y, s.x - o.x);
    });
    for (const d of dirs) expect(d).toBeCloseTo(dirs[0]!, 9);
  });

  it('two lights: each light explains only its own group of three', () => {
    const f = get('two-lights');
    const A = { x: -500, y: -400 };
    const B = { x: 1700, y: -400 };
    expect(f.pairs.filter((p) => angleOffLightDeg(p, A, f.image) < 0.5)).toHaveLength(3);
    expect(f.pairs.filter((p) => angleOffLightDeg(p, B, f.image) < 0.5)).toHaveLength(3);
  });

  it('degenerate fixtures are actually degenerate', () => {
    const dup = get('duplicate-pair');
    expect(dup.pairs[1]).toEqual(dup.pairs[2]);
    const short = get('near-zero-segment').pairs[2]!;
    const sp = toPx(short.object, { width: 1200, height: 800 });
    const ss = toPx(short.shadow, { width: 1200, height: 800 });
    expect(Math.hypot(ss.x - sp.x, ss.y - sp.y)).toBeLessThan(1);
    expect(get('underconstrained-two-pairs').pairs).toHaveLength(2);
    expect(Number.isFinite(get('non-finite').pairs[2]!.object.x)).toBe(false);
  });

  it('no fixture expects a real/fake style verdict', () => {
    for (const f of SHADOW_FIXTURES) expect(['consistent', 'inconsistent', 'inconclusive', 'rejected']).toContain(f.expected);
    expect(JSON.stringify(SHADOW_FIXTURES.map((f) => f.notes))).not.toMatch(/\bfake\b|\breal photo\b|ai-generated/i);
  });
});
