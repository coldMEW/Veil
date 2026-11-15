"""Loopback-first HTTP API. Run behind an authenticated reverse proxy if exposed remotely."""
import asyncio
import contextlib
import importlib.metadata
import os
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .hunt import hunt
from .net import FetchError, IMAGE_LIMIT, PublicFetcher, resolve_public
from .pages import host_info, http_url, scan_page
from .tickets import (TicketStore, classify_reply, imap_configured, now_iso, parse_time, poll_imap,
                      recheck, scheduler_tick, send_smtp, smtp_configured)


class LimitedBody:
    """Bound streamed request bodies before FastAPI/Pydantic performs any JSON parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] in ('GET', 'HEAD', 'OPTIONS'):
            return await self.app(scope, receive, send)
        body = bytearray()
        try:
            async with asyncio.timeout(20):
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    body.extend(message.get('body', b''))
                    if len(body) > 8 * 1024 * 1024:
                        return await JSONResponse({'error': 'The request is too large.'}, 413)(scope, receive, send)
                    if not message.get('more_body'):
                        break
        except TimeoutError:
            return await JSONResponse({'error': 'The request body took too long.'}, 408)(scope, receive, send)
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class CreateTicket(StrictModel):
    id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    pageUrl: str = Field(max_length=8192)
    imageUrl: str | None = Field(default=None, max_length=8192)
    site: str = Field(default='', max_length=300)
    law: str = Field(default='', max_length=300)
    matchKind: str = Field(default='', max_length=100)
    matchScore: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    createdAt: str | int | float = Field(default_factory=now_iso)

    @field_validator('pageUrl', 'imageUrl')
    @classmethod
    def url(cls, value):
        if value is not None and not http_url(value):
            raise ValueError('Expected a public http(s) URL.')
        return value

    @field_validator('createdAt')
    @classmethod
    def timestamp(cls, value):
        if parse_time(value) is None:
            raise ValueError('Expected an ISO timestamp.')
        return value


class Sent(StrictModel):
    via: str = Field(default='manual', min_length=1, max_length=100)
    to: list[str] = Field(min_length=1, max_length=20)
    at: str | int | float = Field(default_factory=now_iso)

    @field_validator('to')
    @classmethod
    def emails(cls, values):
        if any(not re.fullmatch(r'[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+', value)
               or len(value) > 254 for value in values):
            raise ValueError('Expected recipient email addresses.')
        return values

    @field_validator('at')
    @classmethod
    def timestamp(cls, value):
        if parse_time(value) is None:
            raise ValueError('Expected an ISO timestamp.')
        return value


class Reply(StrictModel):
    verdict: str = Field(pattern='^(removed|rejected|needs_info|acknowledged)$')
    sender: str = Field(alias='from', max_length=300)
    snippet: str = Field(default='', max_length=4000)
    at: str | int | float = Field(default_factory=now_iso)

    @field_validator('at')
    @classmethod
    def timestamp(cls, value):
        if parse_time(value) is None:
            raise ValueError('Expected an ISO timestamp.')
        return value


class Send(Sent):
    subject: str = Field(min_length=1, max_length=300, pattern=r'^[^\r\n]+$')
    text: str = Field(min_length=1, max_length=100000)
    replyTo: str | None = Field(default=None, max_length=254, pattern=r'^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+$')
    evidenceHtml: str | None = Field(default=None, max_length=100000)


def create_app(*, db_path=None, fetcher=None, dist_path=None, start_scheduler=True):
    fetcher = fetcher or PublicFetcher()
    default_db = Path(os.getenv('LOCALAPPDATA') or Path.home() / '.local' / 'share') / 'Veil' / 'tickets.sqlite3'
    store = TicketStore(db_path or os.getenv('VEIL_DB') or default_db)
    dist = Path(dist_path or Path(__file__).resolve().parent.parent / 'dist').resolve()

    async def scheduler():
        while True:
            await asyncio.sleep(900)
            try:
                await scheduler_tick(store, fetcher)
                if imap_configured():
                    await asyncio.to_thread(poll_imap, store)
            except Exception:
                # Operational error, not a removal or successful mail poll; next tick retries.
                import logging
                logging.getLogger('veil').exception('Background ticket check failed')

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(scheduler()) if start_scheduler else None
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(LimitedBody)
    app.state.store, app.state.fetcher = store, fetcher
    rate = defaultdict(deque)

    @app.middleware('http')
    async def boundaries(request: Request, call_next):
        allowed_hosts = {'localhost', '127.0.0.1', '::1'}
        allowed_hosts.update(value.strip().lower() for value in os.getenv('VEIL_ALLOWED_HOSTS', '').split(',') if value.strip())
        if (request.url.hostname or '').lower() not in allowed_hosts:
            return JSONResponse({'error': 'Host is not allowed.'}, status_code=400)
        # Local API must not become an ambient cross-origin SMTP proxy or image uploader.
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('origin')
            same = f'{request.url.scheme}://{request.headers.get("host", "")}'
            permitted = {same, 'http://localhost:5173', 'http://127.0.0.1:5173'}
            if origin and origin not in permitted:
                return JSONResponse({'error': 'Cross-origin writes are not allowed.'}, status_code=403)
            if request.headers.get('sec-fetch-site') == 'cross-site':
                return JSONResponse({'error': 'Cross-site writes are not allowed.'}, status_code=403)
            size = request.headers.get('content-length')
            if size and (not size.isdigit() or int(size) > 8 * 1024 * 1024):
                return JSONResponse({'error': 'The request is too large.'}, status_code=413)
        response = await call_next(request)
        response.headers['cross-origin-opener-policy'] = 'same-origin'
        response.headers['cross-origin-embedder-policy'] = 'require-corp'
        response.headers['cross-origin-resource-policy'] = 'same-origin'
        if request.url.path.startswith('/api/'):
            response.headers['cache-control'] = 'no-store'
        return response

    @app.exception_handler(FetchError)
    async def fetch_error(request, exc):
        return JSONResponse({'error': str(exc)}, status_code=exc.status)

    @app.get('/api/health')
    async def health():
        return {'ok': True, 'python': __import__('platform').python_version(),
                'versions': {name: importlib.metadata.version(name) for name in ('fastapi', 'uvicorn', 'httpx', 'pillow')},
                'configured': {'smtp': smtp_configured(), 'imap': imap_configured(),
                               'lens': bool(os.getenv('SERPAPI_KEY'))}, 'schedulerSeconds': 900}

    @app.get('/api/scan')
    async def scan(url: str = ''):
        if not url:
            raise FetchError(400, 'Add a web address.')
        return await scan_page(url, fetcher)

    @app.get('/api/host')
    async def host(url: str = ''):
        return await host_info(url, fetcher)

    @app.get('/api/status')
    async def status(url: str = ''):
        response = await fetcher.fetch(url, headers_only_images=True)
        return {'status': response.status, 'gone': response.status in (404, 410, 451)}

    @app.get('/api/image')
    async def image(url: str = ''):
        response = await fetcher.fetch(url, accept='image/*', limit=IMAGE_LIMIT)
        if not 200 <= response.status < 300:
            raise FetchError(response.status if response.status in (404, 410, 451) else 502,
                             f'The site answered {response.status}.')
        mime = response.headers.get('content-type', '').split(';')[0].lower().strip()
        if not mime.startswith('image/') or mime == 'image/svg+xml':
            raise FetchError(415, 'That address is not a photo.')
        return Response(response.body, media_type=mime)

    @app.post('/api/hunt')
    async def reverse(request: Request, engines: str = 'yandex,bing', imageUrl: str | None = None):
        # Ignore untrusted X-Forwarded-For; loopback callers share a process-local bucket.
        key = request.client.host if request.client else 'shared'
        times = rate[key]
        now = time.monotonic()
        while times and times[0] <= now - 60:
            times.popleft()
        if len(times) >= 10:
            raise FetchError(429, 'Too many searches. Try again in a minute.')
        times.append(now)
        body = bytearray()
        async for part in request.stream():
            body.extend(part)
            if len(body) > 8 * 1024 * 1024:
                raise FetchError(413, 'The image is too large.')
        return await hunt(bytes(body), engines.split(','), imageUrl)

    @app.post('/api/tickets')
    async def create_ticket(payload: CreateTicket):
        await resolve_public(payload.pageUrl)
        if payload.imageUrl:
            await resolve_public(payload.imageUrl)
        return store.upsert(payload.model_dump())

    @app.get('/api/tickets')
    async def list_tickets(ids: str | None = None):
        return store.list(ids.split(',') if ids is not None else None)

    @app.post('/api/tickets/{ticket_id}/sent')
    async def sent(ticket_id: str, payload: Sent):
        return store.event(ticket_id, 'sent', payload.model_dump(exclude={'at'}), payload.at, 'sent')

    @app.post('/api/tickets/{ticket_id}/reply')
    async def reply(ticket_id: str, payload: Reply):
        return store.event(ticket_id, 'reply', payload.model_dump(by_alias=True, exclude={'at'}),
                           payload.at, payload.verdict)

    @app.post('/api/tickets/{ticket_id}/recheck')
    async def check(ticket_id: str):
        return await recheck(store, ticket_id, fetcher)

    @app.post('/api/tickets/{ticket_id}/send')
    async def send(ticket_id: str, payload: Send):
        store.get(ticket_id)
        await asyncio.to_thread(send_smtp, ticket_id, payload.model_dump())
        return store.event(ticket_id, 'sent', {'via': 'smtp', 'to': payload.to}, status='sent')

    @app.get('/{asset_path:path}')
    async def web(asset_path: str):
        if asset_path.startswith('api/'):
            return JSONResponse({'error': 'Not found'}, status_code=404)
        candidate = (dist / (asset_path or 'index.html')).resolve()
        if not candidate.is_relative_to(dist):
            return Response(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        if not Path(asset_path).suffix and (dist / 'index.html').is_file():
            return FileResponse(dist / 'index.html')
        return Response(status_code=404)

    return app


app = create_app()
