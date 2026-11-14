import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCheckResult } from '../../../contracts';
import {
  cropFaceRgba, EXACT_RESIZE, faceRectFromBox, flowMagnitude, HIGH, LOW, MEAN, preprocessBitmap, preprocessFace,
  resizeGeometry, STD, toChw, toWarpOverlay, warpPointToSource,
} from './preprocess';
import { toCheckResult, type WarpState } from './useWarpDetector';
import { FACE_BOX_HINT, MODEL_INFO, type WarpRequest, type WarpResponse, type WarpResult } from './warpTypes';

const fullFace = { x: 0, y: 0, w: 1, h: 1 };

describe('face crop and input preprocessing', () => {
  it('floors the long edge in both orientations, rather than rounding', () => {
    expect(resizeGeometry(7, 3)).toEqual({ width: 933, height: 400 });
    expect(resizeGeometry(3, 7)).toEqual({ width: 400, height: 933 });
    expect(resizeGeometry(10, 10)).toEqual({ width: 400, height: 400 });
    expect(resizeGeometry(1600, 1067)).toEqual({ width: 599, height: 400 });
  });

  it('maps normalized selection to outward-rounded source pixels without adding margin', () => {
    expect(faceRectFromBox(100, 80, { x: 0.205, y: 0.1, w: 0.5, h: 0.5 }))
      .toEqual({ x: 20, y: 8, width: 51, height: 40 });
    expect(faceRectFromBox(100, 80, fullFace)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(faceRectFromBox(100, 80, { x: 0.999, y: 0.999, w: 0.001, h: 0.001 }))
      .toEqual({ x: 99, y: 79, width: 1, height: 1 });
  });

  it('copies only the selected RGBA pixels in row-major order', () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < 12; i++) pixels.set([i, 100, 200, 255], i * 4);
    const crop = cropFaceRgba(pixels, 4, 3, { x: 0.25, y: 0, w: 0.5, h: 2 / 3 });
    expect(crop.faceRect).toEqual({ x: 1, y: 0, width: 2, height: 2 });
    expect(Array.from(crop.rgba)).toEqual([1, 100, 200, 255, 2, 100, 200, 255, 5, 100, 200, 255, 6, 100, 200, 255]);
    crop.rgba[0] = 255;
    expect(pixels[4]).toBe(1);
  });

  it('normalizes RGB/255 with ImageNet constants into distinct CHW planes', () => {
    const data = toChw(new Uint8ClampedArray([255, 0, 128, 0, 0, 255, 64, 255]), 2, 1);
    const rgb = [[255, 0], [0, 255], [128, 64]];
    for (let c = 0; c < 3; c++) for (let i = 0; i < 2; i++) {
      expect(data[c * 2 + i]).toBeCloseTo((rgb[c]![i]! / 255 - MEAN[c]!) / STD[c]!, 5);
    }
  });

  it('produces a rectangular batch-one input with the same pinned bicubic behavior', () => {
    const pixels = new Uint8ClampedArray(7 * 3 * 4);
    for (let i = 0; i < 21; i++) pixels.set([255, 0, 128, 255], i * 4);
    const input = preprocessFace(pixels, 7, 3, fullFace);
    expect(input).toMatchObject({ width: 933, height: 400, faceRect: { x: 0, y: 0, width: 7, height: 3 } });
    const plane = 933 * 400;
    expect(input.data.length).toBe(3 * plane);
    expect(input.data[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
    expect(input.data[plane]).toBeCloseTo(-MEAN[1] / STD[1], 5);
    expect(input.data[3 * plane - 1]).toBeCloseTo((128 / 255 - MEAN[2]) / STD[2], 5);
  });

  it('rejects invalid dimensions, malformed data, and boxes outside the image', () => {
    for (const face of [
      { ...fullFace, x: -0.1 }, { ...fullFace, w: 0 }, { ...fullFace, h: -1 },
      { ...fullFace, x: 0.1 }, { ...fullFace, y: Number.NaN }, { ...fullFace, w: Infinity },
    ]) expect(() => faceRectFromBox(10, 10, face)).toThrow();
    for (const size of [0, -1, Infinity, 1.5]) expect(() => resizeGeometry(size, 10)).toThrow();
    expect(() => cropFaceRgba(new Uint8ClampedArray(3), 1, 1, fullFace)).toThrow(/RGBA/);
    expect(() => toChw(new Uint8ClampedArray(3), 1, 1)).toThrow(/RGBA/);
  });

  it('exports a whole-head selection hint for the upstream margin convention', () => {
    expect(FACE_BOX_HINT).toContain('whole head with margin');
    expect(FACE_BOX_HINT).toContain('2.5');
    expect(FACE_BOX_HINT).toContain('1.5');
  });
});

describe('bitmap preprocessing', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function setup(contextAvailable = true) {
    const canvasSizes: number[][] = [];
    const resizeClose = vi.fn();
    const resize = vi.fn(async () => ({ close: resizeClose }));
    vi.stubGlobal('createImageBitmap', resize);
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) { canvasSizes.push([width, height]); }
      getContext() {
        if (!contextAvailable) return null;
        return { drawImage: vi.fn(), getImageData: () => {
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          for (let i = 0; i < data.length; i += 4) data.set([255, 0, 128, 255], i);
          return { data };
        } };
      }
    });
    const originalClose = vi.fn();
    const bitmap = { width: 3848, height: 2565, close: originalClose } as unknown as ImageBitmap;
    return { resize, resizeClose, originalClose, bitmap, canvasSizes };
  }

  it('crops the bitmap without resize options, then reads native crop pixels for JS bicubic', async () => {
    const h = setup();
    expect(EXACT_RESIZE).toBe(false);
    const face = { x: 0.25, y: 0.2, w: 0.5, h: 0.6 };
    const input = await preprocessBitmap(h.bitmap, face);
    expect(h.resize).toHaveBeenCalledWith(h.bitmap, 962, 513, 1924, 1539);
    expect(h.canvasSizes).toEqual([[1924, 1539]]);
    expect(input).toMatchObject({ width: 500, height: 400, faceRect: { x: 962, y: 513, width: 1924, height: 1539 } });
    expect(input.data.length).toBe(3 * 500 * 400);
    expect(input.data[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
    expect(input.data[500 * 400]).toBeCloseTo(-MEAN[1] / STD[1], 5);
    expect(input.data[2 * 500 * 400]).toBeCloseTo((128 / 255 - MEAN[2]) / STD[2], 5);
    for (const time of [input.decodeMs, input.resizeMs, input.normalizeMs]) expect(time).toBeGreaterThanOrEqual(0);
    expect(h.resizeClose).toHaveBeenCalledOnce();
    expect(h.originalClose).not.toHaveBeenCalled();
  });

  it('retains the exact JS path when enabled, without calling bitmap resize', async () => {
    const h = setup();
    const bitmap = { ...h.bitmap, width: 3, height: 2 } as ImageBitmap;
    const input = await preprocessBitmap(bitmap, fullFace, true);
    const pixels = new Uint8ClampedArray(3 * 2 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 0, 128, 255], i);
    const reference = preprocessFace(pixels, 3, 2, fullFace);
    expect(input.data).toEqual(reference.data);
    expect(input).toMatchObject({ width: reference.width, height: reference.height, faceRect: reference.faceRect });
    expect(h.resize).not.toHaveBeenCalled();
    expect(h.canvasSizes).toEqual([[3, 2]]);
    expect(h.originalClose).not.toHaveBeenCalled();
  });

  it('closes the temporary cropped bitmap if canvas readback is unavailable', async () => {
    const h = setup(false);
    await expect(preprocessBitmap(h.bitmap, fullFace)).rejects.toThrow('2D canvas');
    expect(h.resizeClose).toHaveBeenCalledOnce();
    expect(h.originalClose).not.toHaveBeenCalled();
  });

  it('rejects invalid face coordinates before cropping', async () => {
    const h = setup();
    await expect(preprocessBitmap(h.bitmap, { ...fullFace, x: -1 })).rejects.toThrow('face box');
    expect(h.resize).not.toHaveBeenCalled();
  });

  it('matches the original PIL-style JS path on a textured crop downscaled from native pixels', async () => {
    const width = 640;
    const height = 576;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      pixels.set([(x * 127 + y * 73) % 256, (x * 29 + y * 181) % 256, (x + y) % 2 ? 255 : 0, 255], (y * width + x) * 4);
    }
    const face = { x: 0.125, y: 0.125, w: 0.75, h: 0.75 };
    const original = { width, height, pixels, close: vi.fn() };
    const cropClose = vi.fn();
    const crop = vi.fn(async (_bitmap: unknown, x: number, y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        const start = ((y + row) * width + x) * 4;
        data.set(pixels.subarray(start, start + w * 4), row * w * 4);
      }
      return { width: w, height: h, pixels: data, close: cropClose };
    });
    vi.stubGlobal('createImageBitmap', crop);
    vi.stubGlobal('OffscreenCanvas', class {
      image: { pixels: Uint8ClampedArray } | null = null;
      constructor(public width: number, public height: number) {}
      getContext() {
        return {
          drawImage: (image: { pixels: Uint8ClampedArray }) => { this.image = image; },
          getImageData: () => ({ data: new Uint8ClampedArray(this.image!.pixels) }),
        };
      }
    });
    const fast = await preprocessBitmap(original as unknown as ImageBitmap, face);
    const legacy = await preprocessBitmap(original as unknown as ImageBitmap, face, true);
    const reference = preprocessFace(pixels, width, height, face);
    expect(crop).toHaveBeenCalledWith(original, 80, 72, 480, 432);
    expect(fast).toMatchObject({ width: 444, height: 400, faceRect: reference.faceRect });
    expect(fast.data).toEqual(reference.data);
    expect(fast.data).toEqual(legacy.data);
    expect(cropClose).toHaveBeenCalledOnce();
    expect(original.close).not.toHaveBeenCalled();
  });
});

