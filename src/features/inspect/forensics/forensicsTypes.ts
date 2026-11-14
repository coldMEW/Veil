import type { CheckResult } from '../../../contracts';
import type { AnalysisGeometry, PixelImage } from './grid';
import type { ForensicsId } from './results';

export type ForensicsState =
  | { status: 'idle'; checkResult?: undefined; message?: undefined }
  | { status: 'running'; checkResult?: undefined; message?: undefined }
  | { status: 'done'; checkResult: CheckResult; message?: undefined }
  | { status: 'failed'; checkResult: CheckResult; message: string };

export interface ForensicsStates {
  ela: ForensicsState;
  noise: ForensicsState;
  thumbnail: ForensicsState;
}

interface RequestBase { id: number; assetId: string }
export type ForensicsRequest = RequestBase & (
  | { type: 'start'; image: PixelImage; mimeType: string; geometry: AnalysisGeometry }
  | { type: 'ela'; image: PixelImage; recompressed: PixelImage; geometry: AnalysisGeometry }
  | { type: 'thumbnail'; thumb: PixelImage; main: PixelImage }
);

export type ForensicsResponse =
  | { type: 'result'; id: number; check: ForensicsId; result: CheckResult }
  | { type: 'needs-ela'; id: number; image: PixelImage; geometry: AnalysisGeometry };
