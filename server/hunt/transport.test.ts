import { afterEach, it, expect, vi } from 'vitest';
import { createFetchTransport } from './fetchTransport';
afterEach(() => vi.unstubAllGlobals());
it('blocks non-provider origins before network activity', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  await expect(createFetchTransport().get('https://example.com/')).rejects.toThrow(
    'provider-redirect-blocked',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('does not forward an upload to an untrusted redirect host', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 307, headers: { location: 'https://evil.example/collect' } }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(
    createFetchTransport().postMultipart(
      'https://yandex.com/images/search',
      {},
      { name: 'x', field: 'upfile', type: 'image/jpeg', bytes: new Uint8Array([1]) },
    ),
  ).rejects.toThrow('provider-redirect-blocked');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps provider cookies in the request-scoped transport', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response('ok', { headers: { 'set-cookie': 'session=test; Path=/; HttpOnly' } }),
  );
  vi.stubGlobal('fetch', fetch);
  const t = createFetchTransport();
  await t.get('https://yandex.com/images/');
  await t.get('https://yandex.com/images/search');
  expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('cookie')).toBe('session=test');
});
it('aborts native provider traffic at its execution deadline', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        }),
    ),
  );
  const t = createFetchTransport().withDeadline!(performance.now() + 25);
  await expect(t.get('https://yandex.com/images/')).rejects.toMatchObject({ name: 'TimeoutError' });
});
