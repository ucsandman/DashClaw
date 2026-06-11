/**
 * Non-fabrication verifier.
 *
 * Ported verbatim (TS -> JS) from GroundLock packages/core/src/verify.ts.
 * Given a candidate text and a source-of-truth (allowed facts, required facts,
 * forbidden patterns, extract options), it confirms:
 *   1. every declared required fact appears verbatim (no silent omission),
 *   2. no forbidden pattern matches unless an allowed fact authorizes it,
 *   3. every extracted operational token (money / date / percentage /
 *      caller-registered pattern) traces to an allowed fact.
 *
 * Returns `{ verdict: 'pass' | 'block', violations }`. FAIL-CLOSED: any internal
 * error — including a malformed or missing source-of-truth — blocks. Extraction
 * over-blocks rather than under-blocks.
 */

import { canonicalizeText } from './canonicalize';
import {
  extractMoney,
  extractDates,
  extractPercentages,
  extractPattern,
  normalizeMoney,
} from './extract';
import { assertSafePattern } from './pattern-safety';

export interface Violation {
  code: string;
  label: string;
  detail?: string;
}

export interface VerifyResult {
  verdict: 'pass' | 'block';
  violations: Violation[];
}

export interface FactSlot {
  prefix?: string;
  suffix?: string;
}

export interface RequiredFact {
  value: string;
  label: string;
  slot?: FactSlot;
}

export interface AllowedFact {
  value: string;
  [key: string]: unknown;
}

export interface ForbiddenPattern {
  pattern: string;
  label: string;
  flags?: string;
}

export interface ExtractPatternSpec {
  pattern: string;
  label: string;
}

export interface ExtractOptions {
  money?: boolean;
  dates?: boolean;
  percentages?: boolean;
  patterns?: ExtractPatternSpec[];
}

export interface SourceOfTruth {
  requiredFacts: RequiredFact[];
  allowedFacts: AllowedFact[];
  forbiddenPatterns?: ForbiddenPattern[];
  extract?: ExtractOptions;
}

/** Heuristic signal that legal-citation language is present (adapted from letter-cannon). */
export const DEFAULT_CITATION_SIGNAL =
  '\\u00A7|\\bsection\\s+\\d|\\b(?:RCW|NRS|USC|U\\.S\\.C|ORC|Civ\\.\\s*Code|Stat\\.|Code\\s+(?:Ann|of))\\b';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundary(term: string, flags: string): RegExp {
  return new RegExp('\\b' + escapeRegExp(term) + '\\b', flags);
}

// MAX_PATTERN_LENGTH + assertSafePattern live in ./pattern-safety.js (shared with extract.ts).

function firstMoneyAfterPrefix(text: string, prefix: string) {
  const prefixIdx = text.indexOf(prefix);
  if (prefixIdx === -1) return null;
  return extractMoney(text.slice(prefixIdx + prefix.length))[0] ?? null;
}

/**
 * Check whether a required fact is satisfied by the candidate text.
 *
 * The fact (with its optional role-slot prefix/suffix) must appear verbatim.
 * For a slotted money fact, a formatting variant of the same amount in the
 * same role is accepted (e.g. "$2000" for "$2,000.00" after "return ").
 * Enforcement is unconditional: an absent required fact is a missing_required
 * violation (no silent omission), in line with the fail-closed guarantee.
 */
function isRequiredFactSatisfied(text: string, fact: RequiredFact): boolean {
  const canonValue = canonicalizeText(fact.value);
  const canonPrefix = canonicalizeText(fact.slot?.prefix ?? '');
  const canonSuffix = canonicalizeText(fact.slot?.suffix ?? '');
  const exact = canonPrefix + canonValue + canonSuffix;

  if (text.includes(exact)) return true;

  // Money-normalization fallback, only for slotted money facts: accept any
  // formatting variant of the same amount appearing in the same role-slot.
  if (!canonPrefix) return false;

  const moneyNorm = normalizeMoney(fact.value);
  if (moneyNorm === fact.value.trim()) return false;

  return firstMoneyAfterPrefix(text, canonPrefix)?.normalized === moneyNorm;
}

function forbiddenRegex(pattern: ForbiddenPattern): RegExp {
  assertSafePattern(pattern.pattern); // fail closed on oversized / ReDoS-prone caller patterns (CodeQL js/regex-injection)
  const flags = pattern.flags ?? 'i';
  const isBareWord = /^[\w\s]+$/.test(pattern.pattern);
  return isBareWord ? wordBoundary(pattern.pattern, flags) : new RegExp(pattern.pattern, flags);
}

