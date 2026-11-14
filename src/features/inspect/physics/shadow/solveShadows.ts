import type { HomogeneousPoint, Point, ShadowConditioning, ShadowPair, ShadowSolution, ShadowSolveOptions } from './shadowTypes';

type Axis = 0 | 1 | 2;
type Matrix3 = [HomogeneousPoint, HomogeneousPoint, HomogeneousPoint];
const axes = [0, 1, 2] as const;
const MIN_PAIR_LENGTH = 0.01;
const MIN_CONDITION_RATIO = 1e-6;

/** Jacobi rotations diagonalize a symmetric 3x3 matrix, accumulating eigenvectors as columns. */
function symmetricEigen(input: Matrix3) {
  const a: Matrix3 = [[...input[0]], [...input[1]], [...input[2]]];
  const vectors: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let converged = false;
  for (let iteration = 0; iteration < 64; iteration++) {
    let p: Axis = 0;
    let q: Axis = 1;
    for (const [i, j] of [[0, 2], [1, 2]] as const) {
      if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    }
    const scale = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]);
    if (Math.abs(a[p][q]) <= 1e-14 * Math.max(scale, Number.EPSILON)) {
      converged = true;
      break;
    }
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
    const c = 1 / Math.hypot(1, t);
    const s = t * c;
    for (const k of axes) {
      if (k !== p && k !== q) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = a[p][k] = c * akp - s * akq;
        a[k][q] = a[q][k] = s * akp + c * akq;
      }
      const vkp = vectors[k][p];
      const vkq = vectors[k][q];
      vectors[k][p] = c * vkp - s * vkq;
      vectors[k][q] = s * vkp + c * vkq;
    }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
  }
  const order = [...axes].sort((i, j) => a[i][i] - a[j][j]);
  const i = order[0]!;
  const j = order[1]!;
  const k = order[2]!;
  const eigenvalues: HomogeneousPoint = [Math.max(0, a[i][i]), Math.max(0, a[j][j]), Math.max(0, a[k][k])];
  const vector: HomogeneousPoint = [vectors[0][i], vectors[1][i], vectors[2][i]];
  return { eigenvalues, vector, converged };
}

function validPoint(point: Point, allowOffImagePoints: boolean): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && (allowOffImagePoints || (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
}

function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-12;
}

function coordinateScale(imageSize: ShadowSolveOptions['imageSize']): [number, number] {
  if (!imageSize) return [1, 1];
  const maxSide = Math.max(imageSize.width, imageSize.height);
  return [imageSize.width / maxSide, imageSize.height / maxSide];
}

/** Undirected line angle, evaluated at the object point; inputs must already be validated. */
export function shadowAngularResidual(
  pair: ShadowPair, light: HomogeneousPoint, imageSize?: ShadowSolveOptions['imageSize'],
): number | null {
  const [sx, sy] = coordinateScale(imageSize);
  const dx = (pair.shadow.x - pair.object.x) * sx;
  const dy = (pair.shadow.y - pair.object.y) * sy;
  const lx = (light[0] - light[2] * pair.object.x) * sx;
  const ly = (light[1] - light[2] * pair.object.y) * sy;
  return Math.hypot(lx, ly) <= 1e-12 ? null
    : Math.atan2(Math.abs(dx * ly - dy * lx), Math.abs(dx * lx + dy * ly)) * 180 / Math.PI;
}

/**
 * Bounded shadow-to-object line constraint, based on Kee/O'Brien/Farid:
 * https://hfarid.org/downloads/publications/tog13/tog13.pdf
 * This is homogeneous least squares, not the paper's wedge-feasibility algorithm.
 * Minimize ||L h|| with ||h||=1, using the smallest eigenvector of L^T L.
 * Each row [a,b,c] has unit (a,b), so segment length does not weight a marking.
 * Optional imageSize restores pixel-plane angles; otherwise angles use normalized coordinates.
 */
