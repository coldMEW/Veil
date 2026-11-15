import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, EvidenceStoreError, MAX_EVIDENCE_BYTES } from './server/evidenceStore.mjs';
import { cloudProviders, MAX_CLOUD_BYTES, MAX_CLOUD_SECONDS, runCloudReview } from './server/cloudReview.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 5173);
let cloudReviewRunning = false;
const evidenceStore = new EvidenceStore(resolve(root, '.veil-evidence'));
const ortDistribution = resolve(root, 'node_modules', 'onnxruntime-web', 'dist');
const vendorAssets = Object.fromEntries(
  ['ort.min.js', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'].map((file) => [`/vendor/ort/${file}`, resolve(ortDistribution, file)]),
);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src blob:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://huggingface.co https://*.hf.co; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
};

function safePath(pathname) {
  if (Object.hasOwn(vendorAssets, pathname)) return vendorAssets[pathname];
  const requested = pathname === '/' ? '/index.html' : pathname;
  const full = resolve(root, `.${requested}`);
  const relativePath = relative(root, full);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  if (relativePath.split(/[\\/]/).some((part) => part.startsWith('.') || part === 'node_modules')) return null;
  return full;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function decodeHeader(value, fallback) {
  try {
    return decodeURIComponent(String(value || fallback));
  } catch {
    return fallback;
  }
}

async function readBody(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new EvidenceStoreError(`Request body exceeds the ${maxBytes}-byte limit.`, 413);
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > maxBytes) throw new EvidenceStoreError(`Request body exceeds the ${maxBytes}-byte limit.`, 413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function handleApi(req, res, pathname) {
  if (pathname.startsWith('/api/review/')) {
    const localSocket = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '');
    if (!localSocket || !localHost) throw new EvidenceStoreError('Cloud review is only available from the local Veil app.', 403);
    if (req.method === 'GET' && pathname === '/api/review/providers') {
      sendJson(res, 200, { providers: cloudProviders(), maxBytes: MAX_CLOUD_BYTES, maxSeconds: MAX_CLOUD_SECONDS });
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/review/cloud') {
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-veil-cloud-consent'] !== 'yes') {
        throw new EvidenceStoreError('Start the upload from the cloud review button in Veil.', 403);
      }
      if (cloudReviewRunning) throw new EvidenceStoreError('Another cloud review is already running.', 429);
      cloudReviewRunning = true;
      try {
        const body = await readBody(req, Math.ceil(MAX_CLOUD_BYTES * 4 / 3) + 1_000_000);
        let review;
        try {
          review = await runCloudReview(JSON.parse(body.toString('utf8')));
        } catch (error) {
          throw new EvidenceStoreError(error.message, 400);
        }
        sendJson(res, 200, review);
      } finally {
        cloudReviewRunning = false;
      }
      return true;
    }
  }
  if (req.method === 'GET' && pathname === '/api/evidence/health') {
    sendJson(res, 200, { status: 'ok', service: 'veil-local-evidence-vault', maxEvidenceBytes: MAX_EVIDENCE_BYTES });
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/evidence/keys/public') {
    sendJson(res, 200, await evidenceStore.publicKeyInfo());
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/evidence/cases') {
    const bytes = await readBody(req, MAX_EVIDENCE_BYTES);
    const receipt = await evidenceStore.sealOriginal({
      caseId: String(req.headers['x-veil-case-id'] || ''),
      originalName: decodeHeader(req.headers['x-veil-file-name'], 'original-video'),
      declaredMimeType: String(req.headers['content-type'] || ''),
      clientSha256: String(req.headers['x-veil-client-sha256'] || ''),
      bytes,
    });
    sendJson(res, 201, receipt);
    return true;
  }

  const caseMatch = pathname.match(/^\/api\/evidence\/cases\/([a-zA-Z0-9_-]+)$/);
  const observationMatch = pathname.match(/^\/api\/evidence\/cases\/([a-zA-Z0-9_-]+)\/observations$/);
  const analysisMatch = pathname.match(/^\/api\/evidence\/cases\/([a-zA-Z0-9_-]+)\/analysis$/);
  const verificationMatch = pathname.match(/^\/api\/evidence\/cases\/([a-zA-Z0-9_-]+)\/verify$/);
  if (req.method === 'GET' && caseMatch) {
    sendJson(res, 200, await evidenceStore.getCase(caseMatch[1]));
    return true;
  }
  if (req.method === 'GET' && verificationMatch) {
    sendJson(res, 200, await evidenceStore.verification(verificationMatch[1]));
    return true;
  }
  if (req.method === 'POST' && observationMatch) {
    const raw = await readBody(req, 1024 * 1024);
    let value;
    try {
      value = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new EvidenceStoreError('Observations request must be valid JSON.');
    }
    const receipt = await evidenceStore.appendObservations(observationMatch[1], value.observations);
    sendJson(res, 200, receipt);
    return true;
  }
  if (req.method === 'POST' && analysisMatch) {
    const raw = await readBody(req, 2 * 1024 * 1024);
    let value;
    try {
      value = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new EvidenceStoreError('Analysis request must be valid JSON.');
    }
    const receipt = await evidenceStore.appendAnalysis(analysisMatch[1], value.analysis);
    sendJson(res, 200, receipt);
    return true;
  }
  return false;
}

function serveStatic(req, res, pathname) {
  const file = safePath(pathname);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Could not read local asset.');
  });
  stream.pipe(res);
}

async function handle(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (await handleApi(req, res, url.pathname)) return;
      sendJson(res, 404, { error: 'API route not found.' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...securityHeaders, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error instanceof EvidenceStoreError ? error.status : 500;
    const message = error instanceof EvidenceStoreError ? error.message : 'The local evidence vault encountered an unexpected error.';
    if (status === 500) console.error(error);
    sendJson(res, status, { error: message });
  }
}

await evidenceStore.initialise();
createServer((req, res) => void handle(req, res)).listen(port, () => {
  console.log(`Veil Evidence Passport is running at http://localhost:${port}`);
  console.log(`Local evidence vault: ${resolve(root, '.veil-evidence')}`);
});
