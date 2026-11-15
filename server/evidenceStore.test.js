import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EvidenceStore } from './evidenceStore.mjs';

function fourCC(value) {
  return Array.from(value, (char) => char.charCodeAt(0));
}

function box(type, body) {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(fourCC(type), 4);
  out.set(body, 8);
  return out;
}

test('seals a video receipt, verifies it, and records review observations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'veil-evidence-test-'));
  try {
    const ftypBody = new Uint8Array([...fourCC('isom'), 0, 0, 0, 0, ...fourCC('isom')]);
    const original = new Uint8Array([...box('ftyp', ftypBody), ...box('mdat', new Uint8Array(4))]);
    const store = new EvidenceStore(root);
    const receipt = await store.sealOriginal({ caseId: 'case-12345678', originalName: 'claim.mp4', declaredMimeType: 'video/mp4', clientSha256: null, bytes: original });
    assert.equal(receipt.payload.originalAsset.byteLength, original.length);
    assert.equal(receipt.payload.custodyEvents.length, 2);
    assert.equal(await store.verifyEnvelope(receipt), true);

    const updated = await store.appendObservations('case-12345678', [
      { id: 'note-12345678', time: 3.25, category: 'visual', text: 'Review the face boundary.', createdAt: '2026-11-14T00:00:00.000Z' },
    ]);
    assert.equal(updated.payload.observations.length, 1);
    assert.equal(updated.payload.custodyEvents.length, 3);
    assert.equal(await store.verifyEnvelope(updated), true);

    const analysis = {
      sourceSha256: receipt.payload.originalAsset.serverSha256,
      engine: { id: 'test-scan', version: '1', mode: 'review only' },
      status: 'complete',
      sampledFrames: 12,
      syntheticMedia: {
        status: 'complete',
        engine: { id: 'model-test', modelRepository: 'example/model', modelRevision: 'abc123', modelUrl: 'https://example.test/model.onnx', expectedModelSha256: 'a'.repeat(64), modelSha256: 'a'.repeat(64), integrityVerified: true, runtime: 'onnxruntime-web@1.22.0 WebAssembly', license: 'MIT' },
        metrics: { requestedFrames: 8, sampledFrames: 8, medianSyntheticScore: 0.71, maxSyntheticScore: 0.91, ignored: 'not persisted' },
        signalCount: 1,
      },
      signals: [{ id: 'signal-12345678', check: 'temporal_edit', title: 'Abrupt transition', observation: 'Review this moment.', timeStart: 3.25, timeEnd: 3.25, thumbnail: 'data:image/jpeg;base64,should-not-be-stored' }],
    };
    const analyzed = await store.appendAnalysis('case-12345678', analysis);
    assert.equal(analyzed.payload.analysisRuns.length, 1);
    assert.equal(analyzed.payload.analysisRuns[0].analysis.signals[0].check, 'temporal_edit');
    assert.equal(analyzed.payload.analysisRuns[0].analysis.syntheticMedia.metrics.medianSyntheticScore, 0.71);
    assert.equal(analyzed.payload.analysisRuns[0].analysis.syntheticMedia.engine.runtime, 'onnxruntime-web@1.22.0 WebAssembly');
    assert.equal(analyzed.payload.analysisRuns[0].analysis.syntheticMedia.engine.integrityVerified, true);
    assert.equal('ignored' in analyzed.payload.analysisRuns[0].analysis.syntheticMedia.metrics, false);
    assert.equal(JSON.stringify(analyzed.payload.analysisRuns).includes('should-not-be-stored'), false);
    assert.equal(await store.verifyEnvelope(analyzed), true);

    const duplicate = await store.appendAnalysis('case-12345678', analysis);
    assert.equal(duplicate.payload.analysisRuns.length, 1);
    await assert.rejects(
      () => store.appendAnalysis('case-12345678', { ...analysis, sourceSha256: '0'.repeat(64) }),
      /does not match the original sealed video/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
