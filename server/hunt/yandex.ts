import type { HuntHit, HuntImage, Transport } from './types';
import { checkResponse, decodeHtml, httpUrl, uniqueHits, PartialHuntError } from './shared';
type ObjectValue = Record<string, unknown>;
function record(v: unknown): ObjectValue {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as ObjectValue) : {};
}
export function yandexStates(text: string): ObjectValue[] {
  const states: ObjectValue[] = [];
  for (const m of text.matchAll(/data-state=(["'])(.*?)\1/gs)) {
    try {
      const value = record(JSON.parse(decodeHtml(m[2]!)));
      if (value.initialState) states.push(record(value.initialState));
    } catch {
      /* unrelated state */
    }
  }
  try {
    const value = record(JSON.parse(text));
    if (value.initialState) states.push(record(value.initialState));
  } catch {
    /* HTML */
  }
  return states;
}
function siteHit(value: unknown, base: string): HuntHit | null {
  const item = record(value),
    original = record(item.originalImage),
    thumb = record(item.thumb),
    pageUrl = httpUrl(item.url, base);
  if (!pageUrl) return null;
  return {
    engine: 'yandex',
    pageUrl,
    imageUrl: httpUrl(original.url, base),
    thumbUrl: httpUrl(thumb.url, base),
    title: typeof item.title === 'string' ? item.title : null,
  };
}
/** Parse actual ImagesApp data-state; never treat arbitrary navigation links as matches. */
export function parseYandex(text: string, base = 'https://yandex.com/images/search'): HuntHit[] {
  const hits: HuntHit[] = [];
  for (const state of yandexStates(text)) {
    const sites = record(state.cbirSites).sites;
    if (Array.isArray(sites))
      for (const site of sites) {
        const hit = siteHit(site, base);
        if (hit) hits.push(hit);
      }
    const items = record(record(state.serpList).items),
      entities = record(items.entities);
    for (const raw of Object.values(entities)) {
      const item = record(raw),
        snippet = record(item.snippet),
        preview = Array.isArray(item.preview) ? record(item.preview[0]) : {},
        origin = record(preview.origin);
      const pageUrl = httpUrl(snippet.url ?? origin.url ?? item.pageUrl, base);
      if (!pageUrl) continue;
      hits.push({
        engine: 'yandex',
        pageUrl,
        imageUrl: httpUrl(item.img_href ?? item.origUrl ?? record(item.orig).url ?? preview.url, base),
        thumbUrl: httpUrl(preview.url, base),
        title:
          typeof snippet.title === 'string'
            ? snippet.title
            : typeof origin.title === 'string'
              ? origin.title
              : null,
      });
    }
  }
  return uniqueHits(hits);
}
export async function yandex(image: HuntImage, t: Transport): Promise<HuntHit[]> {
  // Current maintained client uses prg=1 and HTML redirect; the legacy JSON-block upload is not required.
  const warm = await t.get('https://yandex.com/images/');
  checkResponse(warm);
  let response = await t.postMultipart(
    'https://yandex.com/images/search?rpt=imageview&cbir_page=sites',
    { prg: '1' },
    {
      field: 'upfile',
      name: 'image.' + (image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'),
      type: image.type,
      bytes: image.bytes,
    },
    { referer: 'https://yandex.com/images/' },
  );
  checkResponse(response);
  if (!yandexStates(response.text).length) {
    try {
      const upload = JSON.parse(response.text) as {
        url?: string;
        blocks?: Array<{ params?: { url?: string } }>;
      };
      const next = httpUrl(upload.url ?? upload.blocks?.[0]?.params?.url, 'https://yandex.com');
      if (next && new URL(next).hostname === 'yandex.com') {
        response = await t.get(next);
        checkResponse(response);
      }
    } catch {
      /* handled as parse-error below */
    }
  }
  const states = yandexStates(response.text),
    valid = states.some((s) => Array.isArray(record(s.cbirSites).sites));
  if (!valid) throw Error('parse-error');
  let hits = parseYandex(response.text, response.url);
  const cbir =
    new URL(response.url).searchParams.get('cbir_id') ??
    states.map((s) => record(s.cbirPreview).cbirId).find((v): v is string => typeof v === 'string');
  if (cbir) {
    const similar = new URL('https://yandex.com/images/search');
    similar.searchParams.set('rpt', 'imageview');
    similar.searchParams.set('cbir_id', cbir);
    similar.searchParams.set('cbir_page', 'similar');
    try {
      const result = await t.get(similar.href);
      checkResponse(result);
      hits = uniqueHits([...hits, ...parseYandex(result.text, result.url)]);
    } catch (error) {
      if (hits.length)
        throw new PartialHuntError(error instanceof Error ? error.message : 'network-error', hits);
      throw error;
    }
  }
  return hits;
}
