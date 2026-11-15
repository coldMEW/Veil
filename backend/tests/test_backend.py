import asyncio
import io
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import create_app
from backend.hunt import parse_yandex, parse_bing, prepare_image
from backend.net import Fetched, FetchError, PublicFetcher, public_ip, resolve_public
from backend.pages import extract_images
from backend.tickets import TicketStore, classify_reply, parse_time, recheck, scheduler_tick


@pytest.mark.parametrize('ip', ['127.0.0.1', '10.2.3.4', '172.16.0.1', '172.31.255.1', '192.168.1.1',
                               '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
                               '::1', '::', 'fc00::1', 'fdff::1', 'fe80::1', 'fe90::1', 'fea0::1',
                               'febf::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2001:db8::1'])
def test_private_ip(ip):
    assert not public_ip(ip)
    with pytest.raises(FetchError):
        asyncio.run(resolve_public(f'http://[{ip}]/' if ':' in ip else f'http://{ip}/'))


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com',
                                'not a url', 'http://127.0.0.1\\@example.com', 'http://example.com/\n'])
def test_ssrf_syntax(url):
    with pytest.raises(FetchError):
        asyncio.run(resolve_public(url))


def test_public_ip():
    assert public_ip('172.32.0.1')
    assert public_ip('93.184.216.34')
    assert public_ip('2606:4700:4700::1111')


@pytest.mark.parametrize('attrs', ['src="placeholder.png" data-src="real.png"',
                                  'data-src="real.png" src="placeholder.png"',
                                  'src="placeholder.png" data-original="real.png"'])
def test_lazy_parity(attrs):
    assert extract_images(f'<img {attrs}>', 'https://example.com/')[0]['url'] == 'https://example.com/real.png'


def test_social_parity():
    source = ('<meta property="og:image" content="/og.png?a=1&amp;b=2">'
              '<meta content="twitter.png" name="twitter:image"><img data-src="lazy.jpg" alt="A &amp; B">'
              '<img src="data:image/png;base64,abc">')
    assert extract_images(source, 'https://example.com/path/') == [
        {'url': 'https://example.com/og.png?a=1&b=2', 'alt': None},
        {'url': 'https://example.com/path/twitter.png', 'alt': None},
        {'url': 'https://example.com/path/lazy.jpg', 'alt': 'A & B'}]


@pytest.mark.parametrize('srcset', ['large.jpg 1200w, small.jpg 320w', 'small.jpg 1x, large.jpg 3x, medium.jpg 2x'])
def test_srcset_parity(srcset):
    assert extract_images(f'<img srcset="{srcset}">', 'https://example.com/')[0]['url'].endswith('/large.jpg')


def test_dedupe_cap():
    source = '<img src="0.png">' * 90 + ''.join(f'<img src="{i}.png">' for i in range(90))
    assert len(extract_images(source, 'https://example.com/')) == 80
    assert len(extract_images(source, 'https://example.com/', cap=None)) == 90


@pytest.mark.parametrize(('text', 'expected'), [
    ('The image has been removed.', 'removed'), ('The images have been deleted.', 'removed'),
    ('We have removed the content.', 'removed'), ('The page was taken down.', 'removed'),
    ('The URL is now disabled.', 'removed'), ('We already removed the material.', 'removed'),
    ('We have not removed the image.', 'rejected'), ('The image has NOT been removed.', 'rejected'),
    ('We cannot remove this content.', 'rejected'), ('We are unable to remove it.', 'rejected'),
    ("The image hasn't been removed.", 'rejected'), ('We will not take down the page.', 'rejected'),
    ('Your request is rejected.', 'rejected'), ('Your request was denied.', 'rejected'),
    ('There is no violation.', 'rejected'), ('This is not infringing.', 'rejected'),
    ('Please provide more information.', 'needs_info'), ('We need additional evidence.', 'needs_info'),
    ('Please confirm your ownership.', 'needs_info'), ('We need the exact URL.', 'needs_info'),
    ('Missing identity documents.', 'needs_info'), ('We cannot remove it; please provide evidence.', 'needs_info'),
    ('We will remove it soon.', 'acknowledged'), ('We may delete the content.', 'acknowledged'),
    ('We are going to remove the page.', 'acknowledged'), ('Please remove this content.', 'acknowledged'),
    ('Your request was received.', 'acknowledged'), ('We are reviewing it.', 'acknowledged'),
    ('We are investigating the URL.', 'acknowledged'), ('It is under review.', 'acknowledged'),
    ('', 'unknown'), ('Hello world.', 'unknown'), ('This is an automated vacation response.', 'unknown'),
    ('> The image has been removed.\nHello.', 'unknown'),
    ('We will review.\nOn Tuesday Alice wrote:\nThe image has been removed.', 'unknown'),
])
def test_reply_table(text, expected):
    assert classify_reply(text) == expected


