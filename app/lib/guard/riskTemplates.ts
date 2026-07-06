/**
 * Org risk-template evaluation — the pure risk-RAISING math the guard's decide
 * step folds in via `computeRiskAssessment` (guard/risk.ts). Ported out of the
 * (now-retired) scoring subsystem so the guard engine owns its own decision
 * inputs: an org-authored template like `action_type==delete → +30` can only
 * RAISE the effective score (folded via max), never lower it.
 *
 * Zero DB dependencies — callers load the `risk_templates` rows and pass them
 * in. Kept deliberately small: a safe condition evaluator plus the template
 * fold, nothing from the deleted profiles/dimensions grading engine.
 */

/** The action being scored. Loosely typed — external, client-declared shape. */
export interface ActionInput {
  action_type?: string | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RiskTemplateRule {
  condition: string;
  add?: number;
}

export interface RiskTemplate {
  id?: string;
  name?: string;
  action_type?: string | null;
  base_risk?: number;
  rules?: RiskTemplateRule[];
  status?: string;
  [key: string]: unknown;
}

/** Resolve a dotted path like "result.latency" against a source object. */
function resolveFieldPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown> | null | undefined)?.[key], source);
}

/**
 * Simple safe condition evaluator. Supports:
 * - "field == value"  / "field != value"
 * - "field > value"   / "field >= value"
 * - "field < value"   / "field <= value"
 * - "field contains value"
 */
const CONDITION_PATTERNS: { regex: RegExp; fn: (a: unknown, b: unknown) => boolean }[] = [
  { regex: /^(.+?)\s*==\s*(.+)$/, fn: (a, b) => String(a) === String(b) },
  { regex: /^(.+?)\s*!=\s*(.+)$/, fn: (a, b) => String(a) !== String(b) },
  { regex: /^(.+?)\s*>=\s*(.+)$/, fn: (a, b) => Number(a) >= Number(b) },
  { regex: /^(.+?)\s*<=\s*(.+)$/, fn: (a, b) => Number(a) <= Number(b) },
  { regex: /^(.+?)\s*>\s*(.+)$/, fn: (a, b) => Number(a) > Number(b) },
  { regex: /^(.+?)\s*<\s*(.+)$/, fn: (a, b) => Number(a) < Number(b) },
  { regex: /^(.+?)\s+contains\s+(.+)$/i, fn: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase().replace(/['"]/g, '')) },
];

/** Parse a condition target  --  handle booleans, null, and numbers. */
function parseConditionTarget(raw: string): unknown {
  const targetValue = raw.trim().replace(/^['"]|['"]$/g, '');
  if (targetValue === 'true') return true;
  if (targetValue === 'false') return false;
  if (targetValue === 'null') return null;
  if (!isNaN(targetValue as unknown as number) && targetValue !== '') return Number(targetValue);
  return targetValue;
}

function evaluateCondition(condition: unknown, action: ActionInput): boolean {
  if (!condition || typeof condition !== 'string') return false;

  for (const { regex, fn } of CONDITION_PATTERNS) {
    const match = condition.match(regex);
    if (!match) continue;

    const fieldValue = resolveFieldPath(action, (match[1] as string).trim());
    const targetValue = parseConditionTarget(match[2] as string);

    return fn(fieldValue, targetValue);
  }

  return false;
}

function sumMatchedRuleRisk(rules: RiskTemplateRule[], action: ActionInput): number {
  let added = 0;
  for (const rule of rules) {
    try {
      if (evaluateCondition(rule.condition, action)) {
        added += rule.add || 0;
      }
    } catch {
      // Skip malformed rules
    }
  }
  return added;
}

/**
 * Compute an automatic risk score for an action using the matching org risk
 * templates. Returns null when no active template matches (leaving the score
 * untouched); otherwise a clamped 0-100 integer the caller folds via max.
 */
export function computeAutoRisk(action: ActionInput, templates: RiskTemplate[]): number | null {
  // Find matching templates (by action_type, or null = matches all).
  const matching = templates.filter((t) =>
    t.status === 'active' && (!t.action_type || t.action_type === action.action_type)
  );

  if (matching.length === 0) return null;

  // Use the most specific match (action_type match beats the null wildcard).
  const template = matching.find((t) => t.action_type === action.action_type) || matching[0]!;

  const risk = (template.base_risk ?? 0) + sumMatchedRuleRisk(template.rules || [], action);

  return Math.max(0, Math.min(100, risk));
}
