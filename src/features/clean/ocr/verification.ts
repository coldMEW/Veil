import { classifyText } from '../filter';
import type { PrivacyCategory } from '../../../contracts';
import { decodeCtc, preprocessRecognition } from './rec';
import type { OcrModels, Profile, RgbaImage } from './types';

export function canonicalText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Exact normalized agreement deliberately rejects blanks and uncertain substitutions. */
export function textsMatch(first: string, second: string): boolean {
  const canonical = canonicalText(first);
  return canonical.length > 0 && canonical === canonicalText(second);
}

/** Plates need region confirmation, not a perfect transcription: allow one uncertain glyph in5-8 chars. */
export function plateReadsAgree(first: string, second: string): boolean {
  const a = canonicalText(first),
    b = canonicalText(second);
  if (
    classifyText(first).category !== 'plate' ||
    classifyText(second).category !== 'plate' ||
    Math.min(a.length, b.length) < 5 ||
    Math.max(a.length, b.length) > 8
  )
    return false;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Uint8Array(b.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      rows[i]![j] = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return rows[a.length]![b.length]! <= 1;
}

/** Consistency evidence only: a stable hallucination can still agree twice. */
export async function verifyCandidate(
  image: RgbaImage,
  models: OcrModels,
  quad: [number, number][],
  first: { text: string; recScore: number },
  detScore: number,
  category: PrivacyCategory,
  profile?: Profile,
): Promise<{ matched: boolean; score: number }> {
  if (category === 'other_text') return { matched: false, score: 0 };
  const threshold = category === 'plate' ? 0.5 : 0.85;
  // Low confidence candidates cannot pass, so avoid another inference for them.
  if (Math.min(detScore, first.recScore) < threshold) return { matched: false, score: 0 };
  const centerX = quad.reduce((sum, p) => sum + p[0], 0) / 4;
  const centerY = quad.reduce((sum, p) => sum + p[1], 0) / 4;
  const padded = quad.map(
    ([x, y]) =>
      [
        Math.max(0, Math.min(image.width, centerX + (x - centerX) * 1.06)),
        Math.max(0, Math.min(image.height, centerY + (y - centerY) * 1.12)),
      ] as [number, number],
  );
  const xs = padded.map((p) => p[0]),
    ys = padded.map((p) => p[1]);
  const crop = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  const read = async (q: [number, number][]) => {
    const output = await models.recognize(
      preprocessRecognition(image, crop, models.recognitionHeight, q, profile),
    );
    return decodeCtc(output.data, output.dims, models.dictionary);
  };
  let second = await read(padded);
  if (Math.abs(quad[1]![1] - quad[0]![1]) > Math.abs(quad[1]![0] - quad[0]![0])) {
    const alternate = await read([padded[2]!, padded[3]!, padded[0]!, padded[1]!]);
    if (alternate.recScore > second.recScore) second = alternate;
  }
  let score = Math.min(detScore, first.recScore, second.recScore);
  let matched =
    score >= threshold &&
    (category === 'plate' ? plateReadsAgree(first.text, second.text) : textsMatch(first.text, second.text));
  if (!matched && category === 'plate') {
    // A narrow plate can lose a boundary glyph in the wider context crop. Require a second,
    // independently sampled tighter crop to corroborate the initial plate-region read.
    const tighter = quad.map(
      ([x, y]) =>
        [
          Math.max(0, Math.min(image.width, centerX + (x - centerX) * 1.02)),
          Math.max(0, Math.min(image.height, centerY + (y - centerY) * 1.04)),
        ] as [number, number],
    );
    let retry = await read(tighter);
    if (Math.abs(quad[1]![1] - quad[0]![1]) > Math.abs(quad[1]![0] - quad[0]![0])) {
      const reverse = await read([tighter[2]!, tighter[3]!, tighter[0]!, tighter[1]!]);
      if (reverse.recScore > retry.recScore) retry = reverse;
    }
    const retryScore = Math.min(detScore, first.recScore, retry.recScore);
    if (retryScore >= threshold && plateReadsAgree(first.text, retry.text)) {
      matched = true;
      score = retryScore;
    }
  }
  return { matched, score };
}
