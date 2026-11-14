import type { PrivacyCategory } from '../../contracts';

/**
 * Rule-based privacy filter for OCR text. Deliberately simple and explainable:
 * rules miss cases and can mislabel numbers, so the UI must also offer
 * "review all detected text". Returns the category and the rule that fired.
 */
export interface FilterResult {
  category: PrivacyCategory;
  rule: string;
}

const STREET_SUFFIX =
  /\b(st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|pl|place|way|hwy|highway|pkwy|parkway|cir|circle|ter|terrace|sq|square)\.?(?=\s|$|[,.])/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;
const ROOM = /\b(room|rm|suite|ste|apt|unit|bldg|building|office|lab|classroom|hall)\.?\s*#?\s*[a-z]?\d{1,5}[a-z]?\b/i;
const ZIP = /^\d{5}(-\d{4})?$/;

const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

/**
 * Plate-like: an alphanumeric core of 5-8 characters mixing letters and digits (>= 2 digits), with at most
 * 2 extra separator/noise characters. Small real plates are often read with a stray symbol or a missing
 * space (measured on a phone photo: a ~100 px wide plate read as 7 chars with one noise char).
 */
function isPlateLike(t: string): boolean {
  const compact = t.replace(/[^A-Z0-9]/gi, '');
  if (compact.length < 5 || compact.length > 8) return false;
  if (t.replace(/\s/g, '').length - compact.length > 2) return false;
  if (t.trim().split(/\s+/).length > 3) return false;
  return /[A-Z]/i.test(compact) && digitCount(compact) >= 2;
}

export function classifyText(raw: string): FilterResult {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return { category: 'other_text', rule: 'empty' };
  if (EMAIL.test(t)) return { category: 'email', rule: 'email-pattern' };
  if (ROOM.test(t)) return { category: 'room_or_id_number', rule: 'room-keyword+number' };
  if (STREET_SUFFIX.test(t)) {
    if (/\d/.test(t)) return { category: 'address', rule: 'number+street-suffix' };
    if (t.split(' ').length <= 5) return { category: 'address', rule: 'street-name' };
  }
  if (ZIP.test(t)) return { category: 'address', rule: 'zip-code' };
  const d = digitCount(t);
  if (PHONE.test(t) && d >= 7 && d <= 15) return { category: 'phone', rule: 'phone-digits' };
  if (isPlateLike(t)) return { category: 'plate', rule: 'plate-like-alnum' };
  if (/^#?\d{1,5}[A-Z]?$/i.test(t)) return { category: 'room_or_id_number', rule: 'standalone-number' };
  return { category: 'other_text', rule: 'no-rule' };
}

/** Categories pre-selected for removal by default; others are listed but unselected. */
export const DEFAULT_SELECTED: ReadonlySet<PrivacyCategory> = new Set<PrivacyCategory>([
  'address',
  'plate',
  'email',
  'phone',
  'room_or_id_number',
]);