describe('returned flow and source mapping', () => {
  it('uses returned H,W and planar dx,dy, with signed displacements', () => {
    const result = flowMagnitude(new Float32Array([3, -5, 0, 4, 12, 0]), [1, 2, 1, 3]);
    expect(result).toMatchObject({ width: 3, height: 1, maxMagnitude: 13, meanMagnitude: 6 });
    expect(Array.from(result.magnitude)).toEqual([5, 13, 0]);
  });

  it('maps output pixels using their own dimensions, even when DRN changes input size', () => {
    // A 599 x 400 input may produce a 600 x 400 output. Do not reuse 599.
    const rect = { x: 100, y: 50, width: 1198, height: 800 };
    expect(warpPointToSource(299, 199, 600, 400, rect)).toEqual({ x: 698.0016666666667, y: 449 });
    const end = warpPointToSource(599, 399, 600, 400, rect);
    expect(end.x).toBeCloseTo(rect.x + rect.width - rect.width / 1200);
    expect(end.y).toBe(rect.y + rect.height - rect.height / 800);
  });

  it('rejects unexpected tensor shape, mismatched length and non-finite or overflowing flow', () => {
    for (const dims of [[2, 2, 1, 1], [1, 3, 1, 1], [1, 2, 0, 1], [1, 2, 1], [1, 2, 1, 1.5]]) {
      expect(() => flowMagnitude(new Float32Array(2), dims)).toThrow();
    }
    expect(() => flowMagnitude(new Float32Array(3), [1, 2, 1, 1])).toThrow(/dimensions/);
    for (const value of [NaN, Infinity, -Infinity, 3.4e38]) {
      expect(() => flowMagnitude(new Float32Array([value, value]), [1, 2, 1, 1])).toThrow(/non-finite/);
    }
  });
});

