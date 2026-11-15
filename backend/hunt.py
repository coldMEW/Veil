"""Real reverse-search adapters; provider failures are data, never invented hits."""
import asyncio
import base64
import html
import io
import json
import os
import re
import time
from urllib.parse import urlencode, urlsplit, parse_qs

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from .net import FetchError, PublicFetcher, resolve_public
from .pages import http_url

Image.MAX_IMAGE_PIXELS = 40_000_000


def prepare_image(data: bytes) -> bytes:
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > 40_000_000:
            image.close()
            raise FetchError(415, 'The image is too large to decode safely.')
        if image.format not in ('JPEG', 'PNG', 'WEBP'):
            raise FetchError(415, 'Use a JPEG, PNG or WebP image.')
        image = ImageOps.exif_transpose(image)
        image.thumbnail((1024, 1024))
        output = io.BytesIO()
        image.convert('RGB').save(output, format='JPEG', quality=85)
        return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise FetchError(415, 'The image could not be decoded safely.') from exc


def unique_hits(hits):
    seen, hosts, first, rest = set(), set(), [], []
    for hit in hits:
        key = (hit['pageUrl'], hit['imageUrl'])
        if key in seen:
            continue
        seen.add(key)
        host = urlsplit(hit['pageUrl']).hostname
        (rest if host in hosts else first).append(hit)
        hosts.add(host)
    return (first + rest)[:60]


def states(text):
    values = []
    for match in re.finditer(r'data-state=(["\'])(.*?)\1', text, re.S):
        try:
            value = json.loads(html.unescape(match[2]))
            if isinstance(value, dict) and isinstance(value.get('initialState'), dict):
                values.append(value['initialState'])
        except ValueError:
            pass
    try:
        value = json.loads(text)
        if isinstance(value, dict) and isinstance(value.get('initialState'), dict):
            values.append(value['initialState'])
    except ValueError:
        pass
    return values


def hit(engine, page, image=None, thumb=None, title=None, base=''):
    page = http_url(page, base)
    if not page:
        return None
    return {'engine': engine, 'pageUrl': page, 'imageUrl': http_url(image, base),
            'thumbUrl': http_url(thumb, base), 'title': title if isinstance(title, str) else None}


def parse_yandex(text, base):
    hits = []
    for state in states(text):
        for site in state.get('cbirSites', {}).get('sites', []):
            h = hit('yandex', site.get('url'), site.get('originalImage', {}).get('url'),
                    site.get('thumb', {}).get('url'), site.get('title'), base)
            if h:
                hits.append(h)
        for item in state.get('serpList', {}).get('items', {}).get('entities', {}).values():
            snippet = item.get('snippet') or {}
            preview = (item.get('preview') or [{}])[0]
            origin = preview.get('origin') or {}
            h = hit('yandex', snippet.get('url') or origin.get('url') or item.get('pageUrl'),
                    item.get('img_href') or item.get('origUrl') or (item.get('orig') or {}).get('url') or preview.get('url'),
                    preview.get('url'), snippet.get('title') or origin.get('title'), base)
            if h:
                hits.append(h)
    return unique_hits(hits)


def checked(response):
    if re.search(r'showcaptcha|captcha\.js|captcha-checkbox|anomaly-modal|verify you are human|enter the characters|challenge-platform',
                 response.url + ' ' + response.text, re.I):
        raise ValueError('captcha')
    if not 200 <= response.status < 300:
        raise ValueError('http-' + str(response.status))
    return response


class Provider:
    def __init__(self, fetcher, client):
        self.fetcher, self.client = fetcher, client
        self.cookies = httpx.Cookies()

    async def request(self, url, **kwargs):
        host = urlsplit(url).hostname or ''
        if host not in ('yandex.com', 'www.yandex.com', 'www.bing.com', 'bing.com', 'serpapi.com'):
            raise ValueError('provider-redirect-blocked')
        return checked(await self.fetcher.fetch(url, limit=12 * 1024 * 1024, client=self.client,
                                                allowed_hosts={host}, cookie_jar=self.cookies, **kwargs))


async def yandex(image, provider):
    await provider.request('https://yandex.com/images/')
    response = await provider.request('https://yandex.com/images/search?rpt=imageview&cbir_page=sites',
                                      method='POST', data={'prg': '1'},
                                      files={'upfile': ('image.jpg', image, 'image/jpeg')},
                                      headers={'referer': 'https://yandex.com/images/'})
    values = states(response.text)
    if not values:
        try:
            parsed = json.loads(response.text)
            following = http_url(parsed.get('url') or parsed.get('blocks', [{}])[0].get('params', {}).get('url'),
                                 'https://yandex.com')
            if following and urlsplit(following).hostname == 'yandex.com':
                response = await provider.request(following)
                values = states(response.text)
        except (ValueError, KeyError, IndexError):
            pass
    if not any(isinstance(s.get('cbirSites', {}).get('sites'), list) for s in values):
        raise ValueError('parse-error')
    # Sites are actual reverse-search result records, never arbitrary HTML links.
    hits = parse_yandex(response.text, response.url)
    cbir = parse_qs(urlsplit(response.url).query).get('cbir_id', [None])[0]
    cbir = cbir or next((s.get('cbirPreview', {}).get('cbirId') for s in values
                         if s.get('cbirPreview', {}).get('cbirId')), None)
    if cbir:
        try:
            similar = await provider.request('https://yandex.com/images/search?' + urlencode(
                {'rpt': 'imageview', 'cbir_id': cbir, 'cbir_page': 'similar'}))
            hits = unique_hits(hits + parse_yandex(similar.text, similar.url))
        except (FetchError, ValueError) as exc:
            raise PartialHits(str(exc), hits) from exc
    return hits


