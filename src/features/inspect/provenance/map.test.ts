import { describe, it, expect } from 'vitest';
import { mapProvenance } from './map';
import { validateCheckResult } from '../../../contracts';
const signed = {
  active_manifest: 'test',
  manifests: {
    test: {
      claim_generator: 'Test/1',
      assertions: [
        {
          label: 'c2pa.actions',
          data: { actions: [{ action: 'c2pa.created', digitalSourceType: 'trainedAlgorithmicMedia' }] },
        },
      ],
    },
  },
  validation_state: 'Valid',
  validation_results: { activeManifest: { success: [{ code: 'claimSignature.validated' }], failure: [] } },
};
describe('provenance mapping', () => {
  it('keeps no manifest separate from validation failure', () => {
    const r = mapProvenance(null, 'asset');
    expect(r.finding).toBe('not_applicable');
    expect(r.evidence.manifestPresent).toBe(false);
    expect(validateCheckResult(r)).toEqual([]);
  });
  it('reports a declared synthetic source without marking it inconsistent', () => {
    const r = mapProvenance(signed, 'asset');
    expect(r.finding).toBe('consistent');
    expect(r.evidence.declaredSource).toEqual(['trainedAlgorithmicMedia']);
    expect(r.evidence.signer).toMatchObject({ trust: 'unknown' });
  });
  it('reports failing integrity codes', () => {
    const r = mapProvenance(
      {
        ...signed,
        validation_state: 'Invalid',
        validation_results: { activeManifest: { failure: [{ code: 'assertion.dataHash.mismatch' }] } },
      },
      'asset',
    );
    expect(r.finding).toBe('inconsistent');
    expect(r.reason).toContain('assertion.dataHash.mismatch');
  });
  it('does not label absence of trust anchors as broken integrity', () => {
    const r = mapProvenance(
      { ...signed, validation_status: [{ code: 'signingCredential.untrusted', success: false }] },
      'asset',
    );
    expect(r.finding).toBe('consistent');
    expect(r.evidence.signer).toMatchObject({ trust: 'unknown' });
  });
  it('maps SDK errors to failed/inconclusive', () => {
    const r = mapProvenance(null, 'asset', true);
    expect(r.execution).toBe('failed');
    expect(r.finding).toBe('inconclusive');
    expect(validateCheckResult(r)).toEqual([]);
  });
  it('does not declare unverified manifest output intact', () => {
    expect(mapProvenance({ active_manifest: 'test', manifests: { test: {} } }, 'asset').execution).toBe(
      'failed',
    );
  });
});
