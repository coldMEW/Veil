/**
 * Veil shared contracts v1.1 (reconciles SHELL-01's placeholder with CORE-CONTRACT-01).
 * Schema owner: Bibek. Integration reviewer: Sandeep. Physics fields: Sushant reviews.
 * Change process: propose in Decisions and Contracts first, one editor at a time.
 *
 * All coordinates are NORMALIZED (0..1) to the orientation-corrected original image.
 */

export type Execution = 'complete' | 'failed' | 'timeout' | 'unavailable';
export type Finding = 'consistent' | 'inconsistent' | 'inconclusive' | 'not_applicable';
export type EvidenceKind = 'physical' | 'model' | 'signal' | 'provenance';
export type ResultSource = 'live' | 'recorded_fixture';

export interface Point {
  x: number;
  y: number;
}

/** Normalized rectangle used by records (privacy regions, crops). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Overlay =
  | { type: 'points'; points: Point[]; label?: string }
  | { type: 'lines'; lines: Array<{ x1: number; y1: number; x2: number; y2: number }>; label?: string }
  /** Rays start at (x1,y1), pass through (x2,y2) and are extended past the image edge by the renderer. */
  | { type: 'rays'; rays: Array<{ x1: number; y1: number; x2: number; y2: number }>; label?: string }
  | { type: 'box'; x: number; y: number; width: number; height: number; label?: string }
  | { type: 'polygon'; points: Point[]; label?: string }
  /**
   * Row-major raster (e.g. model-focus map) with values in [0,1]. `rect` is the part of the image the
   * raster covers (e.g. the model's centre crop); the renderer hatches/labels everything outside it.
   */
  | {
      type: 'raster';
      width: number;
      height: number;
      values: number[];
      rect: { x: number; y: number; width: number; height: number };
      label?: string;
    };

export interface CheckResult {
  id: string;
  assetId: string;
  kind: EvidenceKind;
  execution: Execution;
  finding: Finding;
  title: string;
  observation: string;
  method: string;
  assumptions: string[];
  limitations: string[];
  evidence: Record<string, unknown>;
  overlays: Overlay[];
  source: ResultSource;
  /** Required when finding is 'inconclusive' or 'not_applicable': the plain-language reason. */
  reason?: string;
}

/** Browser-local capability state of a lazily loaded feature/model. */
export type CapabilityState = 'not_loaded' | 'loading' | 'ready' | 'failed';

export interface ImageAsset {
  /** Same value as sha256: the asset is identified by its exact bytes. */
  id: string;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png';
  byteLength: number;
  /** Size stored in the file, before EXIF orientation is applied. */
  encodedWidth: number;
  encodedHeight: number;
  /** Size after orientation correction. All overlay coordinates use this frame. */
  width: number;
  height: number;
  /** Set for derived images (cleaned, protected). Null for an original upload. */
  parentId: string | null;
  /** TransformRecord that produced this asset, if derived. */
  transformId?: string | null;
}

export type PrivacyCategory =
  | 'address'
  | 'plate'
  | 'email'
  | 'phone'
  | 'face'
  | 'room_or_id_number'
  | 'other_text'
  | 'manual';

export interface PrivacyCandidate {
  id: string;
  assetId: string;
  category: PrivacyCategory;
  sourceMethod: 'ocr' | 'mirage' | 'manual';
  /** Axis-aligned normalized region. */
  region: Rect;
  /** Optional rotated text quad (normalized). Enables glyph-level masks on tilted text. */
  quad?: Point[];
  /** 'glyph' removes only text strokes inside the quad/region; 'region' removes the whole area. */
  removal?: 'glyph' | 'region';
  /** Recognized text. In memory only: never persist, log or put in a report. */
  text?: string;
  /** Detector/recognizer score; technical details only, not a privacy guarantee. */
  score?: number;
  selected: boolean;
}

export type TransformMethod =
  | 'solid_redaction'
  | 'migan_inpaint'
  | 'lama_inpaint'
  | 'metadata_strip_reencode'
  | 'jitter_experimental'
  | 'diffvax';

export interface TransformRecord {
  id: string;
  method: TransformMethod;
  inputSha256: string;
  outputSha256: string;
  maskSha256?: string;
  maskExpansionPx?: number;
  modelSha256?: string;
  seed?: number;
  parameters: Record<string, unknown>;
  outputFormat: string;
  outputWidth: number;
  outputHeight: number;
  /** True when pixels inside the mask were replaced with model-generated content. */
  synthetic: boolean;
  createdAt: string;
}

