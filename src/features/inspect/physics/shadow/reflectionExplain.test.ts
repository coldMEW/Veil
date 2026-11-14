import { describe, expect, it } from 'vitest';
import { reflectionCheck, type ReflectionPair } from './reflectionCheck';
import { explainReflectionResult } from './reflectionExplain';
import type { CheckResult } from './shadowTypes';

const pairs: ReflectionPair[] = [
  { id: 'left', object: { x: 0.2, y: 0.4 }, reflection: { x: 0.1, y: 0.55 } },
  { id: 'middle', object: { x: 0.5, y: 0.4 }, reflection: { x: 0.55, y: 0.55 } },
  { id: 'right', object: { x: 0.7, y: 0.4 }, reflection: { x: 0.85, y: 0.55 } },
];
const complete = reflectionCheck(pairs, 'synthetic');
const inconsistent: CheckResult = { ...complete, finding: 'inconsistent', evidence: {
  ...complete.evidence, perPairResidual: [{ pairId: 'middle', residualDeg: 12.49 },
    { pairId: 'right', residualDeg: 8.2 }], offendingPairIds: ['middle', 'right'],
} };
const failedReasons = [
  ['Object-reflection pair ids must be nonempty and unique.', 'own label'],
  ['Object-reflection coordinates must be finite normalized values in [0,1].', 'mark each point again'],
  ['Object-reflection normalized coordinates exceed the supported numeric range.', 'original photo'],
  ['Angular tolerance must be finite and between 0 and 90 degrees.', 'between 0 and 90'],
  ['infinityEpsilon must be finite, greater than 0 and at most 0.001.', 'default settings'],
  ['Image dimensions must be positive safe integers.', 'width or height'],
  ['Reflection geometry could not be computed.', 'try again'],
] as const;
const unclearReasons = [
  ['Separate groups fit different reflection vanishing points.', 'two separate reflecting surfaces'],
  ['ill-conditioned: reflection vanishing point coincides with a marked object point.', 'marked object point'],
  ['ill-conditioned: eigensolver did not converge.', 'try again'],
  ['ill-conditioned: insufficient independent line constraints or ambiguous reflection direction.', 'spread across'],
  ['Unknown reason', 'mark at least 3'],
] as const;

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

