import { describe, expect, it } from 'vitest';
import { buildProtectProofCard, type G3bResult } from './proofCard';

const row = (arm: G3bResult['arm'], fixtureId: string, seed: number, clipScore: number): G3bResult => ({ fixtureId, arm, seed, promptId: 'erase', clipScore, psnr: 42, ssim: .99, outputSha256: `${arm}-${fixtureId}-${seed}` });

describe('Protect proof card', () => {
  it('compares only matched controls and reports the requested evidence counts', () => {
    const card = buildProtectProofCard([row('clean_control', 'a', 1, .8), row('clean_control', 'b', 1, .5), row('jitter_only', 'a', 1, .4), row('jitter_only', 'b', 1, .7)]);
    const jitter = card.columns[0]!;
    expect(card.source).toBe('recorded_fixture');
    expect(jitter).toMatchObject({ runs: 2, lowerThanControl: 1, matchedRuns: 2, status: 'measured', medianClipScore: .55 });
    expect(jitter.text).toBe('In 1 of 2 runs the edit scored lower than the clean control.');
  });

  it('keeps a no-improvement outcome distinct from missing and unmatched runs', () => {
    const card = buildProtectProofCard([row('clean_control', 'a', 1, .3), row('diffvax_only', 'a', 1, .4), row('combined', 'z', 1, .1)]);
    expect(card.columns.find((c) => c.arm === 'jitter_only')?.status).toBe('not_tested');
    expect(card.columns.find((c) => c.arm === 'diffvax_only')?.status).toBe('no_improvement_observed');
    expect(card.columns.find((c) => c.arm === 'combined')?.status).toBe('unavailable');
  });

  it('does not use a success claim in its display strings', () => {
    const text = JSON.stringify(buildProtectProofCard([])).toLowerCase();
    for (const forbidden of ['protected', 'success', 'works', 'guarantee']) expect(text).not.toContain(forbidden);
  });
});
