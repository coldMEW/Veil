import { build } from 'esbuild';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
await build({ entryPoints: ['src/engine/face/math.ts'], outfile: 'scripts/verify/.math.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const m = await import('./.math.mjs');
const man = JSON.parse(await readFile('src/engine/face/models.json'));
const det = await ort.InferenceSession.create('public' + man.yunet.servedAs, { logSeverityLevel: 3 });
const rec = await ort.InferenceSession.create('public' + man.sface.servedAs, { logSeverityLevel: 3 });
async function load(f) { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }; }
async function faces(img) {
  const p = m.detectorTensor(img);
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', p.data, [1, 3, 640, 640]) });
  return m.decodeYuNet(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.data])), img.width, img.height, p.scaleX, p.scaleY);
}
async function embed(img, f) { const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', m.alignedTensor(img, f), [1, 3, 112, 112]) }); return m.unitVector(out[rec.outputNames[0]].data); }
const dir = process.argv[2];
const names = ['selfie-1', 'selfie-2', 'selfie-3', 'fake-party', 'fake-crypto-ad', 'fake-arrest', 'fake-beach', 'other-person'];
const emb = {};
for (const n of names) {
  const img = await load(`${dir}/${n}.jpg`);
  const fs = await faces(img);
  const best = fs.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  emb[n] = await Promise.all(best.map((f) => embed(img, f)));
  console.log(n, 'faces', fs.length, fs.map((f) => f.score.toFixed(2) + '@' + Math.round(f.box.w * img.width) + 'px').join(' '));
}
const ref = emb['selfie-1'][0];
for (const n of names.slice(1)) {
  const best = Math.max(...emb[n].map((e) => m.compareFaces(e, ref).cosine), -1);
  console.log('vs selfie-1', n, best.toFixed(3), best >= m.SAME_THRESHOLD ? 'SAME' : best >= m.POSSIBLE_THRESHOLD ? 'possible' : 'different');
}
