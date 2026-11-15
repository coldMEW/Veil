import type { HuntHit, Transport } from './types';
import { decodeHtml, httpUrl, uniqueHits, checkResponse } from './shared';
/** DuckDuckGo HTML result anchors, including its encoded uddg redirect URLs. */
export function parseWeb(text: string): HuntHit[] {
  const hits: HuntHit[] = [];
  for (const m of text.matchAll(/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!.match(/href=["']([^"']+)/i)?.[1];
    let url = httpUrl(href, 'https://html.duckduckgo.com');
    if (!url) continue;
    const wrapper = new URL(url);
    if (wrapper.hostname.endsWith('duckduckgo.com') && wrapper.searchParams.has('uddg'))
      url = httpUrl(wrapper.searchParams.get('uddg'));
    if (url)
      hits.push({
        engine: 'web',
        pageUrl: url,
        imageUrl: null,
        thumbUrl: null,
        title: decodeHtml(m[2]!.replace(/<[^>]+>/g, '')),
      });
  }
  return uniqueHits(hits);
}
export async function web(names: string[], t: Transport): Promise<HuntHit[]> {
  let hits: HuntHit[] = [];
  for (const name of names.slice(0, 3)) {
    const cleaned = name
      .replace(/["\r\n]/g, ' ')
      .trim()
      .slice(0, 120);
    if (!cleaned) continue;
    for (const query of ['"' + cleaned + '"', '"' + cleaned + '" (deepfake OR leak OR nude)']) {
      const response = await t.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
      checkResponse(response);
      const result = parseWeb(response.text);
      if (!result.length && !/no results|No more results/i.test(response.text)) throw Error('parse-error');
      hits = uniqueHits([...hits, ...result]);
    }
  }
  return hits;
}
