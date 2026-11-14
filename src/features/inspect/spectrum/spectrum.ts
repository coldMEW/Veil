import type { CheckResult } from '../../../contracts';

/**
 * Bounded FFT signal diagnostic. Measures a frequency pattern; it does NOT detect AI provenance.
 * Pipeline: luma -> centre square crop -> bilinear resize to N (power of two) -> Hann window ->
 * 2-D FFT -> log magnitude (DC centred) + azimuthal-average radial profile + strongest off-axis peaks.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface SpectrumOutput {
  size: number;
  /** log(1+|F|) normalized to [0,1], row-major, DC at centre. */
  logMagnitude: Float32Array;
  /** Mean normalized log magnitude by integer radius 0..size/2-1. */
  radialProfile: number[];
  /** Strongest isolated peaks away from DC and the axes (u,v in cycles per N, relative to centre). */
  peaks: Array<{ u: number; v: number; value: number }>;
  crop: { x: number; y: number; size: number };
}

/** In-place iterative radix-2 complex FFT. `re`/`im` length must be a power of two. */
export function fft1d(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 2-D FFT of a real N x N signal; returns magnitude (not shifted). */
export function fft2dMagnitude(signal: Float64Array, n: number): Float64Array {
  const re = new Float64Array(signal);
  const im = new Float64Array(n * n);
  const rowR = new Float64Array(n);
  const rowI = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    rowR.set(re.subarray(y * n, y * n + n));
    rowI.set(im.subarray(y * n, y * n + n));
    fft1d(rowR, rowI);
    re.set(rowR, y * n);
    im.set(rowI, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rowR[y] = re[y * n + x]!;
      rowI[y] = im[y * n + x]!;
    }
    fft1d(rowR, rowI);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rowR[y]!;
      im[y * n + x] = rowI[y]!;
    }
  }
  const mag = new Float64Array(n * n);
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}

/** Luma of the centre square crop, bilinear-resized to n x n. */
export function lumaSquare(img: RgbaImage, n: number) {
  const side = Math.min(img.width, img.height);
  const cx = Math.floor((img.width - side) / 2);
  const cy = Math.floor((img.height - side) / 2);
  const out = new Float64Array(n * n);
  const s = side / n;
  const lum = (x: number, y: number) => {
    const i = ((cy + y) * img.width + cx + x) * 4;
    return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
  };
  for (let y = 0; y < n; y++) {
    const fy = Math.min(side - 1, Math.max(0, (y + 0.5) * s - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(side - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < n; x++) {
      const fx = Math.min(side - 1, Math.max(0, (x + 0.5) * s - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(side - 1, x0 + 1);
      const wx = fx - x0;
      out[y * n + x] =
        (lum(x0, y0) * (1 - wx) + lum(x1, y0) * wx) * (1 - wy) + (lum(x0, y1) * (1 - wx) + lum(x1, y1) * wx) * wy;
    }
  }
  return { luma: out, crop: { x: cx, y: cy, size: side } };
}

export function computeSpectrum(img: RgbaImage, n = 512): SpectrumOutput {
  if (n & (n - 1)) throw new Error('size must be a power of two');
  if (Math.min(img.width, img.height) < 64) throw new Error('image too small for a spectrum (< 64 px)');
  const { luma, crop } = lumaSquare(img, n);
  let mean = 0;
  for (let i = 0; i < luma.length; i++) mean += luma[i]!;
  mean /= luma.length;
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) luma[y * n + x] = (luma[y * n + x]! - mean) * hann[x]! * hann[y]!;
  const mag = fft2dMagnitude(luma, n);

  const logMag = new Float32Array(n * n);
  let max = 0;
  const half = n >> 1;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = Math.log1p(mag[y * n + x]!);
      const sy = (y + half) % n;
      const sx = (x + half) % n;
      logMag[sy * n + sx] = v;
      if (v > max) max = v;
    }
  if (max > 0) for (let i = 0; i < logMag.length; i++) logMag[i] = logMag[i]! / max;

  const sums = new Float64Array(half);
  const counts = new Uint32Array(half);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.round(Math.hypot(x - half, y - half));
      if (r < half) {
        sums[r] = sums[r]! + logMag[y * n + x]!;
        counts[r] = counts[r]! + 1;
      }
    }
  const radialProfile = Array.from(sums, (s, r) => (counts[r] ? s / counts[r]! : 0));

  // Peaks: local maxima excluding a DC disc (r<8) and the axes (|u|<2 or |v|<2), which windowing/edges dominate.
  const cand: Array<{ u: number; v: number; value: number }> = [];
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      const u = x - half;
      const v = y - half;
      if (Math.hypot(u, v) < 8 || Math.abs(u) < 2 || Math.abs(v) < 2) continue;
      const c = logMag[y * n + x]!;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx || dy) && logMag[(y + dy) * n + x + dx]! >= c) {
            isMax = false;
            break;
          }
      if (!isMax) continue;
      const r = Math.round(Math.hypot(u, v));
      const baseline = radialProfile[Math.min(half - 1, r)] ?? 0;
      if (c > baseline + 0.12) cand.push({ u, v, value: c });
    }
  cand.sort((a, b) => b.value - a.value);
  return { size: n, logMagnitude: logMag, radialProfile, peaks: cand.slice(0, 12), crop };
}

/** Wrap the spectrum as a contract CheckResult. Never claims provenance. */
export function spectrumCheck(assetId: string, img: RgbaImage, n = 512): CheckResult {
  const base = {
    id: `spectrum:${assetId}`,
    assetId,
    kind: 'signal' as const,
    title: 'Frequency spectrum',
    method: `Luma, centre square crop, bilinear resize to ${n}×${n}, Hann window, 2-D FFT, log magnitude; azimuthal-average radial profile; off-axis local peaks above the radial baseline.`,
    assumptions: ['The centre square crop is representative of the image.'],
    limitations: [
      'JPEG compression, sharpening, resampling, screenshots and repeating scene texture (fences, fabric, tiles) all create spectral peaks.',
      'There is no validated decision rule here: a peak pattern is a measurement, not evidence of AI generation or editing.',
    ],
    overlays: [],
    source: 'live' as const,
  };
  try {
    const s = computeSpectrum(img, n);
    return {
      ...base,
      execution: 'complete',
      finding: 'inconclusive',
      reason: 'No validated decision rule links this spectrum to how the image was made.',
      observation:
        s.peaks.length === 0
          ? 'No isolated off-axis peaks stood out above the radial baseline.'
          : `${s.peaks.length} isolated off-axis peak(s) stand out above the radial baseline.`,
      evidence: {
        size: s.size,
        crop: s.crop,
        radialProfile: s.radialProfile.map((v) => Math.round(v * 1e4) / 1e4),
        peaks: s.peaks.map((p) => ({ u: p.u, v: p.v, value: Math.round(p.value * 1e4) / 1e4 })),
      },
    };
  } catch (e) {
    return {
      ...base,
      execution: 'failed',
      finding: 'inconclusive',
      reason: e instanceof Error ? e.message : String(e),
      observation: 'The spectrum could not be computed.',
      evidence: {},
    };
  }
}
