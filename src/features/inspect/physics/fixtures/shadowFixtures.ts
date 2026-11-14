import type { Point } from '../../../../contracts';

/**
 * Independent acceptance fixtures for the shadow-geometry check (G2).
 * Written separately from the solver so the solver is tested against cases it did not shape.
 *
 * Geometry: in the image plane, the line through a shadow point and its object point passes through
 * the projected light position (Kee, O'Brien, Farid 2013). With one dominant light, all such lines
 * meet at one point (possibly at infinity: parallel lines, e.g. distant sun with an orthographic-ish view).
 *
 * Coordinates are NORMALIZED (0..1) to the orientation-corrected image; geometry is defined in PIXELS
 * via `image`, because normalized x and y are scaled differently on non-square images.
 */

export interface ShadowPair {
  object: Point;
  shadow: Point;
}

export type ExpectedOutcome =
  | 'consistent'
  | 'inconsistent'
  | 'inconclusive'
  /** Input must be rejected before solving, with a readable reason. */
  | 'rejected';

export type ReasonCode =
  | 'single_light_fits'
  | 'light_at_infinity'
  | 'outlier_pair'
  | 'multiple_lights'
  | 'duplicate_pair'
  | 'near_zero_segment'
  | 'underconstrained'
  | 'non_finite';

export interface ShadowFixture {
  id: string;
  image: { width: number; height: number };
  pairs: ShadowPair[];
  expected: ExpectedOutcome;
  reasonCode: ReasonCode;
  /** For valid finite-light fixtures: projected light position in PIXELS (may lie outside the image). */
  lightPx?: { x: number; y: number };
  /** Index of the pair that breaks consistency, for outlier fixtures. */
  outlierIndex?: number;
  notes: string;
}

const W = 1200;
const H = 800;
const n = (px: number, py: number, w = W, h = H): Point => ({ x: px / w, y: py / h });

/** Shadow point placed beyond the object along the ray from the light, at distance `len` px. */
function pairFromLight(light: { x: number; y: number }, objPx: { x: number; y: number }, len: number, w = W, h = H): ShadowPair {
  const dx = objPx.x - light.x;
  const dy = objPx.y - light.y;
  const d = Math.hypot(dx, dy);
  return { object: n(objPx.x, objPx.y, w, h), shadow: n(objPx.x + (dx / d) * len, objPx.y + (dy / d) * len, w, h) };
}

/** Deterministic pseudo-random in [-1,1] (no Math.random: fixtures must be stable). */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
}

const LIGHT = { x: 600, y: -900 };
const OBJECTS = [
  { x: 200, y: 450 },
  { x: 450, y: 520 },
  { x: 700, y: 480 },
  { x: 950, y: 560 },
  { x: 1100, y: 430 },
];

const validPairs = OBJECTS.map((o) => pairFromLight(LIGHT, o, 140));

const noisyPairs = validPairs.map((p, i) => ({
  object: { x: p.object.x + (1.5 * jitter(4 * i)) / W, y: p.object.y + (1.5 * jitter(4 * i + 1)) / H },
  shadow: { x: p.shadow.x + (1.5 * jitter(4 * i + 2)) / W, y: p.shadow.y + (1.5 * jitter(4 * i + 3)) / H },
}));

function rotatedShadow(pair: ShadowPair, deg: number): ShadowPair {
  const ox = pair.object.x * W;
  const oy = pair.object.y * H;
  const sx = pair.shadow.x * W - ox;
  const sy = pair.shadow.y * H - oy;
  const r = (deg * Math.PI) / 180;
  return { object: pair.object, shadow: n(ox + sx * Math.cos(r) - sy * Math.sin(r), oy + sx * Math.sin(r) + sy * Math.cos(r)) };
}
const outlier = rotatedShadow(pairFromLight(LIGHT, { x: 820, y: 650 }, 140), 25);

const SUN_DIR = { x: Math.cos((70 * Math.PI) / 180), y: Math.sin((70 * Math.PI) / 180) };
const parallelPairs: ShadowPair[] = OBJECTS.map((o) => ({
  object: n(o.x, o.y),
  shadow: n(o.x + SUN_DIR.x * 150, o.y + SUN_DIR.y * 150),
}));

const LIGHT_A = { x: -500, y: -400 };
const LIGHT_B = { x: 1700, y: -400 };
const twoLightPairs: ShadowPair[] = [
  pairFromLight(LIGHT_A, { x: 150, y: 500 }, 150),
  pairFromLight(LIGHT_A, { x: 320, y: 600 }, 150),
  pairFromLight(LIGHT_A, { x: 480, y: 450 }, 150),
  pairFromLight(LIGHT_B, { x: 720, y: 450 }, 150),
  pairFromLight(LIGHT_B, { x: 880, y: 600 }, 150),
  pairFromLight(LIGHT_B, { x: 1050, y: 500 }, 150),
];

