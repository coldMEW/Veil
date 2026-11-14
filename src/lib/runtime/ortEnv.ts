// Shared ONNX Runtime Web setup. WASM files are served from this origin
// (Vite fingerprints them), so no CDN request and the CSP stays 'self'.
// The WebGPU bundle also carries the WASM execution provider, so one bundle
// covers both paths. In ORT-Web 1.31 that bundle loads the asyncify wasm/mjs pair
// (older releases such as 1.20 used the JSEP pair).

import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

let configured = false;

export function configureOrt(): typeof ort {
  if (!configured) {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
    // Threads need cross-origin isolation (COOP/COEP); fall back to one thread without it.
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, Math.max(1, cores - 1)) : 1;
    ort.env.logLevel = 'error';
    configured = true;
  }
  return ort;
}

/** True when this browser exposes WebGPU with a usable adapter. */
export async function hasWebGpu(): Promise<boolean> {
  const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

export type { ort };
