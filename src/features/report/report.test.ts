import { describe, expect, it } from 'vitest';
import type { CheckResult, ImageAsset, PrivacyCandidate, TransformRecord } from '../../contracts';
import { buildReport, canonicalJson } from './report';
import { buildApprovedMask, candidatesFromOcr, compareRescan, defaultExpansionPx } from '../clean/session';
import { maskArea } from '../clean/mask';

const SECRET = '221B Baker St';

const original: ImageAsset = {
  id: 'a'.repeat(64), sha256: 'a'.repeat(64), mimeType: 'image/jpeg', byteLength: 100,
  encodedWidth: 100, encodedHeight: 50, width: 100, height: 50, parentId: null, transformId: null,
};
const exported: ImageAsset = { ...original, id: 'b'.repeat(64), sha256: 'b'.repeat(64), mimeType: 'image/png', parentId: original.id, transformId: 't1' };
const candidates: PrivacyCandidate[] = [
  { id: 'c1', assetId: original.id, category: 'address', sourceMethod: 'ocr', region: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 }, text: SECRET, selected: true },
  { id: 'c2', assetId: original.id, category: 'other_text', sourceMethod: 'ocr', region: { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }, text: 'STOP', selected: false },
];
const tx: TransformRecord = {
  id: 't1', method: 'migan_inpaint', inputSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64), maskSha256: 'c'.repeat(64),
  maskExpansionPx: 3, parameters: {}, outputFormat: 'image/png', outputWidth: 100, outputHeight: 50, synthetic: true, createdAt: '2026-11-14T00:00:00Z',
};
const failedCheck: CheckResult = {
  id: 'k1', assetId: original.id, kind: 'physical', execution: 'failed', finding: 'consistent', title: 'Shadows', observation: '',
  method: 'm', assumptions: [], limitations: [], evidence: {}, overlays: [], source: 'live',
};

const input = {
  appVersion: '0.0.0', commit: 'abc1234', generatedAt: '2026-11-14T12:00:00Z', original, exported,
  checks: [failedCheck], candidates, transforms: [tx],
  verification: { exportMetadataBlocks: [], roundTripMismatches: 0, rescan: { stillDetectedCount: 0, totalBoxes: 1, selectedCount: 1 } },
};

describe('report', () => {
  it('never contains OCR text', () => {
    const json = canonicalJson(buildReport(input));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('STOP');
  });
  it('is byte-deterministic for identical input', () => {
    expect(canonicalJson(buildReport(input))).toBe(canonicalJson(buildReport(structuredClone(input))));
  });
  it('turns failed checks into inconclusive with a reason', () => {
    const r = buildReport(input);
    expect(r.inspect.checks[0]!.finding).toBe('inconclusive');
    expect(r.inspect.checks[0]!.reason).toMatch(/failed/);
  });
  it('carries both hashes, labels synthetic content and uses honest privacy wording', () => {
    const r = buildReport(input);
    expect(r.original.sha256).toBe('a'.repeat(64));
    expect(r.exported?.sha256).toBe('b'.repeat(64));
    expect(r.clean.syntheticContentNote).toMatch(/synthetic/);
    expect(r.clean.privacyStatement).toMatch(/no longer detects/);
    expect(r.clean.privacyStatement).toMatch(/not a guarantee/);
    expect(r.protect.status).toBe('not_tested');
  });
});

describe('clean session helpers', () => {
  it('pre-selects private categories only', () => {
    const c = candidatesFromOcr('a1', [
      { rect: { x: 0, y: 0, w: 0.1, h: 0.1 }, text: '221B Baker St' },
      { rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, text: 'Welcome' },
    ]);
    expect(c.map((x) => [x.category, x.selected])).toEqual([['address', true], ['other_text', false]]);
  });
  it('builds a dilated mask from selected candidates only', () => {
    const m0 = buildApprovedMask(100, 50, candidates, null, 0);
    expect(maskArea(m0)).toBe(30 * 5);
    const m2 = buildApprovedMask(100, 50, candidates, null, 2);
    expect(maskArea(m2)).toBe(34 * 9);
    expect(defaultExpansionPx(candidates, 50)).toBe(2);
  });
  it('re-scan comparison flags text still detected inside a selected region', () => {
    expect(compareRescan(candidates, []).stillDetected).toEqual([]);
    expect(compareRescan(candidates, [{ rect: { x: 0.12, y: 0.1, w: 0.1, h: 0.08 }, text: '221' }]).stillDetected).toEqual(['c1']);
    expect(compareRescan(candidates, [{ rect: { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }, text: 'STOP' }]).stillDetected).toEqual([]);
  });
});
