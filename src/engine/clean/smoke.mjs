import { build } from 'esbuild';
import { createCanvas } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({
  entryPoints: ['src/features/clean/ocr/pipeline.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { scanImage } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const sb = await build({
  entryPoints: ['src/features/clean/session.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { candidatesFromOcr } = await import(
  'data:text/javascript;base64,' + Buffer.from(sb.outputFiles[0].text).toString('base64')
);
const det = await ort.InferenceSession.create('public/models/ocr/det-v3.onnx', { intraOpNumThreads: 4 }),
  rec = await ort.InferenceSession.create('public/models/ocr/rec.onnx', { intraOpNumThreads: 4 });
const dict = (await readFile('public/models/ocr/dict.txt', 'utf8'))
  .trimEnd()
  .split('\n')
  .map((s) => s.replace(/\r$/, ''));
let passes = 0;
const run = (s) => async (input) => {
  const tensor = new ort.Tensor('float32', input.data, input.dims);
  const out = await s.run({ x: tensor });
  const result = out[s.outputNames[0]],
    value = { data: new Float32Array(result.data), dims: [...result.dims] };
  tensor.dispose();
  Object.values(out).forEach((v) => v.dispose());
  return value;
};
const models = {
  dictionary: ['', ...dict, ' '],
  recognitionHeight: 48,
  detect: async (input) => {
    passes++;
    return run(det)(input);
  },
  recognize: run(rec),
};
try {
  const c = createCanvas(1800, 1400),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#e4e0db';
  ctx.fillRect(0, 0, 1800, 1400);
  ctx.fillStyle = '#111';
  const planted = [
    { text: 'MAPLE AVE', angle: 60, x: 300, y: 200 },
    { text: 'PINE ROAD', angle: 70, x: 700, y: 200 },
    { text: 'BAKER ST', angle: 80, x: 1100, y: 200 },
    { text: 'ROOM 204', angle: 90, x: 1500, y: 200 },
    { text: 'CEDAR LN', angle: -70, x: 700, y: 1100 },
    { text: 'NIKE', angle: 0, x: 300, y: 1000 },
  ];
  for (const p of planted) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.angle * Math.PI) / 180);
    ctx.font = '28px Arial';
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
  let t = performance.now();
  const boxes = await scanImage(ctx.getImageData(0, 0, 1800, 1400), models);
  console.log(
    JSON.stringify({
      synthetic: true,
      ms: Math.round(performance.now() - t),
      passes,
      boxes: boxes.length,
      diagnostics: process.argv.includes('--diagnostic')
        ? boxes.map((b) => ({ text: b.text, score: b.recScore, rect: b.rect }))
        : undefined,
      exact: planted.map((p) => ({ angle: p.angle, found: boxes.some((b) => b.text === p.text) })),
      garmentSelected: boxes.filter((b) => b.text === 'NIKE').map((b) => b.category !== 'other_text'),
    }),
  );
  if (planted.some((p) => !boxes.some((b) => b.text === p.text))) process.exitCode = 1;
  for (const path of process.argv.slice(2).filter((p) => p !== '--diagnostic')) {
    const { data, info } = await sharp(path)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    passes = 0;
    t = performance.now();
    const b = await scanImage({ data, width: info.width, height: info.height }, models);
    const candidates = candidatesFromOcr('local-only', b);
    const canvas = createCanvas(info.width, info.height),
      cx = canvas.getContext('2d');
    const image = await import('@napi-rs/canvas').then((m) => m.loadImage(path));
    cx.drawImage(image, 0, 0, info.width, info.height);
    cx.lineWidth = Math.max(2, info.width / 500);
    for (const box of b) {
      cx.strokeStyle = candidates[b.indexOf(box)].selected ? '#e33333' : '#32c36d';
      cx.strokeRect(box.pixelRect.x, box.pixelRect.y, box.pixelRect.w, box.pixelRect.h);
    }
    const out =
      'C:/Users/DSU/Desktop/Ignite/scratch-eval/engine_clean_preview_' + process.argv.indexOf(path) + '.png';
    await writeFile(out, canvas.toBuffer('image/png'));
    console.log(
      JSON.stringify({
        private: true,
        ms: Math.round(performance.now() - t),
        passes,
        boxes: b.length,
        selected: candidates.filter((x) => x.selected).length,
        garmentReads: b.filter(x=>/\b(champion|nike|adidas|north face|essentials)\b/i.test(x.text)).length,
        garmentSelected: candidates.filter(x=>x.selected && /\b(champion|nike|adidas|north face|essentials)\b/i.test(x.text??'')).length,
        privateCategory: b.filter((x) => x.category !== 'other_text').length,
        reviewOnly: b.filter((x) => x.category === 'other_text').length,
        steep: b.filter((x) => {
          const q = x.quad;
          return Math.abs(Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x)) > Math.PI / 3;
        }).length,
        preview: out,
      }),
    );
  }
} finally {
  await det.release();
  await rec.release();
}
