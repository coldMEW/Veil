import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusResponse } from './focusTypes';

describe('occlusion worker adapter (synthetic runtime)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./models.json');
    vi.doUnmock('./preprocess');
    vi.doUnmock('../../../lib/runtime/ortEnv');
    vi.resetModules();
  });

  async function runWorker(gpu: boolean, coarse: boolean, invalidOutput = false) {
    vi.resetModules();
    const inputDispose = vi.fn();
    const outputDispose = vi.fn();
    const batchSizes: number[] = [];
    let calls = 0;
    const inference = vi.fn(async ({ pixel_values: image }: { pixel_values: { data: Float32Array; dims: number[] } }) => {
      const n = image.dims[0]!;
      batchSizes.push(n);
      const base = calls++ === 0;
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const cell = image.data[i * 3 * 4 * 4]! - 1;
        data[i] = invalidOutput ? NaN : base ? 10 : 10 - (cell % 2 === 0 ? 1 : -2);
      }
      return { logits: {
        type: 'float32', dims: [n, 1], data,
        dispose: () => { outputDispose(); data.fill(NaN); },
      } };
    });
    class Tensor {
      constructor(public type: string, public data: Float32Array, public dims: number[]) {}
      dispose = inputDispose;
    }
    vi.doMock('../../../lib/runtime/ortEnv', () => ({
      configureOrt: () => ({ Tensor, InferenceSession: { create: async () => ({ run: inference }) }, env: { wasm: { numThreads: 1 } } }),
      hasWebGpu: async () => gpu,
    }));
    vi.doMock('./models.json', () => ({ default: {
      'communityforensics-vit-s-fp32': { sha256: 'ab'.repeat(32), servedAs: '/synthetic-model.onnx' },
    } }));
    // Small input tensors keep this a quick adapter test; grid selection stays real.
    vi.doMock('./preprocess', async (importOriginal) => ({
      ...await importOriginal<typeof import('./preprocess')>(),
      CROP: 4,
      cropGeometry: () => ({ resizedWidth: 4, resizedHeight: 4, left: 0, top: 0, source: { x: 0, y: 0, width: 4, height: 4 } }),
      resizeBicubic: () => new Uint8ClampedArray(64),
      cropRgba: () => new Uint8ClampedArray(64),
      toChw: () => new Float32Array(48),
      occlude: (_base: Float32Array, _grid: number, cell: number, out: Float32Array) => { out.fill(cell + 1); return out; },
    }));
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).fill(171).buffer } });
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(64) }) }; }
    });
    const messages: FocusResponse[] = [];
    const workerSelf: { onmessage?: (event: unknown) => void; postMessage: (message: FocusResponse) => void } = {
      postMessage: (message) => { messages.push(message); },
    };
    vi.stubGlobal('self', workerSelf);
    await import('./focus.worker');
    const close = vi.fn();
    workerSelf.onmessage!({ data: { id: 1, coarse, bitmap: { width: 4, height: 4, close } } });
    await vi.waitFor(() => expect(messages.some((message) => message.type === 'result' || message.type === 'error')).toBe(true));
    return { messages, batchSizes, inputDispose, outputDispose, close };
  }

  it.each([
    [true, false, 6, [1, 8, 8, 8, 8, 4]],
    [false, false, 4, [1, 8, 8]],
    [true, true, 4, [1, 8, 8]],
    [false, true, 4, [1, 8, 8]],
  ] as const)('uses bounded batches for GPU=%s / phone=%s', async (gpu, coarse, grid, batches) => {
    const run = await runWorker(gpu, coarse);
    expect(run.batchSizes).toEqual(batches);
    const result = run.messages.at(-1);
    if (result?.type !== 'result') throw new Error('Expected a completed result.');
    expect(result.grid).toBe(grid);
    expect(result.logit).toBe(10);
    expect(Array.from(result.deltas)).toEqual(Array.from({ length: grid * grid }, (_, i) => i % 2 === 0 ? 1 : -2));
    expect(run.messages).toContainEqual({ type: 'progress', id: 1, stage: 'running', done: grid * grid + 1, total: grid * grid + 1 });
    expect(run.inputDispose).toHaveBeenCalledTimes(batches.length);
    expect(run.outputDispose).toHaveBeenCalledTimes(batches.length);
    expect(run.close).toHaveBeenCalledOnce();
    for (const time of Object.values(result.timings)) expect(Number.isFinite(time) && time >= 0).toBe(true);
    expect(result.timings).toHaveProperty('preprocessMs');
    expect(result.timings).toHaveProperty('totalMs');
  });

  it('reports invalid model output as an error and still disposes resources', async () => {
    const run = await runWorker(true, false, true);
    expect(run.messages.at(-1)).toMatchObject({ type: 'error', message: 'The model produced a non-finite output.' });
    expect(run.messages.some((message) => message.type === 'result')).toBe(false);
    expect(run.inputDispose).toHaveBeenCalledOnce();
    expect(run.outputDispose).toHaveBeenCalledOnce();
    expect(run.close).toHaveBeenCalledOnce();
  });
});
