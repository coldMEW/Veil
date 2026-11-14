import { expect, test } from '@playwright/test';

/** Real browser/model round trip; all pixels are generated here, never from a private photo. */
test('OCR -> glyph mask -> MI-GAN -> exported-byte rescan and private report', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // Vite serves the actual library modules; no mocks or test-only processing replacements.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { OcrEngine } = await load('/src/features/clean/ocr/engine.ts');
    const { candidatesFromOcr, textRemovalMask, runClean, rescanExport } = await load(
      '/src/features/clean/session.ts',
    );
    const { MiganInpainter, MIGAN_MODEL } = await load('/src/features/clean/inpaint.ts');
    const { changedOutsideMask } = await load('/src/features/clean/redact.ts');
    const { buildReport, canonicalJson } = await load('/src/features/report/report.ts');
    const { encodePng } = await load('/src/features/clean/export.ts');
    const { sha256Hex } = await load('/src/features/clean/hash.ts');
    const width = 800;
    const height = 600;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const background = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const value = Math.round(222 + 5 * Math.sin(x / 21) + 3 * Math.cos(y / 17));
        background.data[i] = value;
        background.data[i + 1] = value + 2;
        background.data[i + 2] = value - 2;
        background.data[i + 3] = 255;
      }
    }
    ctx.putImageData(background, 0, 0);
    ctx.fillStyle = '#171717';
    ctx.font = '32px Arial';
    ctx.fillText('221B BAKER ST', 200, 240);
    ctx.fillText('ROOM 204', 200, 340);
    const src = ctx.getImageData(0, 0, width, height);
    const originalBytes = await encodePng(src);
    const assetId = await sha256Hex(originalBytes);
    const engine = new OcrEngine();
    const timing: Record<string, number> = {};
    const start = performance.now();
    try {
      let t = performance.now();
      await engine.load('/models/ocr/', { detVariant: 'v3' });
      timing.ocrLoadMs = Math.round(performance.now() - t);
      t = performance.now();
      const boxes = await engine.scan(src);
      timing.ocrScanMs = Math.round(performance.now() - t);
      const candidates = candidatesFromOcr(assetId, boxes);
      const selected = candidates.filter((c: { selected: boolean }) => c.selected);
      t = performance.now();
      const { mask, dilatePx } = textRemovalMask(src, candidates);
      timing.maskMs = Math.round(performance.now() - t);
      const inpainter = new MiganInpainter();
      t = performance.now();
      await inpainter.load('/models/migan/' + MIGAN_MODEL.file, 'wasm');
      timing.inpaintLoadMs = Math.round(performance.now() - t);
      t = performance.now();
      const clean = await runClean({
        src,
        srcSha256: assetId,
        mask,
        expansionPx: dilatePx,
        method: 'migan_inpaint',
        inpainter,
        inpaintMaxSide: 1400,
        modelSha256: MIGAN_MODEL.sha256,
      });
      timing.cleanExportMs = Math.round(performance.now() - t);
      t = performance.now();
      const rescan = await rescanExport(engine, clean.verification.decoded, selected);
      timing.rescanMs = Math.round(performance.now() - t);
      const original = {
        id: assetId,
        sha256: assetId,
        mimeType: 'image/png',
        byteLength: originalBytes.length,
        encodedWidth: width,
        encodedHeight: height,
        width,
        height,
        parentId: null,
      };
      const report = canonicalJson(
        buildReport({
          appVersion: 'e2e',
          commit: 'local',
          generatedAt: '2026-11-14T00:00:00Z',
          original,
          checks: [],
          candidates,
          transforms: clean.transforms,
          verification: {
            exportMetadataBlocks: clean.verification.metadata.metadataBlocks,
            roundTripMismatches: clean.verification.roundTripMismatches,
            rescan: {
              stillDetectedCount: rescan.stillDetected.length,
              totalBoxes: rescan.totalBoxes,
              selectedCount: selected.length,
            },
          },
        }),
      );
      timing.totalMs = Math.round(performance.now() - start);
      return {
        selectedCount: selected.length,
        plantedFound: ['221B BAKER ST', 'ROOM 204'].map((text) =>
          boxes.some((b: { text: string }) => b.text === text),
        ),
        changedOutsideMask: changedOutsideMask(src, clean.verification.decoded, mask),
        metadataBlocks: clean.verification.metadata.metadataBlocks,
        stillDetected: rescan.stillDetected,
        report,
        timing,
        backend: 'wasm',
        crossOriginIsolated,
      };
    } finally {
      engine.dispose();
    }
  });
  console.log('Clean E2E summary:', JSON.stringify({ ...result, report: undefined }));
  await test.info().attach('clean-summary', {
    body: JSON.stringify({ ...result, report: undefined }, null, 2),
    contentType: 'application/json',
  });
  expect(result.crossOriginIsolated).toBe(true);
  expect(result.plantedFound).toEqual([true, true]);
  expect(result.selectedCount).toBeGreaterThanOrEqual(2);
  expect(result.changedOutsideMask).toBe(0);
  expect(result.metadataBlocks).toEqual([]);
  expect(result.stillDetected).toEqual([]);
  expect(result.report).not.toContain('221B BAKER ST');
  expect(result.report).not.toContain('ROOM 204');
});
