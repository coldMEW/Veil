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
  if (await cache.match(model.path)) return;
  return new Promise((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<ConsentRequest>('veil-model-consent', {
        detail: { id, resolve, reject },
      }),
    );
  });
}
