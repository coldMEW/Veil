import { describe, it, expect, vi } from 'vitest';
import recorded from '../../tests/hunt/fixtures/yandex-recorded-sites.json';
import webRecorded from '../../tests/hunt/fixtures/web-recorded.html?raw';
import lensRecorded from '../../tests/hunt/fixtures/lens-recorded-unauthorized.json?raw';
import { parseYandex } from './yandex';
import { parseLens } from './lens';
import { parseWeb } from './web';
import { hunt, huntByUrl } from './index';
import { uniqueHits, httpUrl, publicImageUrl } from './shared';
import type { Transport, TransportResponse, HuntHit } from './types';
const response = (text: string, url = 'https://yandex.com/images/search'): TransportResponse => ({
  status: 200,
  url,
  headers: {},
  text,
});
const image = { bytes: new Uint8Array([1, 2, 3]), type: 'image/jpeg' };
describe('portable hunt', () => {
  it('blocks private/local image URLs and malformed Lens success shapes', () => {
    for (const url of [
      'https://127.0.0.1/a',
      'https://10.0.0.1/a',
      'https://[::1]/a',
      'https://[fc00::1]/a',
      'https://[::ffff:127.0.0.1]/a',
      'https://printer.local/a',
      'http://example.com/a',
    ])
      expect(publicImageUrl(url)).toBeNull();
    expect(() => parseLens('{}')).toThrow('parse-error');
  });
  it('preserves already-recorded source hits when optional enrichment is captcha blocked', async () => {
    const t: Transport = {
      get: async (url) => response(url.includes('cbir_page') ? 'showcaptcha' : '', url),
      postMultipart: async () =>
        response(JSON.stringify(recorded), 'https://yandex.com/images/search?cbir_id=recorded'),
    };
    const [result] = await hunt(image, t, { engines: ['yandex'] });
    expect(result).toMatchObject({ ok: false, error: 'captcha' });
    expect(result!.hits).toHaveLength(5);
  });

  it('parses recorded live DuckDuckGo result anchors', () => expect(parseWeb(webRecorded)).toHaveLength(3));
  it('does not treat recorded SerpApi401 as successful zero matches', () =>
    expect(() => parseLens(lensRecorded)).toThrow('provider-error'));
  it('parses actual recorded Yandex source sites and source image URLs', () => {
    const hits = parseYandex(JSON.stringify(recorded));
    expect(hits.length).toBe(5);
    expect(hits.some((h) => h.pageUrl.includes('wikipedia.org'))).toBe(true);
    expect(hits.every((h) => h.imageUrl?.startsWith('https://'))).toBe(true);
  });
  it('decodes HTML state entities from the recorded payload', () => {
    const state = JSON.stringify(recorded).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    expect(parseYandex('<div data-state="' + state + '"></div>')).toHaveLength(5);
  });
  it('returns only safe http(s) results and caps/dedupes with host diversity', () => {
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(httpUrl('https://user:pass@example.com')).toBeNull();
    const hits: HuntHit[] = Array.from({ length: 80 }, (_, i) => ({
      engine: 'web',
      pageUrl: 'https://one.example/' + i,
      imageUrl: null,
      title: null,
      thumbUrl: null,
    }));
    hits.push({ ...hits[0]!, pageUrl: 'https://other.example/photo' });
    const result = uniqueHits([...hits, ...hits]);
    expect(result).toHaveLength(60);
    expect(result[1]!.pageUrl).toContain('other.example');
    expect(new Set(result.map((h) => h.pageUrl)).size).toBe(60);
  });
  it('one timeout does not discard the other engine results', async () => {
    const t: Transport = {
      get: vi.fn(async () => response('')),
      postMultipart: (url) =>
        url.includes('bing') ? new Promise(() => {}) : Promise.resolve(response(JSON.stringify(recorded))),
    };
    const result = await hunt(image, t, { engines: ['yandex', 'bing'], timeoutMs: 20 });
    expect(result[0]!.ok).toBe(true);
    expect(result[1]).toMatchObject({ ok: false, error: 'timeout' });
  });
  it('reports captcha as failure rather than a clean zero-match result', async () => {
    const t: Transport = {
      get: async () => response('<form action="/showcaptcha">verify you are human</form>'),
      postMultipart: vi.fn(),
    };
    expect((await hunt(image, t, { engines: ['yandex'] }))[0]).toMatchObject({ ok: false, error: 'captcha' });
  });
  it('validates image type and8MB budget before sending', async () => {
    const t = { get: vi.fn(), postMultipart: vi.fn() } as Transport;
    await expect(hunt({ ...image, type: 'image/svg+xml' }, t)).rejects.toThrow('invalid-image');
    await expect(hunt({ ...image, bytes: new Uint8Array(8 * 1024 * 1024 + 1) }, t)).rejects.toThrow();
    expect(t.postMultipart).not.toHaveBeenCalled();
  });
  it('does not upload or invent a public URL for Lens', async () => {
    const t = { get: vi.fn(), postMultipart: vi.fn() } as Transport;
    expect((await hunt(image, t, { engines: ['lens'], serpApiKey: 'test' }))[0]!.error).toBe(
      'image-url-required',
    );
    expect((await huntByUrl('https://example.com/image.jpg', t, { engines: ['lens'] }))[0]!.error).toBe(
      'api-key-required',
    );
    expect(t.get).not.toHaveBeenCalled();
  });
  it('parses Lens documented-schema synthetic data without unsafe links', () => {
    expect(
      parseLens(
        JSON.stringify({
          visual_matches: [
            { link: 'https://example.com/page', original: 'https://example.com/img', title: 'title' },
            { link: 'javascript:bad' },
          ],
        }),
      ),
    ).toEqual([
      {
        engine: 'lens',
        pageUrl: 'https://example.com/page',
        imageUrl: 'https://example.com/img',
        title: 'title',
        thumbUrl: null,
      },
    ]);
  });
  it('parses DuckDuckGo redirect links without engine-navigation matches', () => {
    const text =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fphoto">A &amp; B</a>';
    expect(parseWeb(text)).toEqual([
      { engine: 'web', pageUrl: 'https://example.com/photo', imageUrl: null, thumbUrl: null, title: 'A & B' },
    ]);
  });
});
