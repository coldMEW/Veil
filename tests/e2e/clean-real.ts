/**
 * Dev-only Clean round trip on a user-selected local photo. Nothing is uploaded or persisted.
 * Query params: rects=JSON array of normalized {x,y,w,h}; method=migan|solid; backend=wasm|webgpu.
 * The report written to #out never contains OCR text.
 */
import type { ImageAsset, Point, PrivacyCandidate, TransformRecord } from '../../src/contracts';
import { glyphMask } from '../../src/features/clean/glyph';
import { emptyMask, maskArea, type Mask } from '../../src/features/clean/mask';
import { decodeToPixels } from '../../src/features/clean/export';
import { sha256Hex } from '../../src/features/clean/hash';
import { inspectMetadata } from '../../src/features/clean/metadata';
import { MiganInpainter, MIGAN_MODEL } from '../../src/features/clean/inpaint';
import { buildApprovedMask, defaultExpansionPx, manualCandidate, runClean, type CleanOutput } from '../../src/features/clean/session';
import { changedOutsideMask } from '../../src/features/clean/redact';
import { buildReport, canonicalJson } from '../../src/features/report/report';

const out = document.getElementById('out')!;
const q = new URLSearchParams(location.search);

function sniff(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}

async function handle(file: File) {
  const t0 = performance.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) throw new Error('Unsupported file: not a JPEG or PNG by content (magic bytes).');
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('File is over 10 MiB.');
  const src = await decodeToPixels(bytes, mime);
  if (src.width * src.height > 12_000_000) throw new Error('Image is over 12 megapixels.');
  const srcSha = await sha256Hex(bytes);
  const inMeta = inspectMetadata(bytes);

  const rects = JSON.parse(q.get('rects') ?? '[]') as PrivacyCandidate['region'][];
  const polys = JSON.parse(q.get('polys') ?? '[]') as Point[][];
  if (!rects.length && !polys.length) throw new Error('No rects or polys given.');
  const assetId = 'orig';
  // Glyph mode: per polygon, mask only text-coloured pixels (small holes => clean fills).
  const regionMasks: Mask[] = [];
  const glyphInfo: { coverage: number; area: number }[] = [];
  for (const p of polys) {
    const g = glyphMask(src, p, { threshold: Number(q.get('thr') ?? 70), dilatePx: Number(q.get('dil') ?? 4), polarity: (q.get('pol') as 'auto') ?? 'auto' });
    regionMasks.push(g.mask);
    glyphInfo.push({ coverage: Math.round(g.coverage * 1000) / 1000, area: maskArea(g.mask) });
  }
  const candidates = [
    ...rects.map((r) => manualCandidate(assetId, r)),
    ...polys.map((p) => {
      const xs = p.map((v) => v.x), ys = p.map((v) => v.y);
      return manualCandidate(assetId, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }),
  ];
  const expansionPx = defaultExpansionPx(candidates, src.height);
  for (const r of rects) regionMasks.push(buildApprovedMask(src.width, src.height, [manualCandidate(assetId, r)], null, expansionPx));
  const fullMask = emptyMask(src.width, src.height);
  for (const m of regionMasks) for (let i = 0; i < m.data.length; i++) if (m.data[i]) fullMask.data[i] = 1;

  const method = q.get('method') === 'solid' ? 'solid_redaction' : 'migan_inpaint';
  const backend = (q.get('backend') as 'wasm' | 'webgpu') ?? 'webgpu';
  let inpainter: MiganInpainter | undefined;
  if (method === 'migan_inpaint') {
    inpainter = new MiganInpainter();
    await inpainter.load('/models/migan/' + MIGAN_MODEL.file, backend);
  }
  const t1 = performance.now();
  // MI-GAN inpaints one working crop per call, so process each selected region in turn.
  let current = src;
  const transforms: TransformRecord[] = [];
  let last: CleanOutput | undefined;
  for (const m of regionMasks) {
    last = await runClean({ src: current, srcSha256: srcSha, mask: m, expansionPx, method, inpainter, modelSha256: MIGAN_MODEL.sha256 });
    current = last.verification.decoded;
    transforms.push(...last.transforms);
  }
  const cleanMs = performance.now() - t1;
  const v = last!.verification;

  const original: ImageAsset = {
    id: srcSha, sha256: srcSha, mimeType: mime, byteLength: bytes.byteLength,
    // Best effort: encoded size = decoded size here. The shell's imageIntake provides the real encoded dimensions.
    encodedWidth: src.width, encodedHeight: src.height, width: src.width, height: src.height, parentId: null, transformId: null,
  };
  const exported: ImageAsset = {
    id: v.sha256, sha256: v.sha256, mimeType: 'image/png', byteLength: v.byteLength,
    // Best effort: see note above; imageIntake provides the real encoded dimensions.
    encodedWidth: current.width, encodedHeight: current.height, width: current.width, height: current.height, parentId: srcSha, transformId: transforms[0]?.id ?? null,
  };
  const report = buildReport({
    appVersion: 'dev', commit: 'local', generatedAt: new Date().toISOString(), original, exported,
    checks: [], candidates, transforms,
    verification: { exportMetadataBlocks: v.metadata.metadataBlocks, roundTripMismatches: v.roundTripMismatches, rescan: 'not_run' },
  });

  const c = document.getElementById('after') as HTMLCanvasElement;
  c.width = current.width;
  c.height = current.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(current.data), current.width, current.height), 0, 0);

  const result = {
    input: { mime, bytes: bytes.byteLength, width: src.width, height: src.height, metadataBlocks: inMeta.metadataBlocks },
    method, backend, regions: regionMasks.length, expansionPx, glyphInfo,
    changedOutsideMask: changedOutsideMask(src, current, fullMask),
    export: { sha256: v.sha256, bytes: v.byteLength, metadataBlocks: v.metadata.metadataBlocks, roundTripMismatches: v.roundTripMismatches },
    timingsMs: { total: Math.round(performance.now() - t0), clean: Math.round(cleanMs) },
    reportBytes: canonicalJson(report).length,
  };
  const w = window as unknown as { __CLEAN: unknown; __REPORT: unknown };
  w.__CLEAN = result;
  w.__REPORT = report;
  out.textContent = JSON.stringify(result, null, 2);
}

function start(f: File | undefined) {
  if (!f) return;
  out.textContent = 'processing…';
  handle(f).catch((err) => {
    (window as unknown as { __CLEAN: unknown }).__CLEAN = { error: String(err) };
    out.textContent = 'ERROR ' + String(err);
  });
}
document.getElementById('file')!.addEventListener('change', (e) => start((e.target as HTMLInputElement).files?.[0]));
const drop = document.getElementById('drop')!;
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.style.borderColor = '#2a7';
});
drop.addEventListener('dragleave', () => (drop.style.borderColor = '#888'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.style.borderColor = '#888';
  start(e.dataTransfer?.files?.[0]);
});
