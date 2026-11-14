import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult } from '../../../contracts';
import { elaCheckResult } from './ela';
import { thumbnailCheckResult } from './exifThumbnail';
import type { ForensicsRequest, ForensicsResponse } from './forensicsTypes';
import { analysisGeometry, makeGrid } from './grid';
import { noiseCheckResult } from './noise';
import { checked, exifBytes, pixels } from './testSupport';
import { FORENSICS_TIMEOUT_MS, useForensics } from './useForensics';

// A small hook scheduler exercises the lifecycle without adding a DOM or renderer
// dependency. Browser codec behavior is outside this test's claims.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock('react', () => {
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!hooks.slots[index]) hooks.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = hooks.slots[index] as { value: unknown };
      return [slot.value, (next: unknown) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      return hooks.slots[index] ?? (hooks.slots[index] = { current: initial });
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = hooks.cursor++, previous = hooks.slots[index] as { deps: unknown[]; callback: unknown } | undefined;
      if (!previous || !same(previous.deps, deps)) hooks.slots[index] = { deps, callback };
      return (hooks.slots[index] as { callback: unknown }).callback;
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = hooks.cursor++, previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || !same(previous.deps, deps)) hooks.effects.push(() => {
        previous?.cleanup?.(); hooks.slots[index] = { deps, cleanup: effect() };
      });
    },
  };
});

vi.mock('./browser', () => ({
  readBitmap: vi.fn((bitmap: ImageBitmap, width = bitmap.width, height = bitmap.height) => pixels(width, height)),
  recompressOnMain: vi.fn(async (image: ReturnType<typeof pixels>) => pixels(image.width, image.height, 130)),
}));
vi.mock('./exifThumbnail', async (original) => ({ ...await original<typeof import('./exifThumbnail')>(), decodeThumbnail: vi.fn() }));

import { readBitmap, recompressOnMain } from './browser';
import { decodeThumbnail } from './exifThumbnail';

class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: { data: ForensicsResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn<(req: ForensicsRequest, transfer: Transferable[]) => void>();
  constructor() { WorkerStub.instances.push(this); }
  emit(data: ForensicsResponse) { this.onmessage?.({ data }); }
}

