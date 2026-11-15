export type Point = [number, number];
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface Face {
  box: { x: number; y: number; w: number; h: number };
  score: number;
  landmarks: [Point, Point, Point, Point, Point];
}
export const SAME_THRESHOLD = 0.363;
/** Lower published CFP-FP operating point; the intermediate band is a heuristic, not calibrated. */
export const POSSIBLE_THRESHOLD = 0.212;
export const DETECTION_THRESHOLD = 0.8;
export const ARC_TEMPLATE: readonly Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];
/** Least-squares orientation-preserving similarity: u=a*x-b*y+tx, v=b*x+a*y+ty. */
export function fitSimilarity(source: readonly Point[], target: readonly Point[] = ARC_TEMPLATE) {
  if (
    source.length !== 5 ||
    target.length !== 5 ||
    [...source, ...target].some((p) => p.some((v) => !Number.isFinite(v)))
  )
    throw Error('Five finite landmark pairs required.');
  const means = (p: readonly Point[]) => [
    p.reduce((s, v) => s + v[0], 0) / 5,
    p.reduce((s, v) => s + v[1], 0) / 5,
  ];
  const [sx, sy] = means(source) as Point,
    [ux, uy] = means(target) as Point;
  let aa = 0,
    bb = 0,
    d = 0;
  for (let i = 0; i < 5; i++) {
    const x = source[i]![0] - sx,
      y = source[i]![1] - sy,
      u = target[i]![0] - ux,
      v = target[i]![1] - uy;
    aa += x * u + y * v;
    bb += x * v - y * u;
    d += x * x + y * y;
  }
  if (d < 1e-8) throw Error('Degenerate landmarks.');
  const a = aa / d,
    b = bb / d;
  if (a * a + b * b < 1e-12) throw Error('Degenerate alignment.');
  return { a, b, tx: ux - a * sx + b * sy, ty: uy - b * sx - a * sy };
}
/** Bilinear sample, black outside image; alpha composited over black. */
export function pixel(p: Pixels, x: number, y: number, c: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy;
  let value = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const xx = ix + i,
        yy = iy + j;
      if (xx < 0 || yy < 0 || xx >= p.width || yy >= p.height) continue;
      const n = (yy * p.width + xx) * 4;
      value += p.data[n + c]! * (p.data[n + 3]! / 255) * (i ? dx : 1 - dx) * (j ? dy : 1 - dy);
    }
  return value;
}
/** SFace graph includes normalization; OpenCV feeds raw RGB CHW values (no extra mean/scale). */
export function alignedTensor(p: Pixels, face: Face): Float32Array {
  const points = face.landmarks.map(([x, y]) => [x * p.width, y * p.height] as Point);
  const { a, b, tx, ty } = fitSimilarity(points),
    d = a * a + b * b,
    out = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++)
    for (let x = 0; x < 112; x++) {
      const sx = (a * (x - tx) + b * (y - ty)) / d,
        sy = (-b * (x - tx) + a * (y - ty)) / d;
      for (let c = 0; c < 3; c++) out[c * 112 * 112 + y * 112 + x] = pixel(p, sx, sy, c);
    }
  return out;
}
/** YuNet input is raw BGR CHW, resized to fit 640 with bottom/right zero padding. */
export function detectorTensor(p: Pixels) {
  const scale = Math.min(640 / p.width, 640 / p.height),
    w = Math.max(1, Math.round(p.width * scale)),
    h = Math.max(1, Math.round(p.height * scale));
  const data = new Float32Array(3 * 640 * 640);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++)
        data[c * 640 * 640 + y * 640 + x] = pixel(
          p,
          ((x + 0.5) * p.width) / w - 0.5,
          ((y + 0.5) * p.height) / h - 0.5,
          2 - c,
        );
  return { data, scaleX: w / p.width, scaleY: h / p.height };
}
export function unitVector(values: ArrayLike<number>): Float32Array {
  if (values.length !== 128) throw Error('Expected 128-dimensional SFace output.');
  let d = 0;
  for (let i = 0; i < 128; i++) {
    if (!Number.isFinite(values[i])) throw Error('Non-finite embedding.');
    d += values[i]! ** 2;
  }
  if (d < 1e-16) throw Error('Zero embedding.');
  return Float32Array.from(values, (v) => v / Math.sqrt(d));
}
/** API categories describe similarity thresholds, not proof of identity. */
export function compareFaces(
  a: Float32Array,
  b: Float32Array,
): { cosine: number; match: 'same' | 'possible' | 'different' } {
  const u = unitVector(a),
    v = unitVector(b);
  let cosine = 0;
  for (let i = 0; i < 128; i++) cosine += u[i]! * v[i]!;
  cosine = Math.max(-1, Math.min(1, cosine));
  return {
    cosine,
    match: cosine >= SAME_THRESHOLD ? 'same' : cosine >= POSSIBLE_THRESHOLD ? 'possible' : 'different',
  };
}
export function nms(faces: Face[], threshold = 0.3): Face[] {
  const kept: Face[] = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (
      !kept.some((other) => {
        const a = face.box,
          b = other.box;
        const intersection =
          Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        return intersection / (a.w * a.h + b.w * b.h - intersection) > threshold;
      })
    )
      kept.push(face);
  }
  return kept;
}
/** Decode the three YuNet feature grids exactly as OpenCV FaceDetectorYN. */
export function decodeYuNet(
  outputs: Record<string, ArrayLike<number>>,
  width: number,
  height: number,
  sx: number,
  sy: number,
): Face[] {
  const faces: Face[] = [],
    clamp = (v: number) => Math.max(0, Math.min(1, v));
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`],
      obj = outputs[`obj_${stride}`],
      box = outputs[`bbox_${stride}`],
      kps = outputs[`kps_${stride}`];
    if (!cls || !obj || !box || !kps) throw Error('YuNet output missing.');
    const cols = 640 / stride;
    for (let i = 0; i < cols * cols; i++) {
      const score = Math.sqrt(clamp(cls[i]!) * clamp(obj[i]!));
      if (!Number.isFinite(score) || score < DETECTION_THRESHOLD) continue;
      const row = Math.floor(i / cols),
        col = i % cols,
        cx = ((col + box[4 * i]!) * stride) / sx,
        cy = ((row + box[4 * i + 1]!) * stride) / sy;
      const w = (Math.exp(box[4 * i + 2]!) * stride) / sx,
        h = (Math.exp(box[4 * i + 3]!) * stride) / sy;
      const x = clamp((cx - w / 2) / width),
        y = clamp((cy - h / 2) / height),
        right = clamp((cx + w / 2) / width),
        bottom = clamp((cy + h / 2) / height);
      if (right <= x || bottom <= y) continue;
      const landmarks = Array.from(
        { length: 5 },
        (_, j) =>
          [
            clamp(((col + kps[10 * i + 2 * j]!) * stride) / sx / width),
            clamp(((row + kps[10 * i + 2 * j + 1]!) * stride) / sy / height),
          ] as Point,
      ) as Face['landmarks'];
      faces.push({ box: { x, y, w: right - x, h: bottom - y }, score, landmarks });
    }
  }
  return nms(faces);
}