const CROP = { x: 100, y: 300, w: 1000, h: 400 };
const ZW = CROP.w * 2;
const ZH = CROP.h * 2;
const toCrop = (p: Point): Point => ({ x: (p.x * W - CROP.x) / CROP.w, y: (p.y * H - CROP.y) / CROP.h });
const croppedPairs = validPairs.map((p) => ({ object: toCrop(p.object), shadow: toCrop(p.shadow) }));

export const SHADOW_FIXTURES: ShadowFixture[] = [
  {
    id: 'valid-finite-light',
    image: { width: W, height: H },
    pairs: validPairs,
    expected: 'consistent',
    reasonCode: 'single_light_fits',
    lightPx: LIGHT,
    notes: '5 exact pairs from one light projected above the image.',
  },
  {
    id: 'valid-finite-light-noisy',
    image: { width: W, height: H },
    pairs: noisyPairs,
    expected: 'consistent',
    reasonCode: 'single_light_fits',
    lightPx: LIGHT,
    notes: 'Same scene with ±1.5 px deterministic annotation noise; must stay consistent under the annotation tolerance.',
  },
  {
    id: 'outlier-extra-pair',
    image: { width: W, height: H },
    pairs: [...validPairs, outlier],
    expected: 'inconsistent',
    reasonCode: 'outlier_pair',
    lightPx: LIGHT,
    outlierIndex: validPairs.length,
    notes: 'Valid scene plus one pair whose shadow is rotated 25° from the light ray; the check should flag that pair.',
  },
  {
    id: 'parallel-light-at-infinity',
    image: { width: W, height: H },
    pairs: parallelPairs,
    expected: 'consistent',
    reasonCode: 'light_at_infinity',
    notes: 'All shadows parallel (distant sun). Must NOT force a finite intersection and must NOT be called inconsistent.',
  },
  {
    id: 'two-lights',
    image: { width: W, height: H },
    pairs: twoLightPairs,
    expected: 'inconclusive',
    reasonCode: 'multiple_lights',
    notes: 'Two self-consistent groups lit from different lights. Single-light assumption is violated; report inconclusive.',
  },
  {
    id: 'crop-zoom-of-valid',
    image: { width: ZW, height: ZH },
    pairs: croppedPairs,
    expected: 'consistent',
    reasonCode: 'single_light_fits',
    lightPx: { x: (LIGHT.x - CROP.x) * 2, y: (LIGHT.y - CROP.y) * 2 },
    notes: 'The valid scene after crop + 2x zoom: same outcome required (crop/zoom invariance).',
  },
  {
    id: 'duplicate-pair',
    image: { width: W, height: H },
    pairs: [validPairs[0]!, validPairs[1]!, validPairs[1]!],
    expected: 'rejected',
    reasonCode: 'duplicate_pair',
    notes: 'Same pair entered twice; only 2 distinct pairs remain.',
  },
  {
    id: 'near-zero-segment',
    image: { width: W, height: H },
    pairs: [validPairs[0]!, validPairs[1]!, { object: n(700, 480), shadow: n(700.3, 480.2) }],
    expected: 'rejected',
    reasonCode: 'near_zero_segment',
    notes: 'One object/shadow pair less than 1 px apart: direction undefined.',
  },
  {
    id: 'underconstrained-two-pairs',
    image: { width: W, height: H },
    pairs: validPairs.slice(0, 2),
    expected: 'rejected',
    reasonCode: 'underconstrained',
    notes: 'Two lines always intersect; at least three distinct pairs are required to test consistency.',
  },
  {
    id: 'non-finite',
    image: { width: W, height: H },
    pairs: [validPairs[0]!, validPairs[1]!, { object: { x: Number.NaN, y: 0.5 }, shadow: { x: 0.5, y: 0.6 } }],
    expected: 'rejected',
    reasonCode: 'non_finite',
    notes: 'A NaN coordinate must be rejected, never propagated into a finding.',
  },
];

/** Perpendicular distance in pixels from point P to the infinite line through A and B. */
export function distPointToLinePx(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / Math.hypot(dx, dy);
}

/** Angle in degrees between the pair's object->shadow direction and the light->object direction. */
export function angleOffLightDeg(pair: ShadowPair, lightPx: { x: number; y: number }, image: { width: number; height: number }): number {
  const ox = pair.object.x * image.width;
  const oy = pair.object.y * image.height;
  const sx = pair.shadow.x * image.width - ox;
  const sy = pair.shadow.y * image.height - oy;
  const lx = ox - lightPx.x;
  const ly = oy - lightPx.y;
  const c = (sx * lx + sy * ly) / (Math.hypot(sx, sy) * Math.hypot(lx, ly));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

export function toPx(p: Point, image: { width: number; height: number }) {
  return { x: p.x * image.width, y: p.y * image.height };
}
