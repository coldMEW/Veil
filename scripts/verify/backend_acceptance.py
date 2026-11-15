"""Real Python backend acceptance. Only a public Wikimedia landmark is uploaded."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg'
PAGE = 'https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons.jpg'


def request(base: str, path: str, body=None, raw=False):
    headers = {'User-Agent': 'VeilAcceptance/1.0'}
    if body is not None:
        headers['Content-Type'] = 'image/jpeg' if raw else 'application/json'
        if not raw:
            body = json.dumps(body).encode()
    started = time.monotonic()
    req = urllib.request.Request(base + path, data=body, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(20 * 1024 * 1024 + 1)
        parsed = json.loads(data) if 'json' in response.headers.get('content-type', '') else None
        return response.status, parsed, round((time.monotonic() - started) * 1000), response.headers


def acceptance(base: str) -> dict:
    checks = []

    def record(name, ok, **details):
        checks.append({'name': name, 'ok': bool(ok), **details})

    code, health, ms, headers = request(base, '/api/health')
    record('health', code == 200, status=code, ms=ms, health=health,
           coop=headers.get('cross-origin-opener-policy'), coep=headers.get('cross-origin-embedder-policy'))
    code, _, ms, static_headers = request(base, '/')
    record('production-dist', code == 200 and 'text/html' in static_headers.get('content-type', '')
           and static_headers.get('cross-origin-opener-policy') == 'same-origin'
           and static_headers.get('cross-origin-embedder-policy') == 'require-corp', status=code, ms=ms)
    code, _, ms, _ = request(base, '/backend/app.py')
    record('static-confinement', code == 404, status=code, ms=ms)
    code, data, ms, _ = request(base, '/api/scan?' + urllib.parse.urlencode({'url': PAGE}))
    images = (data or {}).get('images', [])
    record('scan-live', code == 200 and data.get('status') == 200 and len(images) > 0,
           status=code, remoteStatus=(data or {}).get('status'), images=len(images), ms=ms)
    code, data, ms, _ = request(base, '/api/host?' + urllib.parse.urlencode({'url': 'https://www.wikipedia.org/'}))
    record('host-live', code == 200 and bool((data or {}).get('ip')) and bool((data or {}).get('hosting')),
           status=code, ms=ms, result=data)
    for url in ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd']:
        code, _, ms, _ = request(base, '/api/scan?' + urllib.parse.urlencode({'url': url}))
        record('ssrf-block', 400 <= code < 500, url=url, status=code, ms=ms)
    photo_req = urllib.request.Request(PHOTO, headers={'User-Agent': 'VeilAcceptance/1.0'})
    with urllib.request.urlopen(photo_req, timeout=60) as response:
        photo = response.read(8 * 1024 * 1024 + 1)
    if len(photo) > 8 * 1024 * 1024:
        raise ValueError('Public acceptance photo exceeded limit')
    code, results, ms, _ = request(base, '/api/hunt?engines=yandex,bing', photo, raw=True)
    summaries = []
    matched = False
    if isinstance(results, list):
        for result in results:
            hits = result.get('hits', [])
            exact = [hit.get('pageUrl', '') for hit in hits
                     if urllib.parse.urlsplit(hit.get('pageUrl', '')).hostname
                     and urllib.parse.urlsplit(hit.get('pageUrl', '')).hostname.endswith('wikipedia.org')
                     and 'Tour_Eiffel_Wikimedia_Commons' in urllib.parse.unquote(hit.get('pageUrl', ''))]
            matched |= bool(result.get('ok') and exact)
            summaries.append({**{k: v for k, v in result.items() if k != 'hits'},
                              'hits': len(hits), 'exactSourcePages': exact[:3]})
    record('hunt-live', code == 200 and matched, status=code, ms=ms, sourceBytes=len(photo), results=summaries)
    ticket_id = 'acceptance-' + str(time.time_ns())
    payload = {'id': ticket_id, 'pageUrl': PAGE, 'imageUrl': PHOTO, 'site': 'commons.wikimedia.org',
               'law': 'policy', 'matchKind': 'manual', 'matchScore': None, 'createdAt': int(time.time() * 1000)}
    code, data, ms, _ = request(base, '/api/tickets', payload)
    record('ticket-create', code in (200, 201) and data.get('status') == 'ready', status=code, ms=ms)
    code, data, ms, _ = request(base, f'/api/tickets/{ticket_id}/sent',
                               {'via': 'manual-acceptance', 'to': ['abuse@example.org'], 'at': int(time.time() * 1000)})
    record('ticket-sent-event', code == 200 and data.get('status') == 'sent', status=code, ms=ms,
           note='Recorded an explicit caller event; no email was sent.')
    code, data, ms, _ = request(base, f'/api/tickets/{ticket_id}/reply',
                               {'verdict': 'acknowledged', 'from': 'abuse@example.org',
                                'snippet': 'Synthetic acceptance lifecycle event', 'at': int(time.time() * 1000)})
    record('ticket-reply-event', code == 200 and data.get('status') == 'acknowledged', status=code, ms=ms)
    code, data, ms, _ = request(base, '/api/tickets?' + urllib.parse.urlencode({'ids': ticket_id}))
    record('ticket-timeline', code == 200 and isinstance(data, list) and len(data) == 1
           and len(data[0].get('events', [])) >= 3, status=code, ms=ms,
           events=len(data[0].get('events', [])) if isinstance(data, list) and data else 0)
    if not health.get('configured', {}).get('smtp'):
        code, data, ms, _ = request(base, f'/api/tickets/{ticket_id}/send',
                                   {'to': ['abuse@example.org'], 'subject': 'Acceptance', 'text': 'Synthetic test'})
        record('unconfigured-send', code == 503, status=code, ms=ms)
    code, data, ms, _ = request(base, f'/api/tickets/{ticket_id}/recheck', {})
    record('ticket-live-recheck', code == 200 and data.get('status') == 'acknowledged'
           and data.get('events', [{}])[-1].get('type') in ('present', 'unknown'), status=code, ms=ms,
           lastEvent=data.get('events', [{}])[-1])
    return {'ok': all(check['ok'] for check in checks), 'checks': checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', default=sys.executable, help='Interpreter with backend requirements installed')
    parser.add_argument('--url', default='http://127.0.0.1:8787')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--existing', action='store_true', help='Use an already running backend; do not boot one')
    args = parser.parse_args()
    out = args.out.resolve()
    if out == ROOT or ROOT in out.parents:
        parser.error('--out must be outside the repository')
    out.mkdir(parents=True, exist_ok=True)
    process = None
    started = time.monotonic()
    log = (out / 'backend.log').open('w', encoding='utf-8')
    result = {'ok': False}
    try:
        if not args.existing:
            target = urllib.parse.urlsplit(args.url)
            if target.hostname != '127.0.0.1' or target.port != 8787:
                raise ValueError('Owned backend uses http://127.0.0.1:8787')
            try:
                with socket.create_connection(('127.0.0.1', 8787), timeout=1):
                    raise RuntimeError('Backend port occupied; never reuse an unowned server implicitly')
            except OSError:
                pass
            env = {**os.environ, 'VEIL_DB': str(out / 'acceptance.sqlite3')}
            process = subprocess.Popen([args.python, '-m', 'backend'], cwd=ROOT, env=env,
                                       stdout=log, stderr=subprocess.STDOUT)
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError('Backend exited before ready')
                try:
                    if request(args.url, '/api/health')[0] == 200:
                        break
                except OSError:
                    time.sleep(.2)
            else:
                raise RuntimeError('Backend readiness timed out')
        result = acceptance(args.url)
    except Exception as error:
        result = {'ok': False, 'error': type(error).__name__, 'message': str(error)[:300]}
    finally:
        if process:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        log.close()
        result['seconds'] = round(time.monotonic() - started, 3)
        (out / 'backend-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print('VEIL_VERIFY_JSON ' + json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
