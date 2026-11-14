import type { CapabilityState } from '../../../contracts';
import { validateImage } from './image';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { OcrBox, ScanOptions, ScanProgress, RgbaImage } from './types';

export type { OcrBox, ScanOptions, ScanProgress } from './types';
interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface EngineScanOptions extends ScanOptions, RequestOptions { onProgress?: (progress: ScanProgress) => void }

/** Browser facade. CPU/WASM inference and pixel processing run only in the dedicated worker. */
export class OcrEngine {
  private capability: CapabilityState = 'not_loaded';
  private worker: Worker | null = null;
  private pending: { resolve: (boxes?: OcrBox[]) => void; reject: (error: Error) => void; cleanup: () => void; kind: 'load' | 'scan' } | null = null;
  private progress?: (p: ScanProgress) => void;
  get state(): CapabilityState { return this.capability; }

  async load(modelBaseUrl: string, options: RequestOptions & { detVariant?: 'v3' | 'v5' } = {}): Promise<void> {
    if (this.pending) throw new Error('OCR engine is busy.');
    if (options.signal?.aborted) throw new DOMException('OCR cancelled.', 'AbortError');
    this.dispose();
    this.capability = 'loading';
    try {
      // Resolve against document base (supports both root and subpath Vite deployments).
      const base = new URL(modelBaseUrl.endsWith('/') ? modelBaseUrl : `${modelBaseUrl}/`, globalThis.location?.href ?? 'http://localhost/');
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Models require an HTTP(S) base URL.');
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (this.worker !== worker) return;
        const message = event.data;
        if (message.type === 'progress') { this.progress?.(message.progress); return; }
        if (message.type === 'error') { this.fail(new Error(message.message)); return; }
        const p = this.pending;
        if (!p) return;
        if ((message.type === 'loaded' && p.kind !== 'load') || (message.type === 'result' && p.kind !== 'scan')) {
          this.fail(new Error('Unexpected OCR worker response.')); return;
        }
        this.pending = null; this.progress = undefined; p.cleanup(); this.capability = 'ready';
        p.resolve(message.type === 'result' ? message.boxes : undefined);
      };
      worker.onerror = () => this.fail(new Error('OCR worker failed. Check model assets and WASM support.'));
      worker.onmessageerror = () => this.fail(new Error('OCR worker message could not be decoded.'));
      await this.request({ type: 'load', baseUrl: base.href, detVariant: options.detVariant ?? 'v3' }, options, 120_000);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.fail(error instanceof Error ? error : new Error('OCR load failed.'));
      throw error;
    }
  }

  async scan(imageData: RgbaImage, opts: EngineScanOptions = {}): Promise<OcrBox[]> {
    if (this.pending) throw new Error('OCR engine is busy.');
    if (this.capability !== 'ready') throw new Error('Load OCR models before scanning.');
    validateImage(imageData);
    const { signal, timeoutMs, onProgress, ...options } = opts;
    if (signal?.aborted) throw new DOMException('OCR cancelled.', 'AbortError');
    // Never detach the caller's working image. Only this copy transfers to the worker.
    const image = { width: imageData.width, height: imageData.height, data: new Uint8ClampedArray(imageData.data) };
    this.progress = onProgress;
    const result = await this.request({ type: 'scan', image, options }, { signal, timeoutMs }, 300_000, [image.data.buffer]);
    if (!result) throw new Error('OCR returned no result.');
    return result;
  }

  /** Hard cancellation interrupts WASM too. Call load() again before a subsequent scan. */
  cancel(): void {
    this.stop(); this.capability = 'not_loaded';
    const p = this.pending; this.pending = null;
    p?.cleanup(); p?.reject(new DOMException('OCR cancelled.', 'AbortError'));
  }
  dispose(): void { this.cancel(); }

  private stop(): void {
    if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null; this.worker.terminate(); this.worker = null; }
    this.progress = undefined;
  }
  private fail(error: Error): void {
    this.stop(); this.capability = 'failed';
    const p = this.pending; this.pending = null; p?.cleanup(); p?.reject(error);
  }
  private request(message: WorkerRequest, options: RequestOptions, defaultTimeout: number, transfer: Transferable[] = []): Promise<OcrBox[] | undefined> {
    const timeout = options.timeoutMs ?? defaultTimeout;
    if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new Error('Invalid OCR timeout.'));
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel();
      const timer = setTimeout(() => this.fail(new Error('OCR timed out; worker terminated.')), timeout);
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      this.pending = { resolve, reject, cleanup, kind: message.type };
      options.signal?.addEventListener('abort', abort, { once: true });
      try { this.worker!.postMessage(message, transfer); }
      catch { this.fail(new Error('Could not send image to OCR worker.')); }
    });
  }
}

