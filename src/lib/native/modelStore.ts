import focusModels from '../../features/inspect/model/models.json';
import artifactManifest from '../../../scripts/export/models.json';

export const MODEL_CACHE = 'veil-optional-models-v1';
const focus = focusModels['communityforensics-vit-s-fp32'];
const diffvax = artifactManifest.artifacts.find((m) => m.id === 'diffvax-immunizer')!;
export const optionalModels = [
  {
    id: 'focus',
    title: 'Model focus',
    bytes: focus.bytes,
    sha256: focus.sha256,
    path: focus.servedAs,
    url: `${focus.upstream}/resolve/${focus.revision}/${focus.path}`,
  },
  {
    id: 'diffvax',
    title: 'Experimental protection',
    bytes: diffvax.bytes,
    sha256: diffvax.sha256,
    path: `/models/${diffvax.dir}/${diffvax.file}`,
    url: diffvax.url,
  },
] as const;
export type OptionalModel = (typeof optionalModels)[number];

/** Model-only GET, pinned byte length/hash, cache commit only after complete verification. */
export async function downloadModel(
  model: OptionalModel,
  signal: AbortSignal,
  progress: (loaded: number) => void,
): Promise<void> {
  const url = new URL(model.url);
  if (url.origin !== 'https://huggingface.co' || !url.pathname.includes('/resolve/')) {
    throw Error('Model URL is not an allowed pinned source.');
  }
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw Error(`Model download failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const output = new Uint8Array(model.bytes);
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (count + value.length > output.length) throw Error('Model exceeds its pinned size.');
      output.set(value, count);
      count += value.length;
      progress(count);
    }
    if (count !== model.bytes) throw Error('Model byte count differs from the pinned size.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', output)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== model.sha256) throw Error('Model checksum does not match.');
    signal.throwIfAborted();
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(
      model.path,
      new Response(output, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Workers read the same verified cache; the website keeps its existing same-origin fetch. */
export async function modelResponse(path: string): Promise<Response> {
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(path);
    if (hit) return hit;
  }
  return fetch(path);
}
