import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
import { fetchImage, handleApi, scanPage } from './handlers';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

describe('public network guard', () => {
  it.each(['fe80::1', 'fe90::1', 'fea0::1', 'febf::1'])(
    'rejects link-local /10 address %s',
    async (address) => {
      await expect(scanPage(`http://[${address}]/`)).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('resolves images against the final public redirect URL and cancels redirect bodies', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: 'https://cdn.example.com/pages/final' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response('<title>Final &amp; page</title><img src="photo.png">', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(scanPage('https://example.com/initial')).resolves.toEqual({
      pageUrl: 'https://cdn.example.com/pages/final',
      status: 200,
      title: 'Final & page',
      images: [{ url: 'https://cdn.example.com/pages/photo.png', alt: null }],
    });
    expect(cancel).toHaveBeenCalled();
  });
  it.each([
    '127.0.0.1',
    '10.2.3.4',
    '172.16.0.1',
    '172.31.255.1',
    '192.168.1.1',
    '169.254.1.1',
    '[::1]',
    '[fc00::1]',
    '[fdff::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
    '[::ffff:a00:1]',
  ])('rejects %s before fetching', async (host) => {
    await expect(scanPage(`http://${host}/`)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects localhost and hostnames resolving to any private address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(scanPage('http://localhost/')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['::ffff:7f00:1', '::ffff:192.168.1.1', '0:0:0:0:0:0:0:1'])(
    'rejects private IPv6 DNS results %s',
    async (address) => {
      vi.mocked(lookup).mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address, family: 6 },
      ] as never);
      await expect(scanPage('https://example.com/')).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(['file:///etc/passwd', 'ftp://example.com/', 'https://user:pass@example.com/'])(
    'rejects %s',
    async (url) => {
      await expect(scanPage(url)).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('checks redirect destinations before following', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }),
    );
    await expect(scanPage('https://example.com/')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });
  it('allows public addresses at the private range boundary', async () => {
    fetchMock.mockResolvedValue(
      new Response('<title>Public</title>', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(scanPage('https://172.32.0.1/')).resolves.toMatchObject({ title: 'Public' });
  });
});

describe('fetchImage', () => {
  it.each([
    'image/svg+xml',
    'image/SVG+xml',
    'IMAGE/SVG+XML; charset=utf-8',
    'text/html',
    'application/json',
  ])('rejects %s and cancels its body', async (type) => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), { headers: { 'content-type': type } }),
    );
    await expect(fetchImage('https://example.com/image')).rejects.toMatchObject({ status: 415 });
    expect(cancel).toHaveBeenCalled();
  });
  it('rejects declared oversize before reading and cancels the body', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024) },
      }),
    );
    await expect(fetchImage('https://example.com/image')).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });
  it('rejects oversized streamed bodies and cancels the stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      },
      cancel,
    });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } }));
    await expect(fetchImage('https://example.com/image')).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });
  it('returns accepted image bytes', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png; charset=binary' } }),
    );
    await expect(fetchImage('https://example.com/image')).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      type: 'image/png',
      status: 200,
    });
  });
});

describe('handleApi error responses', () => {
  it.each([
    ['/api/scan', '', 400, 'Add a web address.'],
    ['/api/scan', 'not a url', 400, 'That is not a web address.'],
    ['/api/missing', 'https://example.com', 404, 'Not found'],
  ])('returns JSON for %s (%s)', async (path, url, status, error) => {
    const res = await handleApi(path, new URLSearchParams({ url }));
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error });
  });
  it('maps upstream failures to 502 JSON', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));
    const res = await handleApi('/api/scan', new URLSearchParams({ url: 'https://example.com' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'The site could not be reached.' });
  });
  it('returns 404 JSON for a DNS failure', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
    const res = await handleApi('/api/image', new URLSearchParams({ url: 'https://missing.example/image' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Could not find missing.example.' });
  });
  it.each([404, 410, 500])('preserves missing image status or maps upstream %s to 502', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    const res = await handleApi('/api/image', new URLSearchParams({ url: 'https://example.com/image' }));
    expect(res.status).toBe(status === 500 ? 502 : status);
    expect(await res.json()).toEqual({ error: `The site answered ${status}.` });
  });
});
