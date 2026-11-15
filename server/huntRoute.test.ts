import sharp from 'sharp';
import { lookup } from 'node:dns/promises';
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
import { describe, expect, it, vi } from 'vitest';
import { createHuntHandler } from '../api/hunt';
import { handleApi } from './handlers';
import type { HuntImage, HuntOptions, Transport } from './hunt/types';

const raw = (query = '', body: BodyInit = new Uint8Array([1, 2, 3]), headers = {}) =>
  new Request(`https://veil.test/api/hunt${query}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'image/png', ...headers },
  });
const setup = () => {
  const hunt = vi.fn(async (_image: HuntImage, _transport: Transport, _options: HuntOptions = {}) => [
    { engine: 'yandex', ok: true, hits: [], ms: 1 },
  ]);
  const huntByUrl = vi.fn(async (_image: string, _transport: Transport, _options: HuntOptions = {}) => [
    { engine: 'lens', ok: true, hits: [], ms: 1 },
  ]);
  const preprocess = vi.fn(async (image: HuntImage) => image);
  const handler = createHuntHandler({ hunt, huntByUrl, preprocess, serpApiKey: () => 'server-secret' });
  return { hunt, huntByUrl, preprocess, handler };
};
describe('hunt HTTP boundary', () => {
  it('rejects a public-looking URL that resolves to a private address', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    const { handler, hunt } = setup();
    const response = await handler(raw('?imageUrl=https://example.com/image.jpg'));
    expect(response.status).toBe(400);
    expect(hunt).not.toHaveBeenCalled();
  });
  it('accepts raw images and passes bounded options and server credentials', async () => {
    const { handler, hunt } = setup();
    const response = await handler(raw('?engines=yandex,web&names=Example'));
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.clone().json())).toBe(true);
    expect(hunt.mock.calls[0]?.[2]).toMatchObject({
      engines: ['yandex', 'web'],
      names: ['Example'],
      serpApiKey: 'server-secret',
      timeoutMs: 20000,
    });
    expect(await response.text()).not.toContain('server-secret');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('parses multipart and sends only Lens the URL', async () => {
    const { handler, huntByUrl } = setup();
    const form = new FormData();
    form.set('image', new Blob([new Uint8Array([1])], { type: 'image/webp' }), 'photo.webp');
    form.set('engines', 'lens');
    form.set('imageUrl', 'https://example.org/public.jpg');
    expect(
      (await handler(new Request('https://veil.test/api/hunt', { method: 'POST', body: form }))).status,
    ).toBe(200);
    expect(huntByUrl.mock.calls[0]?.[0]).toBe('https://example.org/public.jpg');
  });
  it.each([
    '?engines=evil',
    '?engines=yandex,yandex',
    '?names=',
    '?names=' + 'a'.repeat(101),
    '?serpApiKey=client',
    '?imageUrl=http://example.org/x',
    '?engines=bing&engines=yandex',
  ])('rejects invalid options before effects: %s', async (query) => {
    const { handler, hunt, preprocess } = setup();
    expect((await handler(raw(query))).status).toBe(400);
    expect(hunt).not.toHaveBeenCalled();
    expect(preprocess).not.toHaveBeenCalled();
  });
  it('rejects unsupported MIME and empty data', async () => {
    const { handler } = setup();
    expect((await handler(raw('', 'hello', { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await handler(raw('', new Uint8Array()))).status).toBe(400);
  });
  it('bounds declared and streamed bodies', async () => {
    const { handler, hunt } = setup();
    expect((await handler(raw('', new Uint8Array([1]), { 'content-length': '9000000' }))).status).toBe(413);
    expect((await handler(raw('', new Uint8Array(8 * 1024 * 1024 + 1)))).status).toBe(413);
    expect(hunt).not.toHaveBeenCalled();
  });
  it('rejects malformed multipart and duplicate files', async () => {
    const { handler } = setup();
    expect(
      (await handler(raw('', 'bad', { 'content-type': 'multipart/form-data; boundary=x' }))).status,
    ).toBe(400);
    const form = new FormData();
    for (let i = 0; i < 2; i++) form.append('image', new Blob(['x'], { type: 'image/png' }), 'x.png');
    expect(
      (await handler(new Request('https://veil.test/api/hunt', { method: 'POST', body: form }))).status,
    ).toBe(400);
  });
  it('limits ten requests per minute, ignores untrusted forwarding, and expires buckets', async () => {
    let time = 1000;
    const { hunt, preprocess } = setup();
    const handler = createHuntHandler({
      hunt,
      preprocess,
      now: () => time,
      clientKey: () => 'trusted-client',
    });
    for (let i = 0; i < 10; i++) expect((await handler(raw())).status).toBe(200);
    const blocked = await handler(raw('', 'x', { 'x-forwarded-for': 'spoof' }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    time += 60000;
    expect((await handler(raw())).status).toBe(200);
  });
  it('handles method and route delegation', async () => {
    const { handler } = setup();
    expect((await handler(new Request('https://veil.test/api/hunt'))).status).toBe(405);
    const response = await handleApi(
      '/api/hunt',
      new URLSearchParams(),
      new Request('https://veil.test/api/hunt'),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
  it('rejects undecodable real images without contacting providers', async () => {
    const hunt = vi.fn();
    const handler = createHuntHandler({ hunt });
    expect((await handler(raw())).status).toBe(400);
    expect(hunt).not.toHaveBeenCalled();
  });
  it('decodes and re-encodes a valid PNG as JPEG before provider upload', async () => {
    const { hunt } = setup();
    const handler = createHuntHandler({ hunt });
    const png = new Uint8Array(
      await sharp({ create: { width: 2048, height: 1024, channels: 3, background: 'red' } })
        .png()
        .toBuffer(),
    );
    expect((await handler(raw('', png))).status).toBe(200);
    const image = hunt.mock.calls[0]?.[0];
    expect(image?.type).toBe('image/jpeg');
    expect(await sharp(image!.bytes).metadata()).toMatchObject({ width: 1024, height: 512 });
    expect(Array.from(image!.bytes.slice(0, 2))).toEqual([255, 216]);
  });
});
