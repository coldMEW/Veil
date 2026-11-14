import { preprocessDetection, postprocessDetection } from './det';
import { validateImage } from './image';
import { decodeCtc, preprocessRecognition } from './rec';
import { createTiles, mapToOriginal, mergeDetections } from './tiles';
import type { Detection, OcrBox, OcrModels, RgbaImage, ScanOptions, ScanProgress, Profile } from './types';

export function normalizeQuad(quad: [number,number][], width: number, height: number): OcrBox['quad'] {
  if(quad.length!==4 || !quad.every(p=>p.every(Number.isFinite))) throw new Error('Invalid OCR quad.');
  return quad.map(([x,y])=>({x:Math.max(0,Math.min(1,x/width)),y:Math.max(0,Math.min(1,y/height))})) as OcrBox['quad'];
}

/** Shared by browser worker and real-model Node smoke; model adapter is the only platform difference. */
export async function scanImage(image: RgbaImage, models: OcrModels, opts: ScanOptions = {}, progress?: (p: ScanProgress) => void, profile?: Profile): Promise<OcrBox[]> {
  validateImage(image);
  const { tileSize = 960, overlap = 128, wholeImagePass = true, maxBoxes = 500, minRecScore = 0.3 } = opts;
  if (!Number.isInteger(maxBoxes) || maxBoxes < 1 || maxBoxes > 5000 || !Number.isFinite(minRecScore) || minRecScore < 0 || minRecScore > 1)
    throw new Error('Invalid OCR recognition limits.');
  if (tileSize > 1920) throw new Error('OCR tile size exceeds the memory budget.');
  const tileStart = performance.now();
  const tiles = createTiles(image.width, image.height, tileSize, overlap);
  const passes = wholeImagePass && tiles.length > 1 ? [{ x: 0, y: 0, w: image.width, h: image.height }, ...tiles] : tiles;
  if (passes.length > 256) throw new Error('OCR tile count exceeds the scan budget.');
  profile?.('tile_plan',performance.now()-tileStart);
  // Tiles are coordinate views: no tile pixel buffers are extracted.
  profile?.('tile_extract',0);
  const detections: Detection[] = [];
  for (let i = 0; i < passes.length; i++) {
    const tile = passes[i]! ;
    const output = await models.detect(preprocessDetection(image, tile, tileSize, profile));
    if (output.dims.length !== 4 || output.dims[0]!  !== 1 || output.dims[1]!  !== 1)
      throw new Error('Unsupported detector output shape.');
    const height=output.dims[2]!,width=output.dims[3]!;
    for (const box of postprocessDetection(output.data, width, height, tile.w, tile.h, {profile})) {
      detections.push({ detScore: box.detScore, quad: box.quad?.map(([x,y]) => [x+tile.x,y+tile.y]), pixelRect: mapToOriginal(box.pixelRect, tile, image.width, image.height).pixelRect });
    }
    progress?.({ stage: 'detect', completed: i + 1, total: passes.length });
  }
  const mergeStart = performance.now();
  const merged = mergeDetections(detections);
  profile?.('merge_iou',performance.now()-mergeStart);
  if (merged.length > maxBoxes) throw new Error('OCR box count exceeds the scan budget; scan a smaller image or region.');
  const result: OcrBox[] = [];
  for (let i = 0; i < merged.length; i++) {
    const box = merged[i]! ;
    const recStart = performance.now();
    const input = preprocessRecognition(image, box.pixelRect, models.recognitionHeight, box.quad, profile);
    profile?.('rectify_resize_normalize_rec',performance.now()-recStart);
    const output = await models.recognize(input);
    const decoded = decodeCtc(output.data, output.dims, models.dictionary);
    if (decoded.text.trim() && decoded.recScore >= minRecScore) {
      const { x, y, w, h } = box.pixelRect;
      const pixelQuad = box.quad ?? [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
      const quad = normalizeQuad(pixelQuad as [number,number][],image.width,image.height);
      result.push({ ...box, quad, ...decoded, rect: { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height } });
    }
    progress?.({ stage: 'recognize', completed: i + 1, total: merged.length });
  }
  return result.sort((a, b) => a.pixelRect.y - b.pixelRect.y || a.pixelRect.x - b.pixelRect.x);
}
