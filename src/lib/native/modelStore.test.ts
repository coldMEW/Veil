import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadModel, optionalModels } from './modelStore';
const bytes = new Uint8Array([1, 2, 3]);
const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
  v.toString(16).padStart(2, '0'),
).join('');
const model = { ...optionalModels[0]!, bytes: 3, sha256: hash };
afterEach(() => vi.unstubAllGlobals());
function setup(data = bytes) {
  const put = vi.fn();
  const fetcher = vi.fn(async (_url: unknown, _options: RequestInit) => new Response(data));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('caches', { open: vi.fn(async () => ({ put })) });
  return { put, fetcher };
}
describe('optional model download verification', () => {
  it('GETs only model data and caches only verified bytes', async () => {
    const { put, fetcher } = setup();
    const progress = vi.fn();
    await downloadModel(model, new AbortController().signal, progress);
    expect(put).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(3);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  it('rejects checksum mismatch without caching', async () => {
    const { put } = setup(new Uint8Array([1, 2, 4]));
    await expect(downloadModel(model, new AbortController().signal, () => {})).rejects.toThrow('checksum');
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects a truncated download without caching', async () => {
    const { put } = setup(new Uint8Array([1]));
    await expect(downloadModel(model, new AbortController().signal, () => {})).rejects.toThrow('byte count');
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects an oversized download without caching', async () => {
    const { put } = setup(new Uint8Array([1, 2, 3, 4]));
    await expect(downloadModel(model, new AbortController().signal, () => {})).rejects.toThrow('exceeds');
    expect(put).not.toHaveBeenCalled();
  });
  it('does not cache after cancellation even if transfer just completed', async () => {
    const { put } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(downloadModel(model, controller.signal, () => {})).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
