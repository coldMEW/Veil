import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import official from './official-vectors.json';
import { pdqHash, hamming, MATCH_THRESHOLD } from './index';
function noise(n: number) {
  const data = new Uint8ClampedArray(n * n * 4);
  let v = 123456789;
  for (let i = 0; i < n * n; i++) {
    for (let c = 0; c < 3; c++) {
      v ^= v << 13;
      v ^= v >>> 17;
      v ^= v << 5;
      data[4 * i + c] = v & 255;
    }
    data[4 * i + 3] = 255;
  }
  return { width: n, height: n, data };
}
export function texture(n = 512, phase = 0) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = 4 * (y * n + x);
      for (let c = 0; c < 3; c++)
        data[i + c] =
          120 +
          35 * Math.sin(x / (17 + c * 3) + phase) * Math.cos(y / (29 + c * 2)) +
          30 * Math.sin((x + y) / (43 + c) + phase) +
          25 * Math.cos((x - 2 * y) / (11 + c));
      data[i + 3] = 255;
    }
  return { width: n, height: n, data };
}
describe('PDQ', () => {
  it('matches the published upstream hash-pair distance',()=>expect(hamming(official.hashes[0]!,official.hashes[1]!)).toBe(official.distance));
  it.each([
    [64, 'c17f6931dd484240395b2d918b27672e1f6df97312aab798631b9560dde0cd32'],
    [128, 'baa916943c4cfca4bb76351a550c6e8778e09d6e5ca22d0e5b7910bc2dd35e45'],
    [257, 'ebdde1c4560801742e640743ab2c70bfbea5ead467dcb383524db1f1a8cd445b'],
    [512, 'f0098d043cc0ff2f5fe3f998e4c508fd92f21475e5474aa7c077f7c5580061b3'],
  ] as const)('matches upstream C++ synthetic reference %i', (n, hash) =>
    expect(pdqHash(noise(n))).toEqual({ hash, quality: 100 }),
  );
  it('identical distance is zero; validates hex', () => {
    const h = pdqHash(texture()).hash;
    expect(hamming(h, h)).toBe(0);
    expect(() => hamming('x', h)).toThrow();
  });
  it('JPEG75 and 0.8 resize remain within matching threshold', async () => {
    const image = texture();
    const { data, info } = await sharp(image.data, { raw: { width: 512, height: 512, channels: 4 } })
      .resize(410, 410)
      .jpeg({ quality: 75 })
      .toBuffer()
      .then((b) => sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    const distance = hamming(
      pdqHash(image).hash,
      pdqHash({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) }).hash,
    );
    console.log('PDQ JPEG75+resize distance', distance);
    expect(distance).toBeLessThanOrEqual(MATCH_THRESHOLD);
  });
  it('unrelated content has large distance', () =>
    expect(hamming(pdqHash(texture()).hash, pdqHash(noise(512)).hash)).toBeGreaterThan(80));
  it('flat image has zero quality and undersized inputs reject', () => {
    const image = noise(64);
    image.data.fill(0);
    expect(pdqHash(image).quality).toBe(0);
    expect(() => pdqHash({ width: 4, height: 4, data: new Uint8ClampedArray(64) })).toThrow();
  });
});
