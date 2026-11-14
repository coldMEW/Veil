export interface FaceBox {
  /** Normalized coordinates in the orientation-corrected image. Includes head margin. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FACE_BOX_HINT =
  'Draw a box around the whole head with margin, not just the facial features. The upstream crop expands a dlib face box by its width / 2.5 on each side, width / 1.5 above, and width / 2.5 below.';

export interface FaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WarpRunRequest {
  type: 'run';
  id: number;
  bitmap: ImageBitmap;
  face: FaceBox;
}

export type WarpRequest = WarpRunRequest | { type: 'preload'; id: number };

export interface WarpResult {
  /** Row-major predicted displacement magnitude, in pixels at the 400-short-side scale. */
  magnitude: Float32Array;
  /** Actual output tensor dimensions, which can differ from the input dimensions. */
  width: number;
  height: number;
  /** Source pixels: stretch the output grid over this rectangle using its own width/height. */
  faceRect: FaceRect;
  maxMagnitude: number;
  meanMagnitude: number;
  backend: 'webgpu' | 'wasm';
  threads: number;
  timings: {
    /** Session startup costs, retained for warm runs and excluded from their totalMs. */
    loadMs: number;
    warmupMs?: number;
    /** preprocessMs includes resizeMs (JS bicubic), decodeMs (crop/readback) and normalizeMs. */
    preprocessMs: number;
    resizeMs?: number;
    decodeMs?: number;
    normalizeMs?: number;
    inferenceMs: number;
    postprocessMs?: number;
    totalMs?: number;
  };
}

export type WarpResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; stage: 'loading' | 'running' }
  | ({ type: 'result'; id: number } & WarpResult)
  | { type: 'error'; id: number; message: string };

export interface WarpModelInfo {
  name: string;
  servedAs: string;
  sha256: string;
  bytes: number;
  upstream?: string;
  revision?: string;
  license?: string;
}

// The exporter owns models.json. A glob permits the engine to compile before
// that file arrives, without creating or overwriting the exporter's manifest.
const manifests = import.meta.glob<Record<string, WarpModelInfo>>('./models.json', { eager: true, import: 'default' });
const manifest = manifests['./models.json'];
export const MODEL_INFO: WarpModelInfo = manifest?.['fal-local-drn'] ??
  Object.values(manifest ?? {}).find((model) => model.servedAs === '/models/fal/fal-local-drn.onnx') ?? {
  name: 'FALdetector local detector (DRN)',
  servedAs: '/models/fal/fal-local-drn.onnx',
  sha256: '',
  bytes: 0,
};
