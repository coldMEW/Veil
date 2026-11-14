import { describe, expect, it } from 'vitest';
import { displayedFinding, enforceInvariants, validateCheckResult, validateOverlay, type CheckResult } from './index';

const base: CheckResult = {
  id: 'r1', assetId: 'a1', kind: 'physical', execution: 'complete', finding: 'consistent', title: 't',
  observation: 'o', method: 'm', assumptions: [], limitations: [], evidence: {}, overlays: [], source: 'live',
};

describe('contract invariants', () => {
  it('accepts a valid complete result', () => expect(validateCheckResult(base)).toEqual([]));
  it('rejects a failed execution reported as a finding', () => {
    expect(validateCheckResult({ ...base, execution: 'failed' })).toContain('non-complete execution must have finding "inconclusive"');
    expect(displayedFinding({ execution: 'failed', finding: 'consistent' })).toBe('inconclusive');
  });
  it('enforceInvariants turns failures into inconclusive with a reason', () => {
    const r = enforceInvariants({ ...base, execution: 'timeout' });
    expect(r.finding).toBe('inconclusive');
    expect(r.reason).toMatch(/timeout/);
    expect(validateCheckResult(r)).toEqual([]);
  });
  it('requires reasons for inconclusive and not_applicable', () => {
    expect(validateCheckResult({ ...base, finding: 'not_applicable' })).toHaveLength(1);
    expect(validateCheckResult({ ...base, finding: 'not_applicable', reason: 'no shadows' })).toEqual([]);
  });
  it('drops invalid overlays and records a limitation', () => {
    const r = enforceInvariants({ ...base, overlays: [{ type: 'points', points: [{ x: 0.1, y: 0.2 }] }, { type: 'points', points: [{ x: NaN, y: 0 }] }] });
    expect(r.overlays).toHaveLength(1);
    expect(r.limitations[0]).toMatch(/1 invalid overlay/);
  });
});

describe('overlay validation', () => {
  const rect = { x: 0, y: 0, width: 1, height: 1 };
  it('raster size and range', () => {
    expect(validateOverlay({ type: 'raster', width: 2, height: 1, values: [0, 1], rect })).toBeNull();
    expect(validateOverlay({ type: 'raster', width: 2, height: 2, values: [0, 1], rect })).toMatch(/length/);
    expect(validateOverlay({ type: 'raster', width: 1, height: 1, values: [2], rect })).toMatch(/\[0,1\]/);
  });
  it('shell shapes: box, lines, rays, polygon', () => {
    expect(validateOverlay({ type: 'box', x: 0, y: 0, width: 0.5, height: 0.5 })).toBeNull();
    expect(validateOverlay({ type: 'box', x: 0, y: 0, width: -1, height: 1 })).toMatch(/invalid/);
    expect(validateOverlay({ type: 'lines', lines: [{ x1: 0, y1: 0, x2: 1, y2: 1 }] })).toBeNull();
    expect(validateOverlay({ type: 'rays', rays: [{ x1: 0, y1: 0, x2: Infinity, y2: 1 }] })).toMatch(/non-finite/);
    expect(validateOverlay({ type: 'polygon', points: [{ x: 0, y: 0 }] })).toMatch(/3 points/);
  });
});
