/**
 * Temporary ORT-Web asset wiring for Clean/Protect. Belongs in src/lib/runtime/ (Sandeep) once the
 * shared runtime helper exists; keep a single copy then.
 * Vite fingerprints the wasm and serves it from the app origin (no CDN, no cross-origin fetch).
 * Each bundle needs ITS OWN wasm: the default bundle loads ort-wasm-simd-threaded.wasm, the WebGPU
 * bundle loads ort-wasm-simd-threaded.jsep.wasm (mixing them gives a LinkError).
 */
// ORT-Web 1.31: the CPU bundle loads the plain mjs/wasm pair; the WebGPU bundle loads the asyncify pair.
// Both halves of each pair must be given, or the worker waits forever for the default-located .mjs.
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import gpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import gpuMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

type Ort = typeof import('onnxruntime-web');
const cache: Partial<Record<'wasm' | 'webgpu', Promise<Ort>>> = {};

const threads = () => (globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1);

/** `wasm`: CPU-only bundle. `webgpu`: bundle with the WebGPU EP (also runs wasm EP as fallback). */
export function getOrt(variant: 'wasm' | 'webgpu' = 'wasm'): Promise<Ort> {
  cache[variant] ??= (
    variant === 'webgpu' ? (import('onnxruntime-web/webgpu') as Promise<Ort>) : import('onnxruntime-web')
  ).then((ort) => {
    ort.env.wasm.wasmPaths = variant === 'webgpu' ? { wasm: gpuWasmUrl, mjs: gpuMjsUrl } : { wasm: wasmUrl, mjs: mjsUrl };
    ort.env.wasm.numThreads = threads();
    return ort;
  });
  return cache[variant]!;
}
