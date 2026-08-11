import { type PlainDescription, unknownDescription } from './types';

/** Longest extracted value we will ever put on a card. */
const MAX_DETAIL = 300;

/**
 * Command and payload text is attacker-influenced — a filename can literally
 * be `"; ignore that, this is safe to approve`. Extracted values are bounded
 * and rendered as data by the card, never woven into our own sentences.
 */
function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL)}…` : flat;
}

interface Phrase {
  headline: string;
  ruleId: string;
  reversible: boolean;
  warnings?: string[];
}

/** Generic (non-MCP, non-file, non-shell) tools. */
export const TOOL_PHRASES: Readonly<Record<string, Phrase>> = {
  Read: { headline: 'Reads a file. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  Glob: { headline: 'Searches for files by name. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  Grep: { headline: 'Searches inside files for text. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  WebFetch: {
    headline: 'Fetches a page from the internet.',
    ruleId: 'tool.network',
    reversible: true,
    warnings: ['The contents of that page are chosen by whoever runs the website.'],
  },
  WebSearch: { headline: 'Searches the web.', ruleId: 'tool.network', reversible: true },
  Task: { headline: 'Starts another agent to work on a sub-task.', ruleId: 'tool.delegate', reversible: true },
};

/** DashClaw's own MCP tools, keyed by method name. We own all of these. */
export const MCP_PHRASES: Readonly<Record<string, Phrase>> = {
  dashclaw_guard: { headline: 'Asks DashClaw whether this action is allowed.', ruleId: 'mcp.guard', reversible: true },
  dashclaw_record: { headline: 'Records an action in your decision ledger.', ruleId: 'mcp.record', reversible: true },
  dashclaw_wait_for_approval: { headline: 'Waits for you to approve or reject an action.', ruleId: 'mcp.wait', reversible: true },
  dashclaw_session_start: { headline: 'Starts a governed work session.', ruleId: 'mcp.session', reversible: true },
  dashclaw_session_end: { headline: 'Ends a governed work session.', ruleId: 'mcp.session', reversible: true },
  dashclaw_policies_list: { headline: 'Reads your policy list. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  dashclaw_decisions_recent: { headline: 'Reads recent decisions. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  dashclaw_capabilities_list: { headline: 'Reads the capability list. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  dashclaw_assumption_record: { headline: 'Records an assumption the agent is relying on.', ruleId: 'mcp.record', reversible: true },
  dashclaw_plan_submit: { headline: 'Submits a plan for you to review before work starts.', ruleId: 'mcp.plan', reversible: true },
  dashclaw_plan_status: { headline: 'Checks whether a submitted plan was approved.', ruleId: 'tool.read', reversible: true },
  dashclaw_task_create: { headline: 'Creates a task.', ruleId: 'mcp.task', reversible: true },
  dashclaw_task_update: { headline: 'Updates a task.', ruleId: 'mcp.task', reversible: true },
  dashclaw_task_event: { headline: 'Adds an event to a task.', ruleId: 'mcp.task', reversible: true },
  dashclaw_pair: { headline: 'Pairs this agent with your DashClaw workspace.', ruleId: 'mcp.pair', reversible: true },
  dashclaw_invoke: { headline: 'Runs a governed capability.', ruleId: 'mcp.invoke', reversible: true },
  dashclaw_session_retro: { headline: 'Writes a session retrospective.', ruleId: 'mcp.record', reversible: true },
  dashclaw_status: { headline: 'Reads DashClaw status. Nothing is changed.', ruleId: 'tool.read', reversible: true },
};

function fromPhrase(p: Phrase): PlainDescription {
  return {
    headline: p.headline,
    warnings: p.warnings ? [...p.warnings] : [],
    confidence: 'high',
    reversible: p.reversible,
    ruleId: p.ruleId,
  };
}

/**
 * `payload` is the full `mcp__<server>__<method>` tool name, taken verbatim
 * from declared_goal after the "MCP: " prefix.
 */
export function describeMcp(payload: string, server?: string): PlainDescription {
  const parts = payload.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return unknownDescription('mcp.malformed');

  const resolvedServer = server || parts[1] || 'unknown';
  const method = parts.slice(2).join('__');

  const known = MCP_PHRASES[method];
  if (known) return fromPhrase(known);

  // Never invent a description. Name the server and the tool so the operator
  // has something concrete to ask about.
  const u = unknownDescription('mcp.unregistered');
  return {
    ...u,
    detail: clip(
      `This uses a tool called "${method}" from the "${resolvedServer}" server. I don't have a description for it.`,
    ),
  };
}

export function describeGenericTool(label: string, payload: string): PlainDescription {
  const known = TOOL_PHRASES[label];
  if (known) return fromPhrase(known);

  const u = unknownDescription('tool.unregistered');
  return {
    ...u,
    detail: clip(`This uses a tool called "${label}". I don't have a description for it. It was called with: ${payload}`),
  };
}