function addRequiredFactViolations(violations: Violation[], text: string, requiredFacts: RequiredFact[]) {
  for (const fact of requiredFacts) {
    if (fact.value.trim() === '') continue;
    if (!isRequiredFactSatisfied(text, fact)) {
      violations.push({ code: 'missing_required', label: fact.label });
    }
  }
}

function addForbiddenPatternViolations(
  violations: Violation[],
  text: string,
  allowedValues: string[],
  forbiddenPatterns: ForbiddenPattern[] = [],
) {
  for (const pattern of forbiddenPatterns) {
    // ReDoS / oversized-pattern safety is enforced inside forbiddenRegex (below).
    const authorized = allowedValues.some((value) => forbiddenRegex(pattern).test(value));
    if (forbiddenRegex(pattern).test(text) && !authorized) {
      violations.push({ code: 'forbidden_match', label: pattern.label });
    }
  }
}

function addExtractedTokenViolations(
  violations: Violation[],
  text: string,
  corpus: string,
  label: string,
  extractTokens: (input: string) => { raw: string; normalized: string }[],
) {
  const allowed = new Set(extractTokens(corpus).map((token) => token.normalized));
  for (const token of extractTokens(text)) {
    if (!allowed.has(token.normalized)) {
      violations.push({ code: 'fabricated_fact', label, detail: token.raw });
    }
  }
}

function addRegisteredPatternViolations(
  violations: Violation[],
  text: string,
  corpus: string,
  patterns: ExtractPatternSpec[] = [],
) {
  for (const pattern of patterns) {
    assertSafePattern(pattern.pattern); // fail closed on a ReDoS-prone caller pattern
    const allowed = new Set(extractPattern(corpus, pattern.pattern).map((match) => canonicalizeText(match)));
    for (const match of extractPattern(text, pattern.pattern)) {
      if (!allowed.has(canonicalizeText(match))) {
        violations.push({ code: 'fabricated_fact', label: pattern.label, detail: match });
      }
    }
  }
}

function addExtractViolations(
  violations: Violation[],
  text: string,
  source: SourceOfTruth,
  extractOptions: ExtractOptions,
) {
  const corpus = canonicalizeText(
    [...source.allowedFacts, ...source.requiredFacts].map((fact) => fact.value).join('\n'),
  );

  if (extractOptions.money !== false) {
    addExtractedTokenViolations(violations, text, corpus, 'money', extractMoney);
  }
  if (extractOptions.dates !== false) {
    addExtractedTokenViolations(violations, text, corpus, 'date', extractDates);
  }
  if (extractOptions.percentages !== false) {
    addExtractedTokenViolations(violations, text, corpus, 'percentage', extractPercentages);
  }
  addRegisteredPatternViolations(violations, text, corpus, extractOptions.patterns);
}

export function verify(candidate: string, source: SourceOfTruth): VerifyResult {
  try {
    const violations: Violation[] = [];
    const text = canonicalizeText(candidate);

    // 1. Required facts: each must appear verbatim, with an optional role-slot
    //    (prefix/suffix) to prevent two same-typed values from swapping roles.
    //    Enforcement is unconditional: an absent required fact blocks.
    addRequiredFactViolations(violations, text, source.requiredFacts);

    // 2. Forbidden patterns: must not match unless an allowed fact authorizes them.
    //    Bare-word patterns are matched with word boundaries so "Cooper" does not
    //    match inside "Coopersville"; patterns with regex metacharacters are used as-is.
    const allowedValues = source.allowedFacts.map((a) => canonicalizeText(a.value));
    addForbiddenPatternViolations(violations, text, allowedValues, source.forbiddenPatterns);

    // 3. Positive entailment: every extracted operational token must trace to an allowed fact.
    const ext = source.extract ?? { money: true, dates: true, percentages: true };
    addExtractViolations(violations, text, source, ext);

    return { verdict: violations.length === 0 ? 'pass' : 'block', violations };
  } catch (err) {
    // Fail-closed: any internal error — including a malformed or missing
    // source-of-truth — blocks.
    return {
      verdict: 'block',
      violations: [
        { code: 'engine_error', label: 'engine', detail: err instanceof Error ? err.message : 'unknown' },
      ],
    };
  }
}
