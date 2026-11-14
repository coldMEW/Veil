import { describe, expect, it } from 'vitest';
import type { ImageAsset, ModelManifest } from '../../contracts';
import { buildReport } from '../../features/report/report';
import { prepareReport, reportFilename, serializeReport } from './reportExport';

const original: ImageAsset = {
  id: 'a'.repeat(64), sha256: 'a'.repeat(64), mimeType: 'image/png', byteLength: 100,
  encodedWidth: 10, encodedHeight: 10, width: 10, height: 10, parentId: null,
};
const report = buildReport({
  appVersion: 'test', commit: 'abc123', generatedAt: '2026-11-14T00:00:00Z', original,
  checks: [{
    id: 'fixture', assetId: original.id, kind: 'physical', title: 'Synthetic check',
    execution: 'complete', finding: 'consistent', observation: 'Known geometry.', method: 'Synthetic fixture',
    assumptions: ['One light'], limitations: ['Correspondence unknown'], evidence: { residual: 0.02 },
    overlays: [], source: 'recorded_fixture',
  }],
  candidates: [], transforms: [],
});
const manifest: ModelManifest = {
  id: 'synthetic-model', upstreamUrl: 'https://example.invalid/model', revision: 'pinned',
  sha256: 'c'.repeat(64), license: 'Test', bytes: 100, io: { inputs: {}, outputs: {} }, testedBackends: [],
};

describe('report export', () => {
  it('binds a safe filename to the exact input hash', () => {
    expect(reportFilename(report)).toBe(`veil-report-${original.sha256}.json`);
    expect(reportFilename({ original: { ...original, sha256: '../../private:name' } })).toBe('veil-report-unknown-input.json');
  });
  it('preserves hashes, recorded sources, assumptions, limits and manifests deterministically', () => {
    const exported = { ...original, sha256: 'b'.repeat(64), parentId: original.id };
    const withOutput = { ...report, exported };
    const json = serializeReport(withOutput, [manifest]);
    expect(json).toBe(serializeReport(structuredClone(withOutput), [structuredClone(manifest)]));
    expect(JSON.parse(json)).toEqual({ ...withOutput, modelManifests: [manifest] });
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(serializeReport(report)).exported).toBeNull();
  });
  it.each(['failed', 'timeout', 'unavailable'] as const)('keeps %s execution inconclusive in display and JSON without mutating input', (execution) => {
    const stale = { ...report, inspect: { ...report.inspect, checks: report.inspect.checks.map((c) => ({ ...c, execution })) } };
    expect(prepareReport(stale).inspect.checks[0]).toMatchObject({ execution, finding: 'inconclusive', reason: expect.stringContaining(execution) });
    expect(JSON.parse(serializeReport(stale)).inspect.checks[0].finding).toBe('inconclusive');
    expect(stale.inspect.checks[0]?.finding).toBe('consistent');
  });
});