describe('display overlay', () => {
  it('uses the requested display thresholds, hiding the supplied original-example maximum', () => {
    expect(LOW).toBe(2.5);
    expect(HIGH).toBe(4.5);
    expect(Array.from(toWarpOverlay(new Float32Array([2.25]), 1, 1))).toEqual([0, 0, 0, 0]);
    const examples = toWarpOverlay(new Float32Array([3.41, 8.76]), 2, 1);
    expect(examples[1]).toBeGreaterThan(0); // The selfie response is below the red display threshold.
    expect(Array.from(examples.subarray(4))).toEqual([255, 0, 0, 180]);
  });

  it('is transparent below LOW, yellow at LOW, orange halfway and red at or above HIGH', () => {
    const rgba = toWarpOverlay(new Float32Array([0, LOW - 0.01, LOW, (LOW + HIGH) / 2, HIGH, HIGH + 10]), 3, 2);
    expect(Array.from(rgba)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 255, 220, 0, 180,
      255, 110, 0, 180, 255, 0, 0, 180, 255, 0, 0, 180,
    ]);
  });

  it('rejects invalid grids and values instead of hiding model failure', () => {
    expect(() => toWarpOverlay(new Float32Array(2), 1, 1)).toThrow();
    for (const value of [NaN, Infinity, -1]) expect(() => toWarpOverlay(new Float32Array([value]), 1, 1)).toThrow();
  });
});

