/**
 * Dev-only automatic Clean round trip on a local photo:
 * intake -> OCR -> privacy candidates (default selection) -> glyph masks on OCR quads -> MI-GAN ->
 * fresh PNG export -> decode exported bytes -> OCR re-scan of the export -> report.
 * Output never contains OCR text (only categories, counts, hashes, timings).
 */
import { OcrEngine } from '../../src/features/clean/ocr/engine';
import { checkIntake, sha256Hex } from '../../src/lib/runtime/imageIntake';
import { decodeToPixels } from '../../src/features/clean/export';
import { inspectMetadata } from '../../src/features/clean/metadata';
import { glyphMask, polygonMask } from '../../src/features/clean/glyph';
import { emptyMask, type Mask, type Pixels } from '../../src/features/clean/mask';
import { MiganInpainter, MIGAN_MODEL } from '../../src/features/clean/inpaint';
import { candidatesFromOcr, rescanExport, runClean, textRemovalMask, TEXT_REMOVAL_DEFAULTS, type CleanOutput } from '../../src/features/clean/session';
import { changedOutsideMask } from '../../src/features/clean/redact';
import { buildReport, canonicalJson } from '../../src/features/report/report';
import type { ImageAsset, Point, TransformRecord } from '../../src/contracts';

const out = document.getElementById('out')!;
const q = new URLSearchParams(location.search);

function draw(id: string, p: Pixels) {
  const c = document.getElementById(id) as HTMLCanvasElement;
  c.width = p.width;
  c.height = p.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
}

/** Grow a quad around its centre so the glyph mask samples some background around the text. */
function grow(quad: Point[], fx: number, fy: number): Point[] {
  const cx = quad.reduce((s, p) => s + p.x, 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p.y, 0) / quad.length;
  return quad.map((p) => ({ x: cx + (p.x - cx) * fx, y: cy + (p.y - cy) * fy }));
}

async function handle(file: File) {
  const t0 = performance.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const intake = checkIntake(bytes);
  if (!intake.ok) throw new Error(intake.reason);
  const src = await decodeToPixels(bytes, intake.mimeType);
  const srcSha = await sha256Hex(bytes);
  const inMeta = inspectMetadata(bytes);
  draw('before', src);

  const engine = new OcrEngine();
  await engine.load('/models/ocr/', { detVariant: 'v3' });
  const tScan = performance.now();
  const boxes = await engine.scan(src);
  const scanMs = performance.now() - tScan;
  const candidates = candidatesFromOcr(srcSha, boxes);
  const selected = candidates.filter((c) => c.selected);

  // Library path (same call the UI uses): one combined glyph-level mask with the tuned defaults.
  const { mask: fullMask, dilatePx: dil } = textRemovalMask(src, candidates);
  const perCandidate = selected;
  const masks: Mask[] = selected.length ? [fullMask] : [];

  const inpainter = new MiganInpainter();
  await inpainter.load('/models/migan/' + MIGAN_MODEL.file, (q.get('backend') as 'wasm' | 'webgpu') ?? 'webgpu');
  const tClean = performance.now();
  let current = src;
  const transforms: TransformRecord[] = [];
  let last: CleanOutput | undefined;
  for (const m of masks) {
    last = await runClean({ src: current, srcSha256: srcSha, mask: m, expansionPx: dil, method: 'migan_inpaint', inpainter, inpaintMaxSide: TEXT_REMOVAL_DEFAULTS.inpaintMaxSide, modelSha256: MIGAN_MODEL.sha256 });
    current = last.verification.decoded;
    transforms.push(...last.transforms);
  }
  const cleanMs = performance.now() - tClean;
  draw('after', current);

  const tRe = performance.now();
  const rescan = last ? await rescanExport(engine, current, selected) : { stillDetected: [], totalBoxes: 0 };
  const rescanMs = performance.now() - tRe;
  engine.dispose();

  const v = last?.verification;
  const original: ImageAsset = {
    id: srcSha, sha256: srcSha, mimeType: intake.mimeType, byteLength: bytes.byteLength,
    encodedWidth: intake.width, encodedHeight: intake.height, width: src.width, height: src.height, parentId: null,
  };
  const exported: ImageAsset | undefined = v
    ? { id: v.sha256, sha256: v.sha256, mimeType: 'image/png', byteLength: v.byteLength, encodedWidth: current.width,
        encodedHeight: current.height, width: current.width, height: current.height, parentId: srcSha, transformId: transforms[0]?.id ?? null }
    : undefined;
  const report = buildReport({
    appVersion: 'dev', commit: 'local', generatedAt: new Date().toISOString(), original, exported, checks: [], candidates, transforms,
    verification: v
      ? { exportMetadataBlocks: v.metadata.metadataBlocks, roundTripMismatches: v.roundTripMismatches,
          rescan: { stillDetectedCount: rescan.stillDetected.length, totalBoxes: rescan.totalBoxes, selectedCount: selected.length } }
      : undefined,
  });

  const byCat: Record<string, { total: number; selected: number }> = {};
  for (const c of candidates) {
    byCat[c.category] ??= { total: 0, selected: 0 };
    byCat[c.category]!.total++;
    if (c.selected) byCat[c.category]!.selected++;
  }
  const result = {
    input: { bytes: bytes.byteLength, width: src.width, height: src.height, metadataBlocks: inMeta.metadataBlocks },
    ocr: { boxes: boxes.length, byCategory: byCat, scanMs: Math.round(scanMs) },
    clean: { regions: perCandidate.length, regionHeightsPx: selected.map((c) => Math.round(c.region.h * src.height)), maskAreaPx: fullMask.data.reduce((s, v) => s + v, 0), inpaintPasses: masks.length, dilatePx: dil, changedOutsideMask: changedOutsideMask(src, current, fullMask), ms: Math.round(cleanMs) },
    export: v ? { sha256: v.sha256, metadataBlocks: v.metadata.metadataBlocks, roundTripMismatches: v.roundTripMismatches } : null,
    rescan: { stillDetectedInSelected: rescan.stillDetected.length, selected: selected.length, totalBoxes: rescan.totalBoxes, ms: Math.round(rescanMs) },
    privacyStatement: report.clean.privacyStatement,
    reportHasNoText: !boxes.some((b) => b.text.trim().length >= 3 && canonicalJson(report).includes(b.text.trim())),
    totalMs: Math.round(performance.now() - t0),
  };
  (window as unknown as { __AUTO: unknown }).__AUTO = result;
  out.textContent = JSON.stringify(result, null, 2);
}

function start(f: File | undefined) {
  if (!f) return;
  out.textContent = 'processing…';
  handle(f).catch((err) => {
    (window as unknown as { __AUTO: unknown }).__AUTO = { error: String(err) };
    out.textContent = 'ERROR ' + String(err);
  });
}
document.getElementById('file')!.addEventListener('change', (e) => start((e.target as HTMLInputElement).files?.[0]));
const drop = document.getElementById('drop')!;
drop.addEventListener('dragover', (e) => e.preventDefault());
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  start(e.dataTransfer?.files?.[0]);
});
