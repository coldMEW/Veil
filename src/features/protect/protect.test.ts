import { describe, expect, it } from 'vitest';
import { runProtect, PROTECT_LABEL } from './protect';
import type { Pixels } from '../clean/mask';

const image = (): Pixels => ({ width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(120).map((v, i) => i % 4 === 3 ? 255 : v) });
const bytes = async (px: Pixels) => new Uint8Array(px.data);

describe('Protect transform runner', () => {
  it('makes deterministic jitter exports and TransformRecords with the fixed experimental label', async () => {
    const request = { src: image(), srcSha256: 'input', arms: ['jitter'] as const, seed: 9, encode: bytes, now: () => '2026-11-14T00:00:00.000Z' };
    const [a] = await runProtect(request); const [b] = await runProtect(request);
    expect(a?.pixels.data).toEqual(b?.pixels.data);
    expect(a?.label).toBe(PROTECT_LABEL);
    expect(a?.transforms[0]).toMatchObject({ method: 'jitter_experimental', inputSha256: 'input', seed: 9, synthetic: false });
  });
});
