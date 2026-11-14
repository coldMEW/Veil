import { fft1d } from '../spectrum/spectrum';

export interface Plane {
  width: number;
  height: number;
  data: Float32Array;
}
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface Alignment {
  scale: number;
  tx: number;
  ty: number;
  confidence: number;
  correlation: number;
}

export function sample(p: Plane, x: number, y: number): number {
  x = Math.max(0, Math.min(p.width - 1, x));
  y = Math.max(0, Math.min(p.height - 1, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy;
  const a = iy * p.width + ix,
    b = iy * p.width + Math.min(ix + 1, p.width - 1);
  const c = Math.min(iy + 1, p.height - 1) * p.width + ix,
    d = Math.min(iy + 1, p.height - 1) * p.width + Math.min(ix + 1, p.width - 1);
  return (
    (p.data[a]! * (1 - dx) + p.data[b]! * dx) * (1 - dy) + (p.data[c]! * (1 - dx) + p.data[d]! * dx) * dy
  );
}
export function gray(p: Pixels, factor: number): Plane {
  const width = Math.max(2, Math.round(p.width * factor)),
    height = Math.max(2, Math.round(p.height * factor));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(p.width - 1, Math.max(0, (x + 0.5) / factor - 0.5)),
        sy = Math.min(p.height - 1, Math.max(0, (y + 0.5) / factor - 0.5));
      const ix = Math.floor(sx),
        iy = Math.floor(sy),
        dx = sx - ix,
        dy = sy - iy;
      let v = 0;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const n = (Math.min(p.height - 1, iy + j) * p.width + Math.min(p.width - 1, ix + i)) * 4;
          const alpha = p.data[n + 3]! / 255;
          v +=
            (0.2126 * p.data[n]! + 0.7152 * p.data[n + 1]! + 0.0722 * p.data[n + 2]!) *
            alpha *
            (i ? dx : 1 - dx) *
            (j ? dy : 1 - dy);
        }
      data[y * width + x] = v;
    }
  return { width, height, data };
}
export function gradient(p: Plane): Plane {
  const data = new Float32Array(p.data.length);
  for (let y = 1; y < p.height - 1; y++)
    for (let x = 1; x < p.width - 1; x++) {
      const i = y * p.width + x;
      data[i] = Math.hypot(p.data[i + 1]! - p.data[i - 1]!, p.data[i + p.width]! - p.data[i - p.width]!);
    }
  return { ...p, data };
}
function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false): void {
  const r = new Float64Array(n),
    q = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, (y + 1) * n));
    q.set(im.subarray(y * n, (y + 1) * n));
    fft1d(r, q, inverse);
    re.set(r, y * n);
    im.set(q, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x]!;
      q[y] = im[y * n + x]!;
    }
    fft1d(r, q, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y]!;
      im[y * n + x] = q[y]!;
    }
  }
}
function phase(
  a: Plane,
  bFFT: [Float64Array, Float64Array],
  n: number,
): { tx: number; ty: number; psr: number } {
  const re = new Float64Array(n * n),
    im = new Float64Array(n * n);
  for (let y = 1; y < Math.min(n, a.height) - 1; y++)
    for (let x = 1; x < Math.min(n, a.width) - 1; x++) re[y * n + x] = a.data[y * a.width + x]!;
  fft2(re, im, n);
  for (let i = 0; i < re.length; i++) {
    const ar = re[i]!,
      ai = im[i]!,
      br = bFFT[0][i]!,
      bi = bFFT[1][i]!;
    const rr = br * ar + bi * ai,
      ii = bi * ar - br * ai,
      m = Math.hypot(rr, ii);
    re[i] = m > 1e-8 ? rr / m : 0;
    im[i] = m > 1e-8 ? ii / m : 0;
  }
  fft2(re, im, n, true);
  let best = 0;
  for (let i = 1; i < re.length; i++) if (re[i]! > re[best]!) best = i;
  const px = best % n,
    py = Math.floor(best / n);
  let sum = 0,
    sq = 0,
    count = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = Math.min(Math.abs(x - px), n - Math.abs(x - px)),
        dy = Math.min(Math.abs(y - py), n - Math.abs(y - py));
      if (dx <= 5 && dy <= 5) continue;
      const v = re[y * n + x]!;
      sum += v;
      sq += v * v;
      count++;
    }
  const sub = (center: number, lo: number, hi: number) => {
    const d = lo - 2 * center + hi;
    return Math.abs(d) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (lo - hi)) / d)) : 0;
  };
  return {
    tx:
      (px > n / 2 ? px - n : px) +
      sub(re[best]!, re[py * n + ((px + n - 1) % n)]!, re[py * n + ((px + 1) % n)]!),
    ty:
      (py > n / 2 ? py - n : py) +
      sub(re[best]!, re[((py + n - 1) % n) * n + px]!, re[((py + 1) % n) * n + px]!),
    psr: (re[best]! - sum / count) / Math.sqrt(Math.max(1e-12, sq / count - (sum / count) ** 2)),
  };
}
function score(a: Plane, b: Plane, s: number, tx: number, ty: number, step: number): number {
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0,
    count = 0,
    total = 0;
  for (let y = 2; y < b.height - 2; y += step)
    for (let x = 2; x < b.width - 2; x += step) {
      total++;
      const ax = (x - tx) / s,
        ay = (y - ty) / s;
      if (ax < 2 || ay < 2 || ax >= a.width - 2 || ay >= a.height - 2) continue;
      const va = sample(a, ax, ay),
        vb = b.data[y * b.width + x]!;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
      count++;
    }
  if (count < total * 0.35 || count < 20) return -1;
  return (
    (sab - (sa * sb) / count) /
    Math.sqrt(Math.max(1e-8, (saa - (sa * sa) / count) * (sbb - (sb * sb) / count)))
  );
}
/** Estimate A-original-pixel -> B-original-pixel scale and translation; no rotation is fitted. */
export function align(a: Pixels, b: Pixels): Alignment | null {
  const factor = 128 / Math.max(a.width, a.height, b.width, b.height),
    pa = gray(a, factor),
    pb = gradient(gray(b, factor)),
    n = 256;
  const br = new Float64Array(n * n),
    bi = new Float64Array(n * n);
  for (let y = 1; y < pb.height - 1; y++)
    for (let x = 1; x < pb.width - 1; x++) br[y * n + x] = pb.data[y * pb.width + x]!;
  fft2(br, bi, n);
  let best = { scale: 1, tx: 0, ty: 0, confidence: 0, correlation: -1 };
  for (let i = 0; i < 25; i++) {
    const s = 0.5 * 4 ** (i / 24),
      w = Math.max(2, Math.round(pa.width * s)),
      h = Math.max(2, Math.round(pa.height * s)),
      data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = sample(pa, x / s, y / s);
    const p = phase(gradient({ width: w, height: h, data }), [br, bi], n);
    const c = score(gradient(pa), pb, s, p.tx, p.ty, 2);
    if (c > best.correlation) best = { scale: s, tx: p.tx, ty: p.ty, confidence: p.psr, correlation: c };
  }
  const f = 512 / Math.max(a.width, a.height, b.width, b.height),
    ga = gradient(gray(a, f)),
    gb = gradient(gray(b, f));
  let s = best.scale,
    tx = (best.tx * f) / factor,
    ty = (best.ty * f) / factor,
    c = score(ga, gb, s, tx, ty, 5);
  for (const [scaleStep, translationStep] of [
    [0.012, 2],
    [0.003, 0.5],
    [0.0008, 0.125],
  ] as const) {
    let next = { s, tx, ty, c };
    for (let ds = -3; ds <= 3; ds++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const ns = s * (1 + ds * scaleStep),
            nx = tx + dx * translationStep,
            ny = ty + dy * translationStep;
          if (ns < 0.5 || ns > 2) continue;
          const nc = score(ga, gb, ns, nx, ny, 5);
          if (nc > next.c) next = { s: ns, tx: nx, ty: ny, c: nc };
        }
    ({ s, tx, ty, c } = next);
  }
  if (best.confidence < 5 || c < 0.45) return null;
  return { scale: s, tx: tx / f, ty: ty / f, confidence: best.confidence, correlation: c };
}
