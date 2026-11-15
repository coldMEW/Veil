import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDetectorResults, summarizeSyntheticScores } from './syntheticMediaModel.js';

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

test('counts agreement only at shared timestamps and keeps consecutive flags in the same passage', () => {
  const frames = [{ time: 1 }, { time: 1.5 }, { time: 3 }];
  const detectors = [
    {
      engine: { id: 'one', threshold: 0.65 },
      predictions: [{ time: 1, syntheticScore: 0.9 }, { time: 1.5, syntheticScore: 0.8 }],
    },
    {
      engine: { id: 'two', threshold: 0.8 },
      predictions: [{ time: 1.5, syntheticScore: 0.81 }, { time: 3, syntheticScore: 0.75 }],
    },
  ];
  const comparison = compareDetectorResults(frames, detectors);
  assert.equal(comparison.agreementFrames, 1);
  assert.equal(comparison.flaggedFrames, 2);
  assert.equal(comparison.scoredFrames, 3);
  assert.deepEqual(comparison.signals.map(({ timeStart, timeEnd, evidence }) => [timeStart, timeEnd, evidence.flaggedSampleCount]), [[1, 1.5, 2]]);
  const partial = compareDetectorResults(frames, [detectors[0], { ...detectors[1], predictions: [] }]);
  assert.equal(partial.agreementFrames, 0);
  assert.equal(partial.flaggedFrames, 2);
});
