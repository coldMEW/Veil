import { build } from 'esbuild';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = process.argv[2] ?? resolve('../scratch-eval/hunt01-api-live');
await mkdir(out, { recursive: true });
const cache = resolve('node_modules/.cache/hunt-acceptance');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['api/hunt.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['sharp'],
  outfile: cache + '/api.mjs',
});
const { POST } = await import(pathToFileURL(cache + '/api.mjs'));
const server = createServer(async (req, res) => {
  try {
    const body = req.method === 'GET' ? undefined : Readable.toWeb(req);
    const response = await POST(
      new Request(
        'http://localhost/api/hunt' + (req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
        { method: req.method, headers: req.headers, body, ...(body ? { duplex: 'half' } : {}) },
      ),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(new Uint8Array(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const address = server.address(),
  url = `http://127.0.0.1:${address.port}/api/hunt?engines=yandex,bing`;
try {
  const image = await readFile(resolve('../scratch-eval/hunt01-live/landmark-original.jpg')),
    start = performance.now(),
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: image });
  const results = await response.json();
  const matched =
    Array.isArray(results) &&
    results.some(
      (r) =>
        r.ok &&
        r.hits.some(
          (h) =>
            /wikipedia\.org/.test(new URL(h.pageUrl).hostname) &&
            /Tour_Eiffel_Wikimedia_Commons/.test(decodeURIComponent(h.pageUrl)),
        ),
    );
  const summary = {
    status: response.status,
    ms: Math.round(performance.now() - start),
    sourceBytes: image.length,
    passed: matched,
    results,
  };
  await writeFile(out + '/results.json', JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        ...summary,
        results: results.map((r) => ({
          ...r,
          hits: r.hits.length,
          examples: r.hits.slice(0, 5).map((h) => h.pageUrl),
        })),
      },
      null,
      2,
    ),
  );
  if (!matched) process.exitCode = 1;
} finally {
  await new Promise((r) => server.close(r));
}
