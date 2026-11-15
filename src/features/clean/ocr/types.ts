import type { Rect, Point, PrivacyCategory } from '../../../contracts';

/** Rect-shaped geometry in SOURCE PIXELS, not normalized coordinates. */
export type PixelRect = Rect;
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
export interface Detection {
  pixelRect: PixelRect;
  detScore: number;
  quad?: [number, number][];
}
export interface OcrBox extends Omit<Detection, 'quad'> {
  rect: Rect;
  quad: [Point, Point, Point, Point];
  category?: PrivacyCategory;
  text: string;
  recScore: number;
}
export interface TensorData {
  data: Float32Array;
  dims: readonly number[];
}
export interface ScanOptions {
  /** Extra counterclockwise quarter-turn detector pass for steep/vertical lines. */
  rotateTiles?: boolean;
  tileSize?: number;
  overlap?: number;
  wholeImagePass?: boolean;
  /** Detect all candidates; fail explicitly instead of silently truncating beyond this budget. */
  maxBoxes?: number;
  minRecScore?: number;
}
export interface ScanProgress {
  stage: 'detect' | 'recognize';
  completed: number;
  total: number;
}
export interface OcrModels {
  detect(input: TensorData): Promise<TensorData>;
  recognize(input: TensorData): Promise<TensorData>;
  dictionary: string[];
  recognitionHeight: number;
}

export type Profile = (stage: string, ms: number) => void;
