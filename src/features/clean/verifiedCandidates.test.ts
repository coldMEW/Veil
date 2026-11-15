import { it, expect } from 'vitest';
import type { OcrBox } from './ocr/types';
import { verifiedPrivacyCandidates } from './verifiedCandidates';
function box(text: string, score = 0.99, matched = true): OcrBox {
  return {
    text,
    recScore: score,
    detScore: 0.95,
    verification: { matched, score },
    pixelRect: { x: 10, y: 10, w: 120, h: 30 },
    rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 },
    quad: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.2 },
      { x: 0.1, y: 0.2 },
    ],
  };
}
it('shows only stable privacy suggestions, never other text or unmatched reads', () => {
  const result = verifiedPrivacyCandidates('x', [
    box('ABC1234', 0.7),
    box('NIKE'),
    box('ROOM 204', 0.99, false),
    box('1'),
    box('11'),
    box('123', 0.9),
  ]);
  expect(result).toHaveLength(1);
  expect(result[0]!.category).toBe('plate');
});
it('does not label raw OCR as verified when verification was not performed', () => {
  const b = box('ABC1234');
  delete b.verification;
  expect(verifiedPrivacyCandidates('x', [b])).toEqual([]);
});
it('collapses contained number fragments and duplicate plates', () => {
  const plate = box('ABC1234', 0.9),
    part = { ...box('123', 0.99), rect: { x: 0.22, y: 0.12, w: 0.1, h: 0.04 } };
  expect(verifiedPrivacyCandidates('x', [plate, { ...plate }, part])).toHaveLength(1);
});
it('retains an explicit room label after a stable high confidence reread', () =>
  expect(verifiedPrivacyCandidates('x', [box('ROOM 204')])[0]!.category).toBe('room_or_id_number'));
