import type { HuntHit, HuntImage, Transport, TransportResponse } from './types';
import { base64, checkResponse, decodeHtml, httpUrl, uniqueHits } from './shared';

// Protocol reference: kitUIN/PicImageSearch 784713e546273a09aae4b247a8b6f798825efafa.
// Bing can return a generic image landing page with HTTP 200; that is a parse error.
const ROOT = 'https://www.bing.com';
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
}
export function parseBingJSON(input: unknown): HuntHit[] {
  let data: unknown = input;
  if (typeof input === 'string') {
    checkResponse({ status: 200, url: ROOT, text: input });
    try {
      data = JSON.parse(input);
    } catch {
      throw Error('parse-error');
    }
  }
  const root = object(data);
  if (!root || !Array.isArray(root.tags)) throw Error('parse-error');
  const hits: HuntHit[] = [];
  for (const tag of root.tags) {
    const actions = object(tag)?.actions;
    if (!Array.isArray(actions)) continue;
    for (const value of actions) {
      const action = object(value);
      if (!action || !['PagesIncluding', 'VisualSearch'].includes(String(action.actionType))) continue;
      const values = object(action.data)?.value;
      if (!Array.isArray(values)) continue;
      for (const entry of values) {
        const item = object(entry);
        if (!item) continue;
        const pageUrl = httpUrl(item.hostPageUrl);
        if (!pageUrl) continue;
        hits.push({
          engine: 'bing',
          pageUrl,
          imageUrl: httpUrl(item.contentUrl),
          thumbUrl: httpUrl(item.thumbnailUrl),
          title: typeof item.name === 'string' ? decodeHtml(item.name) : null,
        });
      }
    }
  }
  return uniqueHits(hits);
}
/** Parse embedded iusc metadata only on a positively identified reverse-search page. */
export function parseBingHTML(html: string): HuntHit[] {
  checkResponse({ status: 200, url: ROOT, text: html });
  if (!/bcid_[A-Za-z0-9.-]+|imageInsightsToken|imageSignature(?:&quot;|")/.test(html))
    throw Error('parse-error');
  const hits: HuntHit[] = [];
  let recognized = false;
  for (const match of html.matchAll(/\bm\s*=\s*(["'])([\s\S]*?)\1/g)) {
    let item: RecordValue | null;
    try {
      item = object(JSON.parse(decodeHtml(match[2]!)));
    } catch {
      continue;
    }
    if (!item || !('purl' in item)) continue;
    recognized = true;
    const pageUrl = httpUrl(item.purl);
    if (!pageUrl) continue;
    hits.push({
      engine: 'bing',
      pageUrl,
      imageUrl: httpUrl(item.murl),
      thumbUrl: httpUrl(item.turl),
      title: typeof item.t === 'string' ? decodeHtml(item.t) : null,
    });
  }
  if (!recognized) throw Error('parse-error');
  return uniqueHits(hits);
}
function signature(raw: string): string {
  const parts = raw.split('|');
  if (parts.length !== 3) return raw;
  const key = 'AAAAC3NzaC1lZDI1NTE5AAAAIGd3gMN2v1KRLBGmotz7jbQYF8PaB+Jpe6iVf2YIeN5b';
  try {
    const bytes = atob(parts[1]!);
    let decoded = '';
    for (let i = 0; i < bytes.length; i++) {
      const code = (bytes.charCodeAt(i) ^ key.charCodeAt(i % key.length)) - 3;
      if (code < 0) return raw;
      decoded += String.fromCharCode(code);
    }
    return `${parts[0]}|${decoded}|${parts[2]}`;
  } catch {
    return raw;
  }
}
async function insights(response: TransportResponse, t: Transport, imageUrl?: string): Promise<HuntHit[]> {
  checkResponse(response);
  const html = decodeHtml(response.text);
  const token = html.match(/bcid_[A-Za-z0-9.-]+/)?.[0];
  const sig = html.match(/imageSignature"\s*:\s*"([^"\r\n]+)/)?.[1];
  const skey = html.match(/skey=([^&"\s]+)/)?.[1];
  if ((!imageUrl && !token) || !sig) throw Error('parse-error');
  const params = new URLSearchParams({
    rshighlight: 'true',
    textDecorations: 'true',
    internalFeatures: 'similarproducts,share',
    nbl: '1',
    safeSearch: 'off',
    mkt: 'en-us',
    setLang: 'en-us',
    iss: 'SBIUPLOADGET',
    IID: 'idpins',
    SFX: '1',
  });
  if (skey) params.set('skey', skey);
  if (token && !imageUrl) params.set('insightsToken', token);
  const imageInfo = imageUrl
    ? { url: imageUrl, source: 'Url' }
    : { imageInsightsToken: token, source: 'Gallery' };
  const result = await t.postMultipart(
    ROOT + '/images/api/custom/knowledge?' + params,
    {},
    {
      field: 'knowledgeRequest',
      name: '',
      type: 'application/json',
      bytes: new TextEncoder().encode(JSON.stringify({ imageInfo })),
    },
    { Referer: response.url, 'X-Image-Knowledge-Signature': signature(sig) },
  );
  checkResponse(result);
  return parseBingJSON(result.text);
}
export async function bing(image: HuntImage, t: Transport): Promise<HuntHit[]> {
  const response = await t.postMultipart(
    ROOT + '/images/search?view=detailv2&iss=sbiupload',
    { cbir: 'sbi' },
    { field: 'imageBin', name: '', type: 'text/plain', bytes: new TextEncoder().encode(base64(image.bytes)) },
  );
  return insights(response, t);
}
export async function bingByUrl(imageUrl: string, t: Transport): Promise<HuntHit[]> {
  const url = httpUrl(imageUrl);
  if (!url) throw Error('parse-error');
  return insights(
    await t.get(
      ROOT +
        '/images/search?' +
        new URLSearchParams({
          view: 'detailv2',
          iss: 'sbi',
          FORM: 'SBIHMP',
          sbisrc: 'UrlPaste',
          q: 'imgurl:' + url,
          idpbck: '1',
        }),
    ),
    t,
    url,
  );
}
