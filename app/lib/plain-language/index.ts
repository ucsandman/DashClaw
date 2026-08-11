import { describeBash, type BashIntel } from './bash';
import { describeFile, type FileIntel } from './files';
import { describeGenericTool, describeMcp } from './tools';
import {
  applySafetyFloor,
  clampHeadline,
  IRREVERSIBLE_TEXT,
  MAX_HEADLINE,
  READ_ONLY_REASSURANCE,
  type PlainDescription,
  unknownDescription,
} from './types';

export type { PlainDescription, Confidence } from './types';
export { MAX_HEADLINE } from './types';

/** The hook's declared_goal cap (hooks/dashclaw_pretool.py:511). */
const GOAL_CAP = 2000;

const FILE_LABELS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_LABELS = new Set(['Bash', 'PowerShell']);

export interface DescribeInput {
  action_type?: string | null;
  declared_goal?: string | null;
  risk_score?: number | null;
  target?: string | null;
  intel?: { bash?: BashIntel; file?: FileIntel; mcp?: { server?: string } } | null;
}

function splitGoal(goal: string): { label: string | null; payload: string } {
  const at = goal.indexOf(': ');
  if (at <= 0) return { label: null, payload: goal };
  return { label: goal.slice(0, at), payload: goal.slice(at + 2) };
}

function route(input: DescribeInput): PlainDescription {
  const goal = (input.declared_goal || '').trim();
  if (!goal) return unknownDescription('no-goal');

  const { label, payload } = splitGoal(goal);

  // The stop hook writes prose with no label. The spec passes that prose
  // through as the sentence, because it is already plain English and it is
  // the only description of the row that exists — but passing it through is
  // NOT understanding it. Claiming 'high' and reversible:true here meant a
  // bare `rm -rf /` recorded without a label asserted "this can be undone",
  // at full confidence, about a string nothing had parsed (2026-08-11
  // pre-merge review). Nothing read it, so nothing may vouch for it.
  if (label === null) {
    return {
      headline: goal,
      warnings: [],
      confidence: 'partial',
      reversible: 'unknown',
      ruleId: 'conversation',
    };
  }

  if (SHELL_LABELS.has(label)) return describeBash(payload, input.intel?.bash);

  if (FILE_LABELS.has(label)) {
    // `target` is the authoritative path (hooks/dashclaw_pretool.py:562);
    // the goal payload is the same value but may have been truncated.
    return describeFile(label, input.target || payload, input.intel?.file);
  }

  if (label === 'MCP') return describeMcp(payload, input.intel?.mcp?.server);

  return describeGenericTool(label, payload);
}

export function describeAction(input: DescribeInput): PlainDescription {
  let desc: PlainDescription;
  try {
    desc = route(input);
  } catch (err) {
    // A crashed sentence generator must never blank the hero surface. Worst
    // case the card degrades to exactly what it renders today.
    console.warn('[plain-language] describeAction failed:', (err as Error)?.message);
    return unknownDescription('translator-error');
  }

  // Silent truncation at the hook's cap means the tail is unknowable.
  const goal = input.declared_goal || '';
  if (goal.length >= GOAL_CAP && desc.confidence === 'high') {
    desc = {
      ...desc,
      confidence: 'partial',
      warnings: [...desc.warnings, 'This command was too long to record in full, so I can only read the start of it.'],
    };
  }

  // clampHeadline runs last so it covers every rule and the safety floor's
  // own replacement text — nothing downstream can widen what it bounded.
  return splitPresentation(clampHeadline(applySafetyFloor(desc, input.risk_score ?? 0)));
}

/**
 * Presentation-only pass, applied after every safety rule has had its say.
 *
 * Two things travelled in `warnings` that are not warnings:
 *
 * 1. The read-rule's reassurance. "Reads only, changes nothing." rendered in
 *    the same amber, behind the same triangle, as "Work other people pushed
 *    can be lost." — so the safest action on the queue wore the alarm colour.
 *    It moves to `reassurance`. Crucially this runs AFTER describeBash's
 *    calm-eligibility filter, so a reassurance that was suppressed as
 *    unsupportable is already gone and can never be resurrected here.
 *
 * 2. The irreversibility sentence. `bash.sql.drop` and `bash.sql.delete`
 *    emit it as a warning so the fact survives when the classifier sent no
 *    reversibility at all — but when the classifier DID say `reversible:
 *    false`, the card already renders that exact sentence as its red band,
 *    and the operator read it twice in two colours. Dropped only in that
 *    case, so the no-intel path keeps its only signal.
 *
 * Neither branch can invent text: both compare against the module's own
 * fixed phrases.
 */
function splitPresentation(desc: PlainDescription): PlainDescription {
  const reassurance = desc.warnings.includes(READ_ONLY_REASSURANCE)
    ? READ_ONLY_REASSURANCE
    : undefined;

  const warnings = desc.warnings.filter(
    (w) => w !== READ_ONLY_REASSURANCE && !(desc.reversible === false && w === IRREVERSIBLE_TEXT),
  );

  if (!reassurance && warnings.length === desc.warnings.length) return desc;
  return { ...desc, warnings, ...(reassurance ? { reassurance } : {}) };
}

/**
 * The block a notification channel prepends above the exact command: the
 * sentence, then its warnings.
 *
 * Telegram and Discord both call this, so the two cards cannot drift and
 * neither can rediscover the same bug. Warnings are the point — a Telegram
 * card that said "Overwrites the shared code history on GitHub" while
 * silently dropping "Work other people pushed can be lost." withheld the one
 * line the operator needed, on the surface they actually read.
 *
 * The block is bounded so each channel can compute the room left for the
 * command underneath it by subtraction, and so a long warning list can never
 * push a message past a channel limit on its own. The headline is always
 * kept (it is already <= MAX_HEADLINE); warnings are added while they fit,
 * worst first, since that is the order the rules emit them in.
 */
const MAX_NOTIFICATION_PLAIN = MAX_HEADLINE + 500;

export function plainNotificationLines(desc: PlainDescription): string[] {
  if (desc.confidence === 'unknown') return [];
  const lines = [desc.headline];
  let used = desc.headline.length;

  // The approvals card renders irreversibility as a red band above the
  // sentence. A chat message has no band, so it has to be said in words or
  // the operator reading Telegram is told strictly less than the operator
  // reading the dashboard — and this is the one fact most worth telling.
  // Worst first. The sql rules also carry this sentence as a warning when no
  // classifier reversibility arrived, so the warning list is filtered to keep
  // it from being said twice.
  const body = [
    ...(desc.reversible === false ? [IRREVERSIBLE_TEXT] : []),
    ...desc.warnings.filter((w) => w !== IRREVERSIBLE_TEXT),
    // A reassurance is the least urgent thing here, so it goes last and is
    // the first casualty of the budget.
    ...(desc.reassurance ? [desc.reassurance] : []),
  ];

  for (const line of body) {
    if (used + 1 + line.length > MAX_NOTIFICATION_PLAIN) break;
    lines.push(line);
    used += 1 + line.length;
  }
  return lines;
}
