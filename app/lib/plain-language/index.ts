import { describeBash, type BashIntel } from './bash';
import { describeFile, type FileIntel } from './files';
import { describeGenericTool, describeMcp } from './tools';
import { applySafetyFloor, type PlainDescription, unknownDescription } from './types';

export type { PlainDescription, Confidence } from './types';

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

  // The stop hook writes prose with no label.
  if (label === null) {
    return {
      headline: goal,
      warnings: [],
      confidence: 'high',
      reversible: true,
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

  return applySafetyFloor(desc, input.risk_score ?? 0);
}
