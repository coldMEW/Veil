/**
 * Dev-only harness for Gate G3a "browser forward works": runs the exported DiffVax immunizer
 * in ORT-Web on the synthetic test image and compares with the PyTorch reference output.
 */
import { getOrt } from '../../src/features/clean/ortEnv';
import { decodeToPixels } from '../../src/features/clean/export';

const out = document.getElementById('out')!;
const base = '/models/diffvax/';

async function run() {
  const backend = (new URLSearchParams(location.search).get('backend') as 'wasm' | 'webgpu') ?? 'wasm';
  const ort = await getOrt(backend);
  const png = new Uint8Array(await (await fetch(base + 'test_input.png')).arrayBuffer());
  const px = await decodeToPixels(png);
  if (px.width !== 512 || px.height !== 512) throw new Error(`expected 512x512, got ${px.width}x${px.height}`);
  const n = 512 * 512;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) x[c * n + i] = px.data[i * 4 + c] / 127.5 - 1;

  const t0 = performance.now();
  const session = await ort.InferenceSession.create(base + 'diffvax_immunizer.onnx', { executionProviders: [backend] });
  const loadMs = performance.now() - t0;
  const feeds = { image: new ort.Tensor('float32', x, [1, 3, 512, 512]) };
  await session.run(feeds); // warmup
  const t1 = performance.now();
  const res = await session.run(feeds);
  const inferMs = performance.now() - t1;
  const y = res.output.data as Float32Array;

  const ref = new Float32Array(await (await fetch(base + 'torch_ref.f32')).arrayBuffer());
  let maxAbs = 0,
    sumAbs = 0;
  for (let i = 0; i < ref.length; i++) {
    const d = Math.abs(y[i] - ref[i]);
    if (d > maxAbs) maxAbs = d;
    sumAbs += d;
  }
  const result = {
    backend,
    crossOriginIsolated,
    loadMs: Math.round(loadMs),
    inferMs: Math.round(inferMs),
    outputLength: y.length,
    maxAbsVsTorch: maxAbs,
    meanAbsVsTorch: sumAbs / ref.length,
    parityPass: maxAbs <= 1e-4 && sumAbs / ref.length <= 1e-5,
    userAgent: navigator.userAgent,
  };
  (window as unknown as { __G3A: unknown }).__G3A = result;
  out.textContent = JSON.stringify(result, null, 2);
}

run().catch((e) => {
  (window as unknown as { __G3A: unknown }).__G3A = { error: String(e) };
  out.textContent = 'ERROR ' + String(e);
});
