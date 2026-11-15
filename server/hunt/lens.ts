import type { HuntHit, Transport } from './types';
import { httpUrl, uniqueHits, checkResponse, publicImageUrl } from './shared';
export function parseLens(text: string): HuntHit[] {
  const data = JSON.parse(text) as {
    error?: unknown;
    visual_matches?: Array<Record<string, unknown>>;
    exact_matches?: Array<Record<string, unknown>>;
  };
  if (data.error) throw Error('provider-error');
  if (!Array.isArray(data.visual_matches) && !Array.isArray(data.exact_matches)) throw Error('parse-error');
  return uniqueHits(
    [...(data.exact_matches ?? []), ...(data.visual_matches ?? [])].flatMap((item) => {
      const pageUrl = httpUrl(item.link);
      return pageUrl
        ? [
            {
              engine: 'lens' as const,
              pageUrl,
              imageUrl: httpUrl(item.original ?? item.image),
              thumbUrl: httpUrl(item.thumbnail),
              title: typeof item.title === 'string' ? item.title : null,
            },
          ]
        : [];
    }),
  );
}
export async function lens(imageUrl: string, key: string, t: Transport): Promise<HuntHit[]> {
  const source = publicImageUrl(imageUrl);
  if (!source) throw Error('invalid-image-url');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_lens');
  url.searchParams.set('url', source);
  url.searchParams.set('api_key', key);
  const result = await t.get(url.href);
  checkResponse(result);
  return parseLens(result.text);
}
