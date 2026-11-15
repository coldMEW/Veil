import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from './handlers';
import { Readable } from 'node:stream';

async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.url?.startsWith('/api/')) return next();
  const url = new URL(req.url, 'http://local');
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method ?? 'GET',
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' as const } : {}),
  };
  const response = await handleApi(url.pathname, url.searchParams, new Request(url, init));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Serves the same /api endpoints in `vite dev` and `vite preview` as the deployed functions. */
export function veilApi(): Plugin {
  return {
    name: 'veil-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void middleware(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void middleware(req, res, next));
    },
  };
}
