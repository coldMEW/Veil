"""Public-only, DNS-pinned HTTP transport; every redirect is checked again."""
import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit, urljoin

import httpx

UA = 'VeilScanner/1.0 (+deepfake takedown assistant)'
PAGE_LIMIT = 3 * 1024 * 1024
IMAGE_LIMIT = 15 * 1024 * 1024


class FetchError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


def public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        return ip.is_global and not ip.is_multicast
    except ValueError:
        return False


async def resolve_public(raw: str) -> tuple[str, list[str]]:
    try:
        parsed = urlsplit(raw)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    except ValueError as exc:
        raise FetchError(400, 'That is not a web address.') from exc
    if parsed.scheme not in ('http', 'https') or not host:
        raise FetchError(400, 'Only http and https addresses can be scanned.')
    if parsed.username is not None or parsed.password is not None:
        raise FetchError(400, 'Addresses with passwords are not scanned.')
    if any(ord(char) < 33 for char in raw) or '\\' in raw:
        raise FetchError(400, 'That is not a web address.')
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        try:
            records = await asyncio.wait_for(
                asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), timeout=9)
            addresses = list(dict.fromkeys(record[4][0] for record in records))
        except TimeoutError as exc:
            raise FetchError(504, 'The DNS lookup took too long.') from exc
        except OSError as exc:
            # DNS failure is unknown availability, never HTTP 404/removal.
            raise FetchError(502, f'Could not find {host}.') from exc
    if not addresses or any(not public_ip(address) for address in addresses):
        raise FetchError(400, 'Private network addresses are not scanned.')
    return host, addresses


@dataclass
class Fetched:
    status: int
    url: str
    headers: dict
    body: bytes

    @property
    def text(self) -> str:
        return self.body.decode('utf-8', errors='replace')


class PublicFetcher:
    def __init__(self, timeout: float = 9):
        self.timeout = timeout

    async def fetch(self, raw: str, *, accept='*/*', limit=PAGE_LIMIT,
                    method='GET', data=None, files=None, headers=None,
                    client: httpx.AsyncClient | None = None, allowed_hosts=None,
                    cookie_jar: httpx.Cookies | None = None, headers_only_images=False) -> Fetched:
        async def execute(active):
            target = raw
            current_headers = headers
            current_method, current_data, current_files = method, data, files
            for _ in range(4):
                host, addresses = await resolve_public(target)
                if allowed_hosts is not None and host not in allowed_hosts:
                    raise FetchError(400, 'Provider redirect host is not allowed.')
                parsed = urlsplit(target)
                if allowed_hosts is not None and (parsed.scheme != 'https' or parsed.port not in (None, 443)):
                    raise FetchError(400, 'Provider redirects must use HTTPS on port 443.')
                ip = addresses[0]
                netloc = f'[{ip}]' if ':' in ip else ip
                if parsed.port:
                    netloc += f':{parsed.port}'
                pinned = urlunsplit((parsed.scheme, netloc, parsed.path or '/', parsed.query, ''))
                original_host = f'[{host}]' if ':' in host else host.encode('idna').decode()
                if parsed.port:
                    original_host += f':{parsed.port}'
                request_headers = {'user-agent': UA, 'accept': accept, **(current_headers or {}), 'host': original_host}
                if cookie_jar is not None:
                    cookie_request = httpx.Request(current_method, target)
                    cookie_jar.set_cookie_header(cookie_request)
                    if cookie_request.headers.get('cookie'):
                        request_headers['cookie'] = cookie_request.headers['cookie']
                # The socket sees only the already validated numeric IP. TLS still verifies the original host.
                async with active.stream(current_method, pinned, headers=request_headers,
                                         extensions={'sni_hostname': host.encode('idna').decode()}, data=current_data,
                                         files=current_files) as response:
                    if cookie_jar is not None:
                        original_response = httpx.Response(response.status_code, headers=response.headers,
                                                           request=httpx.Request(current_method, target))
                        cookie_jar.extract_cookies(original_response)
                    # Never rely on the numeric-IP cookie jar maintained by the HTTP client,
                    # including ordinary page redirects that do not need any session cookies.
                    active.cookies.clear()
                    if response.status_code in (301, 302, 303, 307, 308) and response.headers.get('location'):
                        following = urljoin(target, response.headers['location'])
                        next_parsed = urlsplit(following)
                        if (next_parsed.scheme, next_parsed.hostname, next_parsed.port) != (
                                parsed.scheme, parsed.hostname, parsed.port):
                            # Do not forward caller-supplied auth/session headers across an origin boundary.
                            headers_to_remove = ('authorization', 'cookie', 'x-image-knowledge-signature')
                            if current_headers:
                                current_headers = {key: value for key, value in current_headers.items()
                                           if key.lower() not in headers_to_remove}
                        target = following
                        if response.status_code == 303 or response.status_code in (301, 302) and current_method == 'POST':
                            current_method, current_data, current_files = 'GET', None, None
                        continue
                    if headers_only_images and response.headers.get('content-type', '').lower().startswith('image/'):
                        return Fetched(response.status_code, target, dict(response.headers), b'')
                    try:
                        declared = int(response.headers.get('content-length', '0'))
                    except ValueError:
                        declared = 0
                    if declared > limit:
                        raise FetchError(413, 'The file is too large to scan.')
                    body = bytearray()
                    async for part in response.aiter_bytes():
                        body.extend(part)
                        if len(body) > limit:
                            raise FetchError(413, 'The file is too large to scan.')
                    return Fetched(response.status_code, target, dict(response.headers), bytes(body))
            raise FetchError(508, 'Too many redirects.')
        try:
            async with asyncio.timeout(self.timeout):
                if client is not None:
                    return await execute(client)
                async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=self.timeout) as active:
                    return await execute(active)
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise FetchError(504, 'The site took too long to answer.') from exc
        except httpx.HTTPError as exc:
            raise FetchError(502, 'The site could not be reached.') from exc
