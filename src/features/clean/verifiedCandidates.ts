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
  return candidatesFromOcr(assetId, distinct).filter((candidate) => candidate.selected);
}
