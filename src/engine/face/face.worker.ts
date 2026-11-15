/// <reference lib="webworker" />
import { configureOrt, hasWebGpu } from '../../lib/runtime/ortEnv';
import models from './models.json';
import { alignedTensor, detectorTensor, decodeYuNet, unitVector, type Face, type Pixels } from './math';
const ort = configureOrt();
const sessions = new Map<string, Promise<Awaited<ReturnType<typeof ort.InferenceSession.create>>>>();
async function session(id: 'yunet' | 'sface' | 'facefake') {
  if (!sessions.has(id))
    sessions.set(
      id,
      (async () => {
        const model = models[id],
          res = await fetch(model.servedAs);
        if (!res.ok) throw Error(`Face model HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
          x.toString(16).padStart(2, '0'),
        ).join('');
        if (hash !== model.sha256 || bytes.length !== model.bytes)
          throw Error('Face model integrity mismatch.');
        if (await hasWebGpu())
          try {
            return await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
          } catch {
            /* WASM fallback */
          }
        return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      })().catch((error) => {
        sessions.delete(id);
        throw error;
      }),
    );
  return sessions.get(id)!;
}
async function pixels(image: ImageBitmap | ImageData): Promise<Pixels> {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > 40_000_000
  )
    throw Error('Invalid face image dimensions.');
  if ('data' in image) return image;
  try {
    const canvas = new OffscreenCanvas(image.width, image.height),
      ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas unavailable.');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
  } finally {
    image.close();
  }
}
/** The face box widened by 30% each side, resized to 224x224 (bilinear), scaled to [-1, 1], channel-first. */
function fakeTensor(p: Pixels, face: Face): Float32Array {
  const pad = 0.3, w = face.box.w * p.width, h = face.box.h * p.height;
  const x0 = Math.max(0, face.box.x * p.width - w * pad), y0 = Math.max(0, face.box.y * p.height - h * pad);
  const x1 = Math.min(p.width, x0 + w * (1 + 2 * pad)), y1 = Math.min(p.height, y0 + h * (1 + 2 * pad));
  const N = 224, out = new Float32Array(3 * N * N), sx = (x1 - x0) / N, sy = (y1 - y0) / N;
  for (let y = 0; y < N; y++) {
    const fy = Math.min(p.height - 1, y0 + (y + 0.5) * sy - 0.5), ya = Math.max(0, Math.floor(fy)), yb = Math.min(p.height - 1, ya + 1), ty = fy - ya;
    for (let x = 0; x < N; x++) {
      const fx = Math.min(p.width - 1, x0 + (x + 0.5) * sx - 0.5), xa = Math.max(0, Math.floor(fx)), xb = Math.min(p.width - 1, xa + 1), tx = fx - xa;
      for (let c = 0; c < 3; c++) {
        const a = p.data[(ya * p.width + xa) * 4 + c]!, b = p.data[(ya * p.width + xb) * 4 + c]!;
        const d = p.data[(yb * p.width + xa) * 4 + c]!, e = p.data[(yb * p.width + xb) * 4 + c]!;
        const v = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
        out[c * N * N + y * N + x] = (v / 255 - 0.5) / 0.5;
      }
    }
  }
  return out;
}
let queue = Promise.resolve();
self.onmessage = (
  event: MessageEvent<{ id: number; kind: 'detect' | 'embed' | 'fake'; image: ImageBitmap | ImageData; face?: Face }>,
) => {
  queue = queue.then(async () => {
    const { id, kind, image, face } = event.data;
    try {
      if (kind === 'fake') {
        if (!face) throw Error('A face box is required.');
        const px = await pixels(image);
        const fs = await session('facefake');
        const input = new ort.Tensor('float32', fakeTensor(px, face), [1, 3, 224, 224]);
        let out: Awaited<ReturnType<typeof fs.run>> | undefined;
        try {
          out = await fs.run({ [fs.inputNames[0]!]: input });
          const l = out[fs.outputNames[0]!]!.data as Float32Array;
          // Index 0 is the manipulated class in this export (measured on labelled samples).
          const m = Math.max(l[0]!, l[1]!), e0 = Math.exp(l[0]! - m), e1 = Math.exp(l[1]! - m);
          self.postMessage({ id, value: e0 / (e0 + e1) });
        } finally {
          input.dispose();
          if (out) Object.values(out).forEach((v) => v.dispose());
        }
        return;
      }
      const p = await pixels(image),
        s = await session(kind === 'detect' ? 'yunet' : 'sface');
      const prepared = kind === 'detect' ? detectorTensor(p) : null;
      if (kind === 'embed' && !face) throw Error('A face with five landmarks is required.');
      const data = prepared?.data ?? alignedTensor(p, face!),
        n = kind === 'detect' ? 640 : 112;
      const input = new ort.Tensor('float32', data, [1, 3, n, n]);
      let outputs: Awaited<ReturnType<typeof s.run>> | undefined;
      try {
        outputs = await s.run({ [s.inputNames[0]!]: input });
        if (kind === 'embed') {
          const vector = unitVector(outputs[s.outputNames[0]!]!.data as Float32Array);
          self.postMessage({ id, value: vector }, [vector.buffer]);
        } else {
          const values = Object.fromEntries(
            Object.entries(outputs).map(([k, v]) => [k, v.data as Float32Array]),
          );
          self.postMessage({
            id,
            value: decodeYuNet(values, p.width, p.height, prepared!.scaleX, prepared!.scaleY),
          });
        }
      } finally {
        input.dispose();
        if (outputs) Object.values(outputs).forEach((v) => v.dispose());
      }
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : 'Face engine failed.' });
    }
  });
};
