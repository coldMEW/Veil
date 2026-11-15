export interface MarkResult {
  found: boolean;
  payload?: string;
  confidence: number;
  bitErrors: number;
}
export type Rgba = Pick<ImageData, 'width' | 'height' | 'data'>;
const SIZE = 512,
  BLOCKS = 4096,
  BITS = 112,
  STEP = 28;
const basis = Float64Array.from(
  { length: 64 },
  (_, i) =>
    0.25 *
    Math.cos((Math.PI * (2 * (i % 8) + 1) * 2) / 16) *
    Math.cos((Math.PI * (2 * Math.floor(i / 8) + 1)) / 16),
);
function validate(image: Rgba) {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    Math.min(image.width, image.height) < 128 ||
    image.width * image.height > 40_000_000 ||
    image.data.length !== image.width * image.height * 4
  )
    throw Error('Watermark requires RGBA dimensions >=128 and <=40M pixels.');
}
function sample(
  data: ArrayLike<number>,
  w: number,
  h: number,
  x: number,
  y: number,
  stride = 1,
  channel = 0,
) {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const a = (iy * w + ix) * stride + channel,
    b = (iy * w + Math.min(w - 1, ix + 1)) * stride + channel,
    c = (Math.min(h - 1, iy + 1) * w + ix) * stride + channel,
    d = (Math.min(h - 1, iy + 1) * w + Math.min(w - 1, ix + 1)) * stride + channel;
  return (data[a]! * (1 - fx) + data[b]! * fx) * (1 - fy) + (data[c]! * (1 - fx) + data[d]! * fx) * fy;
}
function luminance(image: Rgba) {
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const sx = ((x + 0.5) * image.width) / SIZE - 0.5,
        sy = ((y + 0.5) * image.height) / SIZE - 0.5;
      out[y * SIZE + x] =
        0.299 * sample(image.data, image.width, image.height, sx, sy, 4, 0) +
        0.587 * sample(image.data, image.width, image.height, sx, sy, 4, 1) +
        0.114 * sample(image.data, image.width, image.height, sx, sy, 4, 2);
    }
  return out;
}
function coefficients(luma: Float32Array) {
  const out = new Float64Array(BLOCKS);
  for (let by = 0; by < 64; by++)
    for (let bx = 0; bx < 64; bx++) {
      let sum = 0;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) sum += luma[(by * 8 + y) * SIZE + bx * 8 + x]! * basis[y * 8 + x]!;
      out[by * 64 + bx] = sum;
    }
  return out;
}
/** ChaCha20 keystream: 256-bit user key, fixed domain nonce for this watermark format. */
function random(key: Uint8Array) {
  if (key.length !== 32) throw Error('Watermark key must contain 32 random bytes.');
  const words = new Uint32Array(16);
  words.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let i = 0; i < 8; i++) words[4 + i] = view.getUint32(4 * i, true);
  words[13] = 0x5645494c;
  words[14] = 0x574d3031;
  words[15] = 1;
  let stream = new Uint32Array(0),
    offset = 0;
  const rot = (v: number, n: number) => (v << n) | (v >>> (32 - n));
  function next() {
    if (offset === stream.length) {
      const x = new Uint32Array(words);
      const q = (a: number, b: number, c: number, d: number) => {
        x[a] = (x[a]! + x[b]!) >>> 0;
        x[d] = rot(x[d]! ^ x[a]!, 16);
        x[c] = (x[c]! + x[d]!) >>> 0;
        x[b] = rot(x[b]! ^ x[c]!, 12);
        x[a] = (x[a]! + x[b]!) >>> 0;
        x[d] = rot(x[d]! ^ x[a]!, 8);
        x[c] = (x[c]! + x[d]!) >>> 0;
        x[b] = rot(x[b]! ^ x[c]!, 7);
      };
      for (let i = 0; i < 10; i++) {
        q(0, 4, 8, 12);
        q(1, 5, 9, 13);
        q(2, 6, 10, 14);
        q(3, 7, 11, 15);
        q(0, 5, 10, 15);
        q(1, 6, 11, 12);
        q(2, 7, 8, 13);
        q(3, 4, 9, 14);
      }
      for (let i = 0; i < 16; i++) x[i] = (x[i]! + words[i]!) >>> 0;
      words[12] = (words[12]! + 1) >>> 0;
      stream = x;
      offset = 0;
    }
    return stream[offset++]!;
  }
  return next;
}
function plan(key: Uint8Array) {
  const next = random(key),
    order = Uint16Array.from({ length: BLOCKS }, (_, i) => i),
    flip = new Uint8Array(BLOCKS);
  for (let i = BLOCKS - 1; i > 0; i--) {
    const j = next() % (i + 1),
      a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  for (let i = 0; i < BLOCKS; i++) flip[i] = next() & 1;
  return { order, flip };
}
function crc(payload: bigint) {
  let c = 0xffffffff;
  for (let i = 0; i < 8; i++) {
    c ^= Number((payload >> BigInt(i * 8)) & 255n);
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function frame(payload: bigint | string) {
  const value = BigInt(payload);
  if (value < 0n || value > 0xffffffffffffffffn) throw Error('Payload must be an unsigned 64-bit integer.');
  const packed = value | (BigInt(crc(value)) << 64n) | (0xa6d3n << 96n);
  return Uint8Array.from({ length: BITS }, (_, i) => Number((packed >> BigInt(i)) & 1n));
}
function imageData(data: Uint8ClampedArray, w: number, h: number): ImageData {
  return typeof ImageData === 'undefined'
    ? ({ data, width: w, height: h, colorSpace: 'srgb' } as ImageData)
    : new ImageData(new Uint8ClampedArray(data), w, h);
}
/** Embed a keyed, repeated 64-bit ownership identifier in canonical-scale midfrequency luminance DCT. */
export function embedMark(image: Rgba, key: Uint8Array, payload: bigint | string): ImageData {
  validate(image);
  const bits = frame(payload),
    { order, flip } = plan(key),
    delta = new Float32Array(SIZE * SIZE),
    coeff = coefficients(luminance(image));
  for (let i = 0; i < BLOCKS; i++) {
    const block = order[i]!,
      bit = bits[i % BITS]! ^ flip[i]!,
      v = coeff[block]!,
      target = (2 * Math.round((v / STEP - bit) / 2) + bit) * STEP,
      d = target - v,
      bx = block % 64,
      by = Math.floor(block / 64);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) delta[(by * 8 + y) * SIZE + bx * 8 + x] = d * basis[y * 8 + x]!;
  }
  const out = new Uint8ClampedArray(image.data);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const d = sample(
          delta,
          SIZE,
          SIZE,
          ((x + 0.5) * SIZE) / image.width - 0.5,
          ((y + 0.5) * SIZE) / image.height - 0.5,
        ),
        i = 4 * (y * image.width + x);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c]! + d);
    }
  return imageData(out, image.width, image.height);
}
/** Analyze once for repeated key queries. Input pixels are copied; later caller mutations do not affect it. */
export function createMarkReader(image: Rgba): (key: Uint8Array) => MarkResult {
  validate(image);
  const luma = luminance(image),
    variants = [coefficients(luma)];
  for (const axis of [0, 1])
    for (const side of [0, 0.2]) {
      const restored = new Float32Array(SIZE * SIZE);
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const sx = axis === 0 ? (((x + 0.5) / SIZE - side) / 0.8) * SIZE - 0.5 : x;
          const sy = axis === 1 ? (((y + 0.5) / SIZE - side) / 0.8) * SIZE - 0.5 : y;
          restored[y * SIZE + x] =
            sx < 0 || sy < 0 || sx > SIZE - 1 || sy > SIZE - 1 ? 128 : sample(luma, SIZE, SIZE, sx, sy);
        }
      variants.push(coefficients(restored));
    }
  return (key) => {
    const { order, flip } = plan(key);
    let best: MarkResult = { found: false, confidence: 0, bitErrors: 0 };
    for (const coeff of variants) {
      const votes = new Int16Array(BITS),
        counts = new Uint16Array(BITS);
      for (let i = 0; i < BLOCKS; i++) {
        const bit = (Math.round(coeff[order[i]!]! / STEP) & 1) ^ flip[i]!,
          j = i % BITS;
        votes[j] = votes[j]! + (bit ? 1 : -1);
        counts[j] = counts[j]! + 1;
      }
      let packed = 0n,
        errors = 0,
        margin = 0;
      for (let i = 0; i < BITS; i++) {
        if (votes[i]! > 0) packed |= 1n << BigInt(i);
        errors += (counts[i]! - Math.abs(votes[i]!)) / 2;
        margin += Math.abs(votes[i]!) / counts[i]!;
      }
      const payload = packed & 0xffffffffffffffffn,
        confidence = margin / BITS,
        found =
          packed >> 96n === 0xa6d3n &&
          Number((packed >> 64n) & 0xffffffffn) === crc(payload) &&
          confidence > 0.2;
      const result = {
        found,
        ...(found ? { payload: payload.toString() } : {}),
        confidence,
        bitErrors: Math.round(errors),
      };
      if (found) return result;
      if (confidence > best.confidence) best = result;
    }
    return best;
  };
}
/** Decode ownership mark. A positive mark is not proof of an unedited image or legal ownership. */
export function detectMark(image: Rgba, key: Uint8Array): MarkResult {
  return createMarkReader(image)(key);
}
