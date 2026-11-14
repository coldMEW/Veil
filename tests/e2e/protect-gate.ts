/** G3a browser-only harness: synthetic pixels, real pinned model, no user image persistence. */
import { decodeToPixels } from '../../src/features/clean/export';
import type { Pixels } from '../../src/features/clean/mask';
import { DiffVaxImmunizer } from '../../src/features/protect/diffvax';
import { psnr, ssim } from '../../src/features/protect/jitter';

const out = document.querySelector('#out')!;
const base = '/models/diffvax/';
const synthetic = (): Pixels => {
  const width = 1024, height = 768, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; data[i] = x % 256; data[i + 1] = y % 256; data[i + 2] = (x + y) % 256; data[i + 3] = 255;
  }
  return { width, height, data };
};

async function parity(backend: 'webgpu' | 'wasm') {
  const inputResponse = await fetch(base + 'test_input.png');
  const referenceResponse = await fetch(base + 'torch_ref.f32');
  if (!inputResponse.ok || !referenceResponse.ok || !inputResponse.headers.get('content-type')?.startsWith('image/')) return { status: 'unavailable', reason: 'Pinned test_input.png and torch_ref.f32 are not present locally.' };
  const input = await decodeToPixels(new Uint8Array(await inputResponse.arrayBuffer()));
  const model = new DiffVaxImmunizer(); await model.load(base + 'diffvax_immunizer.onnx', backend);
  const actual = await model.immunize(input);
  const ref = new Float32Array(await referenceResponse.arrayBuffer());
  // The saved reference is a perturbation tensor. This check exposes its presence/shape; numerical tensor parity remains in diffvax-gate.ts.
  return { status: 'available', input: `${input.width}x${input.height}`, output: `${actual.pixels.width}x${actual.pixels.height}`, referenceFloats: ref.length };
}

async function run() {
  const backend = (new URLSearchParams(location.search).get('backend') as 'webgpu' | 'wasm') ?? 'wasm';
  const image = synthetic(); const model = new DiffVaxImmunizer();
  const start = performance.now(); await model.load(base + 'diffvax_immunizer.onnx', backend); const loadMs = performance.now() - start;
  const before = performance.now(); const result = await model.immunize(image); const inferMs = performance.now() - before;
  const report = { backend, loadMs: Math.round(loadMs), inferMs: Math.round(inferMs), psnr: psnr(image, result.pixels), ssim: ssim(image, result.pixels), parity: await parity(backend), userAgent: navigator.userAgent };
  (window as unknown as { __PROTECT_GATE: unknown }).__PROTECT_GATE = report; out.textContent = JSON.stringify(report, null, 2);
}
run().catch((error) => { (window as unknown as { __PROTECT_GATE: unknown }).__PROTECT_GATE = { error: String(error) }; out.textContent = `ERROR ${String(error)}`; });
