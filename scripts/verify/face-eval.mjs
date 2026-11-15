import { build } from 'esbuild';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { emit } from './common.mjs';
const started = performance.now();
let det, rec;
try {
  const bundle = await build({
    entryPoints: ['src/engine/face/math.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'error',
  });
  const m = await import(
    'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
  );
  const man = JSON.parse(await readFile('src/engine/face/models.json', 'utf8'));
  const options = { intraOpNumThreads: 4, logSeverityLevel: 3 };
  det = await ort.InferenceSession.create('public' + man.yunet.servedAs, options);
  rec = await ort.InferenceSession.create('public' + man.sface.servedAs, options);
  async function infer(session, data, dims) {
    const input = new ort.Tensor('float32', data, dims);
    let output;
    try {
      output = await session.run({ [session.inputNames[0]]: input });
      return Object.fromEntries(Object.entries(output).map(([k, v]) => [k, new Float32Array(v.data)]));
    } finally {
      input.dispose();
      if (output) Object.values(output).forEach((t) => t.dispose());
    }
  }
  const dir = process.argv[2] ?? 'public/demo/source',
    names = [
      'selfie-1',
      'selfie-2',
      'selfie-3',
      ...(await readdir(dir)).filter((n) => /^fake-.*\.jpg$/i.test(n)).map((n) => n.slice(0, -4)),
      'other-person',
    ],
    emb = {},
    faceCounts = {};
  for (const name of names) {
    const { data, info } = await sharp(`${dir}/${name}.jpg`)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
      prep = m.detectorTensor(image),
      output = await infer(det, prep.data, [1, 3, 640, 640]);
    const faces = m
      .decodeYuNet(output, image.width, image.height, prep.scaleX, prep.scaleY)
      .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
    faceCounts[name] = faces.length;
    emb[name] = [];
    for (const face of faces) {
      const result = await infer(rec, m.alignedTensor(image, face), [1, 3, 112, 112]);
      emb[name].push(m.unitVector(result[rec.outputNames[0]]));
    }
  }
  const ref = emb['selfie-1'][0];
  if (!ref) throw Error('missing-reference-face');
  const comparisons = names.slice(1).map((name) => {
    const cosine = Math.max(-1, ...emb[name].map((e) => m.compareFaces(e, ref).cosine));
    return {
      name,
      cosine,
      same: cosine >= m.SAME_THRESHOLD,
      expectedSame: name !== 'other-person',
      faces: faceCounts[name],
    };
  });
  emit('face', {
    ok:
      comparisons.every((c) => c.faces > 0 && c.same === c.expectedSame) &&
      names.filter((n) => n.startsWith('fake-')).length > 0,
    threshold: m.SAME_THRESHOLD,
    comparisons,
    ms: Math.round(performance.now() - started),
  });
} catch (error) {
  emit('face', { ok: false, error: error.name, ms: Math.round(performance.now() - started) });
} finally {
  await det?.release();
  await rec?.release();
}
