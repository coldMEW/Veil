import type { Face } from './math';
export { compareFaces, SAME_THRESHOLD, POSSIBLE_THRESHOLD, DETECTION_THRESHOLD } from './math';
export type { Face, Point } from './math';
let worker: Worker | undefined,
  id = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
function stop(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}
/** Terminate inference and release its model sessions. No face data is persisted. */
export function disposeFaceEngine() {
  stop(new Error('Face engine cancelled.'));
}
async function request(
  kind: 'detect' | 'embed',
  image: ImageBitmap | ImageData,
  face?: Face,
): Promise<unknown> {
  if (!worker) {
    worker = new Worker(new URL('./face.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      event.data.error ? p.reject(Error(event.data.error)) : p.resolve(event.data.value);
    };
    worker.onerror = () => stop(Error('Face worker failed.'));
  }
  const copy =
    'data' in image
      ? new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
      : await createImageBitmap(image);
  const n = ++id;
  return new Promise((resolve, reject) => {
    pending.set(n, { resolve, reject });
    try {
      worker!.postMessage({ id: n, kind, image: copy, face }, 'data' in copy ? [] : [copy]);
    } catch (error) {
      pending.delete(n);
      reject(error instanceof Error ? error : Error('Face transfer failed.'));
    }
  });
}
/** Detect faces on-device; boxes and five landmarks use normalized oriented-image coordinates. */
export async function detectFaces(image: ImageBitmap | ImageData): Promise<Face[]> {
  return (await request('detect', image)) as Face[];
}
/** Align using five landmarks and return a 128-dimensional L2-unit identity embedding. */
export async function embedFace(image: ImageBitmap | ImageData, face: Face): Promise<Float32Array> {
  return (await request('embed', image, face)) as Float32Array;
}
