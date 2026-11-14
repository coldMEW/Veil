import type { PrivacyCandidate, Point, Rect, TransformMethod, TransformRecord } from '../../contracts';
import { DEFAULT_SELECTED, classifyText } from './filter';
import { dilate, emptyMask, fillHoles, fillRect, type Mask, type Pixels } from './mask';
import { solidRedact, type RGB } from './redact';
import { maskSha256, sha256Hex } from './hash';
import { encodePng, verifyExport, type ExportVerification } from './export';
import { glyphMask, polygonMask } from './glyph';

/** Shape produced by the OCR engine (src/features/clean/ocr). */
export interface OcrBox {
  rect: Rect; // normalized to the orientation-corrected original
  text: string;
  quad?: Point[];
  detScore?: number;
  recScore?: number;
}

/**
 * Tuned on real phone photos (street signs, room numbers): sample the background inside a slightly grown
 * text quad, mask only text-coloured pixels, dilate in proportion to text height (blurred photo text has a
 * soft halo), and clip to a modestly grown quad so nearby edges/structures are never repainted.
 */
export const TEXT_REMOVAL_DEFAULTS = {
  threshold: 30,
  dilateFraction: 0.2,
  dilateMaxPx: 20,
  dilateMinPx: 4,
  sampleGrow: [1.06, 1.08] as const,
  clipGrow: [1.1, 1.12] as const,
  /** Thin glyph holes inpaint sharpest at native resolution (up to this side length). */
  inpaintMaxSide: 1400,
};

function growQuad(quad: Point[], fx: number, fy: number): Point[] {
  const cx = quad.reduce((s, p) => s + p.x, 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p.y, 0) / quad.length;
  return quad.map((p) => ({ x: cx + (p.x - cx) * fx, y: cy + (p.y - cy) * fy }));
}

function quadOf(c: PrivacyCandidate): Point[] {
  return (
    c.quad ?? [
      { x: c.region.x, y: c.region.y },
      { x: c.region.x + c.region.w, y: c.region.y },
      { x: c.region.x + c.region.w, y: c.region.y + c.region.h },
      { x: c.region.x, y: c.region.y + c.region.h },
    ]
  );
}

/**
 * One combined removal mask for all selected candidates. 'glyph' candidates (default for OCR text) remove
 * only text strokes; 'region' and manual candidates remove the whole region. Inpaint the union ONCE:
 * re-inpainting overlapping crops one by one creates artefacts.
 */
export function textRemovalMask(
  src: Pixels,
  candidates: PrivacyCandidate[],
  opts: Partial<typeof TEXT_REMOVAL_DEFAULTS> = {},
): { mask: Mask; dilatePx: number } {
  const o = { ...TEXT_REMOVAL_DEFAULTS, ...opts };
  const out = emptyMask(src.width, src.height);
  let maxDil = 0;
  for (const c of candidates) {
    if (!c.selected) continue;
    if (c.removal === 'region' || c.sourceMethod === 'manual') {
      fillRect(out, c.region);
      continue;
    }
    const quad = quadOf(c);
    const d = Math.min(o.dilateMaxPx, Math.max(o.dilateMinPx, Math.round(o.dilateFraction * c.region.h * src.height)));
    maxDil = Math.max(maxDil, d);
    const g = glyphMask(src, growQuad(quad, o.sampleGrow[0], o.sampleGrow[1]), { threshold: o.threshold, dilatePx: d }).mask;
    const clip = polygonMask(growQuad(quad, o.clipGrow[0], o.clipGrow[1]), src.width, src.height);
    for (let i = 0; i < g.data.length; i++) if (g.data[i] && clip.data[i]) out.data[i] = 1;
  }
  return { mask: fillHoles(out), dilatePx: maxDil };
}

let seq = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * Minimum recognizer score for a candidate to be PRE-selected. Low-confidence reads are often false
 * detections on faces, hair or texture (measured on a real selfie: a 0.58 "number" on a forehead vs 0.985+
 * for the real room number). They are still listed for the person to review, just not pre-selected.
 */
export const AUTO_SELECT_MIN_SCORE = 0.85;
export const PLATE_AUTO_SELECT_MIN_SCORE = 0.5;

