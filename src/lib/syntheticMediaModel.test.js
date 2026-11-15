import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeSyntheticScores } from './syntheticMediaModel.js';

test('summarizes sampled synthetic-media scores without making a binary verdict', () => {
  const summary = summarizeSyntheticScores([
    { time: 0.5, syntheticScore: 0.11 },
    { time: 1, syntheticScore: 0.71 },
    { time: 1.5, syntheticScore: 0.91 },
    { time: 2, syntheticScore: 0.42 },
  ]);
  assert.equal(summary.requestedFrames, 4);
  assert.equal(summary.sampledFrames, 4);
  assert.equal(summary.unscoredFrames, 0);
  assert.equal(summary.flaggedFrames, 2);
  assert.equal(summary.medianSyntheticScore, 0.565);
  assert.equal(summary.maxSyntheticScore, 0.91);
});

test('ignores malformed model scores instead of manufacturing a result', () => {
  const summary = summarizeSyntheticScores([{ time: 0.5, syntheticScore: Number.NaN }, { time: 1 }]);
  assert.equal(summary.requestedFrames, 2);
  assert.equal(summary.sampledFrames, 0);
  assert.equal(summary.unscoredFrames, 2);
  assert.equal(summary.medianSyntheticScore, null);
  assert.equal(summary.flaggedFrames, 0);
});