export function solveShadows(pairs: readonly ShadowPair[], opts: ShadowSolveOptions = {}): ShadowSolution {
  const infinityEpsilon = opts.infinityEpsilon ?? 1e-8;
  if (!Number.isFinite(infinityEpsilon) || infinityEpsilon <= 0 || infinityEpsilon > 1e-3) {
    throw new RangeError('infinityEpsilon must be finite, greater than 0 and at most 0.001.');
  }
  if (opts.imageSize && (!Number.isSafeInteger(opts.imageSize.width) || !Number.isSafeInteger(opts.imageSize.height)
    || opts.imageSize.width <= 0 || opts.imageSize.height <= 0)) {
    throw new RangeError('Image dimensions must be positive safe integers.');
  }
  const [sx, sy] = coordinateScale(opts.imageSize);
  const used: ShadowPair[] = [];
  const ids = new Set<string>();
  const droppedPairs: ShadowSolution['droppedPairs'] = [];
  for (const pair of pairs) {
    if (!pair.id || ids.has(pair.id)) throw new RangeError('Object-shadow pair ids must be nonempty and unique.');
    ids.add(pair.id);
    if (!validPoint(pair.object, opts.allowOffImagePoints ?? false)
      || !validPoint(pair.shadow, opts.allowOffImagePoints ?? false)) {
      throw new RangeError('Object-shadow coordinates must be finite normalized values in [0,1].');
    }
    if (Math.hypot(pair.object.x - pair.shadow.x, pair.object.y - pair.shadow.y) < MIN_PAIR_LENGTH) {
      droppedPairs.push({ pairId: pair.id, reason: 'degenerate segment: length below 0.01' });
    } else if (used.some((other) =>
      (samePoint(pair.object, other.object) && samePoint(pair.shadow, other.shadow))
      || (samePoint(pair.object, other.shadow) && samePoint(pair.shadow, other.object)))) {
      droppedPairs.push({ pairId: pair.id, reason: 'duplicate correspondence' });
    } else {
      used.push(pair);
    }
  }

  const normal: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const pair of used) {
    const dx = (pair.shadow.x - pair.object.x) * sx;
    const dy = (pair.shadow.y - pair.object.y) * sy;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length === 0) {
      throw new RangeError('Object-shadow normalized coordinates exceed the supported numeric range.');
    }
    const a = -dy / length;
    const b = dx / length;
    const line: HomogeneousPoint = [a, b, -a * pair.object.x * sx - b * pair.object.y * sy];
    for (const i of axes) for (const j of axes) normal[i][j] += line[i] * line[j] / used.length;
  }
  if (normal.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new RangeError('Object-shadow normalized coordinates exceed the supported numeric range.');
  }
  const { eigenvalues, vector, converged } = symmetricEigen(normal);
  const largest = eigenvalues[2];
  const rankRatio = largest > 0 ? eigenvalues[1] / largest : 0;
  const gapRatio = largest > 0 ? (eigenvalues[1] - eigenvalues[0]) / largest : 0;
  const conditioning: ShadowConditioning = { eigenvalues, rankRatio, gapRatio, illConditioned: false };
  if (used.length < 2 || rankRatio < MIN_CONDITION_RATIO || gapRatio < MIN_CONDITION_RATIO || !converged) {
    conditioning.illConditioned = true;
    conditioning.reason = !converged ? 'ill-conditioned: eigensolver did not converge.'
      : 'ill-conditioned: insufficient independent line constraints or ambiguous light direction.';
    return { lightPoint: null, perPairResidual: [], maxResidual: null,
      conditioning, usedPairIds: used.map((pair) => pair.id), droppedPairs };
  }

  let lightPoint: HomogeneousPoint;
  if (Math.abs(vector[2]) <= infinityEpsilon) {
    const length = Math.hypot(vector[0] / sx, vector[1] / sy);
    const sign = Math.abs(vector[0]) > 1e-12 ? Math.sign(vector[0]) : Math.sign(vector[1]);
    lightPoint = [vector[0] * sign / (sx * length), vector[1] * sign / (sy * length), 0];
  } else {
    lightPoint = [vector[0] / (vector[2] * sx), vector[1] / (vector[2] * sy), 1];
  }
  if (!lightPoint.every(Number.isFinite)) {
    throw new RangeError('The projected light exceeds the supported numeric range.');
  }
  const perPairResidual = used.map((pair) => ({
    pairId: pair.id, residualDeg: shadowAngularResidual(pair, lightPoint, opts.imageSize),
  }));
  if (perPairResidual.some((residual) => residual.residualDeg === null)) {
    conditioning.illConditioned = true;
    conditioning.reason = 'ill-conditioned: projected light coincides with a marked object point; angular direction is undefined.';
    return { lightPoint: null, perPairResidual, maxResidual: null,
      conditioning, usedPairIds: used.map((pair) => pair.id), droppedPairs };
  }
  const maxResidual = perPairResidual.reduce((max, residual) => Math.max(max, residual.residualDeg ?? 0), 0);
  return { lightPoint, perPairResidual, maxResidual, conditioning,
    usedPairIds: used.map((pair) => pair.id), droppedPairs };
}
