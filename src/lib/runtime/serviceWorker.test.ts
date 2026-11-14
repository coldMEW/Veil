import { describe, expect, it, vi } from 'vitest';
import source from '../../../public/sw.js?raw';

interface WorkerEvent {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
}

function harness(
  { version = 'test', modelsVersion = 'models-test' } = {},
  entries = new Map<string, Response>(),
) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const put = vi.fn(async (cacheName: string, key: string, response: Response) => { entries.set(`${cacheName}:${key}`, response); });
  const cache = {
    match: vi.fn(async (key: string) => entries.get(`veil-app-${version}:${key}`)?.clone()),
    put: (key: string, response: Response) => put(`veil-app-${version}`, key, response),
    addAll: vi.fn(async () => {}),
  };
  const modelCache = {
    match: vi.fn(async (key: string) => entries.get(`veil-models-${modelsVersion}:${key}`)?.clone()),
    put: (key: string, response: Response) => put(`veil-models-${modelsVersion}`, key, response),
    addAll: vi.fn(async () => {}),
  };
  const caches = {
    open: vi.fn(async (name: string) => name.startsWith('veil-models-') ? modelCache : cache),
    keys: vi.fn(async () => ['veil-app-old', 'veil-app-test', 'veil-models-models-test', 'another-app']),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async (_request: Request) => new Response('asset', {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  }));
  const worker = {
    location: { origin: 'https://veil.invalid' },
    clients: { claim: vi.fn(async () => {}) },
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
  };
  const compiled = source.replace("/* SW_MANIFEST */ { version: 'unbuilt', modelsVersion: 'unbuilt', assets: [], precache: [] }", JSON.stringify({
    version, modelsVersion,
    assets: ['/index.html', '/assets/app.js', '/assets/ort.wasm', '/assets/large.bin'],
    precache: ['/index.html', '/assets/app.js'],
  }));
  new Function('self', 'caches', 'fetch', compiled)(worker, caches, fetch);
  function dispatch(name: string, request = new Request('https://veil.invalid/')) {
    let response: Promise<Response> | undefined;
    let work: Promise<unknown> | undefined;
    handlers.get(name)?.({ request, respondWith: (value) => { response = value; }, waitUntil: (value) => { work = value; } });
    return { response, work };
  }
  return { dispatch, fetch, caches, cache, put, entries };
}

describe('service worker privacy and offline policy (simulated worker)', () => {
  it('does not intercept user content, other origins, POST, query or partial requests', () => {
    const sw = harness();
    const requests = [
      new Request('blob:https://veil.invalid/private'), new Request('data:image/png;base64,AAAA'),
      new Request('https://other.invalid/assets/app.js'), new Request('https://veil.invalid/uploads/photo.png'),
      new Request('https://veil.invalid/report.json'), new Request('https://veil.invalid/models/photo.png'),
      new Request('https://veil.invalid/assets/app.js?private=value'),
      new Request('https://veil.invalid/models/test.onnx', { method: 'POST' }),
      new Request('https://veil.invalid/models/test.onnx', { headers: { Range: 'bytes=0-10' } }),
    ];
    for (const request of requests) expect(sw.dispatch('fetch', request).response).toBeUndefined();
    expect(sw.caches.open).not.toHaveBeenCalled();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it.each(['/assets/app.js', '/models/test.onnx', '/assets/ort.wasm', '/assets/large.bin'])('uses a warm cache first for %s and preserves isolation headers', async (path) => {
    const sw = harness();
    const request = new Request(`https://veil.invalid${path}`);
    const first = await sw.dispatch('fetch', request).response;
    expect(first?.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(first?.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    sw.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await sw.dispatch('fetch', request).response)?.text()).toBe('asset');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    expect(sw.caches.open).toHaveBeenCalledWith(path.startsWith('/models/') || path.endsWith('.wasm') ? 'veil-models-models-test' : 'veil-app-test');
  });

  it('uses network-first for both index URLs, with an offline/server-error fallback', async () => {
    const sw = harness();
    await sw.dispatch('fetch').response;
    sw.fetch.mockResolvedValueOnce(new Response('new index'));
    expect(await (await sw.dispatch('fetch', new Request('https://veil.invalid/index.html')).response)?.text()).toBe('new index');
    sw.fetch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    expect(await (await sw.dispatch('fetch').response)?.text()).toBe('new index');
    sw.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await (await sw.dispatch('fetch').response)?.text()).toBe('new index');
    expect(sw.fetch).toHaveBeenCalledTimes(4);
  });

  it('does not cache failed/partial downloads, no-store responses or model URLs returning images', async () => {
    for (const response of [new Response('', { status: 503 }), new Response('', { status: 206 }), new Response('', { headers: { 'Cache-Control': 'no-store' } }), new Response('', { headers: { 'Content-Type': 'image/png' } })]) {
      const sw = harness();
      sw.fetch.mockResolvedValueOnce(response);
      await sw.dispatch('fetch', new Request('https://veil.invalid/models/test.onnx')).response;
      expect(sw.put).not.toHaveBeenCalled();
    }
  });

  it('keeps the app usable on quota failure and reports cold offline failure', async () => {
    const sw = harness();
    sw.put.mockRejectedValue(new Error('quota exceeded'));
    expect(await (await sw.dispatch('fetch').response)?.text()).toBe('asset');
    sw.fetch.mockRejectedValueOnce(new Error('offline'));
    expect((await sw.dispatch('fetch').response)?.type).toBe('error');
  });

  it('installs without fetching WASM/models/large files and preserves the current model cache on app updates', async () => {
    const sw = harness();
    await sw.dispatch('install').work;
    expect(sw.cache.addAll).toHaveBeenCalledWith(['/index.html', '/assets/app.js']);
    await sw.dispatch('activate').work;
    expect(sw.caches.delete).toHaveBeenCalledExactlyOnceWith('veil-app-old');
    expect(sw.fetch).not.toHaveBeenCalled();
    expect(sw.caches.open).not.toHaveBeenCalledWith('veil-models-models-test');
  });

  it.each(['/models/test.onnx', '/assets/ort.wasm'])('retains %s across app versions and refetches after modelsVersion changes', async (path) => {
    const first = harness();
    const request = new Request(`https://veil.invalid${path}`);
    await first.dispatch('fetch', request).response;
    const appUpdate = harness({ version: 'next-app' }, first.entries);
    await appUpdate.dispatch('activate').work;
    expect(appUpdate.caches.delete).not.toHaveBeenCalledWith('veil-models-models-test');
    expect(await (await appUpdate.dispatch('fetch', request).response)?.text()).toBe('asset');
    expect(appUpdate.fetch).not.toHaveBeenCalled();

    const modelUpdate = harness({ version: 'next-app', modelsVersion: 'new-models' }, first.entries);
    await modelUpdate.dispatch('activate').work;
    expect(modelUpdate.caches.delete).toHaveBeenCalledWith('veil-models-models-test');
    expect(modelUpdate.caches.delete).not.toHaveBeenCalledWith('another-app');
    await modelUpdate.dispatch('fetch', request).response;
    expect(modelUpdate.fetch).toHaveBeenCalledTimes(1);
    expect(modelUpdate.caches.open).toHaveBeenCalledWith('veil-models-new-models');
  });
});
