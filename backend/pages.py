"""HTML image extraction and RDAP response mapping shared by endpoint and ticket checks."""
import asyncio
import html
import json
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, quote

from .net import FetchError, PAGE_LIMIT, PublicFetcher, resolve_public


def http_url(raw, base=''):
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        url = urljoin(base, html.unescape(raw.strip()))
        p = urlsplit(url)
        return url if p.scheme in ('http', 'https') and p.hostname and not p.username and not p.password else None
    except ValueError:
        return None


def extract_images(source: str, base: str, cap: int | None = 80, all_sources=False) -> list[dict]:
    class Images(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.social, self.images, self.links = [], [], []

        def handle_starttag(self, tag, attributes):
            a = dict(attributes)
            if tag == 'meta' and (a.get('property') or a.get('name')) in (
                    'og:image', 'og:image:src', 'twitter:image', 'twitter:image:src'):
                self.social.append((a.get('content'), None))
            if tag == 'img':
                if all_sources:
                    for key in ('src', 'data-src', 'data-original'):
                        if a.get(key):
                            self.images.append((a[key], a.get('alt') or None))
                    for key in ('srcset', 'data-srcset'):
                        for option in (a.get(key) or '').split(','):
                            if option.strip():
                                self.images.append((option.strip().split()[0], a.get('alt') or None))
                srcset = a.get('data-srcset') or a.get('srcset')
                source = a.get('data-src') or a.get('data-original') or a.get('src')
                if srcset:
                    def size(item):
                        fields = item.strip().split()
                        match = re.match(r'[\d.]+', fields[1]) if len(fields) > 1 else None
                        return float(match[0]) if match else 1
                    options = [item for item in srcset.split(',') if item.strip()]
                    if options:
                        source = max(options, key=size).strip().split()[0]
                self.images.append((source, a.get('alt') or None))
            if tag == 'a' and re.search(r'\.(?:jpe?g|png|webp)(?:\?[^\s]*)?$', a.get('href') or '', re.I):
                self.links.append((a['href'], None))
    parser = Images()
    parser.feed(source)
    found = {}
    for src, alt in parser.social + parser.images + parser.links:
        url = http_url(src, base)
        if url and url not in found:
            found[url] = alt
    return [{'url': url, 'alt': alt} for url, alt in list(found.items())[:cap]]


async def scan_page(raw: str, fetcher: PublicFetcher) -> dict:
    response = await fetcher.fetch(raw, accept='text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5',
                                   headers_only_images=True)
    output = {'pageUrl': response.url, 'status': response.status, 'title': None, 'images': []}
    if not 200 <= response.status < 300:
        return output
    if response.headers.get('content-type', '').lower().startswith('image/'):
        output['images'] = [{'url': response.url, 'alt': None}]
    else:
        title = re.search(r'<title[^>]*>([^<]{0,200})', response.text, re.I)
        output['title'] = html.unescape(title[1].strip()) if title else None
        output['images'] = extract_images(response.text, response.url)
    return output


def rdap_find(entities, role):
    for entity in entities or []:
        card = entity.get('vcardArray', [None, []])[1]
        name = next((field[3] for field in card if len(field) >= 4 and field[0] == 'fn'), None)
        email = next((field[3] for field in card if len(field) >= 4 and field[0] == 'email'), None)
        if role in entity.get('roles', []) and (name or email):
            return {'name': name, 'email': email}
        nested = rdap_find(entity.get('entities'), role)
        if nested:
            return {'name': nested['name'] or name, 'email': nested['email']}
    return None


async def host_info(raw: str, fetcher: PublicFetcher) -> dict:
    host, ips = await resolve_public(raw)
    labels = host.split('.')
    two_part = bool(re.match(r'^(co|com|net|org|ac|gov)\.[a-z]{2}$', '.'.join(labels[-2:])))
    domain = '.'.join(labels[-3:] if two_part else labels[-2:])
    async def rdap(path):
        try:
            response = await fetcher.fetch('https://rdap.org/' + path, accept='application/rdap+json')
            return json.loads(response.body) if response.status == 200 else None
        except (FetchError, ValueError):
            return None
    ip_data, domain_data = await asyncio.gather(rdap('ip/' + quote(ips[0], safe=':')),
                                               rdap('domain/' + quote(domain, safe='')))
    hosting_abuse = rdap_find((ip_data or {}).get('entities'), 'abuse') or {}
    hosting_org = rdap_find((ip_data or {}).get('entities'), 'registrant') or {}
    registrar = rdap_find((domain_data or {}).get('entities'), 'registrar') or {}
    registrar_abuse = rdap_find((domain_data or {}).get('entities'), 'abuse') or {}
    return {'host': host, 'ip': ips[0],
            'hosting': {'name': hosting_org.get('name') or ip_data.get('name'),
                        'email': hosting_abuse.get('email')} if ip_data else None,
            'registrar': {'name': registrar.get('name'), 'email': registrar_abuse.get('email')}
            if domain_data else None}
