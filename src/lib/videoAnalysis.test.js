import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTemporalDescriptors, describeFlaggedPassage } from './videoAnalysis.js';

test('explains a flagged frame using adjacent pictures and the measured area of change', () => {
  const changes = Array(24).fill(0.015);
  changes[5] = 0.23;
  const frames = [
    { time: 1, meanLuminance: 0.5, thumbnail: 'before' },
    { time: 1.5004, meanLuminance: 0.52, thumbnail: 'after', globalDifference: 0.034, cellDifferences: changes },
  ];
  const comparison = describeFlaggedPassage(frames, { timeStart: 1.5, timeEnd: 1.5 });
  assert.match(comparison.description, /upper right/);
  assert.deepEqual([comparison.before.thumbnail, comparison.after.thumbnail], ['before', 'after']);
});

test('flags an unusually large sampled frame transition for review', () => {
  const frames = [
    { time: 0.5, meanLuminance: 0.4, globalDifference: null, cellDifferences: [], thumbnail: null },
    { time: 1, meanLuminance: 0.41, globalDifference: 0.02, cellDifferences: Array(24).fill(0.02), thumbnail: null },
    { time: 1.5, meanLuminance: 0.4, globalDifference: 0.018, cellDifferences: Array(24).fill(0.018), thumbnail: null },
    { time: 2, meanLuminance: 0.7, globalDifference: 0.42, cellDifferences: Array(24).fill(0.42), thumbnail: null },
  ];
  const result = analyzeTemporalDescriptors(frames);
  assert.ok(result.signals.some((entry) => entry.check === 'temporal_edit'));
  assert.equal(result.metrics.sampledFrames, 4);
});

test('flags a localized change when the overall frame change is modest', () => {
  const evenCells = Array(24).fill(0.03);
  const localizedCells = [...evenCells];
  localizedCells[5] = 0.4;
  const frames = [
    { time: 0.5, meanLuminance: 0.4, globalDifference: null, cellDifferences: [], thumbnail: null },
    { time: 1, meanLuminance: 0.41, globalDifference: 0.03, cellDifferences: evenCells, thumbnail: null },
    { time: 1.5, meanLuminance: 0.4, globalDifference: 0.031, cellDifferences: evenCells, thumbnail: null },
    { time: 2, meanLuminance: 0.42, globalDifference: 0.08, cellDifferences: localizedCells, thumbnail: null },
  ];
  const result = analyzeTemporalDescriptors(frames);
  assert.ok(result.signals.some((entry) => entry.check === 'localized_temporal_change'));
});