export interface ModelManifest {
  id: string;
  upstreamUrl: string;
  revision: string;
  sha256: string;
  license: string;
  bytes: number;
  io: { inputs: Record<string, string>; outputs: Record<string, string> };
  testedBackends: Array<'webgpu' | 'wasm'>;
}

export type EvaluationArm = 'clean_control' | 'jitter_only' | 'diffvax_only' | 'combined';
export type EvaluationStatus = 'measured' | 'not_tested' | 'unavailable' | 'no_improvement_observed';

export interface EvaluationRun {
  id: string;
  fixtureId: string;
  arm: EvaluationArm;
  promptSha256: string;
  maskSha256: string;
  seed: number;
  modelRevision: string;
  config: Record<string, unknown>;
  inputSha256: string;
  outputSha256: string;
  observations: Record<string, unknown>;
  status: EvaluationStatus;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** A check that did not complete can never report anything but inconclusive. */
export function displayedFinding(result: Pick<CheckResult, 'execution' | 'finding'>): Finding {
  return result.execution === 'complete' ? result.finding : 'inconclusive';
}

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const okPoint = (p: Point | undefined) => !!p && fin(p.x) && fin(p.y);
const okSeg = (s: { x1: number; y1: number; x2: number; y2: number }) => [s.x1, s.y1, s.x2, s.y2].every(fin);
const okBox = (b: { x: number; y: number; width: number; height: number }) =>
  [b.x, b.y, b.width, b.height].every(fin) && b.width >= 0 && b.height >= 0;

export function validateOverlay(o: Overlay): string | null {
  switch (o.type) {
    case 'points':
      return o.points.every(okPoint) ? null : 'points: non-finite coordinate';
    case 'polygon':
      if (o.points.length < 3) return 'polygon: needs at least 3 points';
      return o.points.every(okPoint) ? null : 'polygon: non-finite coordinate';
    case 'lines':
      return o.lines.every(okSeg) ? null : 'lines: non-finite coordinate';
    case 'rays':
      return o.rays.every(okSeg) ? null : 'rays: non-finite coordinate';
    case 'box':
      return okBox(o) ? null : 'box: invalid box';
    case 'raster':
      if (!Number.isInteger(o.width) || !Number.isInteger(o.height) || o.width <= 0 || o.height <= 0)
        return 'raster: invalid size';
      if (o.values.length !== o.width * o.height) return 'raster: values length mismatch';
      if (!o.values.every((v) => fin(v) && v >= 0 && v <= 1)) return 'raster: values must be finite in [0,1]';
      return okBox(o.rect) ? null : 'raster: invalid rect';
    default:
      return 'unknown overlay type';
  }
}

/** Contract violations; empty means valid. */
export function validateCheckResult(r: CheckResult): string[] {
  const errors: string[] = [];
  if (!r.id) errors.push('id required');
  if (!r.assetId) errors.push('assetId required');
  if (r.execution !== 'complete' && r.finding !== 'inconclusive')
    errors.push('non-complete execution must have finding "inconclusive"');
  if ((r.finding === 'inconclusive' || r.finding === 'not_applicable') && !r.reason)
    errors.push(`finding "${r.finding}" requires a reason`);
  r.overlays.forEach((o, i) => {
    const e = validateOverlay(o);
    if (e) errors.push(`overlay[${i}] ${e}`);
  });
  return errors;
}

/** Normalize a produced result: failures become inconclusive with a reason; invalid overlays are dropped. */
export function enforceInvariants(r: CheckResult): CheckResult {
  const out: CheckResult = { ...r, overlays: [], limitations: [...r.limitations] };
  if (out.execution !== 'complete' && out.finding !== 'inconclusive') {
    out.finding = 'inconclusive';
    out.reason = out.reason ?? `Check did not complete (${out.execution}).`;
  }
  if ((out.finding === 'inconclusive' || out.finding === 'not_applicable') && !out.reason)
    out.reason = 'No reason supplied by the check.';
  let dropped = 0;
  for (const o of r.overlays) {
    if (validateOverlay(o) === null) out.overlays.push(o);
    else dropped++;
  }
  if (dropped) out.limitations.push(`${dropped} invalid overlay(s) were dropped.`);
  return out;
}
