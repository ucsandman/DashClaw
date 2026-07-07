/**
 * DashClaw MCP tool definitions and handlers.
 * Tool definitions follow JSON Schema (for both MCP registerTool and JSON-RPC).
 * Handlers are pure functions that call DashClawClient and return text content.
 *
 * This file is HAND-CURATED on purpose. Every MCP tool has a semantically
 * precise description and custom handler logic (e.g., dashclaw_wait_for_approval
 * polls until status changes) that can't be auto-generated from route metadata.
 *
 * For the live API surface, see `routes-inventory.generated.json` (regenerated
 * by `npm run livingcode:refresh`). When adding a new route that agents should
 * invoke, diff the inventory against TOOL_DEFINITIONS below to decide whether
 * a new tool wrapper is warranted.
 */

import { createHash } from "node:crypto";
import type { DashClawClient } from "./client.js";

export interface ToolSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string };
}

export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, ToolSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export type ToolHandler = (input: any) => Promise<string>;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'dashclaw_guard',
    description:
      'Evaluate DashClaw governance policies before taking a risky action. Call this BEFORE ' +
      'any action that modifies external systems, deploys code, sends messages, or touches ' +
      'production data. Returns a decision: "allow" (proceed), "warn" (proceed with caution), ' +
      '"block" (stop), or "require_approval" (wait for human in Mission Control). If the ' +
      'decision is "block", do NOT proceed with the action.',
    inputSchema: {
      type: 'object',
      properties: {
        action_type: { type: 'string', description: 'Category of action (e.g., deploy, send_email, database_write, api_call)' },
        declared_goal: { type: 'string', description: 'What you intend to do, in plain language' },
        risk_score: { type: 'integer', description: 'Estimated risk 0-100. Use 70+ for production systems.' },
        agent_id: { type: 'string', description: 'Fallback identity when no server-level agent id is configured (the configured id wins)' },
        systems_touched: { type: 'array', items: { type: 'string' }, description: 'Systems affected (e.g., production, database, email)' },
        reversible: { type: 'boolean', description: 'Whether the action can be undone' },
        target: { type: 'string', description: 'Primary file path, URL, or resource the action touches (lets protected-path policies match)' },
        write_paths: { type: 'array', items: { type: 'string' }, description: 'File paths the action will write or modify (protected-path policy matching)' },
        content: { type: 'string', description: 'Outbound content excerpt (file content, message body) so secret-scan and content policies can evaluate it' },
        tool_name: { type: 'string', description: 'Name of the tool that will perform the action (e.g., Write, Bash, send_email)' },
        act: { type: 'object', description: 'Evidence-first guard: attach the actual act being evaluated so the server classifies it and folds the derived risk in, instead of trusting only the declared action_type/risk_score above. Shape: { kind: "shell"|"http"|"sql"|"file", command? (shell), request?: { method, url, body_excerpt? } (http), statement? (sql), file?: { path, content_excerpt?, bytes? } (file) }. Optional — omit when you have no concrete evidence to attach.' },
        approval_wait_seconds: { type: 'integer', description: 'How long you will poll dashclaw_wait_for_approval if the decision is require_approval (default 300; the approval expires after this window + a retry grace)' },
      },
      required: ['action_type', 'declared_goal', 'risk_score'],
    },
  },
  {
    name: 'dashclaw_record',
    description:
      'Record a governed action in DashClaw\'s audit trail. Use this to log significant ' +
      'decisions, completed tasks, or notable outcomes. Every important action the agent takes ' +
      'should be recorded for governance visibility in Mission Control and the Decisions ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        action_type: { type: 'string', description: 'Category (e.g., research, analysis, code_change, deploy)' },
        declared_goal: { type: 'string', description: 'What was accomplished' },
        status: { type: 'string', enum: ['running', 'completed', 'failed', 'pending_approval'], description: 'Outcome status' },
        risk_score: { type: 'integer', description: 'Risk level 0-100 (default 30)' },
        agent_id: { type: 'string', description: 'Fallback identity when no server-level agent id is configured (the configured id wins)' },
        reasoning: { type: 'string', description: 'Why this action was chosen' },
        confidence: { type: 'integer', description: 'Confidence 0-100' },
        systems_touched: { type: 'array', items: { type: 'string' }, description: 'Systems affected' },
        reversible: { type: 'boolean', description: 'Whether the action can be undone' },
        output_summary: { type: 'string', description: 'Brief summary of what was produced' },
        tokens_in: { type: 'integer', description: 'Input tokens consumed' },
        tokens_out: { type: 'integer', description: 'Output tokens produced' },
        model: { type: 'string', description: 'Model used' },
        cost_estimate: { type: 'number', description: 'Estimated cost in USD' },
        session_id: { type: 'string', description: 'Session to attribute this action to. Defaults to the session started via dashclaw_session_start in this connection.' },
        approval_wait_seconds: { type: 'integer', description: 'For status pending_approval: how long you will poll for the decision (default 300; the approval expires after this window + a retry grace)' },
        act: { type: 'object', description: 'The actual act this record covers — pass the SAME act object you sent to dashclaw_guard. For status pending_approval the server stamps a content hash from it, binding the operator\'s approval to this exact act: the approval then only covers a dashclaw_guard retry presenting the same act. Shape matches dashclaw_guard\'s act ({ kind: "shell"|"http"|"sql"|"file", ... }). Optional — omit when no concrete act exists.' },
      },
      required: ['action_type', 'declared_goal', 'status'],
    },
  },
  {
    name: 'dashclaw_invoke',
    description:
      'Invoke a DashClaw-governed capability (external API). The capability is guarded ' +
      '(policy check), executed (HTTP call), and recorded (audit trail) automatically. Use ' +
      'this instead of making direct HTTP calls when the target API is registered as a DashClaw ' +
      'capability. Call dashclaw_capabilities_list first to discover available capability IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string', description: 'The capability ID (e.g., cap_abc123)' },
        declared_goal: { type: 'string', description: 'What you\'re trying to accomplish' },
        agent_id: { type: 'string', description: 'Fallback identity when no server-level agent id is configured (the configured id wins)' },
        payload: { type: 'object', description: 'Request payload for the capability' },
      },
      required: ['capability_id', 'declared_goal'],
    },
  },
  {
    name: 'dashclaw_capabilities_list',
    description:
      'List available capabilities registered in DashClaw. Use this to discover what external ' +
      'APIs and tools are available before invoking them. Returns capability IDs, names, health ' +
      'status, and risk levels. Filter by category, risk level, or search term.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category: external_api, webhook, function' },
        risk_level: { type: 'string', description: 'Filter: low, medium, high, critical' },
        search: { type: 'string', description: 'Search by name or description' },
      },
    },
  },
  {
    name: 'dashclaw_policies_list',
    description:
      'List active governance policies. Use this to understand what rules govern your actions ' +
      'before taking them. Helps calibrate risk scores and know which action types require ' +
      'approval. Optionally filter to policies applying to a specific agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter to policies applying to a specific agent' },
      },
    },
  },
  {
    name: 'dashclaw_wait_for_approval',
    description:
      'Wait for a human to approve or deny a pending action in DashClaw Mission Control. ' +
      'Call this after a guard decision returns "require_approval" or after recording an ' +
      'action with status "pending_approval". Polls the action status until it changes. ' +
      'Default timeout is 300 seconds (5 minutes).',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'The action ID to wait on (e.g., act_abc123)' },
        timeout_seconds: { type: 'number', description: 'Max wait time (default 300)' },
        poll_interval_seconds: { type: 'number', description: 'Polling frequency (default 3)' },
      },
      required: ['action_id'],
    },
  },
  {
    name: 'dashclaw_session_start',
    description:
      'Register this agent session with DashClaw. Creates a session record that groups all ' +
      'subsequent actions for tracking and observability. Call this at the beginning of a task ' +
      'to establish a governance boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent identifier (required)' },
        workspace: { type: 'string', description: 'Workspace or project context' },
        branch: { type: 'string', description: 'Git branch or task branch' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'dashclaw_session_end',
    description:
      'Close a DashClaw session and update its status. Call this when the task is complete ' +
      'or if the session needs to be marked as failed. Provides a clean lifecycle boundary ' +
      'for governance reporting in Mission Control.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID from dashclaw_session_start' },
        status: { type: 'string', enum: ['completed', 'failed', 'cancelled'], description: 'Final session status' },
        summary: { type: 'string', description: 'Brief description of what was accomplished' },
      },
      required: ['session_id', 'status'],
    },
  },
  {
    name: 'dashclaw_session_retro',
    description:
      'Fetch the per-session defensibility retro ("was I manipulated?"): injected-content flags, ' +
      'actions outside the declared goal, spend anomalies, and shield hits, composed into a ' +
      'clean/review/flagged posture with evidenced findings. Read-only. Defaults to the active ' +
      'session — call it before dashclaw_session_end, or pass session_id explicitly afterwards ' +
      '(ending a session clears the active default).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID (sess_*). Defaults to the session started by dashclaw_session_start.' },
      },
    },
  },
  // --- Code Sessions: Optimal Files (Phase 6) ------------------------------
  {
    name: 'dashclaw_optimal_files_preview',
    description:
      'Preview the Optimal Files bundle DashClaw Code Sessions would generate for a given session. Returns the per-file plan with confidence, secret-scan, and overwrite-risk flags. Read-only — does NOT write to disk; pair with dashclaw_optimal_files_manifest to persist a chosen subset.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Code session id (cs_*) from /api/code-sessions/sessions/...' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'dashclaw_optimal_files_manifest',
    description:
      'Persist a write plan for selected Optimal Files entries. Returns { manifest_id, expires_at, apply_command }. The local CLI invokes `dashclaw code apply <manifest_id>` to apply the plan to disk. Manifest expires after 24h.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Code session id (cs_*)' },
        selections: {
          type: 'array',
          description: 'Subset of paths from the preview to write. Each item: { path, mode?: "skip"|"side_by_side"|"merge"|"overwrite", overwrite?, acceptedHeadings?, acceptedBullets? }',
          items: { type: 'object' },
        },
      },
      required: ['session_id', 'selections'],
    },
  },
  {
    name: 'dashclaw_handoff_create',
    description:
      'Create a session handoff bundle for the next session of this agent to consume on start. ' +
      'Call this when wrapping up — include a 1-2 sentence summary, any open loops, decisions made, ' +
      'and freeform state you want the next session to see.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Fallback identity when no server-level agent id is configured (the configured id wins)' },
        project_id: { type: 'string', description: 'Optional project ID — handoff is project-scoped' },
        bundle: {
          type: 'object',
          description: 'Handoff content: { summary, open_loops, decisions_made, state_snapshot, generated_at }',
        },
      },
      required: ['bundle'],
    },
  },
  {
    name: 'dashclaw_handoff_latest',
    description:
      'Fetch the latest unconsumed session handoff for this agent (+ project, optional). ' +
      'Call this on session start to pick up where the last session left off. Returns null if ' +
      'no handoff is waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        project_id: { type: 'string' },
      },
    },
  },
  {
    name: 'dashclaw_handoff_consume',
    description:
      'Mark a handoff as consumed. Call after dashclaw_handoff_latest returns a bundle and you ' +
      'have processed it. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Handoff id (hf_*) from handoff_latest' },
        session_id: { type: 'string', description: 'Optional current session id for provenance' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_secret_list',
    description:
      'List tracked secrets (metadata only — no values). Returns each entry with name, rotation ' +
      'interval, last_rotated_at, and computed next_rotation_due.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Optional — scope to this agent' },
      },
    },
  },
  {
    name: 'dashclaw_secret_due',
    description:
      'List secrets coming due for rotation. Call this BEFORE acting on credentials. If a ' +
      'credential you would use is in the result, flag the operator rather than proceeding.',
    inputSchema: {
      type: 'object',
      properties: {
        within_days: { type: 'integer', description: 'Lookahead window in days (default 14)' },
        agent_id: { type: 'string' },
      },
    },
  },
  {
    name: 'dashclaw_secret_mark_rotated',
    description:
      'Mark a tracked secret as rotated (sets last_rotated_at = now). Agents only call this if ' +
      'the operator instructs; secret registration is an operator task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Secret id (sec_*)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_skill_scan',
    description:
      'Run a static safety scan against the contents of an untrusted skill before loading it. ' +
      'Returns findings (severity, file, line) and a passed boolean. If passed=false, do NOT load ' +
      'the skill — show the findings to the operator.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string' },
        files: {
          type: 'object',
          description: 'Map of filename -> file content (string)',
        },
      },
      required: ['skill_name', 'files'],
    },
  },
  {
    name: 'dashclaw_loop_add',
    description:
      'Register an open loop on a parent action — a commitment made in conversation that needs ' +
      'follow-up. Use when you say "I will X later" so the loop is tracked outside of context. ' +
      'Loops are action-scoped; action_id is required.',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'Parent action id (act_*) the loop attaches to' },
        loop_type: { type: 'string', description: 'Category (e.g., follow_up, blocker, decision_pending)' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority (default medium)' },
        owner: { type: 'string', description: 'Optional owner (agent or human handle)' },
      },
      required: ['action_id', 'loop_type', 'description'],
    },
  },
  {
    name: 'dashclaw_loop_list',
    description:
      'List open (or resolved) loops with optional filters. Use on session start to remember ' +
      'what you promised to follow up on.',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'Filter by parent action' },
        status: { type: 'string', enum: ['open', 'resolved', 'cancelled'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        agent_id: { type: 'string', description: 'Filter by agent (joined via parent action)' },
        from: { type: 'string', description: 'ISO timestamp lower bound (reserved)' },
        to: { type: 'string', description: 'ISO timestamp upper bound (reserved)' },
      },
    },
  },
  {
    name: 'dashclaw_loop_close',
    description:
      'Resolve an open loop. Call when the followed-up-on item is complete. Requires the loop_id ' +
      'and a short resolution note.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Loop id (loop_*)' },
        resolution: { type: 'string', description: 'Short note describing how the loop was closed' },
      },
      required: ['id'],
    },
  },
  {
    name: 'dashclaw_assumption_record',
    description:
      'Record an assumption you are acting on — something you treat as true but have not verified ' +
      '(e.g. "staging tests passed", "no active legal hold on this record"). Attach it to the action ' +
      'whose decision rests on it so operators can later validate or refute it and staleness drift is ' +
      'tracked. Call right after the action that depends on the belief.',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'Parent action id the assumption underpins (from dashclaw_record)' },
        assumption: { type: 'string', description: 'The belief being treated as true' },
        basis: { type: 'string', description: 'Why you believe it (optional)' },
      },
      required: ['action_id', 'assumption'],
    },
  },
  {
    name: 'dashclaw_learning_log',
    description:
      'Log a decision + outcome to the learning database. Use after making a non-obvious decision ' +
      'so future sessions can recall the reasoning and outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        decision: { type: 'string', description: 'What was decided' },
        context: { type: 'string', description: 'Why this decision was made' },
        outcome: { type: 'string', description: 'What happened (optional, can be updated later)' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'dashclaw_learning_query',
    description:
      'Query the learning database for prior decisions and lessons. Use BEFORE making a decision ' +
      'similar to one you might have made before.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        query: { type: 'string', description: 'Search text (matches decision/context)' },
        limit: { type: 'integer', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'dashclaw_decisions_recent',
    description:
      'Query the guardrail decisions ledger for recent governed actions. Filter by agent, action ' +
      'type, decision verdict, or time window. Use for in-session retrospection — "what have I done ' +
      'recently?"',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        action_type: { type: 'string' },
        decision: { type: 'string', enum: ['allow', 'warn', 'block', 'require_approval'] },
        since: { type: 'string', description: 'ISO timestamp lower bound' },
        limit: { type: 'integer', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'dashclaw_behavior_suggestions',
    description:
      'List DashClaw Policy Coach suggestions — evidence-backed, observe-only policy suggestions ' +
      'the analyzer learned from this agent\'s locally-recorded behavior (destructive commands, ' +
      'protected-path writes, repeated reloads, failed loops, model/task mismatches, and the safe ' +
      'operating envelope). Read-only: each suggestion carries confidence, sample size, evidence, and ' +
      'expected effect. Review, simulate, and adopt them from the Policy Coach UI — nothing is enforced ' +
      'automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Override default agent ID (filter to one agent)' },
      },
    },
  },
  {
    name: 'dashclaw_inbox_list',
    description:
      'List this agent\'s DashClaw inbox messages and unread count. Use at the start of a session, ' +
      'or when notified, to see governance messages, lessons, questions, and status updates addressed ' +
      'to you before deciding what to do next. Each message includes an is_read flag; the response also ' +
      'carries the total unread_count. Pair with dashclaw_messages_mark_read once you have processed them.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter to one agent (defaults to the configured agent id)' },
        direction: { type: 'string', enum: ['inbox', 'sent'], description: 'inbox (received) or sent. Default inbox.' },
        unread: { type: 'boolean', description: 'When true, return only unread messages.' },
        type: { type: 'string', description: 'Filter by message type (action, info, lesson, question, status).' },
        limit: { type: 'integer', description: 'Max messages (default 50).' },
      },
    },
  },
  {
    name: 'dashclaw_messages_mark_read',
    description:
      'Mark one or more DashClaw inbox messages as read for this agent. Call after processing messages ' +
      'from dashclaw_inbox_list so they stop reappearing as unread. Direct messages are marked read for ' +
      'the target agent; broadcasts record this agent in read_by. Returns { updated: <count> }.',
    inputSchema: {
      type: 'object',
      properties: {
        message_ids: { type: 'array', items: { type: 'string' }, description: 'Message IDs (msg_*) to mark read.' },
        agent_id: { type: 'string', description: 'Fallback identity when no server-level agent id is configured (the configured id wins)' },
      },
      required: ['message_ids'],
    },
  },
  {
    name: 'dashclaw_pair',
    description:
      'Enroll this agent\'s cryptographic identity with DashClaw (operator pairing requests in your inbox ' +
      'ask for exactly this). Generates an RSA-2048 keypair locally, stores the PRIVATE key on this machine ' +
      'only (~/.dashclaw/identity/<agent_id>.pem — never logged, never sent), and POSTs the public key to ' +
      '/api/pairings. An admin then approves the pairing, which creates the agent identity and lets your ' +
      'recorded actions be signature-verified. Set wait:true to poll until approved/expired (max 5 min). ' +
      'After pairing, mark the request message read via dashclaw_messages_mark_read.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Fallback identity when no server-level agent id is configured (the configured id wins)' },
        agent_name: { type: 'string', description: 'Human-readable agent name shown to the approving admin.' },
        wait: { type: 'boolean', description: 'Poll the pairing until approved/expired (default false).' },
      },
    },
  },
];

