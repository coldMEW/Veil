/// <reference lib="webworker" />
import { configureOrt, hasWebGpu } from '../../lib/runtime/ortEnv';
import models from './models.json';
import { alignedTensor, detectorTensor, decodeYuNet, unitVector, type Face, type Pixels } from './math';
const ort = configureOrt();
const sessions = new Map<string, Promise<Awaited<ReturnType<typeof ort.InferenceSession.create>>>>();
async function session(id: 'yunet' | 'sface') {
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
let queue = Promise.resolve();
self.onmessage = (
  event: MessageEvent<{ id: number; kind: 'detect' | 'embed'; image: ImageBitmap | ImageData; face?: Face }>,
) => {
  queue = queue.then(async () => {
    const { id, kind, image, face } = event.data;
    try {
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
