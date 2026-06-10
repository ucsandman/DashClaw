/**
 * Operational-token extraction + normalization.
 *
 * Ported verbatim (TS -> JS) from GroundLock packages/core/src/extract.ts.
 * Zero-dependency: regex + Number only. Each extractor returns
 * `{ raw, normalized }` so a formatting variant of the same value
 * ("$2000" vs "$2,000.00") compares equal on `normalized`.
 */

import { assertSafePattern } from './pattern-safety';

const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g;
const PERCENT_RE = /\d+(?:\.\d+)?\s?%/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};
const MONTH_DATE_RE = new RegExp(
  '\\b(' + Object.keys(MONTHS).join('|') + ')\\s+(\\d{1,2}),\\s*(\\d{4})\\b',
  'gi',
);

export interface ExtractedValue {
  raw: string;
  normalized: string;
}

/**
 * Strip formatting to a bare numeric string (e.g. "1500", "1500.5").
 * Fail-closed: an empty, multi-dot, or non-finite input returns a non-matching
 * sentinel (it starts with a letter, so it can never equal a real numeric string),
 * so an unparseable value is never silently treated as equal to a real amount.
 */
function normalizeNumeric(raw: string): string {
  const digits = raw.replace(/[^0-9.]/g, '');
  const dotCount = (digits.match(/\./g) ?? []).length;
  if (digits === '' || dotCount > 1) return 'invalid:' + raw.trim();
  const n = Number(digits);
  return Number.isFinite(n) ? String(n) : 'invalid:' + raw.trim();
}

export function normalizeMoney(raw: string): string {
  return normalizeNumeric(raw);
}

export function normalizePercent(raw: string): string {
  return normalizeNumeric(raw);
}

/** Normalize a single date string to ISO YYYY-MM-DD, or null if unrecognized. */
export function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (slash) return `${slash[3]}-${pad(slash[1] as string)}-${pad(slash[2] as string)}`;
  const month = new RegExp(
    '^(' + Object.keys(MONTHS).join('|') + ')\\s+(\\d{1,2}),\\s*(\\d{4})$',
    'i',
  ).exec(raw.trim());
  if (month) {
    const mm = MONTHS[(month[1] as string).toLowerCase()];
    return `${month[3]}-${mm}-${pad(month[2] as string)}`;
  }
  return null;
}

function pad(s: string): string {
  return s.length === 1 ? '0' + s : s;
}

function matchAll(text: string, re: RegExp): string[] {
  return text.match(re) ?? [];
}

export function extractMoney(text: string): ExtractedValue[] {
  return matchAll(text, MONEY_RE).map((raw) => ({ raw, normalized: normalizeMoney(raw) }));
}

export function extractPercentages(text: string): ExtractedValue[] {
  return matchAll(text, PERCENT_RE).map((raw) => ({ raw, normalized: normalizePercent(raw) }));
}

export function extractDates(text: string): ExtractedValue[] {
  const out: ExtractedValue[] = [];
  for (const re of [ISO_DATE_RE, SLASH_DATE_RE, MONTH_DATE_RE]) {
    for (const raw of matchAll(text, re)) {
      const normalized = normalizeDate(raw);
      if (normalized) out.push({ raw, normalized });
    }
  }
  return out;
}

export function extractPattern(text: string, pattern: string): string[] {
  assertSafePattern(pattern); // fail closed on oversized / ReDoS-prone caller patterns (CodeQL js/regex-injection)
  return matchAll(text, new RegExp(pattern, 'g'));
}