class FixtureHandler(BaseHTTPRequestHandler):
    state = {'status': 200, 'page': '<img src="/photo.jpg">', 'slow': False}

    def do_GET(self):
        if self.state['slow']:
            time.sleep(0.3)
        status = self.state['status'] if self.path == '/photo.jpg' else 200
        body = b'photo' if self.path == '/photo.jpg' else self.state['page'].encode()
        self.send_response(status)
        self.send_header('Content-Type', 'image/jpeg' if self.path == '/photo.jpg' else 'text/html')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


@pytest.fixture
def local_site():
    FixtureHandler.state = {'status': 200, 'page': '<img src="/photo.jpg">', 'slow': False}
    server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}', FixtureHandler.state
    server.shutdown()
    server.server_close()


class LocalSocketFetcher:
    """Test-only local transport; no public-fetch policy bypass exists in product configuration."""
    async def fetch(self, url, **kwargs):
        try:
            async with httpx.AsyncClient(timeout=0.08, trust_env=False) as client:
                response = await client.get(url)
                return Fetched(response.status_code, str(response.url), dict(response.headers), response.content)
        except httpx.TimeoutException as exc:
            raise FetchError(504, 'The site took too long to answer.') from exc


def make_ticket(store, base):
    return store.upsert({'id': 'ticket1', 'pageUrl': base + '/page', 'imageUrl': base + '/photo.jpg',
                         'createdAt': 1700000000000})


def test_real_socket_recheck_flip_and_timeout(tmp_path, local_site):
    base, state = local_site
    store = TicketStore(tmp_path / 'tickets.db')
    make_ticket(store, base)
    store.event('ticket1', 'sent', {'to': ['abuse@example.com']}, status='sent')
    fetcher = LocalSocketFetcher()
    assert asyncio.run(recheck(store, 'ticket1', fetcher))['events'][-1]['type'] == 'present'
    state['slow'] = True
    record = asyncio.run(recheck(store, 'ticket1', fetcher))
    assert record['status'] == 'sent' and record['events'][-1]['type'] == 'unknown'
    state['slow'] = False
    state['status'] = 404
    record = asyncio.run(recheck(store, 'ticket1', fetcher))
    assert record['status'] == 'removed'
    assert [event['type'] for event in record['events']] == ['created', 'sent', 'present', 'unknown', 'removed']


@pytest.mark.parametrize('status', [403, 500, 503])
def test_recheck_error_not_removed(tmp_path, local_site, status):
    base, state = local_site
    store = TicketStore(tmp_path / 'tickets.db')
    make_ticket(store, base)
    state['status'] = status
    result = asyncio.run(recheck(store, 'ticket1', LocalSocketFetcher()))
    assert result['status'] == 'ready' and result['events'][-1]['type'] == 'unknown'


@pytest.mark.parametrize('page', ['<img src="/other.jpg">', '<img src="/other.jpg"><p>All done.</p>'])
def test_real_page_no_longer_lists_image(tmp_path, local_site, page):
    base, state = local_site
    state['page'] = page
    store = TicketStore(tmp_path / 'tickets.db')
    make_ticket(store, base)
    assert asyncio.run(recheck(store, 'ticket1', LocalSocketFetcher()))['status'] == 'removed'


