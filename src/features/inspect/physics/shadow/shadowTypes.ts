export interface ShadowPair {
  id: string;
  object: { x: number; y: number };
  shadow: { x: number; y: number };
}

// TEMP mirror of contracts v1.1, replace with import when PR #5 merges
export type Execution = 'complete' | 'failed' | 'timeout' | 'unavailable';
export type Finding = 'consistent' | 'inconsistent' | 'inconclusive' | 'not_applicable';
export type EvidenceKind = 'physical' | 'model' | 'signal' | 'provenance';
export type ResultSource = 'live' | 'recorded_fixture';

export interface Point {
  x: number;
  y: number;
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

export type HomogeneousPoint = [number, number, number];

export interface ShadowSolveOptions {
  /** Unit homogeneous w at or below this magnitude is treated as infinity. Default 1e-8. */
  infinityEpsilon?: number;
  /** Optional dimensions restore pixel-plane angles on non-square images. */
  imageSize?: { width: number; height: number };
  /** Explicitly retain finite annotations outside a crop; defaults to false for direct image input. */
  allowOffImagePoints?: boolean;
}

export interface ShadowCheckOptions extends ShadowSolveOptions {
  /** Acute line-angle tolerance in the selected coordinate frame; default 5 degrees. */
  toleranceDeg?: number;
}

export interface ShadowConditioning {
  illConditioned: boolean;
  /** Ascending eigenvalues of the mean line normal matrix. */
  eigenvalues: HomogeneousPoint;
  /** Second / largest eigenvalue; near zero means insufficient independent constraints. */
  rankRatio: number;
  /** (Second - smallest) / largest; near zero means an ambiguous minimizing direction. */
  gapRatio: number;
  reason?: string;
}

export interface ShadowSolution {
  /** w=1 for finite light; w=0 and unit xy for infinity; null when no stable estimate exists. */
  lightPoint: HomogeneousPoint | null;
  /** In accepted input order; angles are undirected (0..90 degrees). Null means undefined. */
  perPairResidual: Array<{ pairId: string; residualDeg: number | null }>;
  maxResidual: number | null;
  conditioning: ShadowConditioning;
  usedPairIds: string[];
  droppedPairs: Array<{ pairId: string; reason: string }>;
}