describe('model observation contract', () => {
  it('reports the peak, mapped coordinates, grid and scope while remaining inconclusive', () => {
    const magnitude = new Float32Array([0, 0, 0, 0, 0, 0, 4.2, 0, 0]);
    const result: WarpResult = {
      magnitude, width: 3, height: 3, faceRect: { x: 10, y: 20, width: 60, height: 90 },
      maxMagnitude: magnitude[6]!, meanMagnitude: magnitude[6]! / 9, backend: 'wasm', threads: 1,
      timings: { loadMs: 10, preprocessMs: 2, inferenceMs: 3 },
    };
    const check = toCheckResult('asset', result);
    expect(validateCheckResult(check)).toEqual([]);
    expect(check).toMatchObject({ id: 'face-warp', assetId: 'asset', kind: 'model', finding: 'inconclusive', execution: 'complete' });
    expect(check.observation).toContain('4.2 px near the lower left');
    expect(check.method).toContain('Wang et al., ICCV 2019');
    expect(check.method).toContain(MODEL_INFO.sha256 || 'unavailable (placeholder)');
    expect(check.method).toContain('WASM');
    expect(check.method).toContain('Pillow-style bicubic interpolation');
    expect(check.evidence).toMatchObject({ resizeMode: 'pil-exact', cropMode: 'bitmap-crop' });
    expect(check.limitations).toEqual(expect.arrayContaining([
      'Trained only on Photoshop Face-Aware Liquify.', 'Does not detect AI generation or other edits.',
      'Real faces can show some predicted warp.', 'Only the face box was analysed.',
    ]));
    expect(check.evidence.peak).toEqual({ column: 0, row: 2, source: { x: 20, y: 95 } });
    expect(check.evidence.gridSummary).toMatchObject({ counts: Array(9).fill(1), max: Array.from(magnitude) });
    expect(check.evidence.thresholds).toEqual({ low: LOW, high: HIGH, purpose: 'display only' });
    expect(toCheckResult('asset', { ...result, magnitude: new Float32Array(9), maxMagnitude: 0 }).finding).toBe('inconclusive');
  });
});