describe('explainReflectionResult', () => {
  it('limits agreement to this check and explains the single flat surface assumption', () => {
    const explanation = explainReflectionResult(complete);
    expect(explanation.headline).toBe('These reflections fit this check.');
    expect(explanation.observation).toContain('5 degree limit');
    expect(explanation.assumptions.join(' ')).toContain('one flat surface');
    for (const phrase of ['fits this check', 'photo has been changed', 'car body', 'spoon', 'wavy water',
      'Several mirrors', 'Marking error', 'blurry', 'rippled']) expect(explanation.unknowns.join(' ')).toContain(phrase);
    expect(explanation.perPair.map((pair) => pair.id)).toEqual(['left', 'middle', 'right']);
  });

  it('shows whole-degree angles and compares unrounded measurements without mutating evidence', () => {
    const result = { ...inconsistent, evidence: { ...inconsistent.evidence, toleranceDeg: 5.25,
      perPairResidual: [{ pairId: 'middle', residualDeg: 5.250001 }, { pairId: 'right', residualDeg: 12.5 }],
    } };
    const before = JSON.stringify(result);
    const explanation = explainReflectionResult(result);
    expect(explanation.observation).toContain('middle is 5 degrees');
    expect(explanation.observation).toContain('above the 5 degree limit');
    expect(explanation.observation).toContain('right is 13 degrees');
    expect(allStrings(explanation).join(' ')).not.toMatch(/\d+\.\d+\s+degrees?/);
    expect(JSON.stringify(result)).toBe(before);
    expect(explanation).toEqual(explainReflectionResult(result));
  });

  it('explains the missing prerequisite and skipped duplicate and zero-length marks', () => {
    const result = reflectionCheck([pairs[0]!, { ...pairs[0]!, id: 'repeat' },
      { id: 'zero', object: { x: 0.2, y: 0.2 }, reflection: { x: 0.2, y: 0.2 } }], 'synthetic');
    const explanation = explainReflectionResult(result);
    expect(explanation.observation).toContain('Only 1 distinct pairs');
    expect(explanation.observation).toContain('at least 3 pairs');
    expect(explanation.perPair.find((pair) => pair.id === 'repeat')?.text).toContain('repeats another pair');
    expect(explanation.perPair.find((pair) => pair.id === 'zero')?.text).toContain('too close');
    expect(explanation.perPair.find((pair) => pair.id === 'left')?.text).toContain('not compared');
  });

  for (const execution of ['failed', 'timeout', 'unavailable'] as const) {
    it(`ignores stale measurements when execution is ${execution}`, () => {
      const explanation = explainReflectionResult({ ...inconsistent, execution });
      expect(explanation.headline).toContain('did not finish');
      expect(explanation.perPair).toEqual([]);
      expect(explanation.observation).not.toMatch(/12|8|disagree|fit this check/);
    });
  }
  for (const [reason, action] of failedReasons) {
    it(`translates failure: ${reason}`, () => {
      expect(explainReflectionResult({ ...complete, execution: 'failed', finding: 'inconclusive', reason })
        .observation.toLowerCase()).toContain(action);
    });
  }
  for (const [reason, action] of unclearReasons) {
    it(`translates uncertainty: ${reason}`, () => {
      const explanation = explainReflectionResult({ ...complete, finding: 'inconclusive', reason });
      expect(explanation.observation.toLowerCase()).toContain(action);
      expect(explanation.perPair.every((pair) => pair.text.includes('not compared'))).toBe(true);
    });
  }

  it('describes infinity without choosing a direction along the axis', () => {
    const result = reflectionCheck([0.2, 0.5, 0.8].map((y, i) => ({ id: `${i}`,
      object: { x: 0.2, y }, reflection: { x: 0.7, y },
    })), 'synthetic');
    const explanation = explainReflectionResult(result);
    expect(explanation.observation).toContain('Either direction');
    expect(explanation.unknowns.join(' ')).toContain('single meeting place is not available');
  });

  it('describes the agreeing group and names only its excluded pair', () => {
    const result = reflectionCheck([...pairs, { id: 'bad', object: { x: 0.2, y: 0.8 },
      reflection: { x: 0.7, y: 0.8 } }], 'synthetic');
    const explanation = explainReflectionResult(result);
    expect(explanation.observation).toContain('Pairs left, middle, right');
    expect(explanation.observation).toContain('Pair bad');
    expect(explanation.perPair.filter((pair) => pair.text.includes('above')).map((pair) => pair.id)).toEqual(['bad']);
    expect(explanation.method).toContain('largest group');
  });

  for (const [status, detail] of [
    ['none', 'No group of 3 or more'], ['ambiguous', 'Several equally large groups'],
    ['below_half', 'fewer than half'], ['limit_reached', 'search stopped'],
  ]) {
    it(`explains the subset search outcome: ${status}`, () => {
      const explanation = explainReflectionResult({ ...inconsistent, evidence: {
        ...inconsistent.evidence, subsetSearch: { status },
      } });
      expect(explanation.observation).toContain(detail);
      expect(explanation.observation).toContain('do not identify one wrong mark');
    });
  }

  it('keeps source, crop, metric and bounded-search limitations visible', () => {
    const explanation = explainReflectionResult({ ...complete, source: 'recorded_fixture', evidence: {
      ...complete.evidence, vanishingPoint: [0.5, -2, 1], allowOffImagePoints: true,
      surfaceGroupSearch: { checkedCandidates: 256, candidateLimit: 256 },
    } });
    for (const phrase of ['saved example', 'outside the photo', 'outside the crop', 'not every grouping', 'stretched to a square']) {
      expect(explanation.unknowns.join(' ')).toContain(phrase);
    }
  });

  it('handles absent and invalid measurements without inventing angles', () => {
    const explanation = explainReflectionResult({ ...inconsistent, evidence: { toleranceDeg: NaN,
      perPairResidual: [{ pairId: 'middle', residualDeg: Infinity }, { pairId: 'right', residualDeg: null }],
      offendingPairIds: ['middle', 'right'],
    } });
    expect(explanation.observation).toContain('angle is not available');
    expect(allStrings(explanation).join(' ')).not.toMatch(/NaN|Infinity|undefined/);
    expect(explanation.unknowns.join(' ')).toContain('angle limit is not available');
  });

  it('applies the shadow explainer language scan to every reflection outcome', () => {
    const results: CheckResult[] = [complete, inconsistent, reflectionCheck([], 'synthetic'),
      ...failedReasons.map(([reason]) => ({ ...complete, execution: 'failed' as const, reason })),
      ...unclearReasons.map(([reason]) => ({ ...complete, finding: 'inconclusive' as const, reason })),
      ...(['timeout', 'unavailable'] as const).map((execution) => ({ ...complete, execution })),
      ...['none', 'ambiguous', 'below_half', 'limit_reached'].map((status) => ({ ...inconsistent,
        evidence: { ...inconsistent.evidence, subsetSearch: { status } },
      })),
      { ...complete, observation: 'FAKE', method: 'SVD', assumptions: ['CONFIDENCE'], limitations: ['AUTHENTIC'] },
    ];
    const banned = /real|fake|authentic|manipulated|edited|genuine|score|percent|probability|confidence|homogeneous|\bSVD\b|residual/i;
    for (const result of results) {
      for (const value of allStrings(explainReflectionResult(result))) {
        expect(value).not.toMatch(banned);
        expect(value).not.toMatch(/\b(tampered|forged|AI-generated)\b|%|\d+\.\d+\s+degrees?/i);
      }
    }
  });
});
