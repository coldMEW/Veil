import { OcrEngine } from '../../src/features/clean/ocr/engine';
const out = document.getElementById('out')!;
const canvas = document.getElementById('fixture') as HTMLCanvasElement;
const planted = [
  { text: '221B BAKER ST', size: 14, x: 1400, y: 1000, angle: 0 },
  { text: 'SMALL TEXT TEN', size: 10, x: 300, y: 400, angle: 0 },
  { text: 'TWENTY PIXEL TEXT', size: 20, x: 1800, y: 1500, angle: 0 },
  { text: 'ROTATED FIFTEEN', size: 20, x: 400, y: 1600, angle: 15 },
  { text: 'ROTATED TWENTY FIVE', size: 20, x: 1700, y: 500, angle: 25 },
];
function publish(result: unknown) {
  (window as unknown as { __G6: unknown }).__G6 = result;
  out.textContent = JSON.stringify(result, null, 2);
}
const engine = new OcrEngine();
async function run() {
  canvas.width = 3000; canvas.height = 2000;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = 'black';
  for (const p of planted) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle * Math.PI / 180);
    ctx.font = `${p.size}px Arial`; ctx.fillText(p.text, 0, 0); ctx.restore();
  }
  const start = performance.now();
  await engine.load('/models/ocr/', { detVariant: 'v3' });
  const loadMs = performance.now() - start;
  const scanStart = performance.now();
  const boxes = await engine.scan(ctx.getImageData(0, 0, canvas.width, canvas.height), {
    timeoutMs: 600_000,
    onProgress: p => { out.textContent = `${p.stage} ${p.completed}/${p.total}`; },
  });
  publish({ detVariant: 'v3', backend: 'wasm', threads: globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1, loadMs: Math.round(loadMs),
    ms: Math.round(performance.now() - scanStart), totalMs: Math.round(performance.now() - start),
    found: Object.fromEntries(planted.map(p => [p.text, boxes.some(b => b.text === p.text)])),
    boxCount: boxes.length, userAgent: navigator.userAgent });
}
run().catch(error => publish({ error: String(error), backend: 'wasm', userAgent: navigator.userAgent })).finally(() => engine.dispose());
