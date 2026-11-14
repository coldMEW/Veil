// Replaced by scripts/sw-manifest.mjs after Vite builds the app.
const BUILD = /* SW_MANIFEST */ { version: 'unbuilt', modelsVersion: 'unbuilt', assets: [], precache: [] };
const CACHE_PREFIX = 'veil-app-';
const CACHE_NAME = CACHE_PREFIX + BUILD.version;
const MODELS_CACHE_PREFIX = 'veil-models-';
const MODELS_CACHE_NAME = MODELS_CACHE_PREFIX + BUILD.modelsVersion;
const APP_ASSETS = new Set(BUILD.assets);

self.addEventListener('install', (event) => {
  // The build excludes WASM and files over 2 MB from this small install list.
  // They and model weights are fetched only in response to an actual request.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(BUILD.precache)));
  // Leave updates waiting so an open image session is never forcibly reloaded.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) =>
      (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) ||
      (name.startsWith(MODELS_CACHE_PREFIX) && name !== MODELS_CACHE_NAME)
    ).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function readCached(key, cacheName = CACHE_NAME) {
  try {
    return await (await caches.open(cacheName)).match(key);
  } catch {
    return undefined;
  }
}

async function store(key, response, cacheName = CACHE_NAME) {
  // Do not persist errors, partial bodies, redirects, opaque or image responses.
  if (response.status !== 200 || response.redirected || !['basic', 'default'].includes(response.type)) return;
  if (/^image\//i.test(response.headers.get('Content-Type') || '') && key.startsWith('/models/')) return;
  if (/\bno-store\b/i.test(response.headers.get('Cache-Control') || '')) return;
  try {
    await (await caches.open(cacheName)).put(key, response.clone());
  } catch {
    // Quota/private-mode failures do not prevent using a network response.
  }
}

async function networkFirstIndex(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await store('/index.html', response);
      return response;
    }
    return (await readCached('/index.html')) || response;
  } catch {
    return (await readCached('/index.html')) || Response.error();
  }
}

async function cacheFirst(request, path, cacheName) {
  const cached = await readCached(path, cacheName);
  if (cached) return cached;
  const response = await fetch(request);
  await store(path, response, cacheName);
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin || url.search) return;
  if (request.headers.has('Range')) return;

  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirstIndex(request));
    return;
  }

  // Only compiled app URLs or model artifact formats are eligible. An arbitrary
  // same-origin GET (uploads, exports, reports, APIs) must never enter the cache.
  const model = url.pathname.startsWith('/models/') && /\.(onnx|ort|wasm|bin|data|json|txt)$/i.test(url.pathname) && request.destination !== 'image';
  const appAsset = APP_ASSETS.has(url.pathname);
  const wasm = appAsset && /\.wasm$/i.test(url.pathname);
  if (appAsset || model) event.respondWith(cacheFirst(request, url.pathname, model || wasm ? MODELS_CACHE_NAME : CACHE_NAME));
});
