import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
const out = process.argv[2] ?? resolve('../scratch-eval/hunt01-live');
await mkdir(out, { recursive: true });
const bundle = await build({
  entryPoints: ['server/hunt/index.ts', 'server/hunt/fetchTransport.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  outdir: 'ignored',
});
const modules = await Promise.all(
  bundle.outputFiles.map(
    (f) => import('data:text/javascript;base64,' + Buffer.from(f.text).toString('base64')),
  ),
);
const { hunt } = modules[0],
  { createFetchTransport } = modules[1];
const sourceUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg',
  sourceResponse = await fetch(sourceUrl, {
    headers: { 'user-agent': 'VeilAcceptance/1.0 (https://github.com/coldMEW/veil)' },
  });
if (!sourceResponse.ok) throw Error('source-http-' + sourceResponse.status);
const original = new Uint8Array(await sourceResponse.arrayBuffer());
await writeFile(out + '/landmark-original.jpg', original);
const resized = await sharp(original)
  .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer();
await writeFile(out + '/landmark-search.jpg', resized);
let requestId = 0;
const records = [];
function transport() {
  const actual = createFetchTransport(),
    record = async (method, url, action) => {
      const id = ++requestId,
        start = performance.now();
      const safe = new URL(url);
      if (safe.searchParams.has('api_key')) safe.searchParams.set('api_key', 'REDACTED');
      try {
        const response = await action();
        await writeFile(out + `/response-${id}.txt`, response.text);
        records.push({
          id,
          method,
          url: safe.href,
          status: response.status,
          responseUrl: response.url,
          bytes: response.text.length,
          ms: Math.round(performance.now() - start),
        });
        return response;
      } catch (error) {
        records.push({
          id,
          method,
          url: safe.href,
          error: error.name,
          ms: Math.round(performance.now() - start),
        });
        throw error;
      }
    };
  return {
    get: (url, headers) => record('GET', url, () => actual.get(url, headers)),
    postMultipart: (url, fields, file, headers) =>
      record('POST', url, () => actual.postMultipart(url, fields, file, headers)),
  };
}
const t = transport(),
  landmark = await hunt({ bytes: new Uint8Array(resized), type: 'image/jpeg' }, t),
  demo = await hunt(
    { bytes: new Uint8Array(await readFile('public/demo/source/selfie-1.jpg')), type: 'image/jpeg' },
    t,
  );
const found = landmark.some(
  (r) =>
    r.ok &&
    r.hits.some(
      (h) =>
        /wikipedia\.org|commons\.wikimedia\.org/.test(new URL(h.pageUrl).hostname) &&
        /Tour_Eiffel_Wikimedia_Commons/i.test(decodeURIComponent(h.pageUrl)),
    ),
);
const summary = {
  sourceUrl,
  sourceBytes: original.length,
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  searchBytes: resized.length,
  resize: 'longest side768/JPEG85',
  liveAcceptance: found,
  landmark: landmark.map((r) => ({
    ...r,
    hitCount: r.hits.length,
    examples: r.hits.slice(0, 5).map((h) => h.pageUrl),
    wikiPages: r.hits.filter((h) => /wiki/.test(new URL(h.pageUrl).hostname)).map((h) => h.pageUrl),
  })),
  demo: demo.map((r) => ({ engine: r.engine, ok: r.ok, error: r.error, hits: r.hits.length, ms: r.ms })),
  records,
};
await writeFile(out + '/results.json', JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    { ...summary, landmark: summary.landmark.map(({ hits, ...r }) => r), records: undefined },
    null,
    2,
  ),
);
if (!found) process.exitCode = 1;
