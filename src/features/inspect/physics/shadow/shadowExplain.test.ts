import { describe, expect, it } from 'vitest';
import { runShadowCheck } from './shadowCheck';
import { explainShadowResult } from './shadowExplain';
import type { CheckResult, ShadowPair } from './shadowTypes';

const pairs: ShadowPair[] = [
  { id: 'left', object: { x: 0.2, y: 0.4 }, shadow: { x: 0.1, y: 0.55 } },
  { id: 'middle', object: { x: 0.5, y: 0.4 }, shadow: { x: 0.55, y: 0.55 } },
  { id: 'right', object: { x: 0.7, y: 0.4 }, shadow: { x: 0.85, y: 0.55 } },
];

const complete = runShadowCheck(pairs, 'synthetic');
const inconsistent: CheckResult = { ...complete, finding: 'inconsistent', evidence: {
  ...complete.evidence, perPairResidual: [{ pairId: 'left', residualDeg: 1 },
    { pairId: 'middle', residualDeg: 12.4 }, { pairId: 'right', residualDeg: 8.2 }],
  offendingPairIds: ['middle', 'right'],
} };
const incompleteReasons = [
  ['Object-shadow coordinates must be finite normalized values in [0,1].', 'mark each point again'],
  ['Object-shadow pair ids must be nonempty and unique.', 'own label'],
  ['Angular tolerance must be finite and between 0 and 90 degrees.', 'between 0 and 90'],
  ['infinityEpsilon must be finite, greater than 0 and at most 0.001.', 'default settings'],
  ['Image dimensions must be positive safe integers.', 'width or height'],
  ['Object-shadow normalized coordinates exceed the supported numeric range.', 'original photo'],
  ['The projected light exceeds the supported numeric range.', 'original photo'],
  ['Shadow geometry could not be computed.', 'try again'],
] as const;
const inconclusiveReasons = [
  ['ill-conditioned: insufficient independent line constraints or ambiguous light direction.', 'spread across'],
  ['ill-conditioned: eigensolver did not converge.', 'try again'],
  ['ill-conditioned: projected light coincides with a marked object point; angular direction is undefined.', 'marked object point'],
  ['ill-conditioned: no stable projected light estimate.', 'spread across'],
  ['Separate groups fit different projected lights; the single dominant light assumption is uncertain (possible multiple lights or ambiguous markings).', 'more than one light'],
  ['A future reason that this presenter does not recognize.', 'mark at least 3'],
] as const;

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

