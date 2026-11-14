import type { OcrBox, RgbaImage, ScanOptions, ScanProgress } from './types';

export type WorkerRequest = { type: 'load'; baseUrl: string; detVariant: 'v3' | 'v5' } | { type: 'scan'; image: RgbaImage; options: ScanOptions };
export type WorkerResponse = { type: 'loaded' } | { type: 'result'; boxes: OcrBox[] } |
  { type: 'progress'; progress: ScanProgress } | { type: 'error'; message: string };
