import type { PrivacyCandidate, Rect, TransformMethod, TransformRecord } from '../../contracts';
import { DEFAULT_SELECTED, classifyText } from './filter';
import { dilate, emptyMask, fillRect, type Mask, type Pixels } from './mask';
import { solidRedact, type RGB } from './redact';
import { maskSha256, sha256Hex } from './hash';
import { encodePng, verifyExport, type ExportVerification } from './export';

/** Shape produced by the OCR engine (src/features/clean/ocr). */
export interface OcrBox {
  rect: Rect; // normalized to the orientation-corrected original
  text: string;
  detScore?: number;
  recScore?: number;
}

let seq = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** OCR boxes -> privacy candidates. Text stays in memory only. */
export function candidatesFromOcr(assetId: string, boxes: OcrBox[]): PrivacyCandidate[] {
  return boxes.map((b) => {
    const { category } = classifyText(b.text);
    return {
      id: newId('cand'),
      assetId,
      category,
      sourceMethod: 'ocr',
      region: b.rect,
      text: b.text,
      score: b.recScore,
      selected: DEFAULT_SELECTED.has(category),
    };
  });
}

export function manualCandidate(assetId: string, region: Rect, category: PrivacyCandidate['category'] = 'manual'): PrivacyCandidate {
  return { id: newId('cand'), assetId, category, sourceMethod: 'manual', region, selected: true };
}

/** Build the approved removal mask: selected candidate regions + painted mask, dilated by `expansionPx`. */
export function buildApprovedMask(
  width: number,
  height: number,
  candidates: PrivacyCandidate[],
  painted: Mask | null,
  expansionPx: number,
): Mask {
  const m = emptyMask(width, height);
  for (const c of candidates) if (c.selected) fillRect(m, c.region);
  if (painted) for (let i = 0; i < m.data.length; i++) if (painted.data[i]) m.data[i] = 1;
  return dilate(m, expansionPx);
}

/**
 * Default expansion: ~15% of the median selected OCR box height (tight detector boxes miss glyph edges),
 * at least 2 px, capped at 24 px. Manual boxes already include the user's margin, so they get 2 px.
 */
export function defaultExpansionPx(candidates: PrivacyCandidate[], height: number): number {
  const hs = candidates
    .filter((c) => c.selected && c.sourceMethod === 'ocr')
    .map((c) => c.region.h * height)
    .sort((a, b) => a - b);
  if (!hs.length) return 2;
  return Math.min(24, Math.max(2, Math.round(hs[Math.floor(hs.length / 2)]! * 0.15)));
}

export interface Inpainter {
  inpaint(src: Pixels, mask: Mask): Promise<{ pixels: Pixels }>;
}

export interface CleanOutput {
  pixels: Pixels;
  bytes: Uint8Array;
  verification: ExportVerification;
  transforms: TransformRecord[];
}

/**
 * Remove the approved region and export a fresh, metadata-free PNG, then verify the exported bytes.
 * `method` 'solid_redaction' never needs a model; 'migan_inpaint' requires `inpainter`.
 * Re-scan of target regions is done by the caller with the OCR engine on `verification.decoded`.
 */
export async function runClean(opts: {
  src: Pixels;
  srcSha256: string;
  mask: Mask;
  expansionPx: number;
  method: Extract<TransformMethod, 'solid_redaction' | 'migan_inpaint'>;
  inpainter?: Inpainter;
  modelSha256?: string;
  color?: RGB;
}): Promise<CleanOutput> {
  const { src, mask, method } = opts;
  let pixels: Pixels;
  if (method === 'migan_inpaint') {
    if (!opts.inpainter) throw new Error('migan_inpaint requires a loaded inpainter');
    pixels = (await opts.inpainter.inpaint(src, mask)).pixels;
  } else {
    pixels = solidRedact(src, mask, opts.color ?? [0, 0, 0]);
  }
  const bytes = await encodePng(pixels);
  const verification = await verifyExport(pixels, bytes);
  const now = new Date().toISOString();
  const mHash = await maskSha256(mask);
  const removal: TransformRecord = {
    id: newId('tx'),
    method,
    inputSha256: opts.srcSha256,
    outputSha256: verification.sha256,
    maskSha256: mHash,
    maskExpansionPx: opts.expansionPx,
    modelSha256: method === 'migan_inpaint' ? opts.modelSha256 : undefined,
    parameters: method === 'solid_redaction' ? { color: opts.color ?? [0, 0, 0] } : {},
    outputFormat: 'image/png',
    outputWidth: pixels.width,
    outputHeight: pixels.height,
    synthetic: method === 'migan_inpaint',
    createdAt: now,
  };
  const reencode: TransformRecord = {
    id: newId('tx'),
    method: 'metadata_strip_reencode',
    inputSha256: opts.srcSha256,
    outputSha256: verification.sha256,
    parameters: { metadataBlocksInOutput: verification.metadata.metadataBlocks },
    outputFormat: 'image/png',
    outputWidth: pixels.width,
    outputHeight: pixels.height,
    synthetic: false,
    createdAt: now,
  };
  return { pixels, bytes, verification, transforms: [removal, reencode] };
}

export interface RescanResult {
  /** Selected candidate ids whose region still has detected text in the exported image. */
  stillDetected: string[];
  /** Total boxes detected anywhere in the exported image. */
  totalBoxes: number;
}

/** Compare a re-scan of the exported bytes against the originally selected target regions. */
export function compareRescan(selected: PrivacyCandidate[], rescan: OcrBox[], minOverlap = 0.3): RescanResult {
  const overlap = (a: Rect, b: Rect) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / Math.max(1e-12, Math.min(a.w * a.h, b.w * b.h));
  };
  const still = selected
    .filter((c) => c.selected && rescan.some((b) => b.text.trim().length > 0 && overlap(c.region, b.rect) >= minOverlap))
    .map((c) => c.id);
  return { stillDetected: still, totalBoxes: rescan.length };
}

export { sha256Hex };
