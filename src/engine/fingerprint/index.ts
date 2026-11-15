// Algorithm port of Meta ThreatExchange PDQ (BSD-3-Clause), see README.md.
export { sha256Hex } from '../../features/clean/hash';
export const MATCH_THRESHOLD = 31;
const f = Math.fround;
const matrix = Float32Array.from({ length: 1024 }, (_, i) =>
  f(Math.sqrt(2 / 64) * Math.cos((Math.PI / 128) * (Math.floor(i / 64) + 1) * (2 * (i % 64) + 1))),
);
function box(
  input: Float32Array,
  output: Float32Array,
  width: number,
  height: number,
  vertical: boolean,
  window: number,
) {
  const length = vertical ? height : width,
    lines = vertical ? width : height,
    stride = vertical ? width : 1;
  const half = Math.floor((window + 2) / 2);
  for (let line = 0; line < lines; line++) {
    const base = vertical ? line : line * width;
    let sum = 0,
      left = 0,
      right = 0,
      count = 0,
      out = 0;
    for (let j = 0; j < half - 1; j++) {
      sum = f(sum + input[base + right++ * stride]!);
      count++;
    }
    for (let j = 0; j < window - half + 1; j++) {
      sum = f(sum + input[base + right++ * stride]!);
      count++;
      output[base + out++ * stride] = sum / count;
    }
    for (let j = 0; j < length - window; j++) {
      sum = f(sum + input[base + right++ * stride]!);
      sum = f(sum - input[base + left++ * stride]!);
      output[base + out++ * stride] = sum / count;
    }
    for (let j = 0; j < half - 1; j++) {
      sum = f(sum - input[base + left++ * stride]!);
      count--;
      output[base + out++ * stride] = sum / count;
    }
  }
}
/** Meta PDQ: RGB luma, two Jarosz passes, center decimation, DCT frequencies 1..16, lower median. */
export function pdqHash(image: Pick<ImageData, 'width' | 'height' | 'data'>): {
  hash: string;
  quality: number;
} {
  const { width: w, height: h, data } = image;
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 5 ||
    h < 5 ||
    data.length !== w * h * 4 ||
    w * h > 40_000_000
  )
    throw Error('PDQ requires valid RGBA dimensions >=5.');
  const a = new Float32Array(w * h),
    b = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++)
    a[i] = f(f(f(f(0.299) * data[4 * i]!) + f(f(0.587) * data[4 * i + 1]!)) + f(f(0.114) * data[4 * i + 2]!));
  if (w !== 64 || h !== 64)
    for (let pass = 0; pass < 2; pass++) {
      box(a, b, w, h, false, Math.ceil(w / 128));
      box(b, a, w, h, true, Math.ceil(h / 128));
    }
  const small = new Float32Array(4096);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      small[y * 64 + x] = a[Math.floor(((y + 0.5) * h) / 64) * w + Math.floor(((x + 0.5) * w) / 64)]!;
  let gradient = 0;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const v = small[y * 64 + x]!;
      if (y < 63) gradient += Math.abs(Math.trunc(f(f(v - small[(y + 1) * 64 + x]!) * 100) / 255));
      if (x < 63) gradient += Math.abs(Math.trunc(f(f(v - small[y * 64 + x + 1]!) * 100) / 255));
    }
  const temp = new Float32Array(1024),
    dct = new Float32Array(256);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 64; j++) {
      let sum = 0;
      for (let k = 0; k < 64; k++) sum = f(sum + f(matrix[i * 64 + k]! * small[k * 64 + j]!));
      temp[i * 64 + j] = sum;
    }
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      let sum = 0;
      for (let k = 0; k < 64; k++) sum = f(sum + f(temp[i * 64 + k]! * matrix[j * 64 + k]!));
      dct[i * 16 + j] = sum;
    }
  const median = Array.from(dct).sort((a, b) => a - b)[127]!;
  let bits = 0n;
  for (let i = 0; i < 256; i++) if (dct[i]! > median) bits |= 1n << BigInt(i);
  return { hash: bits.toString(16).padStart(64, '0'), quality: Math.min(100, Math.floor(gradient / 90)) };
}
/** Hamming distance of canonical 256-bit PDQ hex strings. */
export function hamming(a: string, b: string): number {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b))
    throw Error('Expected 64 hexadecimal characters.');
  let bits = BigInt('0x' + a) ^ BigInt('0x' + b),
    count = 0;
  while (bits) {
    bits &= bits - 1n;
    count++;
  }
  return count;
}