// ── Guard availability mapping (fail closed) ──
// Mirrors the discipline of src/actions.ts guardWithDashclaw ("DashClaw
// unavailable; refusing risky action"): a transport error must never read as
// permission. DASHCLAW_GUARD_UNAVAILABLE_POLICY matches the Python hook's env
// name and default (block); `allow` is the documented self-hoster escape hatch.

function guardUnavailablePolicy(): 'block' | 'allow' {
  const v = (process.env.DASHCLAW_GUARD_UNAVAILABLE_POLICY || 'block').toLowerCase();
  return v === 'allow' ? 'allow' : 'block';
}

// DashClawClient maps fetch failures to { error, _status: 0 } and non-2xx to
// { ...body, _status }; a successful response never carries _status.
function transportFailed(result: any): boolean {
  return !result || typeof result !== 'object' || result._status != null;
}

// Guard responses must carry a decision string; anything else (transport
// error, non-2xx, malformed 200) is treated as guard-unavailable.
function guardUnavailable(result: any): boolean {
  return transportFailed(result) || typeof result.decision !== 'string';
}

function transportDetail(result: any): string {
  if (!result || typeof result !== 'object') return 'no response';
  if (result.error) return String(result.error);
  if (result._status != null && result._status !== 0) return `HTTP ${result._status}`;
  return 'no decision in response';
}