class PartialHits(Exception):
    def __init__(self, error, hits):
        self.hits = hits
        super().__init__(error)


def parse_bing(value):
    if not isinstance(value, dict) or not isinstance(value.get('tags'), list):
        raise ValueError('parse-error')
    hits = []
    for tag in value['tags']:
        for action in tag.get('actions', []):
            if action.get('actionType') not in ('PagesIncluding', 'VisualSearch'):
                continue
            for item in action.get('data', {}).get('value', []):
                h = hit('bing', item.get('hostPageUrl'), item.get('contentUrl'),
                        item.get('thumbnailUrl'), item.get('name'))
                if h:
                    hits.append(h)
    return unique_hits(hits)


async def bing(image, provider):
    response = await provider.request('https://www.bing.com/images/search?view=detailv2&iss=sbiupload',
                                      method='POST', data={'cbir': 'sbi'},
                                      files={'imageBin': ('', base64.b64encode(image), 'text/plain')})
    text = html.unescape(response.text)
    token = re.search(r'bcid_[A-Za-z0-9.-]+', text)
    sig = re.search(r'imageSignature"\s*:\s*"([^"\r\n]+)', text)
    if not token or not sig:
        raise ValueError('parse-error')
    signature = sig[1]
    parts = signature.split('|')
    if len(parts) == 3:
        key = 'AAAAC3NzaC1lZDI1NTE5AAAAIGd3gMN2v1KRLBGmotz7jbQYF8PaB+Jpe6iVf2YIeN5b'
        try:
            decoded = ''.join(chr((v ^ ord(key[i % len(key)])) - 3)
                              for i, v in enumerate(base64.b64decode(parts[1])))
            signature = '|'.join((parts[0], decoded, parts[2]))
        except ValueError:
            pass
    payload = json.dumps({'imageInfo': {'imageInsightsToken': token[0], 'source': 'Gallery'}})
    query = urlencode({'rshighlight': 'true', 'textDecorations': 'true',
                       'internalFeatures': 'similarproducts,share', 'nbl': '1', 'safeSearch': 'off',
                       'mkt': 'en-us', 'setLang': 'en-us', 'iss': 'SBIUPLOADGET', 'IID': 'idpins', 'SFX': '1'})
    response = await provider.request('https://www.bing.com/images/api/custom/knowledge?' + query,
                                      method='POST', files={'knowledgeRequest': ('', payload, 'application/json')},
                                      headers={'referer': response.url, 'X-Image-Knowledge-Signature': signature})
    return parse_bing(json.loads(response.text))


async def lens(image_url, key, provider):
    if not key:
        raise ValueError('not-configured')
    if not image_url or urlsplit(image_url).scheme != 'https':
        raise ValueError('public-image-url-required')
    await resolve_public(image_url)
    response = await provider.request('https://serpapi.com/search.json?' + urlencode(
        {'engine': 'google_lens', 'url': image_url, 'api_key': key}))
    data = json.loads(response.text)
    if data.get('error'):
        raise ValueError('provider-error')
    if not isinstance(data.get('visual_matches'), list) and not isinstance(data.get('exact_matches'), list):
        raise ValueError('parse-error')
    result = []
    for item in data.get('exact_matches', []) + data.get('visual_matches', []):
        h = hit('lens', item.get('link'), item.get('original') or item.get('image'),
                item.get('thumbnail'), item.get('title'))
        if h:
            result.append(h)
    return unique_hits(result)


async def hunt(data, engines=None, image_url=None):
    image = await asyncio.to_thread(prepare_image, data)
    selected = list(dict.fromkeys(engines or ['yandex', 'bing']))
    async def run(engine):
        start = time.monotonic()
        hits, error = [], None
        try:
            async with asyncio.timeout(22):
                async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=15) as client:
                    provider = Provider(PublicFetcher(18), client)
                    if engine == 'yandex':
                        hits = await yandex(image, provider)
                    elif engine == 'bing':
                        hits = await bing(image, provider)
                    elif engine == 'lens':
                        hits = await lens(image_url, os.getenv('SERPAPI_KEY'), provider)
                    else:
                        raise ValueError('unsupported-engine')
        except PartialHits as exc:
            hits, error = exc.hits, str(exc)
        except TimeoutError:
            error = 'timeout'
        except (FetchError, ValueError, KeyError, TypeError, httpx.HTTPError):
            # Never leak URLs containing provider keys or internal connection details.
            import sys
            exc = sys.exception()
            error = str(exc) if isinstance(exc, ValueError) and str(exc) in (
                'captcha', 'parse-error', 'not-configured', 'provider-error', 'public-image-url-required',
                'unsupported-engine', 'http-401', 'http-403', 'http-404', 'http-429') else 'network-error'
        return {'engine': engine, 'ok': error is None, 'hits': hits,
                **({'error': error} if error else {}), 'ms': round((time.monotonic() - start) * 1000)}
    return await asyncio.gather(*(run(engine) for engine in selected[:4]))
