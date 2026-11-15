export interface FocusRequest {
  id: number;
  bitmap: ImageBitmap;
  /** Phones and coarse pointers get the smaller grid regardless of backend. */
  coarse: boolean;
  /** Force a grid size (tests). Otherwise chosen from the measured backend speed. */
  grid?: number;
  /** Score the whole views only and skip the occlusion heatmap (used for video frames). */
  viewsOnly?: boolean;
}

export interface FocusResult {
  logit: number;
  /** base minus occluded logit, row-major. Positive supports AI-generated; negative is uncoloured. */
  deltas: Float32Array;
  grid: number;
  /** The model's 384 crop in original image pixels. */
  crop: { x: number; y: number; width: number; height: number };
  /**
   * The detector's raw output on each whole 384 window (centre crop first, then the ends of the long
   * edge). No occlusion: these say what the model output; the heatmap says where it came from.
   * Results without it are treated as the centre crop only.
   */
  views?: Array<{ label: 'start' | 'center' | 'end'; logit: number; crop: { x: number; y: number; width: number; height: number } }>;
  backend: 'wasm' | 'webgpu';
  threads: number;
  timings: { loadMs: number; baseMs: number; occlusionMs: number; preprocessMs?: number; totalMs?: number };
}

export type FocusResponse =
  | { type: 'progress'; id: number; stage: 'loading' | 'running'; done: number; total: number }
  | ({ type: 'result'; id: number } & FocusResult)
  | { type: 'error'; id: number; message: string };
