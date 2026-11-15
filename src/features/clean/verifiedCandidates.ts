import type { Rect } from '../../contracts';
import type { OcrBox } from './ocr/types';
import { canonicalText } from './ocr/verification';
import { classifyText, DEFAULT_SELECTED } from './filter';
import { candidatesFromOcr } from './session';
function contained(a: Rect, b: Rect) {
  const area =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return area / Math.max(1e-9, a.w * a.h);
}
/** Precision-first suggestions: two consistent reads plus category/geometry checks, never a privacy guarantee. */
export function verifiedPrivacyCandidates(assetId: string, boxes: OcrBox[]) {
  const stable = boxes
    .filter((box) => {
      const { category, rule } = classifyText(box.text),
        score = box.verification?.score ?? 0;
      if (!box.verification?.matched || !DEFAULT_SELECTED.has(category)) return false;
      if (category === 'plate')
        return (
          score >= 0.5 &&
          box.detScore >= 0.7 &&
          box.pixelRect.w / box.pixelRect.h >= 1.6 &&
          box.pixelRect.h >= 8
        );
      if (rule === 'standalone-number' || rule === 'zip-code')
        return canonicalText(box.text).length >= 3 && score >= 0.98 && box.pixelRect.h >= 10;
      return score >= 0.85;
    })
    .sort((a, b) => (b.verification?.score ?? 0) - (a.verification?.score ?? 0));
  const distinct = stable.filter(
    (box, index) =>
      !stable.some((other, j) => {
        if (index === j) return false;
        const text = canonicalText(box.text),
          full = canonicalText(other.text);
        if (text === full) return j < index && contained(box.rect, other.rect) > 0.6;
        return full.length > text.length && full.includes(text) && contained(box.rect, other.rect) > 0.65;
      }),
  );
  const verified = candidatesFromOcr(assetId, distinct)
    .filter((candidate) => candidate.selected)
    .map((c) => ({ ...c, verified: true }));
  // Second tier, kept apart and never pre-selected: location-class reads (street names, plates) that one
  // read supports but the second did not confirm. Stray numbers and other text never appear here.
  const maybe = boxes.filter((box) => {
    if (distinct.includes(box)) return false;
    const { category } = classifyText(box.text);
    if (category !== 'address' && category !== 'plate') return false;
    if (box.recScore < 0.6 || box.pixelRect.h < 8) return false;
    return !distinct.some((v) => contained(box.rect, v.rect) > 0.5);
  });
  const seen: OcrBox[] = [];
  for (const box of maybe.sort((a, b) => b.recScore - a.recScore))
    if (!seen.some((o) => contained(box.rect, o.rect) > 0.5 || contained(o.rect, box.rect) > 0.5)) seen.push(box);
  const unverified = candidatesFromOcr(assetId, seen.slice(0, 4)).map((c) => ({ ...c, selected: false, verified: false }));
  return [...verified, ...unverified];
}
