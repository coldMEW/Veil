import type { InferenceSession } from 'onnxruntime-web';
import type { CapabilityState } from '../../contracts';
import { maskBounds, type Mask, type Pixels } from './mask';
import { compositeCrop, workingCrop } from './redact';
import { getOrt } from './ortEnv';

/**
 * MI-GAN inpainting adapter (andraniksargsyan/migan rev 406830d, migan_pipeline_v2.onnx, MIT).
 * Measured I/O: image uint8 [1,3,H,W] RGB, mask uint8 [1,1,H,W] with 0 = HOLE, 255 = KEEP;
 * output `result` uint8 [1,3,H,W]. Our Mask uses 1 = remove, so polarity is inverted here.
 * Only masked pixels are composited back; everything else stays byte-identical.
 */
export const MIGAN_MODEL = {
  file: 'migan_pipeline_v2.onnx',
  revision: '406830d0fa60666da0071c342ad2fbc8f30c5c64',
  sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
  bytes: 28079181,
  license: 'MIT',
  upstreamUrl: 'https://huggingface.co/andraniksargsyan/migan',
};

/** Pure: extract a crop as CHW uint8 RGB plus the model mask (0 = hole) for that crop. */
export function toModelInputs(src: Pixels, mask: Mask, crop: { x: number; y: number; w: number; h: number }) {
  const n = crop.w * crop.h;
  const image = new Uint8Array(3 * n);
  const m = new Uint8Array(n);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const gi = (crop.y + y) * src.width + (crop.x + x);
      const li = y * crop.w + x;
      image[li] = src.data[gi * 4]!;
      image[n + li] = src.data[gi * 4 + 1]!;
      image[2 * n + li] = src.data[gi * 4 + 2]!;
      m[li] = mask.data[gi] ? 0 : 255;
    }
  }
  return { image, mask: m };
}

export function extractCrop(src: Pixels, crop: { x: number; y: number; w: number; h: number }): Pixels {
  const data = new Uint8ClampedArray(crop.w * crop.h * 4);
  for (let y = 0; y < crop.h; y++)
    data.set(src.data.subarray(((crop.y + y) * src.width + crop.x) * 4, ((crop.y + y) * src.width + crop.x + crop.w) * 4), y * crop.w * 4);
  return { width: crop.w, height: crop.h, data };
}

/** Pure: CHW uint8 RGB -> RGBA Pixels. */
export function fromModelOutput(chw: Uint8Array, w: number, h: number): Pixels {
  const n = w * h;
  if (chw.length !== 3 * n) throw new Error(`MI-GAN output length ${chw.length}, expected ${3 * n}`);
  const data = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) {
    data[i * 4] = chw[i]!;
    data[i * 4 + 1] = chw[n + i]!;
    data[i * 4 + 2] = chw[2 * n + i]!;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Pure bilinear resize of RGBA pixels. */
export function resizeBilinear(src: Pixels, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c]!;
        const b = src.data[(y0 * src.width + x1) * 4 + c]!;
        const d = src.data[(y1 * src.width + x0) * 4 + c]!;
        const e = src.data[(y1 * src.width + x1) * 4 + c]!;
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Nearest-neighbour resize of a binary mask crop; any covered source pixel keeps the hole (conservative). */
export function resizeMaskCrop(mask: Mask, crop: { x: number; y: number; w: number; h: number }, w: number, h: number): Mask {
  const data = new Uint8Array(w * h);
  const sx = crop.w / w;
  const sy = crop.h / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ys = Math.floor(y * sy);
      const ye = Math.max(ys + 1, Math.floor((y + 1) * sy));
      const xs = Math.floor(x * sx);
      const xe = Math.max(xs + 1, Math.floor((x + 1) * sx));
      let hit = 0;
      for (let yy = ys; yy < ye && !hit; yy++)
        for (let xx = xs; xx < xe; xx++)
          if (mask.data[(crop.y + Math.min(yy, crop.h - 1)) * mask.width + crop.x + Math.min(xx, crop.w - 1)]) {
            hit = 1;
            break;
          }
      data[y * w + x] = hit;
    }
  return { width: w, height: h, data };
}

/** MI-GAN's training resolution; crops are resized to this before inference. */
export const MIGAN_NATIVE = 512;

export interface InpaintResult {
  pixels: Pixels;
  crop: { x: number; y: number; w: number; h: number };
  ms: number;
  backend: string;
}

export class MiganInpainter {
  state: CapabilityState = 'not_loaded';
  error?: string;
  private session?: InferenceSession;
  private backend = 'wasm';

  /** Load from a URL served by the app (models are cached by version, never user images). */
  async load(modelUrl: string, backend: 'wasm' | 'webgpu' = 'wasm') {
    this.state = 'loading';
    try {
      const ort = await getOrt(backend);
      this.session = await ort.InferenceSession.create(modelUrl, { executionProviders: [backend] });
      this.backend = backend;
      this.state = 'ready';
    } catch (e) {
      this.state = 'failed';
      this.error = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  /** Inpaint the masked region. Returns a new full-size buffer; `src` is not mutated. */
  async inpaint(src: Pixels, mask: Mask, opts: { pad?: number; minSize?: number } = {}): Promise<InpaintResult> {
    if (!this.session || this.state !== 'ready') throw new Error('MI-GAN not loaded');
    const bounds = maskBounds(mask);
    if (!bounds) return { pixels: { ...src, data: new Uint8ClampedArray(src.data) }, crop: { x: 0, y: 0, w: 0, h: 0 }, ms: 0, backend: this.backend };
    // Context pad proportional to the hole so large holes still see surroundings.
    const pad = opts.pad ?? Math.max(64, Math.round(0.5 * Math.max(bounds.w, bounds.h)));
    const crop = workingCrop(bounds, src.width, src.height, pad, opts.minSize ?? MIGAN_NATIVE);
    // Run at native resolution: resize the crop (longest side -> 512), inpaint, resize back.
    const scale = MIGAN_NATIVE / Math.max(crop.w, crop.h);
    const mw = Math.max(8, Math.round(crop.w * scale));
    const mh = Math.max(8, Math.round(crop.h * scale));
    const cropPx = resizeBilinear(extractCrop(src, crop), mw, mh);
    const cropMask = resizeMaskCrop(mask, crop, mw, mh);
    const { image, mask: m } = toModelInputs(cropPx, cropMask, { x: 0, y: 0, w: mw, h: mh });
    const ort = await getOrt(this.backend as 'wasm' | 'webgpu');
    const t0 = performance.now();
    const out = await this.session.run({
      image: new ort.Tensor('uint8', image, [1, 3, mh, mw]),
      mask: new ort.Tensor('uint8', m, [1, 1, mh, mw]),
    });
    const ms = performance.now() - t0;
    const result = (out.result ?? Object.values(out)[0])!;
    const inpaintedSmall = fromModelOutput(result.data as Uint8Array, mw, mh);
    const inpainted = mw === crop.w && mh === crop.h ? inpaintedSmall : resizeBilinear(inpaintedSmall, crop.w, crop.h);
    return { pixels: compositeCrop(src, inpainted, crop, mask), crop, ms, backend: this.backend };
  }

  async dispose() {
    await this.session?.release();
    this.session = undefined;
    this.state = 'not_loaded';
  }
}
