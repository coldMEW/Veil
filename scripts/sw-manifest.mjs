// Only static build output is enumerated. User content never enters this list.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const template = await readFile(join(root, 'public', 'sw.js'), 'utf8');
const marker = "/* SW_MANIFEST */ { version: 'unbuilt', modelsVersion: 'unbuilt', assets: [], precache: [] }";
if (!template.includes(marker)) throw new Error('Missing service worker manifest marker');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    // Weights remain lazy and are versioned separately using both manifests.
    if (directory === dist && (entry.name === 'models' || entry.name === 'sw.js')) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  }));
  return files.flat();
}

const files = (await filesUnder(dist)).sort();
const hash = createHash('sha256').update(template);
const inspectModels = JSON.parse(await readFile(join(root, 'src/features/inspect/model/models.json'), 'utf8'));
const exportModels = JSON.parse(await readFile(join(root, 'scripts/export/models.json'), 'utf8'));
// Optional third manifest (face warp model); absent in older trees and test fixtures.
const warpModels = await readFile(join(root, 'src/features/inspect/warp/models.json'), 'utf8').then(JSON.parse, () => ({}));
const pinnedModels = [
  ...Object.values(inspectModels).map((model) => [model.servedAs, model.sha256]),
  ...Object.values(warpModels).map((model) => [model.servedAs, model.sha256]),
  ...exportModels.artifacts.map((model) => [`/models/${model.dir}/${model.file}`, model.sha256]),
].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
if (pinnedModels.some(([, sha256]) => !/^[a-f0-9]{64}$/i.test(sha256))) throw new Error('Invalid model SHA-256');
// App-only changes do not invalidate model/ORT downloads. A changed model hash
// or WASM artifact does, including fixed model URLs whose bytes have changed.
const modelsHash = createHash('sha256').update(JSON.stringify(pinnedModels));
const assets = [];
const precache = [];
let precacheBytes = 0;
const MAX_PRECACHE_BYTES = 2_000_000;
for (const file of files) {
  const url = '/' + relative(dist, file).split(sep).map(encodeURIComponent).join('/');
  const bytes = await readFile(file);
  assets.push(url);
  hash.update(url).update('\0').update(bytes).update('\0');
  if (/\.wasm$/i.test(url)) {
    modelsHash.update(url).update('\0').update(bytes).update('\0');
  } else if (bytes.length <= MAX_PRECACHE_BYTES) {
    precache.push(url);
    precacheBytes += bytes.length;
  }
}
if (!assets.includes('/index.html')) throw new Error('Build has no index.html');
const version = hash.digest('hex');
const modelsVersion = modelsHash.digest('hex');
await writeFile(join(dist, 'sw.js'), template.replace(marker, JSON.stringify({ version, modelsVersion, assets, precache })));
console.log(`[sw] precache: ${precache.length} app assets, ${precacheBytes} bytes (${(precacheBytes / 1e6).toFixed(2)} MB); app ${version.slice(0, 12)}, models ${modelsVersion.slice(0, 12)}; WASM/models/large assets on demand`);