describe('worker adapter (synthetic runtime, not real model execution)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./warpTypes');
    vi.doUnmock('./preprocess');
    vi.doUnmock('../../../lib/runtime/ortEnv');
    vi.resetModules();
  });

  async function runWorker(options: { gpuFails?: boolean; checksum?: string; bytes?: number; httpOk?: boolean; invalidFlow?: boolean; preloadOnly?: boolean; exactResize?: boolean; warmupFails?: boolean; resizeFails?: boolean } = {}) {
    vi.resetModules();
    const dispose = vi.fn();
    const inputDispose = vi.fn();
    const release = vi.fn(async () => undefined);
    let provider = '';
    const inference = vi.fn(async () => {
      if (options.warmupFails && provider === 'webgpu') throw new Error('GPU shader compilation failed');
      return { flow: { type: 'float32', dims: [1, 2, 3, 5], data: new Float32Array(30).fill(options.invalidFlow ? NaN : 3), dispose } };
    });
    const create = vi.fn(async (_bytes: Uint8Array, config: { executionProviders: Array<string | { name: string; preferredLayout?: string }>; graphOptimizationLevel: string }) => {
      const ep = config.executionProviders[0]!;
      provider = typeof ep === 'string' ? ep : ep.name;
      if (options.gpuFails && provider === 'webgpu') throw new Error('unsupported GPU op');
      return { run: inference, release };
    });
    const tensorInputs: number[][] = [];
    const tensorData: Float32Array[] = [];
    class Tensor {
      constructor(_type: string, data: Float32Array, dims: number[]) { tensorInputs.push(dims); tensorData.push(data); }
      dispose = inputDispose;
    }
    vi.doMock('../../../lib/runtime/ortEnv', () => ({
      configureOrt: () => ({ InferenceSession: { create }, Tensor, env: { wasm: { numThreads: 1 } } }),
      hasWebGpu: async () => true,
    }));
    vi.doMock('./warpTypes', () => ({ MODEL_INFO: {
      name: 'synthetic model', servedAs: '/models/fal/fal-local-drn.onnx',
      sha256: options.checksum ?? 'ab'.repeat(32), bytes: options.bytes ?? 3,
    } }));
    vi.doMock('./preprocess', async (importOriginal) => ({
      ...await importOriginal<typeof import('./preprocess')>(), EXACT_RESIZE: options.exactResize ?? false,
    }));
    const fetchMock = vi.fn(async () => ({ ok: options.httpOk ?? true, status: 404, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(171).buffer) } });
    const messages: WarpResponse[] = [];
    const workerSelf: { onmessage?: (event: unknown) => void; postMessage: (message: WarpResponse) => void } = {
      postMessage: (message) => { messages.push(message); },
    };
    vi.stubGlobal('self', workerSelf);
    const resizedClose = vi.fn();
    const resize = vi.fn(async () => {
      if (options.resizeFails) throw new Error('Bitmap resize failed.');
      return { close: resizedClose };
    });
    vi.stubGlobal('createImageBitmap', resize);
    vi.stubGlobal('OffscreenCanvas', class {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext() { return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4).fill(255) }) }; }
    });
    await import('./warp.worker');
    let id = 0;
    async function send(type: 'preload' | 'run') {
      const requestId = ++id;
      const close = vi.fn();
      workerSelf.onmessage!({ data: type === 'preload' ? { type, id: requestId } : {
        type, id: requestId, bitmap: { width: 3, height: 2, close }, face: fullFace,
      } });
      await vi.waitFor(() => expect(messages.some((m) => m.id === requestId && (m.type === 'ready' || m.type === 'result' || m.type === 'error'))).toBe(true));
      return close;
    }
    const close = await send(options.preloadOnly ? 'preload' : 'run');
    return { messages, create, inference, tensorInputs, tensorData, dispose, inputDispose, close, fetchMock, send, resize, resizedClose, release };
  }

  it.each([false, true])('verifies bytes and checksum, uses batch 1 and returned flow dimensions (GPU fallback=%s)', async (gpuFails) => {
    const run = await runWorker({ gpuFails });
    expect(run.messages.at(-1)).toMatchObject({ type: 'result', width: 5, height: 3, backend: gpuFails ? 'wasm' : 'webgpu', faceRect: { width: 3, height: 2 } });
    expect(run.tensorInputs).toEqual([[1, 3, 400, 400], [1, 3, 400, 600]]);
    expect(run.inference.mock.calls[0]).toBeDefined();
    const webgpu = [{ name: 'webgpu', preferredLayout: 'NHWC' }];
    expect(run.create.mock.calls.map((call) => call[1].executionProviders)).toEqual(gpuFails ? [webgpu, ['wasm']] : [webgpu]);
    for (const call of run.create.mock.calls) expect(call[1].graphOptimizationLevel).toBe('all');
    expect(run.dispose).toHaveBeenCalledTimes(2);
    expect(run.inputDispose).toHaveBeenCalledTimes(2);
    expect(run.close).toHaveBeenCalledOnce();
    expect(run.resizedClose).toHaveBeenCalledOnce();
    const result = run.messages.at(-1);
    if (result?.type !== 'result') throw new Error('Expected a result.');
    expect(Object.keys(result.timings).sort()).toEqual([
      'decodeMs', 'inferenceMs', 'loadMs', 'normalizeMs', 'postprocessMs', 'preprocessMs', 'resizeMs', 'totalMs', 'warmupMs',
    ]);
    for (const time of Object.values(result.timings)) expect(Number.isFinite(time) && time >= 0).toBe(true);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.preprocessMs + result.timings.inferenceMs);
  });

  it.each([
    [{ checksum: '' }, /unavailable/], [{ checksum: 'cd'.repeat(32) }, /checksum/],
    [{ bytes: 4 }, /byte count/], [{ httpOk: false }, /HTTP 404/],
  ] as const)('refuses unverified or missing models: %j', async (options, error) => {
    const run = await runWorker(options);
    expect(run.messages.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(error) });
    expect(run.create).not.toHaveBeenCalled();
    expect(run.inference).not.toHaveBeenCalled();
    expect(run.close).toHaveBeenCalledOnce();
    if ('checksum' in options && options.checksum === '') expect(run.fetchMock).not.toHaveBeenCalled();
  });

  it('reports non-finite model output as an error and disposes resources', async () => {
    const run = await runWorker({ invalidFlow: true });
    expect(run.messages.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('non-finite') });
    expect(run.dispose).toHaveBeenCalledTimes(2);
    expect(run.inputDispose).toHaveBeenCalledTimes(2);
    expect(run.close).toHaveBeenCalledOnce();
  });

  it('preloads with one zero-tensor warm-up and reuses the verified session across repeated runs', async () => {
    const run = await runWorker({ preloadOnly: true });
    expect(run.messages.at(-1)).toEqual({ type: 'ready', id: 1 });
    expect(run.inference).toHaveBeenCalledOnce();
    expect(run.tensorInputs).toEqual([[1, 3, 400, 400]]);
    expect(run.tensorData[0]!.every((value) => value === 0)).toBe(true);
    expect(run.dispose).toHaveBeenCalledOnce();
    expect(run.inputDispose).toHaveBeenCalledOnce();
    expect(run.resize).not.toHaveBeenCalled();
    await run.send('preload');
    expect(run.inference).toHaveBeenCalledOnce();
    const closes = await Promise.all([run.send('run'), run.send('run')]);
    expect(run.fetchMock).toHaveBeenCalledOnce();
    expect(run.create).toHaveBeenCalledOnce();
    expect(run.inference).toHaveBeenCalledTimes(3);
    expect(run.messages.filter((m) => m.type === 'result').map((m) => m.id)).toEqual([3, 4]);
    expect(run.messages.filter((m) => m.type === 'progress' && m.stage === 'loading').map((m) => m.id)).toEqual([1, 2]);
    for (const close of closes) expect(close).toHaveBeenCalledOnce();
  });

  it('falls back to WASM when WebGPU warm-up fails, disposing the failed session', async () => {
    const run = await runWorker({ warmupFails: true, preloadOnly: true });
    expect(run.messages.at(-1)).toEqual({ type: 'ready', id: 1 });
    expect(run.release).toHaveBeenCalledOnce();
    expect(run.inference).toHaveBeenCalledTimes(2);
    expect(run.inputDispose).toHaveBeenCalledTimes(2);
    expect(run.dispose).toHaveBeenCalledOnce();
    await run.send('run');
    expect(run.messages.at(-1)).toMatchObject({ type: 'result', backend: 'wasm' });
  });

  it('supports the exact resize flag and still returns output tensor dimensions', async () => {
    const run = await runWorker({ exactResize: true });
    expect(run.messages.at(-1)).toMatchObject({ type: 'result', width: 5, height: 3 });
    expect(run.resize).not.toHaveBeenCalled();
    expect(run.close).toHaveBeenCalledOnce();
  });

  it('closes the source bitmap when fast resizing fails', async () => {
    const run = await runWorker({ resizeFails: true });
    expect(run.messages.at(-1)).toMatchObject({ type: 'error', message: 'Bitmap resize failed.' });
    expect(run.close).toHaveBeenCalledOnce();
    expect(run.inference).toHaveBeenCalledOnce(); // Only preload warm-up ran.
  });
});

