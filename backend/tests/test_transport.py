"""Unit probes of transport policy plus real sockets in test_backend.py."""
import asyncio

import httpx
import pytest

from backend.net import FetchError, PublicFetcher


def test_pinned_dns_host_sni_and_no_rebinding(monkeypatch):
    calls = []
    async def resolve(raw):
        calls.append(raw)
        return 'example.com', ['93.184.216.34']
    monkeypatch.setattr('backend.net.resolve_public', resolve)
    async def scenario():
        def respond(request):
            assert request.url.host == '93.184.216.34'
            assert request.headers['host'] == 'example.com'
            assert request.extensions['sni_hostname'] == 'example.com'
            return httpx.Response(200, text='actual transport policy path')
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond), trust_env=False) as client:
            result = await PublicFetcher().fetch('https://example.com/photo', client=client)
            assert result.url == 'https://example.com/photo'
    asyncio.run(scenario())
    assert calls == ['https://example.com/photo']


@pytest.mark.parametrize('destination', ['https://evil.example/upload', 'http://example.com/upload',
                                         'https://example.com:444/upload', 'http://127.0.0.1/'])
def test_provider_redirect_rejected_before_next_request(monkeypatch, destination):
    requests = []
    async def resolve(raw):
        host = httpx.URL(raw).host
        return host, ['93.184.216.34']
    monkeypatch.setattr('backend.net.resolve_public', resolve)
    async def scenario():
        def respond(request):
            requests.append(request)
            return httpx.Response(307, headers={'location': destination})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond), trust_env=False) as client:
            with pytest.raises(FetchError):
                await PublicFetcher().fetch('https://example.com/upload', method='POST', data={'private': 'image'},
                                            allowed_hosts={'example.com'}, client=client)
    asyncio.run(scenario())
    assert len(requests) == 1


def test_redirect_private_destination_uses_real_guard(monkeypatch):
    # Only the initial public lookup is supplied; redirect is checked by the real literal-IP policy.
    from backend.net import resolve_public
    async def resolve(raw):
        if raw.startswith('https://example.com'):
            return 'example.com', ['93.184.216.34']
        return await resolve_public(raw)
    monkeypatch.setattr('backend.net.resolve_public', resolve)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(302, headers={'location': 'http://10.0.0.1/'})), trust_env=False) as client:
            with pytest.raises(FetchError, match='Private network'):
                await PublicFetcher().fetch('https://example.com/start', client=client)
    asyncio.run(scenario())


def test_original_domain_cookies_not_numeric_ip_scope(monkeypatch):
    async def resolve(raw):
        return httpx.URL(raw).host, ['93.184.216.34']
    monkeypatch.setattr('backend.net.resolve_public', resolve)
    async def scenario():
        seen = []
        def respond(request):
            seen.append(request.headers.get('cookie'))
            return httpx.Response(200, headers={'set-cookie': 'session=one; Domain=example.com; Secure; Path=/'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond), trust_env=False) as client:
            jar = httpx.Cookies()
            fetcher = PublicFetcher()
            await fetcher.fetch('https://example.com/', client=client, cookie_jar=jar)
            await fetcher.fetch('https://example.com/next', client=client, cookie_jar=jar)
            await fetcher.fetch('https://other.example/', client=client, cookie_jar=jar)
        assert seen == [None, 'session=one', None]
    asyncio.run(scenario())


def test_declared_and_streamed_limits(monkeypatch):
    async def resolve(raw):
        return 'example.com', ['93.184.216.34']
    monkeypatch.setattr('backend.net.resolve_public', resolve)
    async def scenario():
        for headers in ({'content-length': '1000'}, {}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, headers=headers, content=b'x' * 100)), trust_env=False) as client:
                with pytest.raises(FetchError) as failure:
                    await PublicFetcher().fetch('https://example.com/', client=client, limit=10)
                assert failure.value.status == 413
    asyncio.run(scenario())
