// Downloads pinned model files into public/models/ and verifies their SHA-256.
// Model weights are never committed; every build fetches the exact revision.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'src/features/inspect/model/models.json'), 'utf8'));

async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

for (const [id, m] of Object.entries(manifest)) {
  const out = join(root, 'public', m.servedAs);
  try {
    if ((await stat(out)).size === m.bytes && (await sha256File(out)) === m.sha256) {
      console.log(`[models] ${id}: present, sha256 ok`);
      continue;
    }
  } catch {
    // missing; download below
  }

  const url = `${m.upstream}/resolve/${m.revision}/${m.path}`;
  console.log(`[models] ${id}: downloading ${(m.bytes / 1e6).toFixed(1)} MB from ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`[models] ${id}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== m.sha256 || bytes.length !== m.bytes) {
    throw new Error(`[models] ${id}: checksum mismatch (got ${got}, ${bytes.length} bytes)`);
  }
  await mkdir(dirname(out), { recursive: true });
  const tmp = `${out}.part`;
  await writeFile(tmp, bytes);
  await rm(out, { force: true });
  await rename(tmp, out);
  console.log(`[models] ${id}: saved, sha256 ok`);
}
