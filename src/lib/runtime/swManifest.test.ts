import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import workerSource from '../../../public/sw.js?raw';
import manifestScript from '../../../scripts/sw-manifest.mjs?raw';

interface Manifest {
  version: string;
  modelsVersion: string;
  assets: string[];
  precache: string[];
}

async function fixture() {
  // Keep synthetic test files inside this workspace; never alter real manifests.
  const root = await mkdtemp(resolve('.sw-manifest-test-'));
  const inspect = { model: { servedAs: '/models/inspect.onnx', sha256: 'a'.repeat(64) } };
  const exported = { artifacts: [{ dir: 'clean', file: 'clean.onnx', sha256: 'b'.repeat(64) }] };
  await Promise.all(['public', 'scripts/export', 'src/features/inspect/model', 'dist/assets'].map((path) => mkdir(join(root, path), { recursive: true })));
  await Promise.all([
    writeFile(join(root, 'public/sw.js'), workerSource),
    writeFile(join(root, 'scripts/sw-manifest.mjs'), manifestScript),
    writeFile(join(root, 'dist/index.html'), '<!doctype html>'),
    writeFile(join(root, 'dist/assets/app.js'), 'app version one'),
    writeFile(join(root, 'dist/assets/ort.wasm'), 'synthetic wasm'),
  ]);
  async function build() {
    await Promise.all([
      writeFile(join(root, 'src/features/inspect/model/models.json'), JSON.stringify(inspect)),
      writeFile(join(root, 'scripts/export/models.json'), JSON.stringify(exported)),
    ]);
    execFileSync(process.execPath, [join(root, 'scripts/sw-manifest.mjs')], { cwd: root, windowsHide: true });
    const result = await readFile(join(root, 'dist/sw.js'), 'utf8');
    return JSON.parse(result.match(/^const BUILD = (.*);$/m)![1]!) as Manifest;
  }
  return { root, inspect, exported, build, dispose: () => rm(root, { recursive: true, force: true }) };
}

describe('generated service worker manifest', () => {
  it('excludes all WASM and files over 2 MB from precache while keeping them eligible on demand', async () => {
    const f = await fixture();
    try {
      await Promise.all([
        writeFile(join(f.root, 'dist/assets/large.bin'), new Uint8Array(2_000_001)),
        writeFile(join(f.root, 'dist/assets/boundary.bin'), new Uint8Array(2_000_000)),
        mkdir(join(f.root, 'dist/models'), { recursive: true }).then(() => writeFile(join(f.root, 'dist/models/private.onnx'), 'not precached')),
      ]);
      const manifest = await f.build();
      expect(manifest.precache).toContain('/assets/boundary.bin');
      expect(manifest.precache).not.toContain('/assets/large.bin');
      expect(manifest.precache).not.toContain('/assets/ort.wasm');
      expect(manifest.assets).toEqual(expect.arrayContaining(['/assets/large.bin', '/assets/ort.wasm']));
      expect(manifest.assets.some((url) => url.startsWith('/models/'))).toBe(false);
    } finally { await f.dispose(); }
  });

  it('keeps model versions stable for app changes and invalidates on either manifest SHA or WASM changes', async () => {
    const f = await fixture();
    try {
      const initial = await f.build();
      expect(await f.build()).toEqual(initial);
      await writeFile(join(f.root, 'dist/assets/app.js'), 'app version two');
      const appChange = await f.build();
      expect(appChange.version).not.toBe(initial.version);
      expect(appChange.modelsVersion).toBe(initial.modelsVersion);
      f.inspect.model.sha256 = 'c'.repeat(64);
      const inspectChange = await f.build();
      expect(inspectChange.modelsVersion).not.toBe(appChange.modelsVersion);
      f.exported.artifacts[0]!.sha256 = 'd'.repeat(64);
      const exportChange = await f.build();
      expect(exportChange.modelsVersion).not.toBe(inspectChange.modelsVersion);
      await writeFile(join(f.root, 'dist/assets/ort.wasm'), 'new synthetic wasm');
      expect((await f.build()).modelsVersion).not.toBe(exportChange.modelsVersion);
    } finally { await f.dispose(); }
  });
});
