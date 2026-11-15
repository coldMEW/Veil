// Pure maths over sampled frames: no browser, no models. Thresholds adapt to each video (median
// plus a multiple of the spread), so a shaky phone clip is not judged like a tripod shot.

export const GRID_COLS = 6;
export const GRID_ROWS = 4;

export interface FrameStats {
  time: number;
  luminance: number;
  /** Mean absolute colour difference to the previous sampled frame, 0..1. Null on the first frame. */
  difference: number | null;
  /** The same difference per cell of a 6 x 4 grid, row by row. */
  cells: number[];
}

export type MomentKind = 'cut' | 'local' | 'light' | 'held';

export interface Moment {
  kind: MomentKind;
  time: number;
  previousTime: number;
  /** Where in the picture, for 'local'. */
  where?: string;
  /** How far past the video's own threshold, 1 = just over. */
  strength: number;
}

export function median(values: number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median plus k robust standard deviations, never below `floor`. */
export function robustThreshold(values: number[], floor: number, k: number): number {
  const centre = median(values);
  const spread = median(values.map((v) => Math.abs(v - centre)));
  return Math.max(floor, centre + k * spread * 1.4826);
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export function cellName(cell: number): string {
  const col = ['left', 'centre', 'right'][Math.min(2, Math.floor(((cell % GRID_COLS) * 3) / GRID_COLS))]!;
  const row = ['top', 'middle', 'bottom'][Math.min(2, Math.floor((Math.floor(cell / GRID_COLS) * 3) / GRID_ROWS))]!;
  return row === 'middle' && col === 'centre' ? 'centre' : `${row} ${col}`;
}

export interface TemporalResult {
  moments: Moment[];
  cutThreshold: number;
  /** Times where the whole picture changed: used to split the video into shots. */
  cuts: number[];
}

export function findMoments(frames: FrameStats[]): TemporalResult {
  if (frames.length < 3) return { moments: [], cutThreshold: 0.17, cuts: [] };
  const steps = frames.slice(1);
  const diffs = steps.map((f) => f.difference ?? 0);
  const cutThreshold = robustThreshold(diffs, 0.17, 5);
  const localScores = steps.map((f) => (f.cells.length ? Math.max(...f.cells) - mean(f.cells) : 0));
  const localThreshold = robustThreshold(localScores, 0.1, 4);
  const lightDeltas = steps.map((f, i) => Math.abs(f.luminance - frames[i]!.luminance));
  const lightThreshold = robustThreshold(lightDeltas, 0.13, 5);

  const moments: Moment[] = [];
  const cuts: number[] = [];
  steps.forEach((frame, i) => {
    const previous = frames[i]!;
    const d = diffs[i]!;
    if (d >= cutThreshold) {
      cuts.push(frame.time);
      moments.push({ kind: 'cut', time: frame.time, previousTime: previous.time, strength: d / cutThreshold });
    } else if (localScores[i]! >= localThreshold && d > 0.015) {
      const cell = frame.cells.indexOf(Math.max(...frame.cells));
      moments.push({ kind: 'local', time: frame.time, previousTime: previous.time, where: cellName(cell), strength: localScores[i]! / localThreshold });
    }
    if (lightDeltas[i]! >= lightThreshold && d < cutThreshold) {
      moments.push({ kind: 'light', time: frame.time, previousTime: previous.time, strength: lightDeltas[i]! / lightThreshold });
    }
    const before = i > 0 ? diffs[i - 1]! : 0;
    if (d < 0.002 && before > Math.max(0.05, cutThreshold * 0.35)) {
      moments.push({ kind: 'held', time: frame.time, previousTime: previous.time, strength: before / Math.max(0.05, cutThreshold * 0.35) });
    }
  });
  return { moments: dedupe(moments), cutThreshold, cuts };
}

/** One moment per kind per 1.2 seconds, strongest first within the limit. */
function dedupe(moments: Moment[], seconds = 1.2, limit = 16): Moment[] {
  const kept: Moment[] = [];
  for (const m of [...moments].sort((a, b) => a.time - b.time)) {
    if (!kept.some((k) => k.kind === m.kind && Math.abs(k.time - m.time) < seconds)) kept.push(m);
  }
  return kept.sort((a, b) => b.strength - a.strength).slice(0, limit).sort((a, b) => a.time - b.time);
}

/** Per-frame brightness and difference to the previous frame. Both arrays are RGBA of the same size. */
export function describeFrame(time: number, rgba: Uint8ClampedArray, previous: Uint8ClampedArray | null, width: number, height: number): FrameStats {
  const totals = new Float64Array(GRID_COLS * GRID_ROWS);
  const counts = new Uint32Array(GRID_COLS * GRID_ROWS);
  let lum = 0;
  let diff = 0;
  for (let y = 0; y < height; y++) {
    const row = Math.min(GRID_ROWS - 1, Math.floor((y / height) * GRID_ROWS));
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!;
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (previous) {
        const d = (Math.abs(previous[o]! - r) + Math.abs(previous[o + 1]! - g) + Math.abs(previous[o + 2]! - b)) / 765;
        diff += d;
        const cell = row * GRID_COLS + Math.min(GRID_COLS - 1, Math.floor((x / width) * GRID_COLS));
        totals[cell] = totals[cell]! + d;
        counts[cell] = counts[cell]! + 1;
      }
    }
  }
  const pixels = Math.max(1, width * height);
  return {
    time,
    luminance: lum / pixels / 255,
    difference: previous ? diff / pixels : null,
    cells: previous ? Array.from(totals, (t, i) => (counts[i] ? t / counts[i]! : 0)) : [],
  };
}

/** Groups flagged sample times into stretches: neighbours in the sampling order belong together. */
export function passages<T extends { time: number }>(samples: T[], flagged: (s: T) => boolean): T[][] {
  const out: T[][] = [];
  let open: T[] | null = null;
  for (const s of samples) {
    if (!flagged(s)) {
      open = null;
      continue;
    }
    if (!open) {
      open = [];
      out.push(open);
    }
    open.push(s);
  }
  return out;
}

/** Which shot a time belongs to: the number of cuts at or before it. */
export function shotOf(time: number, cuts: number[]): number {
  let n = 0;
  for (const c of cuts) if (c <= time) n++;
  return n;
}
