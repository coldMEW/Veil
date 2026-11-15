import { describe, expect, it } from 'vitest';
import { extractImages } from './extract';

describe('extractImages', () => {
  it.each([
    'src="placeholder.png" data-src="real.png"',
    'data-src="real.png" src="placeholder.png"',
    'src="placeholder.png" data-original="real.png"',
  ])('prefers lazy sources regardless of order: %s', (attributes) => {
    expect(extractImages(`<img ${attributes}>`, 'https://example.com/')[0]?.url).toBe(
      'https://example.com/real.png',
    );
  });
  it('extracts social images, resolves relative URLs and decodes entities', () => {
    expect(
      extractImages(
        `<meta property="og:image" content="/og.png?a=1&amp;b=2"><meta content="twitter.png" name="twitter:image"><img data-src="lazy.jpg" alt="A &amp; B"><img src="data:image/png;base64,abc">`,
        'https://example.com/path/',
      ),
    ).toEqual([
      { url: 'https://example.com/og.png?a=1&b=2', alt: null },
      { url: 'https://example.com/path/twitter.png', alt: null },
      { url: 'https://example.com/path/lazy.jpg', alt: 'A & B' },
    ]);
  });
  it.each(['large.jpg 1200w, small.jpg 320w', 'small.jpg 1x, large.jpg 3x, medium.jpg 2x'])(
    'selects the largest descriptor from %s',
    (srcset) => {
      expect(extractImages(`<img srcset="${srcset}">`, 'https://example.com/')[0]?.url).toBe(
        'https://example.com/large.jpg',
      );
    },
  );
  it('deduplicates before enforcing the 80 image cap', () => {
    const html =
      '<img src="0.png">'.repeat(90) + Array.from({ length: 90 }, (_, i) => `<img src="${i}.png">`).join('');
    const result = extractImages(html, 'https://example.com/');
    expect(result).toHaveLength(80);
    expect(result[79]?.url).toBe('https://example.com/79.png');
  });
});
