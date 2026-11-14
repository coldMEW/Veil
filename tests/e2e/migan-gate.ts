/**
 * Dev-only browser harness for Gate G4. Uses a synthetic image (no private photos).
 * Result is written to #out as JSON and to window.__G4 for automation.
 */
import { MiganInpainter } from '../../src/features/clean/inpaint';
import { encodePng, verifyExport } from '../../src/features/clean/export';
import { rectsToMask, type Pixels } from '../../src/features/clean/mask';
import { changedOutsideMask } from '../../src/features/clean/redact';

const out = document.getElementById('out')!;

function synthetic(w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inSquare = x >= 350 && x < 450 && y >= 250 && y < 330;
      data[i] = inSquare ? 255 : Math.floor((x * 255) / w);
      data[i + 1] = inSquare ? 0 : Math.floor((y * 255) / h);
      data[i + 2] = inSquare ? 0 : 128;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

function draw(id: string, p: Pixels) {
  const c = document.getElementById(id) as HTMLCanvasElement;
  c.width = p.width;
  c.height = p.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
}

async function run() {
  const W = 800,
    H = 600;
  const src = synthetic(W, H);
  const mask = rectsToMask([{ x: 340 / W, y: 240 / H, w: 120 / W, h: 100 / H }], W, H);
  const backend = (new URLSearchParams(location.search).get('backend') as 'wasm' | 'webgpu') ?? 'wasm';
  const inp = new MiganInpainter();
  const tLoad = performance.now();
  await inp.load('/models/migan/migan_pipeline_v2.onnx', backend);
  const loadMs = performance.now() - tLoad;
  const r = await inp.inpaint(src, mask);
  let redLeft = 0;
  for (let i = 0; i < mask.data.length; i++)
    if (mask.data[i] && r.pixels.data[i * 4] > 200 && r.pixels.data[i * 4 + 1] < 60) redLeft++;
  const bytes = await encodePng(r.pixels);
  const v = await verifyExport(r.pixels, bytes);
  draw('before', src);
  draw('after', v.decoded);
  const result = {
    backend: r.backend,
    loadMs: Math.round(loadMs),
    inferMs: Math.round(r.ms),
    crop: r.crop,
    redPixelsLeftInHole: redLeft,
    changedOutsideMask: changedOutsideMask(src, v.decoded, mask),
    exportSha256: v.sha256,
    exportBytes: v.byteLength,
    exportMetadataBlocks: v.metadata.metadataBlocks,
    exportBlocks: [...new Set(v.metadata.blocks)],
    roundTripMismatches: v.roundTripMismatches,
    userAgent: navigator.userAgent,
  };
  (window as unknown as { __G4: unknown }).__G4 = result;
  out.textContent = JSON.stringify(result, null, 2);
}

run().catch((e) => {
  (window as unknown as { __G4: unknown }).__G4 = { error: String(e) };
  out.textContent = 'ERROR ' + String(e);
});
