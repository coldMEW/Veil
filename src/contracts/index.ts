// DRAFT shared contract, placed by SHELL-01 so the shell can render cards.
// Schema owner: Bibek (CORE-CONTRACT-01). Replace freely; the shell will follow.
// Change process: propose in Decisions and Contracts first, one editor at a time.

export type Execution = 'complete' | 'failed' | 'timeout' | 'unavailable';
export type Finding = 'consistent' | 'inconsistent' | 'inconclusive' | 'not_applicable';
export type EvidenceKind = 'physical' | 'model' | 'signal' | 'provenance';

/** Coordinates are normalized (0..1) to the orientation-corrected original image. */
export type Overlay =
  | { type: 'points'; points: Array<{ x: number; y: number }>; label?: string }
  | { type: 'lines'; lines: Array<{ x1: number; y1: number; x2: number; y2: number }>; label?: string }
  | { type: 'box'; x: number; y: number; width: number; height: number; label?: string };

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
  source: 'live' | 'recorded_fixture';
}

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
}

/** A check that did not complete can never report anything but inconclusive. */
export function displayedFinding(result: Pick<CheckResult, 'execution' | 'finding'>): Finding {
  return result.execution === 'complete' ? result.finding : 'inconclusive';
}