/** OCR boxes -> privacy candidates. Text stays in memory only. */
export function candidatesFromOcr(assetId: string, boxes: OcrBox[]): PrivacyCandidate[] {
  return boxes.map((b) => {
    const { category } = classifyText(b.text);
    // Plate-shaped reads (5-8 mixed letters+digits) almost never come from faces/texture, and small real
    // plates read with low scores, so they are pre-selected from a lower score.
    const minScore = category === 'plate' ? PLATE_AUTO_SELECT_MIN_SCORE : AUTO_SELECT_MIN_SCORE;
    const confident = (b.recScore ?? 0) >= minScore;
    return {
      id: newId('cand'),
      assetId,
      category,
      sourceMethod: 'ocr',
      region: b.rect,
      quad: b.quad?.map(p => ({...p})),
      removal: 'glyph',
      text: b.text,
      score: b.recScore,
      selected: DEFAULT_SELECTED.has(category) && confident,
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
  inpaint(src: Pixels, mask: Mask, opts?: { maxSide?: number }): Promise<{ pixels: Pixels }>;
}

export interface CleanOutput {
  pixels: Pixels;
  bytes: Uint8Array;
  verification: ExportVerification;
  transforms: TransformRecord[];
}

/**
 * Find inpainted pixels whose luma lies far outside the range of the real background just around the mask
 * (1st..99th percentile of an 8-px ring, widened by `margin`). Returns a dilated mask of those pixels
 * (restricted to the original mask), or null when the fill is plausible.
 */
export function fillOutliers(pixels: Pixels, mask: Mask, margin = 35, minBlob = 6): Mask | null {
  const { width: w } = pixels;
  const ring = dilate(mask, 8);
  const lum = (i: number) => 0.299 * pixels.data[i * 4]! + 0.587 * pixels.data[i * 4 + 1]! + 0.114 * pixels.data[i * 4 + 2]!;
  const ringL: number[] = [];
  for (let i = 0; i < ring.data.length; i++) if (ring.data[i] && !mask.data[i]) ringL.push(lum(i));
  if (ringL.length < 50) return null;
  ringL.sort((a, b) => a - b);
  const lo = ringL[Math.floor(ringL.length * 0.01)]! - margin;
  const hi = ringL[Math.floor(ringL.length * 0.99)]! + margin;
  const out = emptyMask(w, pixels.height);
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    const L = lum(i);
    if (L < lo || L > hi) {
      out.data[i] = 1;
      n++;
    }
  }
  if (n < minBlob) return null;
  const grown = dilate(out, 6);
  for (let i = 0; i < grown.data.length; i++) if (!mask.data[i]) grown.data[i] = 0;
  return grown;
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
  /** Max model input side. 512 for large regions; TEXT_REMOVAL_DEFAULTS.inpaintMaxSide for thin glyph masks. */
  inpaintMaxSide?: number;
  modelSha256?: string;
  color?: RGB;
}): Promise<CleanOutput> {
  const { src, mask, method } = opts;
  let pixels: Pixels;
  if (method === 'migan_inpaint') {
    if (!opts.inpainter) throw new Error('migan_inpaint requires a loaded inpainter');
    const maxSide = opts.inpaintMaxSide ?? 512;
    pixels = (await opts.inpainter.inpaint(src, mask, { maxSide })).pixels;
    // Repair pass: MI-GAN occasionally emits a small near-white/near-black blob that depends on the working
    // resolution (measured on a real photo: present at 512/768/1400, absent at 1024). Pixels far outside the
    // brightness range of the real background ring are re-inpainted once at a different resolution.
    const alts = maxSide === 1024 ? [768, 512] : [1024, 768];
    for (const alt of alts) {
      const outliers = fillOutliers(pixels, mask);
      if (!outliers) break;
      pixels = (await opts.inpainter.inpaint(pixels, outliers, { maxSide: alt })).pixels;
    }
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

/** Scan decoded exported pixels; scanner failures propagate and never imply a clean result. */
export async function rescanExport(engine: {scan(pixels: Pixels): Promise<OcrBox[]>}, decodedPixels: Pixels, selected: PrivacyCandidate[]): Promise<RescanResult> {
  return compareRescan(selected, await engine.scan(decodedPixels));
}
