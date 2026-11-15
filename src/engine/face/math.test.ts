import { describe, it, expect } from 'vitest';
import {
  ARC_TEMPLATE,
  fitSimilarity,
  compareFaces,
  nms,
  alignedTensor,
  detectorTensor,
  unitVector,
  type Face,
  type Point,
} from './math';
const face = (score = 0.9, x = 0.1): Face => ({
  box: { x, y: 0.1, w: 0.3, h: 0.4 },
  score,
  landmarks: ARC_TEMPLATE.map(([x, y]) => [x / 112, y / 112]) as Face['landmarks'],
});
describe('face math', () => {
  it('recovers rotation scale translation using all five landmarks', () => {
    const a = 1.7,
      b = 0.4,
      tx = 9,
      ty = -12;
    const points = ARC_TEMPLATE.map(
      ([u, v]) =>
        [
          ((u - tx) * a + (v - ty) * b) / (a * a + b * b),
          (-(u - tx) * b + (v - ty) * a) / (a * a + b * b),
        ] as Point,
    );
    const t = fitSimilarity(points);
    expect(t.a).toBeCloseTo(a, 8);
    expect(t.b).toBeCloseTo(b, 8);
    expect(t.tx).toBeCloseTo(tx, 8);
    expect(t.ty).toBeCloseTo(ty, 8);
  });
  it('rejects degenerate landmarks', () =>
    expect(() => fitSimilarity(Array.from({ length: 5 }, () => [1, 1] as Point))).toThrow());
  it('classifies similarity bands without requiring already normalized input', () => {
    const a = new Float32Array(128);
    a[0] = 1;
    const vector = (cos: number) => {
      const b = new Float32Array(128);
      b[0] = cos;
      b[1] = Math.sqrt(1 - cos * cos);
      return b;
    };
    expect(compareFaces(a, a).match).toBe('same');
    expect(compareFaces(a, vector(0.3)).match).toBe('possible');
    expect(compareFaces(a, vector(0.1)).match).toBe('different');
  });
  it('rejects invalid embeddings', () => {
    expect(() => unitVector(new Float32Array(128))).toThrow();
    expect(() => unitVector(new Float32Array(127))).toThrow();
  });
  it('NMS keeps strongest duplicate and spatially separate face', () =>
    expect(nms([face(0.85), face(0.95), face(0.9, 0.7)])).toHaveLength(2));
  it('alignment uses RGB raw values and detector uses BGR', () => {
    const data = new Uint8ClampedArray(112 * 112 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 20;
      data[i + 1] = 50;
      data[i + 2] = 90;
      data[i + 3] = 255;
    }
    const p = { width: 112, height: 112, data };
    const r = alignedTensor(p, face());
    expect(r[50 * 112 + 50]).toBeCloseTo(20);
    expect(r[112 * 112 + 50 * 112 + 50]).toBeCloseTo(50);
    expect(detectorTensor(p).data[100 * 640 + 100]).toBeCloseTo(90);
  });
});