describe('explainShadowResult', () => {
  it('explains a consistent result with the required whole-photo limit', () => {
    const explanation = explainShadowResult(complete);
    expect(explanation.headline).toBe('These shadows fit one light source in this check.');
    expect(explanation.observation).toContain('5 degree limit');
    expect(explanation.unknowns).toContain('This check cannot tell whether the photo has been changed.');
    expect(explanation.perPair.map((pair) => pair.id)).toEqual(['left', 'middle', 'right']);
    expect(explanation.perPair[0]!.text).toContain('0 degrees');
  });

  it('names every disagreeing pair and its angle', () => {
    const explanation = explainShadowResult(inconsistent);
    expect(explanation.observation).toContain('middle');
    expect(explanation.observation).toContain('12 degrees');
    expect(explanation.observation).toContain('right');
    expect(explanation.observation).toContain('8 degrees');
    expect(explanation.observation).not.toContain('left');
    expect(explanation.perPair[0]!.text).toContain('within');
    const unknowns = explanation.unknowns.join(' ');
    for (const text of ['More than one light', 'Marking error', 'Curved or uneven ground', 'different part of the object']) {
      expect(unknowns).toContain(text);
    }
  });

  it('explains a missing prerequisite and gives the next action', () => {
    const explanation = explainShadowResult(runShadowCheck(pairs.slice(0, 2), 'synthetic'));
    expect(explanation.observation).toContain('2 distinct pairs');
    expect(explanation.observation).toContain('Mark at least 3 pairs spread across the photo');
    expect(explanation.perPair.every((pair) => pair.text.includes('not compared'))).toBe(true);
  });

  for (const [reason, action] of inconclusiveReasons) {
    it(`translates an inconclusive reason: ${reason}`, () => {
      const explanation = explainShadowResult({ ...complete, finding: 'inconclusive', reason });
      expect(explanation.observation.toLowerCase()).toContain(action);
      expect(explanation.headline).toBe('The shadow check is unclear.');
      expect(explanation.perPair.every((pair) => pair.text.includes('not compared'))).toBe(true);
    });
  }

  for (const [reason, action] of incompleteReasons) {
    it(`translates an input or calculation failure: ${reason}`, () => {
      const explanation = explainShadowResult({ ...complete, execution: 'failed', reason });
      expect(explanation.headline).toBe('The shadow check did not finish.');
      expect(explanation.observation.toLowerCase()).toContain(action);
      expect(explanation.perPair).toEqual([]);
      expect(explanation.observation).not.toContain('fit one light');
    });
  }

  for (const execution of ['failed', 'timeout', 'unavailable'] as const) {
    it(`does not imply a finding when execution is ${execution}`, () => {
      const explanation = explainShadowResult({ ...inconsistent, execution });
      expect(explanation.headline).toContain('did not finish');
      expect(explanation.perPair).toEqual([]);
      expect(explanation.observation).not.toMatch(/12\.4|8\.2|disagree|fit one light/);
    });
  }

  it('explains skipped duplicate and short pairs without repeating technical reasons', () => {
    const result = runShadowCheck([...pairs, { ...pairs[0]!, id: 'repeat' }, {
      id: 'tiny', object: { x: 0.5, y: 0.5 }, shadow: { x: 0.501, y: 0.5 },
    }], 'synthetic');
    const explanation = explainShadowResult(result);
    expect(explanation.perPair.find((pair) => pair.id === 'repeat')!.text).toContain('repeats another pair');
    expect(explanation.perPair.find((pair) => pair.id === 'tiny')!.text).toContain('too close');
    expect(explanation.unknowns.join(' ')).toContain('2 pairs were not used');
  });

  it('explains a light at infinity as a shared direction', () => {
    const result = runShadowCheck([0.2, 0.5, 0.8].map((y, i) => ({ id: `pair-${i}`,
      object: { x: 0.2, y }, shadow: { x: 0.7, y },
    })), 'synthetic');
    expect(explainShadowResult(result).observation).toContain('shared direction');
    expect(explainShadowResult(result).unknowns.join(' ')).toContain('precise light position');
  });

  it('preserves source and calculation limits in plain language', () => {
    const result = { ...complete, source: 'recorded_fixture' as const, evidence: {
      ...complete.evidence, lightPoint: [0.5, -2, 1], allowOffImagePoints: true,
      lightGroupSearch: { checkedCandidates: 256, candidateLimit: 256, groups: null },
    } };
    const unknowns = explainShadowResult(result).unknowns.join(' ');
    for (const text of ['saved example', 'outside the photo', 'outside the crop', 'not every grouping', 'stretched to a square']) {
      expect(unknowns).toContain(text);
    }
  });

  it('does not invent missing angles or accept invalid numeric evidence', () => {
    const result = { ...inconsistent, evidence: { toleranceDeg: NaN,
      usedPairIds: ['left', 'middle'], perPairResidual: [
        { pairId: 'left', residualDeg: Infinity }, { pairId: 'middle', residualDeg: null },
      ], offendingPairIds: ['middle'] } };
    const explanation = explainShadowResult(result);
    expect(explanation.observation).toContain('middle');
    expect(explanation.observation).toContain('angle is not available');
    expect(allStrings(explanation).join(' ')).not.toMatch(/NaN|Infinity|undefined/);
    expect(explanation.unknowns.join(' ')).toContain('angle limit is not available');
  });

  it('does not round a small exceedance into an apparent pass', () => {
    const result = { ...inconsistent, evidence: { ...inconsistent.evidence,
      perPairResidual: [{ pairId: 'middle', residualDeg: 5.000001 }], offendingPairIds: ['middle'],
    } };
    const observation = explainShadowResult(result).observation;
    expect(observation).toContain('5 degrees');
    expect(observation).toContain('above the 5 degree limit');
    expect(result.evidence.perPairResidual[0]!.residualDeg).toBe(5.000001);
  });

  it('rounds displayed angles while preserving the written tolerance and evidence', () => {
    for (const residualDeg of [12.49, 12.5, 61.6]) {
      const result = { ...inconsistent, evidence: { ...inconsistent.evidence, toleranceDeg: 5.25,
        perPairResidual: [{ pairId: 'middle', residualDeg }], offendingPairIds: ['middle'],
      } };
      const explanation = explainShadowResult(result);
      expect(explanation.observation).toContain(`${Math.round(residualDeg)} degrees`);
      expect(explanation.perPair.find((pair) => pair.id === 'middle')!.text).toContain(`${Math.round(residualDeg)} degrees`);
      expect(explanation.observation).toContain('5.25 degree limit');
      expect(result.evidence.perPairResidual[0]!.residualDeg).toBe(residualDeg);
      expect(result.evidence.toleranceDeg).toBe(5.25);
    }
    expect(explainShadowResult({ ...complete, evidence: { ...complete.evidence, toleranceDeg: 5.25 } })
      .observation).toContain('5.25 degree limit');
  });

  it('does not mutate its input and always produces the same explanation', () => {
    const before = JSON.stringify(inconsistent);
    expect(explainShadowResult(inconsistent)).toEqual(explainShadowResult(inconsistent));
    expect(JSON.stringify(inconsistent)).toBe(before);
  });

  it('explains which group supplied the light and only flags the excluded pair', () => {
    const result = runShadowCheck([...pairs, {
      id: 'bad', object: { x: 0.2, y: 0.8 }, shadow: { x: 0.7, y: 0.8 },
    }], 'synthetic');
    expect(result.evidence.fitSubsetPairIds).toEqual(['left', 'middle', 'right']);
    const explanation = explainShadowResult(result);
    expect(explanation.observation).toContain('Pairs left, middle, right fit one light');
    expect(explanation.observation).toContain('Pair bad');
    expect(explanation.perPair.filter((pair) => pair.text.includes('above')).map((pair) => pair.id)).toEqual(['bad']);
    expect(explanation.method).toContain('largest group');
  });

  for (const [status, detail] of [
    ['none', 'No group of 3 or more'], ['ambiguous', 'Several equally large groups'],
    ['below_half', 'fewer than half'], ['limit_reached', 'search stopped'],
  ]) {
    it(`explains why no agreeing group was selected: ${status}`, () => {
      const result = { ...inconsistent, evidence: { ...inconsistent.evidence, subsetSearch: { status } } };
      const explanation = explainShadowResult(result);
      expect(explanation.observation).toContain(detail);
      expect(explanation.observation).toContain('do not identify one wrong mark');
    });
  }

  it('scans every generated string for banned language and technical jargon', () => {
    const results: CheckResult[] = [complete, inconsistent, runShadowCheck([], 'synthetic'),
      ...inconclusiveReasons.map(([reason]) => ({ ...complete, finding: 'inconclusive' as const, reason })),
      ...incompleteReasons.map(([reason]) => ({ ...complete, execution: 'failed' as const, reason })),
      ...(['timeout', 'unavailable'] as const).map((execution) => ({ ...complete, execution })),
      { ...complete, source: 'recorded_fixture' },
      ...['none', 'ambiguous', 'below_half', 'limit_reached'].map((status) => ({ ...inconsistent,
        evidence: { ...inconsistent.evidence, subsetSearch: { status } },
      })),
      { ...inconsistent, evidence: { ...inconsistent.evidence, fitSubsetPairIds: ['A', 'B', 'C'] } },
      { ...complete, observation: 'FAKE', method: 'SVD', assumptions: ['CONFIDENCE'], limitations: ['AUTHENTIC'] },
    ];
    const banned = /real|fake|authentic|manipulated|edited|genuine|score|percent|probability|confidence|homogeneous|\bSVD\b|residual/i;
    for (const result of results) {
      for (const value of allStrings(explainShadowResult(result))) expect(value).not.toMatch(banned);
    }
  });
});
