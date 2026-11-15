// Real-photo face matrix. Usage: node scripts/verify/real-faces.mjs <folder of private photos>
// Prints only file names and similarity numbers; photos stay local.
import { build } from 'esbuild';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readdirSync, readFileSync } from 'node:fs';
await build({ entryPoints: ['src/engine/face/math.ts'], outfile: 'scripts/verify/.math.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const m = await import('./.math.mjs');
const man = JSON.parse(readFileSync('src/engine/face/models.json'));
const det = await ort.InferenceSession.create('public' + man.yunet.servedAs, { logSeverityLevel: 3 });
const rec = await ort.InferenceSession.create('public' + man.sface.servedAs, { logSeverityLevel: 3 });
const dir = process.argv[2];
const faces = [];
for (const f of readdirSync(dir).filter((x) => /\.jpe?g$/i.test(x))) {
  const { data, info } = await sharp(`${dir}/${f}`).rotate().resize({ width: 2000, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  const p = m.detectorTensor(img);
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', p.data, [1, 3, 640, 640]) });
  const found = m.decodeYuNet(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.data])), img.width, img.height, p.scaleX, p.scaleY).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  if (!found.length) { console.log(f.padEnd(44), 'no face found'); continue; }
  const o = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', m.alignedTensor(img, found[0]), [1, 3, 112, 112]) });
  faces.push({ f, e: m.unitVector(o[rec.outputNames[0]].data), px: Math.round(found[0].box.w * img.width) });
}
const short = (s) => s.replace(/\.jpe?g$/i, '').slice(0, 14).padEnd(14);
console.log(''.padEnd(34), faces.map((x, i) => String(i).padStart(5)).join(''));
faces.forEach((a, i) => console.log(`${String(i).padStart(2)} ${a.f.replace(/\.jpe?g$/i, '').slice(0, 26).padEnd(26)} ${String(a.px).padStart(4)}px`, faces.map((b) => m.compareFaces(a.e, b.e).cosine.toFixed(2).padStart(5)).join('')));
console.log('same person at', m.SAME_THRESHOLD, 'and above');
