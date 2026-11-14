import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrEngine } from './engine';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) } as ImageData;

describe('worker engine lifecycle', () => {
  it('loads, scans and transfers a COPY without detaching caller pixels', async () => {
    const engine = new OcrEngine();
    expect(engine.state).toBe('not_loaded');
    const loading = engine.load('https://example.test/models/ocr/');
    expect(engine.state).toBe('loading');
    const w = FakeWorker.instances[0]! ;
    expect(w.postMessage.mock.calls[0]! [0]! .detVariant).toBe('v3');
    w.reply({ type: 'loaded' }); await loading;
    expect(engine.state).toBe('ready');
    const scanning = engine.scan(pixels);
    const sent = w.postMessage.mock.calls[1]! [0]! ;
    expect(sent.image.data.buffer).not.toBe(pixels.data.buffer);
    w.reply({ type: 'result', boxes: [] });
    expect(await scanning).toEqual([]);
    engine.dispose();
  });
  it('cancels by terminating the worker and rejects the pending scan', async () => {
    const e = new OcrEngine();
    const loading = e.load('https://example.test/models/ocr/');
    const w = FakeWorker.instances[0]! ; w.reply({ type: 'loaded' }); await loading;
    const scanning = e.scan(pixels);
    const rejected = expect(scanning).rejects.toMatchObject({ name: 'AbortError' });
    e.cancel(); await rejected;
    expect(w.terminate).toHaveBeenCalledTimes(1);
    expect(e.state).toBe('not_loaded');
    await expect(e.scan(pixels)).rejects.toThrow(/load/i);
  });
  it('does not allow overlapping calls or convert failures into empty scans', async () => {
    const e = new OcrEngine();
    const loading = e.load('https://example.test/models/ocr/');
    const w = FakeWorker.instances[0]! ; w.reply({ type: 'loaded' }); await loading;
    const scanning = e.scan(pixels);
    await expect(e.scan(pixels)).rejects.toThrow(/busy/i);
    w.reply({ type: 'error', message: 'OCR model failed.' });
    await expect(scanning).rejects.toThrow('OCR model failed.');
    expect(e.state).toBe('failed');
    expect(w.terminate).toHaveBeenCalled();
  });
  it('supports AbortSignal during load and can reload after cancellation', async () => {
    const e = new OcrEngine();
    const controller = new AbortController();
    const loading = e.load('https://example.test/models/ocr/', { signal: controller.signal });
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    const again = e.load('https://example.test/models/ocr/');
    FakeWorker.instances[1]! .reply({ type: 'loaded' }); await again;
    expect(e.state).toBe('ready'); e.dispose();
  });
});