describe('page worker lifecycle (synthetic worker and hook harness)', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('react');
    vi.resetModules();
  });

  async function setup() {
    vi.resetModules();
    vi.useFakeTimers();
    let latest: WarpState = { status: 'idle' };
    const refs: Array<{ current: unknown }> = [];
    const effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
    let refCursor = 0;
    let effectCursor = 0;
    const scheduled: Array<() => void> = [];
    vi.doMock('react', () => ({
      useState: () => [latest, (state: WarpState) => { latest = state; }],
      useRef: (value: unknown) => refs[refCursor++] ?? (refs[refCursor - 1] = { current: value }),
      useCallback: (callback: unknown) => callback,
      useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => {
        const index = effectCursor++;
        const previous = effects[index];
        if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
        scheduled.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: callback() };
        });
      },
    }));
    const workers: FakeWorker[] = [];
    class FakeWorker {
      sent: WarpRequest[] = [];
      onmessage: ((event: { data: WarpResponse }) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminate = vi.fn();
      constructor() { workers.push(this); }
      postMessage(message: WarpRequest) { this.sent.push(message); }
      reply(message: WarpResponse) { this.onmessage?.({ data: message }); }
      ready() { this.reply({ type: 'ready', id: this.sent.at(-1)!.id }); }
      result() {
        this.reply({
          type: 'result', id: this.sent.at(-1)!.id,
          ...flowMagnitude(new Float32Array(18).fill(1), [1, 2, 3, 3]),
          faceRect: { x: 0, y: 0, width: 3, height: 2 }, backend: 'wasm', threads: 1,
          timings: { loadMs: 1, preprocessMs: 1, inferenceMs: 1 },
        });
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const clones: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    const clone = vi.fn(async () => {
      const copy = { close: vi.fn() };
      clones.push(copy);
      return copy;
    });
    vi.stubGlobal('createImageBitmap', clone);
    const module = await import('./useWarpDetector');
    const bitmap = { width: 3, height: 2, close: vi.fn() } as unknown as ImageBitmap;
    const render = (assetId = 'first', image = bitmap) => {
      refCursor = 0;
      effectCursor = 0;
      const api = module.useWarpDetector(assetId, image);
      for (const effect of scheduled.splice(0)) effect();
      return api;
    };
    const unmount = () => { for (const effect of effects) effect.cleanup?.(); };
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return { module, workers, bitmap, clone, clones, render, unmount, flush, state: () => latest };
  }

  it('deduplicates named preloads and reuses readiness without extra worker requests', async () => {
    const h = await setup();
    h.render();
    const first = h.module.preload();
    const second = h.module.preload();
    expect(first).toBe(second);
    expect(h.workers).toHaveLength(1);
    expect(h.workers[0]!.sent).toEqual([{ type: 'preload', id: 1 }]);
    h.workers[0]!.ready();
    await first;
    await h.module.preload();
    expect(h.workers[0]!.sent).toHaveLength(1);
    expect(h.clone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.unmount();
    expect(h.workers[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('keeps the worker after preload and successful repeated runs, terminating on unmount', async () => {
    const h = await setup();
    const api = h.render();
    const loading = api.preload();
    const worker = h.workers[0]!;
    worker.ready();
    await loading;
    expect(h.state().status).toBe('idle');
    for (let i = 0; i < 2; i++) {
      const running = api.run(fullFace);
      await h.flush();
      expect(worker.sent.at(-1)?.type).toBe('run');
      worker.result();
      await running;
      expect(h.state().status).toBe('done');
      expect(worker.terminate).not.toHaveBeenCalled();
    }
    expect(h.workers).toHaveLength(1);
    expect(worker.sent.map((message) => message.type)).toEqual(['preload', 'run', 'run']);
    expect(h.bitmap.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.unmount();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('ignores stale image results while retaining the same session for the new image', async () => {
    const h = await setup();
    const first = h.render();
    const loading = first.preload();
    const worker = h.workers[0]!;
    worker.ready();
    await loading;
    const stale = first.run(fullFace);
    await h.flush();
    const second = h.render('second', { ...h.bitmap } as ImageBitmap);
    worker.result();
    await stale;
    expect(h.state().status).toBe('idle');
    expect(worker.terminate).not.toHaveBeenCalled();
    const running = second.run(fullFace);
    await h.flush();
    worker.result();
    await running;
    expect(h.state()).toMatchObject({ status: 'done', checkResult: { assetId: 'second' } });
    expect(h.workers).toHaveLength(1);
    h.unmount();
  });

  it('cancels loading, ignores late replies, and creates a fresh session on retry', async () => {
    const h = await setup();
    const api = h.render();
    const loading = api.preload();
    const old = h.workers[0]!;
    api.cancel();
    old.ready();
    await loading;
    expect(h.state().status).toBe('idle');
    expect(old.terminate).toHaveBeenCalledOnce();
    const retry = api.preload();
    expect(h.workers).toHaveLength(2);
    h.workers[1]!.ready();
    await retry;
    expect(h.state().status).toBe('idle');
    h.unmount();
  });

  it('closes a bitmap copy created after cancellation without submitting it', async () => {
    const h = await setup();
    const api = h.render();
    const loading = api.preload();
    const worker = h.workers[0]!;
    worker.ready();
    await loading;
    const copy = { close: vi.fn() };
    let finishCopy!: (value: typeof copy) => void;
    h.clone.mockImplementationOnce(() => new Promise((resolve) => { finishCopy = resolve; }));
    const running = api.run(fullFace);
    await h.flush();
    api.cancel();
    finishCopy(copy);
    await running;
    expect(copy.close).toHaveBeenCalledOnce();
    expect(worker.sent).toHaveLength(1);
    expect(h.state().status).toBe('idle');
    h.unmount();
  });

  it('cancels timed-out work and leaves an explicit inconclusive failure', async () => {
    const h = await setup();
    const api = h.render();
    const loading = api.preload();
    await vi.advanceTimersByTimeAsync(120_000);
    await loading;
    expect(h.workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(h.state()).toMatchObject({ status: 'failed', message: expect.stringContaining('Timed out after 2 minutes') });
    expect(h.state()).toMatchObject({ message: expect.stringContaining('inconclusive') });
    expect(vi.getTimerCount()).toBe(0);
    h.unmount();
  });

  it('retains the worker after a reported preload failure and allows a retry', async () => {
    const h = await setup();
    const api = h.render();
    const loading = api.preload();
    const worker = h.workers[0]!;
    worker.reply({ type: 'error', id: worker.sent.at(-1)!.id, message: 'Model download failed (HTTP 404).' });
    await loading;
    expect(h.state()).toMatchObject({ status: 'failed', message: expect.stringContaining('HTTP 404') });
    expect(worker.terminate).not.toHaveBeenCalled();
    const retry = api.preload();
    worker.ready();
    await retry;
    expect(h.workers).toHaveLength(1);
    expect(h.state().status).toBe('idle');
    h.unmount();
  });
});
