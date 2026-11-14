import { afterEach, describe, expect, it, vi } from 'vitest';
import { runForensicsRequest } from './forensics.worker';
import type { ForensicsRequest, ForensicsResponse } from './forensicsTypes';
import { analysisGeometry } from './grid';
import { checked, noisy, pixels } from './testSupport';

afterEach(() => vi.unstubAllGlobals());

async function collect(request: ForensicsRequest) {
  const messages: ForensicsResponse[] = [], transfers: Transferable[][] = [];
  await runForensicsRequest(request, (message, transfer = []) => {
    if (message.type === 'result') checked(message.result);
    messages.push(message); transfers.push(transfer);
  });
  return { messages, transfers };
}

describe('forensics worker protocol', () => {
  it('runs PNG noise and skips ELA independently', async () => {
    const image = noisy(256, 256, () => 2);
    const { messages } = await collect({ type: 'start', id: 7, assetId: 'asset', image,
      geometry: analysisGeometry(256, 256), mimeType: 'image/png' });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 7, check: 'noise', result: { execution: 'complete' } });
    expect(messages[1]).toMatchObject({ id: 7, check: 'ela', result: { finding: 'not_applicable' } });
  });

  it('requests page encoding and transfers the pixel buffer when worker encoding is absent', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const image = pixels(64, 64), geometry = analysisGeometry(64, 64);
    const { messages, transfers } = await collect({ type: 'start', id: 2, assetId: 'asset', image, geometry, mimeType: 'image/jpeg' });
    expect(messages[1]).toMatchObject({ type: 'needs-ela', id: 2, image, geometry });
    expect(transfers[1]).toEqual([image.rgba.buffer]);
    const recompressed = pixels(64, 64, 130);
    const encoded = await collect({ type: 'ela', id: 2, assetId: 'asset', image, recompressed, geometry });
    expect(encoded.messages[0]).toMatchObject({ check: 'ela', result: { execution: 'complete', finding: 'inconclusive' } });
  });

  it('treats unsupported worker encoding as a capability fallback', async () => {
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    const image = pixels(32, 32);
    const { messages } = await collect({ type: 'start', id: 1, assetId: 'asset', image,
      geometry: analysisGeometry(32, 32), mimeType: 'image/jpeg' });
    expect(messages[1]).toMatchObject({ type: 'needs-ela' });
  });

  it('isolates math failures and rejects changed recompression dimensions', async () => {
    const invalid = { rgba: new Uint8ClampedArray(), width: 64, height: 64 };
    const first = await collect({ type: 'start', id: 1, assetId: 'asset', image: invalid,
      geometry: analysisGeometry(64, 64), mimeType: 'image/png' });
    expect(first.messages[0]).toMatchObject({ check: 'noise', result: { execution: 'failed', finding: 'inconclusive' } });
    expect(first.messages[1]).toMatchObject({ check: 'ela', result: { finding: 'not_applicable' } });
    const second = await collect({ type: 'ela', id: 1, assetId: 'asset', image: pixels(64, 64), recompressed: pixels(32, 32),
      geometry: analysisGeometry(64, 64) });
    expect(second.messages[0]).toMatchObject({ check: 'ela', result: { execution: 'failed', finding: 'inconclusive' } });
  });

  it('compares thumbnails off-thread and reports comparison failures honestly', async () => {
    const good = await collect({ type: 'thumbnail', id: 1, assetId: 'asset', thumb: pixels(8, 8), main: pixels(64, 64) });
    expect(good.messages[0]).toMatchObject({ check: 'exif-thumbnail', result: { finding: 'consistent' } });
    const bad = await collect({ type: 'thumbnail', id: 1, assetId: 'asset', thumb: pixels(8, 8),
      main: { rgba: new Uint8ClampedArray(), width: 64, height: 64 } });
    expect(bad.messages[0]).toMatchObject({ check: 'exif-thumbnail', result: { execution: 'failed', finding: 'inconclusive' } });
  });
});