// Parse a client.fetch() response and make failure STRUCTURAL: on non-2xx (or
// transport failure) the returned object always carries `error` + `_status`.
// Write tools previously forwarded whatever body a 4xx/5xx sent — if that body
// looked plausible, the caller had no signal that the write was NOT persisted.
async function jsonOrFailure(res: { ok: boolean; status: number; json: () => Promise<any> }): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const body = data && typeof data === 'object' ? data : {};
  return {
    ...body,
    error: body.error ? String(body.error) : `HTTP ${res.status || 0} — request failed; the write was NOT persisted`,
    _status: res.status ?? 0,
  };
}

// Idempotency key derivation — mirror of the reference implementation in
// sdk/dashclaw.js deriveIdempotencyKey (and the Python hook/SDK mirrors):
// sorted "k=v" pairs joined with "|", SHA-256 hex. Identical parts must derive
// identical keys on every surface. MCP has no tool_use_id, so an hour bucket
// scopes content-identical calls: a blind retry seconds later dedupes, the
// same logical action re-run much later is a new action. Use only
// strings/numbers/null as values (bool formatting differs between languages).
function deriveIdempotencyKey(parts: Record<string, unknown>): string {
  const ordered = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k] ?? ''}`)
    .join('|');
  return createHash('sha256').update(ordered).digest('hex');
}

function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000);
}

/**
 * Create tool handler functions bound to a DashClawClient instance.
 * Each handler accepts input args and returns a JSON string (MCP text content).
 */
export function createToolHandlers(client: DashClawClient): Record<string, ToolHandler> {
  // WRITE identity: server-configured agent_id (DASHCLAW_AGENT_ID / --agent-id /
  // auto-derived from MCP clientInfo) wins over anything the LLM passes in the
  // tool call. This is deliberate: agent identity is a governance primitive,
  // and letting the LLM pick its own agent_id based on prompt context (e.g.
  // it sees "smoke test" and picks "claude-mcp-smoketest") breaks attribution
  // and lets a single misbehaving prompt impersonate a different agent. The
  // input.agent_id field is preserved only as a last-resort fallback for
  // configurations that intentionally run without a server-level default.
  const agentId = (input: any) => client.agentId || input.agent_id;

  // READ filter: the opposite precedence. On query tools agent_id is a filter,
  // not an identity claim — "show me moltfire's loops" must not be silently
  // rewritten to the server's own agent_id (that bug made every cross-agent
  // read return the caller's rows). Explicit filter wins; the configured
  // identity is only the default scope when the caller passes nothing.
  const agentIdFilter = (input: any) => input.agent_id || client.agentId;

  // Ambient session: dashclaw_session_start stashes the created session id here
  // so dashclaw_record auto-stamps it without the LLM re-threading it. Lives in
  // this per-client closure — per-process for stdio, per-request for HTTP — so
  // it is never module-global and the stateless HTTP transport can't leak one
  // org's session onto another's record.
  let activeSessionId: string | null = null;

  return {
    async dashclaw_optimal_files_preview(input: any) {
      const result = await client.post(`/api/code-sessions/sessions/${encodeURIComponent(input.session_id)}/optimal-files/preview`, {}, { timeout: 20000 });
      return JSON.stringify(result);
    },

    async dashclaw_optimal_files_manifest(input: any) {
      const result = await client.post(`/api/code-sessions/sessions/${encodeURIComponent(input.session_id)}/optimal-files/manifest`,
        { selections: input.selections || [] }, { timeout: 20000 });
      return JSON.stringify(result);
    },

    // Record semantics: deliberately NOT ?record=true (the hook's single-call
    // path). The hook records a "running" action at pretool and patches it at
    // posttool; MCP's dashclaw_record is a separate tool carrying outcome data
    // at completion time. Adopting record=true here would double-record every
    // guarded action (guard insert + record insert) or force dashclaw_record
    // into update semantics, breaking its documented contract.
    async dashclaw_guard(input: any) {
      const result = await client.post('/api/guard', {
        action_type: input.action_type,
        declared_goal: input.declared_goal,
        risk_score: input.risk_score,
        agent_id: agentId(input),
        systems_touched: input.systems_touched,
        reversible: input.reversible,
        // Context enrichment toward hook parity: the guard input schema accepts
        // target / write_paths / content / tool, so protected-path, secret-scan,
        // and content policies can fire on MCP-originated calls too. Only fields
        // the tool input can honestly supply are forwarded — the hook-side
        // enrichment (category classification, autoscan, subagent provenance,
        // intel) has no MCP equivalent and is intentionally absent.
        ...(typeof input.target === 'string' && input.target ? { target: input.target } : {}),
        ...(Array.isArray(input.write_paths) && input.write_paths.length > 0 ? { write_paths: input.write_paths.slice(0, 100) } : {}),
        ...(typeof input.content === 'string' && input.content ? { content: input.content.slice(0, 20000) } : {}),
        ...(typeof input.tool_name === 'string' && input.tool_name ? { tool: { name: input.tool_name } } : {}),
        // Evidence-first guard: forward the actual act (shell/http/sql/file)
        // when the caller supplied one, so the server classifies it and folds
        // the derived risk in rather than trusting only the declared fields
        // above. See docs/superpowers/specs/2026-07-05-evidence-first-guard.md.
        ...(input.act && typeof input.act === 'object' ? { act: input.act } : {}),
        // Approvals lifecycle (roadmap v2.3): declare the wait window this
        // MCP client will poll (dashclaw_wait_for_approval default: 300s) so
        // a require_approval row gets a truthful approval_expires_at stamp.
        approval_wait_seconds: Number.isInteger(input.approval_wait_seconds) ? input.approval_wait_seconds : 300,
        // Blind retries of the same guard question dedupe server-side (the
        // prior decision is replayed instead of double-counting in
        // flood/signal windows). Derived, never LLM-chosen.
        idempotency_key: deriveIdempotencyKey({
          agent_id: agentId(input) ?? '',
          action_type: input.action_type ?? '',
          declared_goal: input.declared_goal ?? '',
          target: input.target ?? '',
          tool_name: input.tool_name ?? '',
          ts_bucket: hourBucket(),
        }),
      }, { timeout: 10000 });

      if (guardUnavailable(result)) {
        const policy = guardUnavailablePolicy();
        const detail = transportDetail(result);
        return JSON.stringify({
          decision: policy === 'allow' ? 'allow' : 'block',
          degraded: true,
          reason: policy === 'allow'
            ? `DashClaw guard unreachable; failing open (DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow) — ${detail}`
            : `DashClaw guard unreachable; refusing risky action (fail closed) — ${detail}`,
          guidance: policy === 'allow'
            ? 'Guard policies were NOT evaluated for this action.'
            : 'Do NOT proceed with the action. Check DASHCLAW_URL / DASHCLAW_API_KEY, then retry dashclaw_guard.',
        });
      }
      return JSON.stringify(result);
    },

    async dashclaw_record(input: any) {
      const sessionId = input.session_id ?? activeSessionId;
      const body = {
        action_type: input.action_type,
        declared_goal: input.declared_goal,
        status: input.status,
        risk_score: input.risk_score ?? 30,
        agent_id: agentId(input),
        reasoning: input.reasoning,
        confidence: input.confidence,
        systems_touched: input.systems_touched,
        reversible: input.reversible,
        output_summary: input.output_summary,
        tokens_in: input.tokens_in,
        tokens_out: input.tokens_out,
        model: input.model,
        cost_estimate: input.cost_estimate,
        // Act-content grant binding (drizzle/0056): forward the act so the
        // server stamps act_content_hash on the row — a pending_approval
        // record then binds the operator's approval to this exact act, and
        // the grant only covers a dashclaw_guard retry presenting the same
        // act. Same forwarding rule as dashclaw_guard.
        ...(input.act && typeof input.act === 'object' ? { act: input.act } : {}),
        // Approvals lifecycle (roadmap v2.3): same wait-window declaration as
        // dashclaw_guard, for records created directly as pending_approval.
        approval_wait_seconds: Number.isInteger(input.approval_wait_seconds) ? input.approval_wait_seconds : 300,
        ...(sessionId ? { session_id: sessionId } : {}),
        // A retried record call returns the original ledger row instead of
        // inserting a duplicate. Derived, never LLM-chosen.
        idempotency_key: deriveIdempotencyKey({
          agent_id: agentId(input) ?? '',
          action_type: input.action_type ?? '',
          declared_goal: input.declared_goal ?? '',
          status: input.status ?? '',
          session_id: sessionId ?? '',
          ts_bucket: hourBucket(),
        }),
      };
      const result = await client.post('/api/actions', body, { timeout: 10000 });
      // Fail loud (same mapping as dashclaw_guard): a swallowed transport error
      // here would silently drop the action from the audit ledger.
      if (transportFailed(result)) {
        return JSON.stringify({
          recorded: false,
          error: `DashClaw record failed — the action was NOT written to the audit ledger: ${transportDetail(result)}`,
          guidance: 'Retry dashclaw_record; if the instance stays unreachable, surface this to the user instead of continuing silently.',
        });
      }
      return JSON.stringify(result);
    },

    async dashclaw_invoke(input: any) {
      const result = await client.post(`/api/capabilities/${input.capability_id}/invoke`, {
        agent_id: agentId(input),
        declared_goal: input.declared_goal,
        payload: input.payload,
      }, { timeout: 30000 });
      return JSON.stringify(result);
    },

    async dashclaw_capabilities_list(input: any) {
      const result = await client.get('/api/capabilities', {
        category: input.category,
        risk_level: input.risk_level,
        search: input.search,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_policies_list(input: any) {
      const result = await client.get('/api/policies', {
        agent_id: input.agent_id,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_wait_for_approval(input: any) {
      const timeout = (input.timeout_seconds ?? 300) * 1000;
      const interval = (input.poll_interval_seconds ?? 3) * 1000;
      const start = Date.now();

      // Poll-failure honesty: a transport error / non-2xx has no `action` key
      // and previously fell straight through to the sleep, so a full-window
      // API outage (or a plain wrong action_id) returned the exact same
      // payload as "the human genuinely didn't decide in time". Track the
      // failures so the caller can tell the two apart.
      let pollErrors = 0;
      let pollSuccesses = 0;
      let lastPollError: string | null = null;

      while (Date.now() - start < timeout) {
        const result = await client.get(`/api/actions/${input.action_id}`, {}, { timeout: 10000 });

        if (transportFailed(result) || !result.action) {
          // A definitive 404 is terminal: this action will never resolve —
          // keeping the caller polling for the full window would be a lie.
          if (result?._status === 404) {
            return JSON.stringify({
              approved: false,
              error: `Action ${input.action_id} not found — nothing to wait for (wrong action_id, or the record was never created).`,
              status_confirmed: false,
              waited_seconds: Math.round((Date.now() - start) / 1000),
            });
          }
          pollErrors++;
          lastPollError = transportDetail(result);
          await new Promise((r) => setTimeout(r, interval));
          continue;
        }
        pollSuccesses++;
        const status = result?.action?.status;

        if (status && status !== 'pending_approval') {
          // An approval flips the row to 'running' (approved_by set); the
          // agent may also have completed it by the time we poll. The old
          // `status === 'completed'` check misreported real approvals as
          // approved:false (fixed alongside roadmap v2.3).
          const approved = !!result?.action?.approved_by || status === 'running' || status === 'completed';
          // Distinguish explicit operator denial (failed/cancelled) from
          // a genuine approval. The JS and Python SDKs throw on denial;
          // MCP can't throw through the tool channel, so surface a
          // clear `denied:true` + reason instead of returning
          // approved:false with no further signal.
          const denied = !approved && (status === 'failed' || status === 'cancelled');
          // Approvals lifecycle (roadmap v2.3): the server expired the
          // approval — it can no longer release anything. Terminal.
          const expired = !approved && status === 'expired';
          return JSON.stringify({
            approved,
            denied,
            ...(expired ? { expired: true } : {}),
            denial_reason: denied
              ? (result?.action?.error_message || `Operator marked action as ${status}`)
              : (expired ? (result?.action?.error_message || 'Approval expired before a decision was made') : null),
            action: result.action,
            waited_seconds: Math.round((Date.now() - start) / 1000),
          });
        }

        await new Promise((r) => setTimeout(r, interval));
      }

      // Every poll failed → this is an OUTAGE report, not a timeout: the
      // pending status was never once confirmed.
      if (pollSuccesses === 0 && pollErrors > 0) {
        return JSON.stringify({
          approved: false,
          error: `Could not confirm approval status: all ${pollErrors} polls failed (last: ${lastPollError}). The DashClaw API was unreachable or erroring for the entire wait — this is NOT a human timeout.`,
          status_confirmed: false,
          poll_errors: pollErrors,
          waited_seconds: Math.round((Date.now() - start) / 1000),
        });
      }

      return JSON.stringify({
        approved: false,
        timed_out: true,
        action: { status: 'pending_approval' },
        status_confirmed: true,
        ...(pollErrors > 0 ? { poll_errors: pollErrors, last_poll_error: lastPollError } : {}),
        waited_seconds: Math.round((Date.now() - start) / 1000),
      });
    },

    async dashclaw_session_start(input: any) {
      const result = await client.post('/api/sessions', {
        // Same WRITE-identity precedence as guard/record/invoke: the
        // server-configured agent_id wins. This was the one write path that
        // trusted the caller's raw value, so a session could be opened under
        // an arbitrary identity while its records stamped the real one.
        agent_id: agentId(input),
        workspace: input.workspace,
        branch: input.branch,
      }, { timeout: 10000 });
      // Adopt the new session as the ambient default for subsequent records.
      activeSessionId = result?.session?.id ?? activeSessionId;
      return JSON.stringify(result);
    },

    async dashclaw_session_end(input: any) {
      const result = await client.patch(`/api/sessions/${input.session_id}`, {
        status: input.status,
        summary: input.summary,
      }, { timeout: 10000 });
      // Only clear when ending the session we're actively stamping, so ending an
      // unrelated session doesn't silently unset the active one.
      if (activeSessionId === input.session_id) activeSessionId = null;
      return JSON.stringify(result);
    },

    async dashclaw_session_retro(input: any) {
      // Read BEFORE dashclaw_session_end clears it, or pass session_id explicitly.
      const sessionId = input.session_id ?? activeSessionId;
      if (!sessionId) {
        return JSON.stringify({
          error: 'No session_id given and no active session. Pass session_id (sess_*) or call dashclaw_session_start first.',
        });
      }
      const result = await client.get(`/api/sessions/${sessionId}/retro`, {}, { timeout: 15000 });
      return JSON.stringify(result);
    },

    async dashclaw_handoff_create(args: any) {
      const res = await client.fetch('/api/handoffs', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId(args),
          project_id: args.project_id,
          bundle: args.bundle,
        }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_handoff_latest(args: any) {
      const params = new URLSearchParams();
      const aid = agentIdFilter(args);
      if (aid) params.set('agent_id', aid);
      if (args.project_id) params.set('project_id', args.project_id);
      const res = await client.fetch(`/api/handoffs/latest?${params}`);
      if (res.status === 404) return JSON.stringify(null);
      const data = await res.json();
      return JSON.stringify(data);
    },

    async dashclaw_handoff_consume(args: any) {
      const res = await client.fetch(`/api/handoffs/${encodeURIComponent(args.id)}/consume`, {
        method: 'POST',
        body: JSON.stringify({ session_id: args.session_id }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_secret_list(args: any) {
      const params = new URLSearchParams();
      const aid = agentIdFilter(args);
      if (aid) params.set('agent_id', aid);
      const res = await client.fetch(`/api/secrets?${params}`);
      const data = await res.json();
      return JSON.stringify(data);
    },

    async dashclaw_secret_due(args: any) {
      const params = new URLSearchParams();
      if (args.within_days != null) params.set('within_days', String(args.within_days));
      const aid = agentIdFilter(args);
      if (aid) params.set('agent_id', aid);
      const res = await client.fetch(`/api/secrets/rotation-due?${params}`);
      const data = await res.json();
      return JSON.stringify(data);
    },

    async dashclaw_secret_mark_rotated(args: any) {
      const res = await client.fetch(`/api/secrets/${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_rotated_at: new Date().toISOString() }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_skill_scan(args: any) {
      const res = await client.fetch('/api/skills/scan', {
        method: 'POST',
        body: JSON.stringify({
          skill_name: args.skill_name,
          files: args.files,
        }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_loop_add(args: any) {
      const res = await client.fetch('/api/actions/loops', {
        method: 'POST',
        body: JSON.stringify({
          action_id: args.action_id,
          loop_type: args.loop_type,
          description: args.description,
          priority: args.priority,
          owner: args.owner,
        }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_loop_list(args: any) {
      const params = new URLSearchParams();
      if (args.action_id) params.set('action_id', args.action_id);
      if (args.status) params.set('status', args.status);
      if (args.priority) params.set('priority', args.priority);
      const aid = agentIdFilter(args);
      if (aid) params.set('agent_id', aid);
      if (args.from) params.set('from', args.from);
      if (args.to) params.set('to', args.to);
      const res = await client.fetch(`/api/actions/loops?${params}`);
      const data = await res.json();
      return JSON.stringify(data);
    },

    async dashclaw_loop_close(args: any) {
      const res = await client.fetch(`/api/actions/loops/${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'resolved',
          resolution: args.resolution || 'Closed by agent via dashclaw_loop_close',
        }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_assumption_record(args: any) {
      const res = await client.fetch('/api/assumptions', {
        method: 'POST',
        body: JSON.stringify({
          action_id: args.action_id,
          assumption: args.assumption,
          basis: args.basis,
        }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_learning_log(args: any) {
      const res = await client.fetch('/api/learning', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId(args),
          decision: args.decision,
          context: args.context,
          outcome: args.outcome,
        }),
      });
      return JSON.stringify(await jsonOrFailure(res));
    },

    async dashclaw_learning_query(args: any) {
      // Query the same store dashclaw_learning_log writes to. POST /api/learning
      // records decisions into the `decisions` table; GET /api/learning reads
      // them back. The sibling /api/learning/lessons endpoint is the
      // recommendations consolidator (a different store with no decision/context
      // text), so a logged decision could never be queried back through it.
      //
      // Search text (`q`) and `limit` are passed server-side so the search
      // window is the full decision history, not just the most-recent 20. The
      // client-side filter below is kept as a fallback for older DashClaw
      // instances that ignore these params (they return the recent window, and
      // we narrow it here).
      const params = new URLSearchParams();
      const aid = agentIdFilter(args);
      if (aid) params.set('agent_id', aid);
      if (args.query) params.set('q', String(args.query));
      if (Number.isInteger(args.limit) && args.limit > 0) params.set('limit', String(args.limit));
      const res = await client.fetch(`/api/learning?${params}`);
      const data = await res.json();

      let decisions: any[] = Array.isArray(data?.decisions) ? data.decisions : [];
      if (args.query) {
        const needle = String(args.query).toLowerCase();
        decisions = decisions.filter((d) =>
          `${d?.decision || ''} ${d?.context || ''}`.toLowerCase().includes(needle),
        );
      }
      const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 10;
      decisions = decisions.slice(0, limit);

      return JSON.stringify({ ...data, decisions });
    },

    async dashclaw_decisions_recent(args: any) {
      const params = new URLSearchParams();
      const aid = agentIdFilter(args);
      if (aid) params.set('agent_id', aid);
      if (args.action_type) params.set('action_type', args.action_type);
      if (args.decision) params.set('decision', args.decision);
      if (args.since) params.set('since', args.since);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await client.fetch(`/api/guard/decisions?${params}`);
      const data = await res.json();
      return JSON.stringify(data);
    },

    async dashclaw_behavior_suggestions(input: any) {
      // GET /api/behavior/suggestions — analyzes the local behavior-sample log.
      // Read-only; adopt/dismiss are UI-only in V1 (they require simulation review).
      const result = await client.get('/api/behavior/suggestions', {
        agent_id: agentIdFilter(input),
      }, { timeout: 15000 });
      return JSON.stringify(result);
    },

    async dashclaw_inbox_list(input: any) {
      // GET /api/messages — the canonical inbox read. unread is a string flag
      // server-side (checks === 'true'); undefined params are dropped by client.get.
      const result = await client.get('/api/messages', {
        agent_id: agentIdFilter(input),
        direction: input.direction || 'inbox',
        unread: input.unread ? 'true' : undefined,
        type: input.type,
        limit: input.limit,
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_messages_mark_read(input: any) {
      // PATCH /api/messages with action:'read'. This is the durable mark-read
      // path for MCP-only agents (no SDK install required). Returns { updated }.
      const result = await client.patch('/api/messages', {
        message_ids: input.message_ids,
        action: 'read',
        agent_id: agentId(input),
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    async dashclaw_pair(input: any) {
      // Generate the keypair locally; the private key NEVER leaves this
      // machine (and is never logged or returned in tool output beyond its
      // filesystem path). Public PEM goes to POST /api/pairings — the same
      // agent-initiated flow the Python SDK's create_pairing uses.
      const [{ generateKeyPairSync }, fs, os, path] = await Promise.all([
        import('node:crypto'),
        import('node:fs'),
        import('node:os'),
        import('node:path'),
      ]);
      const id = agentId(input);
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const dir = path.join(os.homedir(), '.dashclaw', 'identity');
      fs.mkdirSync(dir, { recursive: true });
      const keyPath = path.join(dir, `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.pem`);
      fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });

      const created = await client.post('/api/pairings', {
        agent_id: id,
        agent_name: input.agent_name,
        public_key: publicKey,
        algorithm: 'RSASSA-PKCS1-v1_5',
      }, { timeout: 10000 });

      let pairing = created.pairing || created;
      // Same poll-failure honesty as dashclaw_wait_for_approval: a transport
      // error has no pairing/status and used to read as "still pending" for
      // the whole window.
      let pairPollErrors = 0;
      let lastPairPollError: string | null = null;
      if (input.wait && pairing?.id) {
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline) {
          const res = await client.get(`/api/pairings/${encodeURIComponent(pairing.id)}`, {}, { timeout: 10000 });
          if (transportFailed(res)) {
            pairPollErrors++;
            lastPairPollError = transportDetail(res);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          const current = res.pairing || res;
          if (current.status && current.status !== 'pending') { pairing = current; break; }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      return JSON.stringify({
        pairing_id: pairing.id,
        status: pairing.status,
        pairing_url: pairing.pairing_url,
        private_key_path: keyPath,
        ...(pairPollErrors > 0 ? { poll_errors: pairPollErrors, last_poll_error: lastPairPollError } : {}),
        next: pairing.status === 'approved'
          ? 'Approved — sign recorded actions with the private key (see docs/agent-identity.md).'
          : pairPollErrors > 0 && pairing.status === 'pending'
            ? `Status unconfirmed for part of the wait (${pairPollErrors} failed polls; last: ${lastPairPollError}) — check the DashClaw Identities page.`
            : 'Awaiting admin approval on the DashClaw Identities page.',
      });
    },
  };
}
