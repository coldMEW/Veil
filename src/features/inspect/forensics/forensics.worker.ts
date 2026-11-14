/// <reference lib="webworker" />
import { elaCheckResult, elaGrid, recompressJpeg } from './ela';
import { compareThumbnail, thumbnailCheckResult } from './exifThumbnail';
import type { ForensicsRequest, ForensicsResponse } from './forensicsTypes';
import { noiseCheckResult, noiseResidualGrid } from './noise';
import { failureResult } from './results';
import type { ForensicsId } from './results';

type Post = (message: ForensicsResponse, transfer?: Transferable[]) => void;

/** Exported for protocol tests; importing in Node does not install a global handler. */
export async function runForensicsRequest(req: ForensicsRequest, post: Post): Promise<void> {
  const report = (check: ForensicsId, compute: () => ReturnType<typeof elaCheckResult>) => {
    try { post({ type: 'result', id: req.id, check, result: compute() }); }
    catch { post({ type: 'result', id: req.id, check,
      result: failureResult(check, req.assetId, 'failed', 'The image check could not be computed.') }); }
  };
  if (req.type === 'thumbnail') {
    report('exif-thumbnail', () => thumbnailCheckResult(req.assetId, compareThumbnail(req.thumb, req.main)));
    return;
  }
  if (req.type === 'ela') {
    report('ela', () => {
      if (req.recompressed.width !== req.image.width || req.recompressed.height !== req.image.height) {
        throw new RangeError('JPEG dimensions changed during encoding.');
      }
      return elaCheckResult(req.assetId, 'image/jpeg', elaGrid(req.image.rgba, req.recompressed.rgba,
        req.image.width, req.image.height), req.geometry);
    });
    return;
  }
  const { image, geometry } = req;
  report('noise', () => noiseCheckResult(req.assetId, noiseResidualGrid(image.rgba, image.width, image.height), geometry));
  if (req.mimeType !== 'image/jpeg') {
    report('ela', () => elaCheckResult(req.assetId, req.mimeType, null, geometry));
    return;
  }
  // Feature detection is in the worker, not inferred from the page's capabilities.
  if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height));
      const decoded = await recompressJpeg(bitmap);
      report('ela', () => elaCheckResult(req.assetId, req.mimeType,
        elaGrid(image.rgba, decoded.rgba, image.width, image.height), geometry));
      return;
    } catch { /* Encoding capability varies by environment; ask the page to encode. */ }
    finally { bitmap?.close(); }
  }
  post({ type: 'needs-ela', id: req.id, image, geometry }, [image.rgba.buffer as ArrayBuffer]);
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  scope.onmessage = (event: MessageEvent<ForensicsRequest>) => {
    void runForensicsRequest(event.data, (message, transfer = []) => scope.postMessage(message, transfer));
  };
}
