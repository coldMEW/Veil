import { isAndroid } from './environment';
import { MODEL_CACHE, optionalModels } from './modelStore';

export interface ConsentRequest {
  id: string;
  resolve: () => void;
  reject: (error: Error) => void;
}
/** Web behavior is unchanged; Android requires a person to approve optional model downloads. */
export async function ensureOptionalModel(id: string): Promise<void> {
  if (!isAndroid()) return;
  const model = optionalModels.find((m) => m.id === id);
  if (!model) throw Error('This optional model has no pinned downloadable Android artifact yet.');
  const cache = await caches.open(MODEL_CACHE);
  const stored = await cache.match(model.path);
  if (stored) {
    const bytes = await stored.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    if (bytes.byteLength === model.bytes && hash === model.sha256) return;
    await cache.delete(model.path);
  }
  return new Promise((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<ConsentRequest>('veil-model-consent', {
        detail: { id, resolve, reject },
      }),
    );
  });
}
