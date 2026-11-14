import type { Pixels } from '../clean/mask';

/**
 * Layer 0: deterministic, seed-recorded pixel-value jitter.
 * EXPERIMENTAL TRANSFORM — protection is NOT established by running it.
 * No geometric shift: masks and evaluation alignment remain valid.
 */
export const JITTER_LABEL = 'Experimental transform; protection not established.';

/** mulberry32: small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface JitterParams {
  seed: number;
  /** Max absolute change per channel, in 8-bit levels (1..8). */
  amplitude: number;
}

/** Returns a new buffer; alpha untouched. Same input + params => identical bytes. */
export function applyJitter(src: Pixels, p: JitterParams): Pixels {
  if (!Number.isInteger(p.amplitude) || p.amplitude < 1 || p.amplitude > 8) throw new Error('amplitude must be an integer in 1..8');
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) throw new Error('seed must be a uint32');
  const rnd = mulberry32(p.seed);
  const out = new Uint8ClampedArray(src.data);
  const span = 2 * p.amplitude + 1;
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i]! + Math.floor(rnd() * span) - p.amplitude;
    out[i + 1] = out[i + 1]! + Math.floor(rnd() * span) - p.amplitude;
    out[i + 2] = out[i + 2]! + Math.floor(rnd() * span) - p.amplitude;
  }
  return { width: src.width, height: src.height, data: out };
}

/** PSNR over RGB in dB (Infinity when identical). Fidelity screening only, not a defense metric. */
export function psnr(a: Pixels, b: Pixels): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('size mismatch');
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c]! - b.data[i + c]!;
      se += d * d;
      n++;
    }
  const mse = se / n;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Mean SSIM on luma over non-overlapping 8x8 blocks. Screening only. */
export function ssim(a: Pixels, b: Pixels, block = 8): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('size mismatch');
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const luma = (p: Pixels, i: number) => 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!;
  let total = 0;
  let count = 0;
  for (let by = 0; by + block <= a.height; by += block)
    for (let bx = 0; bx + block <= a.width; bx += block) {
      let ma = 0,
        mb = 0;
      const xs: number[] = [],
        ys: number[] = [];
      for (let y = by; y < by + block; y++)
        for (let x = bx; x < bx + block; x++) {
          const i = (y * a.width + x) * 4;
          const va = luma(a, i),
            vb = luma(b, i);
          xs.push(va);
          ys.push(vb);
          ma += va;
          mb += vb;
        }
      const n = xs.length;
      ma /= n;
      mb /= n;
      let va = 0,
        vb = 0,
        cov = 0;
      for (let k = 0; k < n; k++) {
        va += (xs[k]! - ma) ** 2;
        vb += (ys[k]! - mb) ** 2;
        cov += (xs[k]! - ma) * (ys[k]! - mb);
      }
      va /= n - 1;
      vb /= n - 1;
      cov /= n - 1;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  return count ? total / count : 1;
}
