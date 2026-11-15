import { build } from 'esbuild';
import { createCanvas } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-node';
import { writeFile } from 'node:fs/promises';
async function module(path) {
  const b = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const { inpaintTiled } = await module('src/engine/clean/tiles.ts'),
  { textRemovalMask, candidatesFromOcr } = await module('src/features/clean/session.ts'),
  { changedOutsideMask } = await module('src/features/clean/redact.ts');
const c = createCanvas(1024, 768),
  ctx = c.getContext('2d'),
  img = ctx.createImageData(1024, 768);
for (let y = 0; y < 768; y++)
  for (let x = 0; x < 1024; x++) {
    const i = 4 * (y * 1024 + x);
    img.data[i] = 130 + 12 * Math.sin(x / 7) + 8 * Math.cos(y / 11);
    img.data[i + 1] = 145 + 12 * Math.sin(x / 7) + 8 * Math.cos(y / 11);
    img.data[i + 2] = 125 + 12 * Math.sin(x / 7) + 8 * Math.cos(y / 11);
    img.data[i + 3] = 255;
  }
ctx.putImageData(img, 0, 0);
ctx.fillStyle = '#101010';
ctx.font = '42px Arial';
ctx.fillText('ROOM 204', 90, 130);
ctx.fillText('BAKER ST', 700, 640);
const src = ctx.getImageData(0, 0, 1024, 768),
  candidates = candidatesFromOcr('synthetic', [
    { text: 'ROOM 204', recScore: 1, rect: { x: 85 / 1024, y: 90 / 768, w: 230 / 1024, h: 50 / 768 } },
    { text: 'BAKER ST', recScore: 1, rect: { x: 690 / 1024, y: 600 / 768, w: 260 / 1024, h: 50 / 768 } },
  ]),
  { mask } = textRemovalMask(src, candidates);
const session = await ort.InferenceSession.create('public/models/migan/migan_pipeline_v2.onnx', {
  intraOpNumThreads: 4,
  logSeverityLevel: 3,
});
let calls = 0,
  inferMs = 0;
try {
  const t = performance.now();
  const output = await inpaintTiled(src, mask, { x: 0, y: 0, w: 1024, h: 768 }, async (tile, m) => {
    calls++;
    const n = tile.width * tile.height,
      chw = new Uint8Array(n * 3),
      keep = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) chw[n * k + i] = tile.data[4 * i + k];
      keep[i] = m.data[i] ? 0 : 255;
    }
    const image = new ort.Tensor('uint8', chw, [1, 3, tile.height, tile.width]),
      mask = new ort.Tensor('uint8', keep, [1, 1, tile.height, tile.width]),
      start = performance.now();
    let result;
    try {
      result = await session.run({ image, mask });
      inferMs += performance.now() - start;
      const raw = result.result.data,
        data = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) data[4 * i + k] = raw[n * k + i];
        data[4 * i + 3] = 255;
      }
      return { width: tile.width, height: tile.height, data };
    } finally {
      image.dispose();
      mask.dispose();
      if (result) Object.values(result).forEach((t) => t.dispose());
    }
  });
  const outside = changedOutsideMask(src, output, mask);
  ctx.putImageData(new (await import('@napi-rs/canvas')).ImageData(output.data, 1024, 768), 0, 0);
  await writeFile(
    'C:/Users/DSU/Desktop/Ignite/scratch-eval/engine_clean_inpaint.png',
    c.toBuffer('image/png'),
  );
  console.log(
    JSON.stringify({
      synthetic: true,
      totalMs: Math.round(performance.now() - t),
      inferenceMs: Math.round(inferMs),
      tiles: calls,
      changedOutsideMask: outside,
      maskPixels: mask.data.reduce((a, b) => a + b, 0),
    }),
  );
  if (outside) process.exitCode = 1;
} finally {
  await session.release();
}
