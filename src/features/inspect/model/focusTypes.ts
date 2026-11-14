export interface FocusRequest {
  id: number;
  bitmap: ImageBitmap;
  /** Phones and coarse pointers get the smaller grid regardless of backend. */
  coarse: boolean;
  /** Force a grid size (tests). Otherwise chosen from the measured backend speed. */
  grid?: number;
}

export interface FocusResult {
  logit: number;
  /** base logit minus occluded logit, one per grid cell, row-major. */
  deltas: Float32Array;
  grid: number;
  /** The model's 384 crop in original image pixels. */
  crop: { x: number; y: number; width: number; height: number };
  backend: 'wasm' | 'webgpu';
  threads: number;
  timings: { loadMs: number; baseMs: number; occlusionMs: number };
}

export type FocusResponse =
  | { type: 'progress'; id: number; stage: 'loading' | 'running'; done: number; total: number }
  | ({ type: 'result'; id: number } & FocusResult)
  | { type: 'error'; id: number; message: string };