@pytest.mark.parametrize('page', ['<p>Enable JavaScript</p>', '<h1>Sign in</h1>', '<p>Empty SPA</p>',
                               '<img src="/photo.jpg" srcset="/larger.jpg 2x">',
                               '<img src="/photo.jpg" data-src="/actual.jpg">',
                               ''.join(f'<img src="/{i}.jpg">' for i in range(90)) + '<img src="/photo.jpg">'])
def test_recheck_does_not_misread_extractor_or_challenge(tmp_path, local_site, page):
    base, state = local_site
    state['page'] = page
    store = TicketStore(tmp_path / 'tickets.db')
    make_ticket(store, base)
    assert asyncio.run(recheck(store, 'ticket1', LocalSocketFetcher()))['status'] != 'removed'


def test_scheduler_overdue_once(tmp_path, local_site):
    base, state = local_site
    store = TicketStore(tmp_path / 'tickets.db')
    make_ticket(store, base)
    before = datetime.now(timezone.utc) - timedelta(hours=49)
    store.event('ticket1', 'sent', {'to': ['abuse@example.com']}, at=before.isoformat(), status='sent')
    asyncio.run(scheduler_tick(store, LocalSocketFetcher()))
    asyncio.run(scheduler_tick(store, LocalSocketFetcher()))
    assert sum(event['type'] == 'overdue' for event in store.get('ticket1')['events']) == 1
    assert parse_time(1700000000000).year == 2023


def test_api_storage_validation_and_cross_origin(tmp_path):
    app = create_app(db_path=tmp_path / 'tickets.db', start_scheduler=False)
    with TestClient(app, base_url='http://127.0.0.1') as client:
        assert client.get('/api/health').status_code == 200
        assert client.post('/api/tickets', json={}, headers={'Origin': 'https://evil.example'}).status_code == 403
        assert client.get('/api/tickets', headers={'Host': 'evil.example'}).status_code == 400
        assert client.post('/api/tickets', json={'id': 'x', 'pageUrl': 'https://example.com', 'photos': []}).status_code == 422
        assert client.post('/api/tickets', json={'id': 'x', 'pageUrl': 'http://127.0.0.1'}).status_code == 400
        assert client.get('/api/not-found').status_code == 404
        assert client.get('/backend/requirements.txt').status_code == 404
        store = app.state.store
        make_ticket(store, 'https://example.com')
        sent = client.post('/api/tickets/ticket1/sent', json={'to': ['abuse@example.com'], 'at': 1700000000000})
        assert sent.json()['status'] == 'sent'
        replied = client.post('/api/tickets/ticket1/reply', json={'verdict': 'needs_info', 'from': 'abuse@example.com', 'snippet': 'Need evidence'})
        assert replied.json()['status'] == 'needs_info'
        assert len(client.get('/api/tickets?ids=ticket1').json()[0]['events']) == 3
        assert client.post('/api/tickets/ticket1/send', json={'to': ['abuse@example.com'], 'subject': 'Test', 'text': 'Synthetic'}).status_code == 503


def test_prepare_real_image_and_invalid():
    image = Image.new('RGB', (1600, 800), (100, 120, 130))
    output = io.BytesIO()
    image.save(output, format='PNG')
    prepared = prepare_image(output.getvalue())
    assert Image.open(io.BytesIO(prepared)).size == (1024, 512)
    with pytest.raises(FetchError):
        prepare_image(b'not an image')


def test_recorded_yandex_and_bing_failure():
    from pathlib import Path
    text = (Path(__file__).resolve().parents[2] / 'tests/hunt/fixtures/yandex-recorded-sites.json').read_text()
    hits = parse_yandex(text, 'https://yandex.com/images/search')
    assert hits
    assert all(hit['engine'] == 'yandex' and hit['pageUrl'].startswith('http') for hit in hits)
    with pytest.raises(ValueError, match='parse-error'):
        parse_bing({'landing': 'not reverse search results'})
