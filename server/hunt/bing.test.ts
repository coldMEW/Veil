import { describe, it, expect } from 'vitest';
import landing from '../../tests/hunt/fixtures/bing-upload-landing.html?raw';
import knowledge404 from '../../tests/hunt/fixtures/bing-knowledge-404.html?raw';
import { bing, parseBingJSON, parseBingHTML } from './bing';
import type { Transport } from './types';
const fixture = (name: string) => (name === 'bing-upload-landing.html' ? landing : knowledge404);
describe('Bing recorded failures', () => {
  it('rejects the real 200 generic landing page as parse-error', () =>
    expect(() => parseBingHTML(fixture('bing-upload-landing.html'))).toThrow('parse-error'));
  it('reports the real knowledge endpoint 404 without parsing generic images', async () => {
    const t: Transport = {
      get: async () => {
        throw Error('unused');
      },
      postMultipart: async () => ({
        status: 404,
        url: 'https://www.bing.com/images/api/custom/knowledge',
        headers: {},
        text: fixture('bing-knowledge-404.html'),
      }),
    };
    await expect(bing({ bytes: new Uint8Array([1]), type: 'image/jpeg' }, t)).rejects.toThrow('http-404');
  });
});
describe('Bing schema unit cases (synthetic, not live evidence)', () => {
  it('maps PagesIncluding and VisualSearch while deduplicating and filtering unsafe URLs', () => {
    const item = {
      name: 'A &amp; B',
      hostPageUrl: 'https://example.com/page',
      contentUrl: 'https://example.com/photo.jpg',
      thumbnailUrl: 'javascript:bad',
    };
    expect(
      parseBingJSON({
        tags: [
          {
            actions: [
              {
                actionType: 'PagesIncluding',
                data: { value: [item, { ...item, hostPageUrl: 'javascript:bad' }] },
              },
              { actionType: 'VisualSearch', data: { value: [item] } },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        engine: 'bing',
        pageUrl: 'https://example.com/page',
        imageUrl: 'https://example.com/photo.jpg',
        thumbUrl: null,
        title: 'A & B',
      },
    ]);
  });
  it('accepts empty recognized JSON, rejects unrecognized JSON', () => {
    expect(parseBingJSON({ tags: [] })).toEqual([]);
    expect(() => parseBingJSON({})).toThrow('parse-error');
  });
  it('recognizes a captcha', () => expect(() => parseBingJSON('verify you are human')).toThrow('captcha'));
  it('caps result count at 60', () =>
    expect(
      parseBingJSON({
        tags: [
          {
            actions: [
              {
                actionType: 'VisualSearch',
                data: {
                  value: Array.from({ length: 80 }, (_, i) => ({ hostPageUrl: 'https://example.com/' + i })),
                },
              },
            ],
          },
        ],
      }),
    ).toHaveLength(60));
});
