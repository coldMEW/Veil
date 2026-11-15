import sharp from 'sharp';
import { lookup } from 'node:dns/promises';
import { publicImageUrl } from '../server/hunt/shared';
import { hunt, huntByUrl } from '../server/hunt';
import type { HuntImage, HuntOptions, Transport } from '../server/hunt';
import { createFetchTransport } from '../server/hunt/fetchTransport';

const LIMIT = 8 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ENGINES = new Set(['yandex', 'bing', 'lens', 'web']);
class InputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(status === 405 ? { allow: 'POST' } : {}),
      ...(status === 429 ? { 'retry-after': '60' } : {}),
    },
  });
}
async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > limit) throw new InputError(413, 'Image is too large.');
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new InputError(413, 'Image is too large.');
      }
      parts.push(value);
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
type Dependencies = {
  hunt?: typeof hunt;
  huntByUrl?: typeof huntByUrl;
  transport?: () => Transport;
  preprocess?: (image: HuntImage) => Promise<HuntImage>;
  now?: () => number;
  clientKey?: (request: Request) => string;
  serpApiKey?: () => string | undefined;
};
async function preprocess(image: HuntImage): Promise<HuntImage> {
  try {
    const bytes = await sharp(image.bytes, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { bytes: new Uint8Array(bytes), type: 'image/jpeg' };
  } catch {
    throw new InputError(400, 'Image could not be decoded.');
  }
}
/** Per-process best-effort limit. The hosting proxy must overwrite its trusted IP header. */
export function createHuntHandler(deps: Dependencies = {}) {
  const clients = new Map<string, { count: number; until: number }>();
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    try {
      const url = new URL(request.url);
      if (url.search.length > 4096) throw new InputError(400, 'Options are too long.');
      const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const multipart = type === 'multipart/form-data';
      if (!multipart && !TYPES.has(type))
        throw new InputError(415, 'Use JPEG, PNG, WebP, or multipart form data.');
      const now = (deps.now ?? Date.now)();
      for (const [key, entry] of clients) if (entry.until <= now) clients.delete(key);
      const key = (
        deps.clientKey?.(request) ??
        (process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') : null) ??
        'shared'
      ).slice(0, 128);
      const entry = clients.get(key);
      if (entry && entry.count >= 10)
        return json({ error: 'Too many searches. Try again in a minute.' }, 429);
      // At capacity use a shared bucket, so arbitrary addresses cannot grow memory without bound.
      const bucket = entry ? key : clients.size < 10000 ? key : 'overflow';
      const current = clients.get(bucket);
      if (current && current.count >= 10)
        return json({ error: 'Too many searches. Try again in a minute.' }, 429);
      clients.set(bucket, { count: (current?.count ?? 0) + 1, until: current?.until ?? now + 60000 });

      // Bound the stream before invoking the platform multipart parser, including its metadata.
      const bytes = await readBody(request, LIMIT + (multipart ? 16 * 1024 : 0));
      let image: HuntImage;
      const options = new URLSearchParams(url.searchParams);
      if (multipart) {
        let form: FormData;
        try {
          form = await new Response(bytes as BodyInit, {
            headers: { 'content-type': request.headers.get('content-type')! },
          }).formData();
        } catch {
          throw new InputError(400, 'Invalid multipart form.');
        }
        const files = form.getAll('image');
        if (files.length !== 1 || typeof files[0] === 'string' || !files[0])
          throw new InputError(400, 'Add one image file.');
        const file = files[0];
        for (const [name, value] of form) {
          if (name === 'image') continue;
          if (
            !['engines', 'names', 'imageUrl'].includes(name) ||
            typeof value !== 'string' ||
            value.length > 2048 ||
            options.has(name)
          )
            throw new InputError(400, 'Invalid or duplicate option.');
          options.set(name, value);
        }
        image = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type.toLowerCase() };
      } else image = { bytes, type };
      if (!TYPES.has(image.type)) throw new InputError(415, 'Use JPEG, PNG, or WebP.');
      if (image.bytes.length > LIMIT) throw new InputError(413, 'Image is too large.');
      if (!image.bytes.length) throw new InputError(400, 'Add an image.');
      for (const key of options.keys())
        if (!['engines', 'names', 'imageUrl'].includes(key) || options.getAll(key).length !== 1)
          throw new InputError(400, 'Invalid or duplicate option.');
      const engines = options.has('engines')
        ? options
            .get('engines')!
            .split(',')
            .map((v) => v.trim())
        : undefined;
      if (
        engines &&
        (!engines.length ||
          engines.length > 4 ||
          engines.some((v) => !ENGINES.has(v)) ||
          new Set(engines).size !== engines.length)
      )
        throw new InputError(400, 'Invalid engines.');
      const names = options.has('names')
        ? options
            .get('names')!
            .split(',')
            .map((v) => v.trim())
        : [];
      if (names.length > 3 || names.some((v) => !v || v.length > 100 || /[\x00-\x1f\x7f]/.test(v)))
        throw new InputError(400, 'Invalid names.');
      const imageUrl = options.get('imageUrl') || undefined;
      if (imageUrl) {
        let target: URL;
        try {
          target = new URL(imageUrl);
        } catch {
          throw new InputError(400, 'Invalid image URL.');
        }
        if (imageUrl.length > 2048 || !publicImageUrl(target.href))
          throw new InputError(400, 'Use a public HTTPS image URL.');
        const host = target.hostname.replace(/^\[|\]$/g, '');
        const addresses = await lookup(host, { all: true }).catch(() => []);
        if (
          !addresses.length ||
          addresses.some(
            (a) =>
              !publicImageUrl('https://' + (a.address.includes(':') ? '[' + a.address + ']' : a.address)),
          )
        )
          throw new InputError(400, 'Image URL must resolve to public addresses.');
      }
      image = await (deps.preprocess ?? preprocess)(image);
      const transport = (deps.transport ?? createFetchTransport)();
      const opts: HuntOptions = {
        engines,
        names,
        timeoutMs: 20000,
        serpApiKey: (deps.serpApiKey ?? (() => process.env.SERPAPI_KEY))(),
      };
      const uploadEngines = engines?.filter((v) => v !== 'lens');
      const results = await (deps.hunt ?? hunt)(image, transport, { ...opts, engines: uploadEngines });
      if (imageUrl && (engines?.includes('lens') || (!engines && opts.serpApiKey)))
        results.push(
          ...(await (deps.huntByUrl ?? huntByUrl)(imageUrl, transport, { ...opts, engines: ['lens'] })),
        );
      else if (engines?.includes('lens'))
        results.push({ engine: 'lens', ok: false, hits: [], error: 'image-url-required', ms: 0 });
      return json(results);
    } catch (error) {
      return json(
        { error: error instanceof InputError ? error.message : 'Search could not be completed.' },
        error instanceof InputError ? error.status : 502,
      );
    }
  };
}
export const POST = createHuntHandler();
export const GET = POST;
