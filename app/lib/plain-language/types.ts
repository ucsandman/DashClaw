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

/**
 * The longest headline any rule may ever produce.
 *
 * A headline is one sentence, and it is prepended to messages with hard
 * channel limits: Telegram caps a message at 4096 characters and Discord caps
 * an embed description at 4096. Before this cap existed, a 120-stage chain
 * from a declared_goal of only 1562 characters composed a 5034-character
 * headline, which 400ed BOTH channels — so the operator received no approval
 * notification at all for exactly the class of command most worth one
 * (measured, 2026-08-11 pre-merge review).
 *
 * 400 rather than something tighter because it holds four or five typical
 * clauses (the longest single clause is a verb plus an 80-character noun).
 * 400 rather than something looser because a sentence longer than a phone
 * screen has stopped being a headline, and the exact command is always
 * rendered directly below it. It also leaves both 4096-character channels at
 * least 3600 characters for that command.
 */
export const MAX_HEADLINE = 400;

/**
 * The final backstop on headline length, applied once at the end of
 * describeAction so that no rule — present or future — can emit an unbounded
 * sentence. Rules that can legitimately run long (a shell chain) trim
 * themselves clause by clause first, so arriving here means the text was
 * never sentence-shaped to begin with; cutting it is safe because the
 * untruncated value is always shown beneath the sentence.
 */
export function clampHeadline(desc: PlainDescription): PlainDescription {
  if (desc.headline.length <= MAX_HEADLINE) return desc;
  return { ...desc, headline: `${desc.headline.slice(0, MAX_HEADLINE - 1)}…` };
}

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
