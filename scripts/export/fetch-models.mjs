#!/usr/bin/env node
// Fetch pinned model artifacts into public/models/<dir>/ and verify sha256 + size.
// Usage: node scripts/export/fetch-models.mjs [--only id1,id2]
// Skips files already present with the right hash. Any mismatch exits non-zero (fails the build).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(join(root, 'scripts/export/models.json'), 'utf8'));
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let failed = 0;
for (const a of manifest.artifacts) {
  if (only && !only.has(a.id)) continue;
  const dest = join(root, 'public/models', a.dir, a.file);
  try {
    const s = await stat(dest);
    if (s.size === a.bytes && sha256(await readFile(dest)) === a.sha256) {
      console.log(`ok (cached) ${a.id}`);
      continue;
    }
  } catch {
    /* not present */
  }
  await mkdir(dirname(dest), { recursive: true });
  const t0 = Date.now();
  const res = await fetch(a.url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`FAIL ${a.id}: HTTP ${res.status}`);
    failed++;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (buf.length !== a.bytes || got !== a.sha256) {
    console.error(`FAIL ${a.id}: expected ${a.bytes} B ${a.sha256}, got ${buf.length} B ${got}`);
    failed++;
    continue;
  }
  const tmp = dest + '.part';
  await writeFile(tmp, buf);
  await rm(dest, { force: true });
  await rename(tmp, dest);
  console.log(`ok ${a.id} ${(buf.length / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
}
if (failed) {
  console.error(`${failed} artifact(s) failed verification`);
  process.exit(1);
}
