/**
 * Temporary ORT-Web asset wiring for Clean/Protect. Belongs in src/lib/runtime/ (Sandeep) once the
 * shared runtime helper exists; keep a single copy then.
 * Vite fingerprints the wasm and serves it from the app origin (no CDN, no cross-origin fetch).
 * Each bundle needs ITS OWN wasm: the default bundle loads ort-wasm-simd-threaded.wasm, the WebGPU
 * bundle loads ort-wasm-simd-threaded.jsep.wasm (mixing them gives a LinkError).
 */
import wasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import jsepWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

type Ort = typeof import('onnxruntime-web');
const cache: Partial<Record<'wasm' | 'webgpu', Promise<Ort>>> = {};

const threads = () => (globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1);

/** `wasm`: CPU-only bundle. `webgpu`: bundle with the WebGPU EP (also runs wasm EP as fallback). */
export function getOrt(variant: 'wasm' | 'webgpu' = 'wasm'): Promise<Ort> {
  cache[variant] ??= (
    variant === 'webgpu' ? (import('onnxruntime-web/webgpu') as Promise<Ort>) : import('onnxruntime-web')
  ).then((ort) => {
    ort.env.wasm.wasmPaths = { wasm: variant === 'webgpu' ? jsepWasmUrl : wasmUrl };
    ort.env.wasm.numThreads = threads();
    return ort;
  });
  return cache[variant]!;
}