let asset: string | null, bitmap: ImageBitmap | null, bytes: Uint8Array | null;
const render = () => {
  hooks.cursor = 0;
  const value = useForensics(asset, bitmap, bytes, 'image/jpeg');
  for (const effect of hooks.effects.splice(0)) effect();
  return value;
};
const currentWorker = () => WorkerStub.instances.at(-1)!;
const reply = (worker: WorkerStub, result: CheckResult, id?: number) => {
  const request = worker.postMessage.mock.calls[0]![0];
  worker.emit({ type: 'result', id: id ?? request.id, check: result.id as 'ela' | 'noise' | 'exif-thumbnail', result: checked(result) });
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; WorkerStub.instances = [];
  asset = 'asset'; bitmap = { width: 64, height: 64, close: vi.fn() } as unknown as ImageBitmap;
  bytes = new Uint8Array();
  vi.stubGlobal('window', { setTimeout, clearTimeout }); vi.stubGlobal('Worker', WorkerStub);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('forensics hook lifecycle (mocked browser)', () => {
  it('starts explicitly, transfers owned pixels, preserves the source and completes separately', async () => {
    expect(render().ela.status).toBe('idle');
    await render().run();
    const worker = currentWorker(), request = worker.postMessage.mock.calls[0]![0];
    expect(request).toMatchObject({ type: 'start', assetId: 'asset', geometry: { scale: 1 } });
    expect(worker.postMessage.mock.calls[0]![1]).toHaveLength(1);
    expect(bitmap!.close).not.toHaveBeenCalled();
    expect(render().thumbnail.status).toBe('done'); checked(render().thumbnail.checkResult!);
    reply(worker, noiseCheckResult('asset', makeGrid(64, 64, 32)));
    expect(render().noise.status).toBe('done'); expect(render().ela.status).toBe('running');
    reply(worker, elaCheckResult('asset', 'image/jpeg', makeGrid(64, 64, 16)));
    expect(render().ela.status).toBe('done'); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates on a new asset and ignores stale responses', async () => {
    await render().run(); const old = currentWorker();
    asset = 'next'; render();
    expect(old.terminate).toHaveBeenCalledOnce(); expect(render().ela.status).toBe('idle');
    reply(old, elaCheckResult('asset', 'image/png', null));
    expect(render().ela.status).toBe('idle');
  });

  it('cancel and retry terminate computation and clear the deadline', async () => {
    await render().run(); const old = currentWorker(); render().cancel();
    expect(old.terminate).toHaveBeenCalledOnce(); expect(render().noise.status).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    await render().run(); const second = currentWorker(); await render().run();
    expect(second.terminate).toHaveBeenCalledOnce(); expect(WorkerStub.instances).toHaveLength(3);
  });

  it('times out only unfinished checks, with inconclusive failure results', async () => {
    await render().run();
    reply(currentWorker(), noiseCheckResult('asset', makeGrid(64, 64, 32)));
    vi.advanceTimersByTime(FORENSICS_TIMEOUT_MS);
    const state = render();
    expect(state.noise.status).toBe('done'); expect(state.thumbnail.status).toBe('done');
    expect(state.ela.status).toBe('failed');
    expect(checked(state.ela.checkResult!).execution).toBe('timeout');
    expect(state.ela.message).toContain('60 seconds'); expect(currentWorker().terminate).toHaveBeenCalledOnce();
  });

  it.each(['onerror', 'onmessageerror'] as const)('reports %s without overwriting completed checks', async (handler) => {
    await render().run(); currentWorker()[handler]?.();
    const state = render();
    expect(state.thumbnail.status).toBe('done');
    for (const check of [state.ela, state.noise]) expect(checked(check.checkResult!).execution).toBe('failed');
    expect(currentWorker().terminate).toHaveBeenCalledOnce();
  });

  it('handles worker construction failure and missing input without an unhandled rejection', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('unavailable'); } });
    await render().run();
    const state = render();
    for (const check of [state.ela, state.noise, state.thumbnail]) expect(checked(check.checkResult!).execution).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
    render().cancel(); bytes = null;
    await render().run(); expect(render().ela.status).toBe('idle');
  });

  it('returns main-thread encoding to the worker and ignores mismatched run IDs', async () => {
    await render().run(); const worker = currentWorker(), id = worker.postMessage.mock.calls[0]![0].id;
    reply(worker, elaCheckResult('asset', 'image/png', null), id - 1);
    expect(render().ela.status).toBe('running');
    worker.emit({ type: 'needs-ela', id, image: pixels(64, 64), geometry: analysisGeometry(64, 64) });
    await Promise.resolve(); await Promise.resolve();
    expect(recompressOnMain).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[1]![0]).toMatchObject({ type: 'ela', id });
    expect(worker.postMessage.mock.calls[1]![1]).toHaveLength(2);
  });

  it('a failed fallback affects ELA only', async () => {
    vi.mocked(recompressOnMain).mockRejectedValueOnce(new Error('unsupported'));
    await render().run(); const worker = currentWorker(), id = worker.postMessage.mock.calls[0]![0].id;
    worker.emit({ type: 'needs-ela', id, image: pixels(64, 64), geometry: analysisGeometry(64, 64) });
    await Promise.resolve(); await Promise.resolve();
    expect(checked(render().ela.checkResult!).execution).toBe('failed'); expect(render().noise.status).toBe('running');
    expect(render().thumbnail.status).toBe('done');
  });

  it('closes a thumbnail decoded after cancellation without posting old pixels', async () => {
    bytes = exifBytes().bytes;
    let resolve!: (bitmap: ImageBitmap) => void;
    vi.mocked(decodeThumbnail).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const run = render().run(), worker = currentWorker(); render().cancel();
    const decoded = { width: 8, height: 8, close: vi.fn() } as unknown as ImageBitmap;
    resolve(decoded); await run;
    expect(decoded.close).toHaveBeenCalledOnce(); expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(render().thumbnail.status).toBe('idle');
  });

  it('handles thumbnail decode failure independently', async () => {
    bytes = exifBytes().bytes;
    vi.mocked(decodeThumbnail).mockRejectedValueOnce(new Error('damaged'));
    await render().run();
    expect(checked(render().thumbnail.checkResult!).execution).toBe('failed'); expect(render().noise.status).toBe('running');
  });

  it('transfers thumbnail comparison pixels and records downscaling for large images', async () => {
    bytes = exifBytes().bytes; bitmap = { width: 4000, height: 3000, close: vi.fn() } as unknown as ImageBitmap;
    const decoded = { width: 8, height: 8, close: vi.fn() } as unknown as ImageBitmap;
    vi.mocked(decodeThumbnail).mockResolvedValueOnce(decoded);
    await render().run(); const worker = currentWorker();
    expect(readBitmap).toHaveBeenCalledWith(bitmap, 2048, 1536);
    expect(worker.postMessage.mock.calls[0]![0]).toMatchObject({ geometry: { scale: 0.512 } });
    expect(worker.postMessage.mock.calls[1]![0]).toMatchObject({ type: 'thumbnail' });
    expect(worker.postMessage.mock.calls[1]![1]).toHaveLength(2); expect(decoded.close).toHaveBeenCalledOnce();
    reply(worker, thumbnailCheckResult('asset', null));
  });

  it('unmount cleanup terminates the worker', async () => {
    await render().run();
    for (const slot of hooks.slots) (slot as { cleanup?: () => void })?.cleanup?.();
    expect(currentWorker().terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
