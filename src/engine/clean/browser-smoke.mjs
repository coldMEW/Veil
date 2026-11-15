import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5190');
  const result = await page.evaluate(async () => {
    const { OcrEngine } = await import('/src/features/clean/ocr/engine.ts'),
      { candidatesFromOcr, textRemovalMask, runClean, rescanExport } = await import(
        '/src/features/clean/session.ts'
      ),
      { MiganInpainter } = await import('/src/features/clean/inpaint.ts');
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d'),
      bg = ctx.createImageData(800, 600);
    for (let y = 0; y < 600; y++)
      for (let x = 0; x < 800; x++) {
        const i = 4 * (y * 800 + x),
          v = Math.round(222 + 5 * Math.sin(x / 21) + 3 * Math.cos(y / 17));
        bg.data[i] = v;
        bg.data[i + 1] = v + 2;
        bg.data[i + 2] = v - 2;
        bg.data[i + 3] = 255;
      }
    ctx.putImageData(bg, 0, 0);
    ctx.fillStyle = '#171717';
    ctx.font = '32px Arial';
    ctx.fillText('221B BAKER ST', 200, 240);
    ctx.fillText('ROOM 204', 200, 340);
    const src = ctx.getImageData(0, 0, 800, 600),
      ocr = new OcrEngine(),
      paint = new MiganInpainter();
    try {
      await ocr.load('/models/ocr/');
      const boxes = await ocr.scan(src),
        cand = candidatesFromOcr('synthetic', boxes),
        { mask, dilatePx } = textRemovalMask(src, cand);
      await paint.load('/models/migan/migan_pipeline_v2.onnx');
      const output = await runClean({
        src,
        srcSha256: 'synthetic',
        mask,
        expansionPx: dilatePx,
        method: 'migan_inpaint',
        inpainter: paint,
        inpaintMaxSide: 1400,
      });
      const rescan = await ocr.scan(output.verification.decoded);
      return {
        png: Array.from(output.bytes),
        boxes: boxes.map((b) => ({ text: b.text, rect: b.rect, score: b.recScore })),
        rescan: rescan.map((b) => ({ text: b.text, rect: b.rect, score: b.recScore })),
        dilatePx,
      };
    } finally {
      ocr.dispose();
      await paint.dispose();
    }
  });
  await writeFile(
    'C:/Users/DSU/Desktop/Ignite/scratch-eval/engine_clean_browser.png',
    Buffer.from(result.png),
  );
  delete result.png;
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
