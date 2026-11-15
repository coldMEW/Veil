// Run after vite build, before cap sync. Website CSP/assets are untouched.
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve('dist');
const manifest = JSON.parse(await readFile('scripts/export/models.json', 'utf8'));
const core = manifest.artifacts.filter((m) => m.feature === 'clean');
const keep = new Set(core.map((m) => `models/${m.dir}/${m.file}`));
// Face detection and identity models are core too: Find my face runs offline on the phone.
const face = JSON.parse(await readFile('src/engine/face/models.json', 'utf8'));
for (const m of Object.values(face)) if (m && typeof m === 'object' && m.servedAs) keep.add(m.servedAs.replace(/^\//, ''));
async function trim(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await trim(path);
    else if (!keep.has(path.slice(root.length + 1).replaceAll('\\', '/'))) await rm(path);
  }
}
await trim(join(root, 'models'));
// Verification sources are test fixtures, not app content.
await rm(join(root, 'demo', 'source'), { recursive: true, force: true });
for (const m of core) {
  const bytes = await readFile(join(root, 'models', m.dir, m.file));
  if (bytes.length !== m.bytes || createHash('sha256').update(bytes).digest('hex') !== m.sha256) {
    throw Error(`Bundled core model mismatch: ${m.id}`);
  }
}
// HF may redirect pinned large files to these exact content-delivery origins.
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; " +
  "connect-src 'self' https: ; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";
let html = await readFile(join(root, 'index.html'), 'utf8');
html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
await writeFile(join(root, 'index.html'), html);
console.log(
  `APK core models: ${core.length}, ${core.reduce((n, m) => n + m.bytes, 0)} bytes; optional models omitted`,
);
