import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckResult, Execution } from '../../../contracts';
import { readBitmap, recompressOnMain } from './browser';
import { decodeThumbnail, extractExifThumbnail, thumbnailCheckResult } from './exifThumbnail';
import type { ForensicsRequest, ForensicsResponse, ForensicsStates } from './forensicsTypes';
import { analysisGeometry } from './grid';
import { CHECK_IDS, failureResult } from './results';
import type { ForensicsId } from './results';

export type { ForensicsState, ForensicsStates } from './forensicsTypes';
export const FORENSICS_TIMEOUT_MS = 60_000;
const idle = (): ForensicsStates => ({ ela: { status: 'idle' }, noise: { status: 'idle' }, thumbnail: { status: 'idle' } });
const keyFor = (id: ForensicsId): keyof ForensicsStates => id === 'exif-thumbnail' ? 'thumbnail' : id;

/** Local, explicit-run checks. New asset, cancel, retry and unmount terminate work. */
export function useForensics(assetId: string | null, bitmap: ImageBitmap | null,
  bytes: Uint8Array | null, mimeType: string | null) {
  const [states, setStates] = useState<ForensicsStates>(idle);
  const workerRef = useRef<Worker | null>(null);
  const runId = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    workerRef.current?.terminate(); workerRef.current = null;
    window.clearTimeout(timer.current); timer.current = undefined;
    runId.current++;
  }, []);

  useEffect(() => { stop(); setStates(idle()); return stop; }, [assetId, stop]);

  const run = useCallback(async () => {
    if (!assetId || !bitmap || !bytes || !mimeType) return;
    stop();
    const id = ++runId.current, pending = new Set(CHECK_IDS);
    setStates({ ela: { status: 'running' }, noise: { status: 'running' }, thumbnail: { status: 'running' } });
    const active = () => runId.current === id;
    const finish = (check: ForensicsId, result: CheckResult) => {
      if (!active() || !pending.delete(check)) return;
      const key = keyFor(check);
      setStates((previous) => ({ ...previous, [key]: result.execution === 'complete'
        ? { status: 'done', checkResult: result }
        : { status: 'failed', checkResult: result, message: result.reason ?? 'The check did not complete.' } }));
      if (!pending.size) stop();
    };
    const failPending = (execution: Exclude<Execution, 'complete'>, message: string) => {
      for (const check of [...pending]) finish(check, failureResult(check, assetId, execution, message));
      if (active()) stop();
    };
    timer.current = window.setTimeout(() => {
      if (active()) failPending('timeout', 'Timed out after 60 seconds, so the run was stopped.');
    }, FORENSICS_TIMEOUT_MS);

    try {
      const worker = new Worker(new URL('./forensics.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const send = (req: ForensicsRequest, transfer: Transferable[]) => { if (active()) worker.postMessage(req, transfer); };
      worker.onmessage = (event: MessageEvent<ForensicsResponse>) => {
        const message = event.data;
        if (!active() || message.id !== id) return;
        if (message.type === 'result') { finish(message.check, message.result); return; }
        // Encoding only is on the page in this fallback; ELA math returns to the worker.
        void (async () => {
          try {
            const recompressed = await recompressOnMain(message.image);
            send({ type: 'ela', id, assetId, image: message.image, recompressed, geometry: message.geometry },
              [message.image.rgba.buffer as ArrayBuffer, recompressed.rgba.buffer as ArrayBuffer]);
          } catch { finish('ela', failureResult('ela', assetId, 'failed', 'JPEG recompression is unavailable in this browser.')); }
        })();
      };
      worker.onerror = () => { if (active()) failPending('failed', 'The image worker stopped unexpectedly.'); };
      worker.onmessageerror = () => { if (active()) failPending('failed', 'The image worker response could not be read.'); };
      const geometry = analysisGeometry(bitmap.width, bitmap.height);
      const image = readBitmap(bitmap, geometry.width, geometry.height);
      send({ type: 'start', id, assetId, image, mimeType, geometry }, [image.rgba.buffer as ArrayBuffer]);

      // Keep byte/pixel owners intact: only locally allocated buffers are transferred.
      const embedded = extractExifThumbnail(bytes);
      if (!embedded) { finish('exif-thumbnail', thumbnailCheckResult(assetId, null)); return; }
      let decoded: ImageBitmap | undefined;
      try {
        decoded = await decodeThumbnail(embedded);
        if (!active()) return;
        const thumb = readBitmap(decoded), main = readBitmap(bitmap);
        send({ type: 'thumbnail', id, assetId, thumb, main }, [thumb.rgba.buffer as ArrayBuffer, main.rgba.buffer as ArrayBuffer]);
      } catch { finish('exif-thumbnail', failureResult('exif-thumbnail', assetId, 'failed', 'The embedded thumbnail could not be decoded.')); }
      finally { decoded?.close(); }
    } catch { if (active()) failPending('failed', 'The image worker or pixel preparation is unavailable in this browser.'); }
  }, [assetId, bitmap, bytes, mimeType, stop]);

  const cancel = useCallback(() => { stop(); setStates(idle()); }, [stop]);
  return { ...states, run, cancel };
}
