import type { CapabilityState } from '../../contracts';
import type { Mask, Pixels } from '../clean/mask';
import { getOrt } from '../clean/ortEnv';

export const DIFFVAX_SHA256 = '44aa61ea8d6fbdc485bc897376cff41027e9885d5f68c3dd2e4bae8092cf3cd4';
export const DIFFVAX_REVISION = '7f45aabc2d6b9cf71452fdb49bf1acbe9957fb8e';
export const DIFFVAX_SIZE = 512;

type Backend = 'webgpu' | 'wasm';
type TensorLike = { data: Float32Array; dims: readonly number[] };
export interface DiffVaxSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(inputs: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
}

export interface DiffVaxLoadOptions {
  /** Test-only injection point; production always creates an ORT-Web session. */
  createSession?: (bytes: Uint8Array, backend: Backend) => Promise<DiffVaxSession>;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  /** Test-only override. Production always uses the pinned artifact checksum. */
  expectedSha256?: string;
}

export interface ImmunizeResult {
  pixels: Pixels;
  /** True when no user edit mask was supplied and the full image received the perturbation. */
  wholeImage: boolean;
  networkCrop: { x: number; y: number; width: number; height: number };
}

function assertPixels(px: Pixels) {
  if (!Number.isInteger(px.width) || !Number.isInteger(px.height) || px.width < 1 || px.height < 1 || px.data.length !== px.width * px.height * 4)
    throw new Error('invalid RGBA pixel buffer');
}

function assertMask(mask: Mask, px: Pixels) {
  if (mask.width !== px.width || mask.height !== px.height || mask.data.length !== px.width * px.height) throw new Error('mask dimensions must match pixels');
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }

/** Bilinear sample of interleaved RGBA, returning one RGB channel in 0..255. */
function sampleRgb(px: Pixels, x: number, y: number, channel: number) {
  const x0 = Math.max(0, Math.min(px.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(px.height - 1, Math.floor(y)));
  const x1 = Math.min(px.width - 1, x0 + 1);
  const y1 = Math.min(px.height - 1, y0 + 1);
  const tx = clamp01(x - x0); const ty = clamp01(y - y0);
  const at = (xx: number, yy: number) => px.data[(yy * px.width + xx) * 4 + channel]!;
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

function sampleMask(mask: Mask, x: number, y: number) {
  const x0 = Math.max(0, Math.min(mask.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(mask.height - 1, Math.floor(y)));
  const x1 = Math.min(mask.width - 1, x0 + 1);
  const y1 = Math.min(mask.height - 1, y0 + 1);
  const tx = clamp01(x - x0); const ty = clamp01(y - y0);
  const at = (xx: number, yy: number) => mask.data[yy * mask.width + xx]!;
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

/**
 * Resize the whole photo to the network's 512 × 512 input. The output is mapped back with the same
 * full-frame mapping in `immunize`, so every pixel receives the perturbation computed for it.
 */
export function inputTensor(px: Pixels): { tensor: Float32Array; crop: { x: number; y: number; width: number; height: number } } {
  assertPixels(px);
  const crop = { x: 0, y: 0, width: px.width, height: px.height };
  const tensor = new Float32Array(3 * DIFFVAX_SIZE * DIFFVAX_SIZE);
  for (let y = 0; y < DIFFVAX_SIZE; y++) for (let x = 0; x < DIFFVAX_SIZE; x++) {
    const sx = (x + .5) * px.width / DIFFVAX_SIZE - .5;
    const sy = (y + .5) * px.height / DIFFVAX_SIZE - .5;
    const offset = y * DIFFVAX_SIZE + x;
    for (let c = 0; c < 3; c++) tensor[c * DIFFVAX_SIZE * DIFFVAX_SIZE + offset] = sampleRgb(px, sx, sy, c) / 127.5 - 1;
  }
  return { tensor, crop };
}

function outputValue(output: Float32Array, channel: number, x: number, y: number) {
  const x0 = Math.max(0, Math.min(DIFFVAX_SIZE - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(DIFFVAX_SIZE - 1, Math.floor(y)));
  const x1 = Math.min(DIFFVAX_SIZE - 1, x0 + 1); const y1 = Math.min(DIFFVAX_SIZE - 1, y0 + 1);
  const tx = clamp01(x - x0); const ty = clamp01(y - y0); const plane = DIFFVAX_SIZE * DIFFVAX_SIZE;
  const at = (xx: number, yy: number) => output[channel * plane + yy * DIFFVAX_SIZE + xx]!;
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
}

/** Single-pass, local-only DiffVax ONNX adapter. It intentionally makes no efficacy claim. */
export class DiffVaxImmunizer {
  state: CapabilityState = 'not_loaded';
  private session: DiffVaxSession | null = null;
  private backend: Backend | null = null;

  async load(url: string, backend: Backend, options: DiffVaxLoadOptions = {}) {
    this.state = 'loading';
    try {
      const bytes = options.fetchBytes ? await options.fetchBytes(url) : new Uint8Array(await (await fetch(url)).arrayBuffer());
      if (await sha256(bytes) !== (options.expectedSha256 ?? DIFFVAX_SHA256)) throw new Error('DiffVax artifact SHA-256 verification failed.');
      if (options.createSession) this.session = await options.createSession(bytes, backend);
      else {
        const ort = await getOrt(backend);
        const raw = await ort.InferenceSession.create(bytes, { executionProviders: [backend] });
        this.session = {
          inputNames: raw.inputNames,
          outputNames: raw.outputNames,
          run: async (inputs) => {
            const tensors = Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, new ort.Tensor('float32', value.data, [...value.dims])]));
            const outputs = await raw.run(tensors);
            return Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, { data: value.data as Float32Array, dims: value.dims }]));
          },
        };
      }
      this.backend = backend;
      this.state = 'ready';
    } catch (error) {
      this.session = null; this.backend = null; this.state = 'failed';
      throw error;
    }
  }

  async immunize(pixels: Pixels, editorMask?: Mask): Promise<ImmunizeResult> {
    if (!this.session || this.state !== 'ready' || !this.backend) throw new Error('DiffVax is not loaded.');
    assertPixels(pixels);
    if (editorMask) assertMask(editorMask, pixels);
    const { tensor, crop } = inputTensor(pixels);
    const input = this.session.inputNames[0]; const outputName = this.session.outputNames[0];
    if (!input || !outputName) throw new Error('DiffVax ONNX graph is missing its required input or output.');
    const result = await this.session.run({ [input]: { data: tensor, dims: [1, 3, DIFFVAX_SIZE, DIFFVAX_SIZE] } });
    const perturbation = result[outputName];
    if (!perturbation || perturbation.data.length !== 3 * DIFFVAX_SIZE * DIFFVAX_SIZE) throw new Error('DiffVax output must be [1,3,512,512].');
    const out = new Uint8ClampedArray(pixels.data);
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
      const nx = (x + .5) * DIFFVAX_SIZE / pixels.width - .5;
      const ny = (y + .5) * DIFFVAX_SIZE / pixels.height - .5;
      // Mask 1 means an editor would repaint it: preserve it. No mask means the full image receives the perturbation.
      const keep = editorMask ? 1 - sampleMask(editorMask, x, y) / 255 : 1;
      const i = (y * pixels.width + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(clamp01((pixels.data[i + c]! / 127.5 - 1 + outputValue(perturbation.data, c, nx, ny) * keep + 1) / 2) * 255);
    }
    return { pixels: { width: pixels.width, height: pixels.height, data: out }, wholeImage: !editorMask, networkCrop: crop };
  }
}
