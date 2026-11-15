import { describe, expect, it, vi } from 'vitest';
import { scanImage } from './pipeline';
import { decodeCtc } from './rec';
import { canonicalText, textsMatch, verifyCandidate } from './verification';
import type { OcrModels, TensorData } from './types';

const dictionary = ['', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'];
function tensor(text: string, score = 0.99): TensorData {
  const indices = [...text].flatMap((char) => [dictionary.indexOf(char), 0]);
  if (!indices.length) indices.push(0);
  const data = new Float32Array(indices.length * dictionary.length);
  indices.forEach((index, step) => {
    data[step * dictionary.length + index] = score;
  });
  return { data, dims: [1, indices.length, dictionary.length] };
}
const image = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).fill(255) };
const quad: [number, number][] = [
  [5, 5],
  [25, 5],
  [25, 15],
  [5, 15],
];
function models(second: string, score = 0.99): OcrModels {
  return {
    recognitionHeight: 48,
    dictionary,
    detect: vi.fn(async (input: TensorData) => {
      const h = input.dims[2]!,
        w = input.dims[3]!;
      const data = new Float32Array(w * h);
      for (let y = 5; y < 12; y++) for (let x = 5; x < 20; x++) data[y * w + x] = 0.99;
      return { data, dims: [1, 1, h, w] };
    }),
    recognize: vi.fn(async () => tensor(second, score)),
  };
}

describe('candidate second-read verification', () => {
  it('requires nonblank exact alphanumeric agreement, normalizing case and punctuation', () => {
    expect(canonicalText(' ab-123 ')).toBe('AB123');
    expect(textsMatch('ab-123', 'AB 123')).toBe(true);
    expect(textsMatch('AB123', 'AB128')).toBe(false);
    expect(textsMatch('---', '')).toBe(false);
  });
  it('accepts stable reads and rejects disagreements and blank second reads', async () => {
    for (const [second, matched] of [
      ['AB 123', true],
      ['XY789', false],
      ['', false],
    ] as const) {
      const m = models(second);
      expect(
        (await verifyCandidate(image, m, quad, { text: 'AB-123', recScore: 0.99 }, 0.99, 'plate')).matched,
      ).toBe(matched);
    }
  });
  it('checks confidence on both reads and detection, with a stricter nonplate gate', async () => {
    expect(
      (
        await verifyCandidate(
          image,
          models('AB123', 0.49),
          quad,
          { text: 'AB123', recScore: 0.99 },
          0.99,
          'plate',
        )
      ).matched,
    ).toBe(false);
    expect(
      (
        await verifyCandidate(
          image,
          models('123'),
          quad,
          { text: '123', recScore: 0.84 },
          0.99,
          'room_or_id_number',
        )
      ).matched,
    ).toBe(false);
    expect(
      (
        await verifyCandidate(
          image,
          models('123'),
          quad,
          { text: '123', recScore: 0.99 },
          0.84,
          'room_or_id_number',
        )
      ).matched,
    ).toBe(false);
  });
  it('skips inference for other text', async () => {
    const m = models('BRAND');
    expect(
      await verifyCandidate(image, m, quad, { text: 'BRAND', recScore: 0.99 }, 0.99, 'other_text'),
    ).toEqual({ matched: false, score: 0 });
    expect(m.recognize).not.toHaveBeenCalled();
  });
  it('compares both directions for steep text before verifying the chosen reading', async () => {
    const m = models('AB123');
    vi.mocked(m.recognize).mockResolvedValueOnce(tensor('AB128', 0.9));
    const steep: [number, number][] = [
      [20, 3],
      [20, 28],
      [10, 28],
      [10, 3],
    ];
    expect(
      (await verifyCandidate(image, m, steep, { text: 'AB123', recScore: 0.99 }, 0.99, 'plate')).matched,
    ).toBe(true);
    expect(m.recognize).toHaveBeenCalledTimes(2);
  });
  it('decodes synthetic logits for matching without retaining raw tensors', () => {
    const input = tensor('AB123');
    const logits = Float32Array.from(input.data, (value) => (value > 0 ? 12 : -12));
    expect(textsMatch(decodeCtc(logits, input.dims, dictionary, 'logits').text, 'AB-123')).toBe(true);
  });
  it('keeps a pipeline candidate visible when its second recognition disagrees', async () => {
    const m = models('XY789');
    vi.mocked(m.recognize).mockResolvedValueOnce(tensor('AB123'));
    const boxes = await scanImage(image, m, { rotateTiles: false, verifyCandidates: true });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.text).toBe('AB123');
    expect(boxes[0]!.verification?.matched).toBe(false);
    expect(m.recognize).toHaveBeenCalledTimes(3);
  });
  it('preserves the default single-read pipeline', async () => {
    const m = models('AB123');
    const boxes = await scanImage(image, m, { rotateTiles: false });
    expect(boxes[0]!.verification).toBeUndefined();
    expect(m.recognize).toHaveBeenCalledTimes(1);
  });
});

import { plateReadsAgree } from './verification';
it('allows one uncertain plate glyph but not unrelated or short text', () => {
  expect(plateReadsAgree('ABC123', 'ABC128')).toBe(true);
  expect(plateReadsAgree('ABC123', 'XYZ789')).toBe(false);
  expect(plateReadsAgree('A12', 'A12')).toBe(false);
});
