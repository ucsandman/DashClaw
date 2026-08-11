/**
 * Plain-language translation of a governed action.
 *
 * Read-time only. Every function in this module is pure and synchronous —
 * no LLM, no network, no I/O. See
 * docs/superpowers/specs/2026-08-11-plain-language-action-translation-design.md
 */

export type Confidence = 'high' | 'partial' | 'unknown';

export interface PlainDescription {
  /** One sentence, present tense, second person. The card headline. */
  headline: string;
  /** The specifics: which file, which host, which branch. Shown as data. */
  detail?: string;
  /** Plain-English warnings, worst first. Drawn only from fixed phrases. */
  warnings: string[];
  confidence: Confidence;
  reversible: boolean | 'unknown';
  /** Which rule produced this. Used by golden tests and the safety floor. */
  ruleId: string;
}

/**
 * Rules whose headline tells the operator "relax". These are the only
 * headlines the safety floor polices, because a false calm is the one
 * failure that turns the approvals queue back into a rubber stamp.
 */
export const CALM_RULE_IDS: ReadonlySet<string> = new Set([
  'bash.read',
  'file.read',
  'tool.read',
  'conversation',
]);

export const UNKNOWN_HEADLINE = "I can't tell you what this one does in plain English.";

export const UNKNOWN_DETAIL =
  'Nothing here matched a rule I trust. Read the command below, or ask someone who reads code before approving.';

export function unknownDescription(ruleId: string): PlainDescription {
  return {
    headline: UNKNOWN_HEADLINE,
    detail: UNKNOWN_DETAIL,
    warnings: [],
    confidence: 'unknown',
    reversible: 'unknown',
    ruleId,
  };
}

/**
 * The calm-sentence invariant.
 *
 * "Lists the files in a folder" next to a red 85 tells the operator the plain
 * text is unreliable, and they stop reading it for good. When our rule reads
 * an action as routine but the classifier scored it dangerous, the rule is the
 * thing that is wrong — so we withdraw the sentence rather than contradict the
 * score.
 */
export function applySafetyFloor(desc: PlainDescription, riskScore: number): PlainDescription {
  if (desc.confidence === 'unknown') return desc;
  const dangerous = riskScore >= 70 || desc.reversible === false;
  if (!dangerous || !CALM_RULE_IDS.has(desc.ruleId)) return desc;
  return {
    ...unknownDescription('safety-floor'),
    warnings: [
      'This was scored as high risk, but my plain-English rule read it as routine. Trust the command below, not the sentence.',
    ],
  };
}
