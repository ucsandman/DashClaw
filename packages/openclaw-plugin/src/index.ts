/**
 * @dashclaw/openclaw-plugin
 *
 * OpenClaw plugin that routes every tool call through DashClaw governance:
 *   1. `before_tool_call` → `guard()` + optional `waitForApproval()` +
 *      `createAction()` to open a governance record.
 *   2. `after_tool_call`  → `updateOutcome()` to close that record.
 *
 * Type accuracy notes (verified against `openclaw` plugin SDK types):
 *   - `PluginHookBeforeToolCallResult` uses `blockReason`, not `reason`.
 *   - `PluginKind` is `"memory" | "context-engine"` — neither applies to this
 *     generic hook plugin, so the manifest and `definePluginEntry` call both
 *     omit `kind`.
 *   - Event/context field shapes come from `PluginHookBeforeToolCallEvent`,
 *     `PluginHookAfterToolCallEvent`, and `PluginHookToolContext`. No
 *     defensive fallbacks for alternative field names are needed.
 *
 * The DashClaw client is cached at module scope and rebuilt only when the
 * resolved config key changes, mirroring the pattern used by OpenClaw's
 * bundled MemOS plugin.
 */

import {
  definePluginEntry,
  type OpenClawPluginApi,
} from 'openclaw/plugin-sdk/plugin-entry';
import {
  DashClaw,
  type ActionRecord,
  type GuardDecision,
} from 'dashclaw';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { maybeAutoPair } from './auto-pairing.js';
import { runLivenessProbe, shouldProbeNow, PROBE_AGENT_ID } from './liveness-probe.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface PluginConfig {
  dashclawUrl: string;
  dashclawApiKey: string;
  agentId: string;
  // Fallback model id used when `llm_output` events fire without a `model`
  // field. Without this, the server's `estimateCost` treats the usage as
  // unpriceable and stores `cost_estimate = 0` — producing the "tokens
  // but no cost" failure mode. Empty string disables the fallback.
  defaultModel: string;
  failClosed: boolean;
  requireExecutionClaims: boolean;
  autoPairing: boolean;
  riskScoreDefault: number;
  highRiskTools: ReadonlySet<string>;
  // Bounded human-approval wait. Codex's embedded dynamic-tool RPC enforces a
  // per-call watchdog (~90s): a longer synchronous wait is killed mid-flight
  // and the tool result (e.g. an outbound message) is silently dropped, so the
  // default stays under that ceiling. The server-side approval window
  // (approval_wait_seconds, 300s) is intentionally longer — see
  // waitForRequiredApproval for the retry-after-approval path.
  approvalWaitMs: number;
}

/**
 * Resolve the DashClaw URL from (in order of precedence):
 *   1. `config.dashclawUrl`                    (canonical plugin-config key)
 *   2. `config.baseUrl`                        (SDK-style alias)
 *   3. `process.env.DASHCLAW_BASE_URL`         (canonical env var — matches CLI, local scripts)
 *   4. `process.env.DASHCLAW_URL`              (legacy env var — matches MCP server docs)
 *
 * The same precedence applies to the API key (with DASHCLAW_API_KEY as the only env var).
 */
function firstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

function stringSetFromConfig(value: unknown): ReadonlySet<string> {
  return new Set<string>(
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
  );
}

function numberFromConfig(
  value: unknown,
  fallback: number,
  allowNegative = true,
): number {
  if (typeof value !== 'number') return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (!allowNegative && value < 0) return fallback;
  return value;
}

function enabledEnvFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true'].includes(value.toLowerCase());
}

function resolveConfig(raw: Record<string, unknown> | undefined): PluginConfig {
  const cfg = raw ?? {};
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};

  const failClosed = cfg.failClosed !== false; // default true
  const requireExecutionClaims = enabledEnvFlag(env.DASHCLAW_REQUIRE_EXECUTION_CLAIMS);
  const autoPairing = cfg.autoPairing !== false; // default true
  const riskScoreDefault = numberFromConfig(cfg.riskScoreDefault, 50);
  const highRiskTools = stringSetFromConfig(cfg.highRiskTools);
  const approvalWaitMs = numberFromConfig(cfg.approvalWaitMs, 60_000, false) || 60_000;

  const dashclawUrl = firstString(
    cfg.dashclawUrl,
    cfg.baseUrl,
    env.DASHCLAW_BASE_URL,
    env.DASHCLAW_URL
  );
  const dashclawApiKey = firstString(
    cfg.dashclawApiKey,
    cfg.apiKey,
    env.DASHCLAW_API_KEY
  );
  const agentId = firstString(cfg.agentId, env.DASHCLAW_AGENT_ID) || 'openclaw';
  const defaultModel = firstString(
    cfg.defaultModel,
    env.DASHCLAW_DEFAULT_MODEL
  );

  return {
    dashclawUrl,
    dashclawApiKey,
    agentId,
    defaultModel,
    failClosed,
    requireExecutionClaims,
    autoPairing,
    riskScoreDefault,
    highRiskTools,
    approvalWaitMs,
  };
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let cachedClient: DashClaw | null = null;
let cachedClientKey = '';

/** Maps synthetic call key → DashClaw action_id so `after_tool_call` can close it. */
const pendingActions = new Map<string, string>();

/**
 * Per-run state for LLM token attribution. OpenClaw's `llm_output` event
 * fires once per assistant response with `usage.{input,output,cacheRead,
 * cacheWrite}` and `model`. The tool calls induced by that response arrive
 * via `before_tool_call` after the `llm_output`. We stash the most recent
 * usage and the action_ids opened since we stashed it; on the NEXT
 * `llm_output` (or on `agent_end`) we distribute that usage evenly across
 * those action_ids via `updateOutcome` PATCHes. Cost is derived server-side.
 */
interface TokenTurnState {
  pendingUsage?: { tokens_in: number; tokens_out: number; model: string };
  turnActionIds: string[];
  // Set after the first llm_output on this run that fires without a model
  // field. Used to suppress repeat warnings within the same run — ops see
  // one log line per run, not one per turn.
  warnedMissingModel?: boolean;
  // DashClaw Agent Session opened on the first tool call of this run, so the
  // run shows up under the Agent Sessions feature (not just Code Sessions).
  // Closed (status='completed') and cleared on agent_end. `sessionStarted`
  // guards the lazy create so we POST /api/sessions exactly once per run.
  sessionId?: string;
  sessionStarted?: boolean;
}
const tokenTurnByRun = new Map<string, TokenTurnState>();

// Cap for in-memory per-run state. `agent_end` deletes entries, but a crash
// or an agent framework that never fires `agent_end` in a long-lived gateway
// process would leak. At ~100 bytes/entry this cap bounds worst-case memory
// to ~100KB while still comfortably above typical concurrency.
const MAX_TURN_RUNS = 1000;

function getTokenTurn(runId: string): TokenTurnState {
  let state = tokenTurnByRun.get(runId);
  if (!state) {
    if (tokenTurnByRun.size >= MAX_TURN_RUNS) {
      // Evict oldest (Map preserves insertion order). One at a time is enough
      // to stay at the cap under steady state — we only grow by one here.
      const oldest = tokenTurnByRun.keys().next().value;
      if (oldest !== undefined) tokenTurnByRun.delete(oldest);
    }
    state = { turnActionIds: [] };
    tokenTurnByRun.set(runId, state);
  }
  return state;
}

/** Split a non-negative integer `total` into `n` buckets, putting remainders
 *  in the earliest buckets so the sum is preserved exactly. */
function distributeEvenly(total: number, n: number): number[] {
  if (n <= 0 || total <= 0) return new Array<number>(Math.max(n, 0)).fill(0);
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

async function distributePendingTokens(
  client: DashClaw,
  state: TokenTurnState,
): Promise<void> {
  const usage = state.pendingUsage;
  const ids = state.turnActionIds;
  state.pendingUsage = undefined;
  state.turnActionIds = [];

  if (!usage || ids.length === 0) return;
  if (usage.tokens_in === 0 && usage.tokens_out === 0) return;

  const inParts = distributeEvenly(usage.tokens_in, ids.length);
  const outParts = distributeEvenly(usage.tokens_out, ids.length);

  await Promise.all(
    ids.map((actionId, idx) =>
      client
        .updateOutcome(actionId, {
          tokens_in: inParts[idx],
          tokens_out: outParts[idx],
          ...(usage.model ? { model: usage.model } : {}),
        })
        .catch((err: unknown) => {
          console.warn(
            `[dashclaw-governance] token PATCH failed for ${actionId}: ${errorMessage(err) || 'unknown'}`
          );
        })
    )
  );
}

function getClient(config: PluginConfig): DashClaw {
  const key = `${config.dashclawUrl}|${config.dashclawApiKey}|${config.agentId}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  if (!config.dashclawUrl || !config.dashclawApiKey) {
    const missing: string[] = [];
    if (!config.dashclawUrl) missing.push('dashclawUrl');
    if (!config.dashclawApiKey) missing.push('dashclawApiKey');
    throw new Error(
      `dashclaw-governance plugin: missing ${missing.join(' and ')}. ` +
        'Provide via openclaw.plugin.json config (dashclawUrl/dashclawApiKey or baseUrl/apiKey), ' +
        'or set env vars DASHCLAW_BASE_URL and DASHCLAW_API_KEY before starting the gateway.'
    );
  }

  cachedClient = new DashClaw({
    baseUrl: config.dashclawUrl,
    apiKey: config.dashclawApiKey,
    agentId: config.agentId,
  });
  cachedClientKey = key;
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  let serialized: string;
  try {
    serialized = JSON.stringify(params);
  } catch {
    return '[unserializable params]';
  }
  if (serialized.length <= 500) return serialized;
  return serialized.slice(0, 500) + '…[truncated]';
}

function callKey(
  toolName: string,
  toolCallId: string | undefined,
  runId: string | undefined
): string {
  // Prefer the provider-supplied tool call ID; fall back to runId-scoped tool
  // name so a later `after_tool_call` without a toolCallId can still find the
  // pending record.
  if (toolCallId) return `id:${toolCallId}`;
  if (runId) return `run:${runId}:${toolName}`;
  return `tool:${toolName}`;
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : '';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Tool classification (aligned with DashClaw hooks vocabulary so policies
// written for the Claude Code hooks also fire for OpenClaw tool calls)
// ---------------------------------------------------------------------------

interface ActionClassification {
  actionType: string;
  riskScore: number;
  reversible: boolean;
  systemsTouched: string[];
  declaredGoal: string;
  act?: GuardAct;
}

type GuardAct =
  | {
      kind: 'shell';
      command: string;
      script?: { path: string; content_excerpt?: string };
    }
  | { kind: 'file'; file: { path: string } };

const READONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat', 'du', 'df',
  'ls', 'tree', 'find', 'locate', 'which', 'whereis', 'type',
  'grep', 'rg', 'awk', 'cut', 'sort', 'uniq', 'diff', 'comm',
  'echo', 'printf', 'date', 'uname', 'whoami', 'pwd', 'hostname',
  'ps', 'top', 'htop', 'free', 'uptime', 'env', 'printenv',
]);

const GIT_READONLY = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote',
  'stash', 'describe', 'rev-parse', 'blame', 'ls-files',
]);

const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'rmdir', 'shred', 'mkfs', 'dd', 'truncate',
]);

const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'ping',
]);

const PACKAGE_COMMANDS = new Set([
  'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo', 'go', 'gem',
  'brew', 'apt', 'apt-get', 'dnf',
]);

const DEPLOY_PATTERN = /(?:git\s+push|deploy|vercel|kubectl|terraform|docker\s+push|helm)/i;
const DESTRUCTIVE_PATTERN = /(?:rm\s+-rf|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)/i;
const SENSITIVE_PATH_PATTERN = /(?:\.env|secret|credential|private_key|\.pem|id_rsa|\.key)/i;

// Interpreters/runners that indicate the next non-flag token is a local
// script file worth attaching as evidence (see incident: `node
// tmp/domain-buy.mjs <name>` was graded from self-declared risk alone
// because the plugin attached no `act`).
const SCRIPT_RUNNERS = new Set([
  'node', 'nodejs', 'python', 'python2', 'python3', 'bash', 'sh', 'zsh',
  'deno', 'bun', 'tsx', 'ts-node', 'ruby', 'perl', 'php', 'npx',
]);

const SCRIPT_CONTENT_MAX_BYTES = 64 * 1024;
const SCRIPT_EXCERPT_MAX_CHARS = 6144;

/**
 * Find the first chain segment (split on &&, ||, ;, |) whose command word,
 * after stripping a leading `cd ...` segment, env assignments, `timeout N`,
 * and `sudo`, is a known script runner — then return the next non-flag
 * token as the candidate script path. Returns undefined when no segment
 * qualifies.
 */
function findScriptPathToken(command: string): string | undefined {
  const segments = command.split(/&&|\|\||;|\|/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens[0] === 'cd') continue;
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
    if (tokens[0] === 'timeout') tokens.splice(0, 2);
    if (tokens[0] === 'sudo') tokens.shift();
    if (tokens.length === 0) continue;
    const cmdWord = tokens[0].replace(/^.*[/\\]/, '');
    if (!SCRIPT_RUNNERS.has(cmdWord)) continue;
    const pathToken = tokens.slice(1).find((t) => !t.startsWith('-'));
    if (pathToken) return pathToken;
  }
  return undefined;
}

/**
 * Attach the local script's content when a shell command invokes one, so
 * the server's evidence classifier sees what actually runs instead of
 * grading only the self-declared risk_score. Fail-soft everywhere: any
 * resolution, stat, or read error yields no `script` at all. Sensitive
 * paths (.env, credentials, keys) still attach `path` for policy matching
 * but never their content.
 */
function detectLocalScript(
  command: string,
  workspace: string | undefined,
): { path: string; content_excerpt?: string } | undefined {
  try {
    const rawPath = findScriptPathToken(command);
    if (!rawPath) return undefined;
    const resolved = resolvePath(workspace || process.cwd(), rawPath);
    if (SENSITIVE_PATH_PATTERN.test(rawPath)) {
      return existsSync(resolved) ? { path: rawPath } : undefined;
    }
    if (!existsSync(resolved)) return undefined;
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > SCRIPT_CONTENT_MAX_BYTES) return undefined;
    const content = readFileSync(resolved, 'utf8');
    return { path: rawPath, content_excerpt: content.slice(0, SCRIPT_EXCERPT_MAX_CHARS) };
  } catch {
    return undefined;
  }
}

function classifyBash(
  command: string | undefined,
  defaultRisk: number,
): ActionClassification {
  if (!command) {
    return { actionType: 'other', riskScore: defaultRisk, reversible: true, systemsTouched: [], declaredGoal: 'Bash: (empty)' };
  }
  const goal = `Bash: ${command.slice(0, 120)}`;

  const patternClassification = classifyBashPattern(command, goal);
  if (patternClassification) return patternClassification;

  const firstToken = command.trim().split(/[\s|;&]/)[0].replace(/^.*[/\\]/, '');
  return classifyCommandToken(firstToken, command, goal, defaultRisk);
}

function classifyBashPattern(
  command: string,
  goal: string,
): ActionClassification | null {
  if (DESTRUCTIVE_PATTERN.test(command)) {
    return { actionType: 'security', riskScore: 90, reversible: false, systemsTouched: ['filesystem'], declaredGoal: goal };
  }
  if (DEPLOY_PATTERN.test(command)) {
    return { actionType: 'deploy', riskScore: 80, reversible: false, systemsTouched: ['production'], declaredGoal: goal };
  }
  return null;
}

function classifyGitCommand(
  command: string,
  goal: string,
): ActionClassification {
  const sub = command.match(/git\s+(\S+)/)?.[1] ?? '';
  if (GIT_READONLY.has(sub)) {
    return { actionType: 'review', riskScore: 10, reversible: true, systemsTouched: [], declaredGoal: goal };
  }
  if (sub === 'push') {
    return { actionType: 'deploy', riskScore: 75, reversible: false, systemsTouched: [], declaredGoal: goal };
  }
  return { actionType: 'apply', riskScore: 30, reversible: true, systemsTouched: [], declaredGoal: goal };
}

function classifyCommandToken(
  firstToken: string,
  command: string,
  goal: string,
  defaultRisk: number,
): ActionClassification {
  if (firstToken === 'git') {
    return classifyGitCommand(command, goal);
  }
  if (READONLY_COMMANDS.has(firstToken)) {
    return { actionType: 'review', riskScore: 10, reversible: true, systemsTouched: [], declaredGoal: goal };
  }
  if (DESTRUCTIVE_COMMANDS.has(firstToken)) {
    return { actionType: 'security', riskScore: 85, reversible: false, systemsTouched: ['filesystem'], declaredGoal: goal };
  }
  if (NETWORK_COMMANDS.has(firstToken)) {
    return { actionType: 'api', riskScore: 40, reversible: true, systemsTouched: [], declaredGoal: goal };
  }
  if (PACKAGE_COMMANDS.has(firstToken)) {
    return { actionType: 'build', riskScore: 30, reversible: true, systemsTouched: [], declaredGoal: goal };
  }
  return { actionType: 'other', riskScore: defaultRisk, reversible: true, systemsTouched: ['shell'], declaredGoal: goal };
}

function classifyFile(
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
): ActionClassification {
  const filePath = String(params?.file_path ?? params?.path ?? '');
  const goal = `${toolName}: ${filePath || '(unknown)'}`;
  if (SENSITIVE_PATH_PATTERN.test(filePath)) {
    return { actionType: 'security', riskScore: 85, reversible: true, systemsTouched: ['filesystem'], declaredGoal: goal };
  }
  return { actionType: 'apply', riskScore: defaultRisk, reversible: true, systemsTouched: ['filesystem'], declaredGoal: goal };
}

function classifyToolCall(
  toolName: string,
  params: Record<string, unknown> | undefined,
  config: PluginConfig,
  workspace?: string,
): ActionClassification {
  const defaultRisk = config.highRiskTools.has(toolName) ? 85 : config.riskScoreDefault;
  const classified = TOOL_CLASSIFIERS
    .map((classify) => classify(toolName, params, defaultRisk))
    .find((result): result is ActionClassification => result !== null);
  const base = classified ?? classifyDefaultTool(toolName, params, defaultRisk);
  const act = buildGuardAct(toolName, params, workspace);
  return act ? { ...base, act } : base;
}

type ToolClassifier = (
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
) => ActionClassification | null;

const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch']);
const REVIEW_TOOLS = new Set([
  'read',
  'web_search',
  'web_fetch',
  'memory_search',
  'memory_get',
  'image',
]);

/**
 * Translate OpenClaw tool params into the narrow evidence-first guard wire
 * contract. Do not truncate the command or the file path: a lost suffix
 * could hide the risk. If a value exceeds the server contract, omit it and
 * retain the normal classified request. File content is intentionally
 * excluded, since a path is sufficient for protected/sensitive-path
 * policies and content may itself be sensitive. Shell commands that
 * execute a local script (e.g. `node tmp/domain-buy.mjs`) are the
 * exception: the script's content is what actually runs, so its first
 * 6144 chars are attached via `script.content_excerpt` (see
 * detectLocalScript) — bounded per the server contract, not exempt from it.
 */
function buildGuardAct(
  toolName: string,
  params: Record<string, unknown> | undefined,
  workspace?: string,
): GuardAct | undefined {
  if (toolName === 'bash' || toolName === 'exec') {
    const command = params?.command;
    if (typeof command === 'string' && command.length > 0 && command.length <= 8192) {
      const script = detectLocalScript(command, workspace);
      return script ? { kind: 'shell', command, script } : { kind: 'shell', command };
    }
    return undefined;
  }

  if (WRITE_TOOLS.has(toolName)) {
    const path = params?.file_path ?? params?.path;
    if (typeof path === 'string' && path.length > 0 && path.length <= 1024) {
      return { kind: 'file', file: { path } };
    }
  }

  return undefined;
}

const TOOL_CLASSIFIERS: ToolClassifier[] = [
  classifyShellTool,
  classifyWriteTool,
  classifyReviewTool,
  classifyMessageTool,
];

function classifyShellTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
): ActionClassification | null {
  return toolName === 'bash' || toolName === 'exec'
    ? classifyBash(params?.command as string | undefined, defaultRisk)
    : null;
}

function classifyWriteTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
): ActionClassification | null {
  return WRITE_TOOLS.has(toolName) ? classifyFile(toolName, params, defaultRisk) : null;
}

function classifyReviewTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
): ActionClassification | null {
  if (!REVIEW_TOOLS.has(toolName)) return null;
  const target = String(params?.file_path ?? params?.path ?? params?.query ?? '');
  return {
    actionType: 'review',
    riskScore: Math.min(defaultRisk, 15),
    reversible: true,
    systemsTouched: [],
    declaredGoal: `${toolName}: ${target.slice(0, 120) || '(unknown)'}`,
  };
}

function classifyMessageTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
): ActionClassification | null {
  if (toolName !== 'sessions_send') return null;
  return {
    actionType: 'message',
    riskScore: defaultRisk,
    reversible: false,
    systemsTouched: [],
    declaredGoal: `message: ${summarizeParams(params).slice(0, 120)}`,
  };
}

function classifyDefaultTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  defaultRisk: number,
): ActionClassification {
  return {
    actionType: 'other',
    riskScore: defaultRisk,
    reversible: true,
    systemsTouched: [],
    declaredGoal: `${toolName}: ${summarizeParams(params).slice(0, 120)}`,
  };
}

function isApproved(action: ActionRecord | undefined): boolean {
  if (!action) return false;
  if (action.approved_by) return true;
  return action.status === 'running' || action.status === 'completed';
}

type HookBlockResult = { block: true; blockReason: string };
type HookResult = HookBlockResult | void;

interface ToolCallEvent {
  toolName: string;
  params?: Record<string, unknown>;
  toolCallId?: string;
  runId?: string;
  error?: string;
  result?: unknown;
  workspace?: unknown;
  branch?: unknown;
}

interface LlmOutputEvent {
  runId?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

interface AgentEndContext {
  runId?: string;
}

interface CreatedAction {
  actionId: string;
  status?: string;
}

function registerGovernanceGate(api: OpenClawPluginApi, config: PluginConfig): void {
  api.on('before_tool_call', async (event, _ctx) =>
    handleBeforeToolCall(event as ToolCallEvent, config)
  );
}

function registerTokenAttribution(api: OpenClawPluginApi, config: PluginConfig): void {
  api.on('llm_output', async (event, _ctx) =>
    handleLlmOutput(event as LlmOutputEvent, config)
  );
}

function registerRunCleanup(api: OpenClawPluginApi, config: PluginConfig): void {
  api.on('agent_end', async (_event, ctx) =>
    handleAgentEnd(ctx as AgentEndContext | undefined, config)
  );
}

function registerOutcomeRecorder(api: OpenClawPluginApi, config: PluginConfig): void {
  api.on('after_tool_call', async (event, _ctx) =>
    handleAfterToolCall(event as ToolCallEvent, config)
  );
}

/**
 * Enforcement-liveness probe on `session_start` (v8.2; per-seam since
 * drizzle/0072). Proves the `before_tool_call` veto above actually HOLDS a
 * synthetic action, and files the verdict under `runtime: openclaw` so this
 * seam is scored on its own instead of inheriting another runtime's green.
 *
 * Fire-and-forget, like maybeAutoPair: session start is never delayed or
 * failed by it. Self-throttled to once per 12h.
 *
 * It drives handleBeforeToolCall — the REAL handler, not a copy — under a
 * synthetic identity. `smoke-` prefixed agents are excluded from every
 * aggregate, and the identity swap is orthogonal to the enforcement mechanics
 * being probed, so it costs no seam fidelity while keeping the probe's guard
 * rows out of the operator's real numbers.
 */
function registerLivenessProbe(api: OpenClawPluginApi, config: PluginConfig): void {
  api.on('session_start', async (_event, _ctx) => {
    if (!config.dashclawUrl || !config.dashclawApiKey) return;
    if (!shouldProbeNow()) return;
    const probeConfig: PluginConfig = { ...config, agentId: PROBE_AGENT_ID };
    void runLivenessProbe({
      dashclawUrl: config.dashclawUrl,
      dashclawApiKey: config.dashclawApiKey,
      driveSeam: (event) => handleBeforeToolCall(event as ToolCallEvent, probeConfig),
    }).catch((err) => {
      console.warn(
        `[dashclaw-governance] liveness probe failed: ${errorMessage(err) || 'unknown'}`
      );
    });
  });
}

async function handleBeforeToolCall(
  event: ToolCallEvent,
  config: PluginConfig,
): Promise<HookResult> {
  const { toolName, params, toolCallId, runId } = event;
  const key = callKey(toolName, toolCallId, runId);
  if (!toolCallId && pendingActions.has(key)) {
    return {
      block: true,
      blockReason:
        'OpenClaw did not provide a stable tool call ID and another matching call is still open. ' +
        'Execution was interrupted because its outcome could not be correlated safely.',
    };
  }
  const workspace = typeof event.workspace === 'string' ? event.workspace : undefined;
  const classification = classifyToolCall(toolName, params, config, workspace);

  const client = getBeforeClient(config);
  if ('result' in client) return client.result;

  // Fire-and-forget: answers a pending operator pairing request once per
  // gateway process. Never blocks or fails the tool call.
  void maybeAutoPair(client.value, config);

  await maybeStartSession(event, client.value, config);

  const decision = await guardClassifiedAction(client.value, classification, config);
  if ('result' in decision) return decision.result;

  const block = blockResultForDecision(decision.value, toolName);
  if (block) return block;

  return openActionRecord({
    client: client.value,
    classification,
    decision: decision.value,
    toolName,
    key,
    runId,
    config,
  });
}

function getBeforeClient(
  config: PluginConfig,
): { value: DashClaw } | { result: HookResult } {
  try {
    return { value: getClient(config) };
  } catch (err) {
    const msg = errorMessage(err) || 'unknown error';
    if (config.failClosed) {
      return { result: { block: true, blockReason: `DashClaw config error: ${msg}` } };
    }
    console.warn(`[dashclaw-governance] config error (fail-open): ${msg}`);
    return { result: undefined };
  }
}

async function maybeStartSession(
  event: ToolCallEvent,
  client: DashClaw,
  config: PluginConfig,
): Promise<void> {
  if (!event.runId) return;
  const runState = getTokenTurn(event.runId);
  if (runState.sessionStarted) return;

  runState.sessionStarted = true; // guard before await — once per run
  const workspace = typeof event.workspace === 'string' ? event.workspace : undefined;
  const branch = typeof event.branch === 'string' ? event.branch : null;
  try {
    const res = await client.createSession(config.agentId, workspace, branch);
    const sessionId =
      (res as { session?: { id?: string }; id?: string }).session?.id ??
      (res as { id?: string }).id;
    if (sessionId) runState.sessionId = sessionId;
  } catch (err) {
    console.warn(
      `[dashclaw-governance] createSession failed: ${errorMessage(err) || 'unknown'}`
    );
  }
}

async function guardClassifiedAction(
  client: DashClaw,
  classification: ActionClassification,
  config: PluginConfig,
): Promise<{ value: ClaimAwareGuardDecision } | { result: HookResult }> {
  try {
    const raw = await client.guard({
        action_type: classification.actionType,
        risk_score: classification.riskScore,
        declared_goal: classification.declaredGoal,
        reversible: classification.reversible,
        systems_touched: classification.systemsTouched,
        client_capabilities: ['execution_claims'],
        ...(classification.act ? { act: classification.act } : {}),
      });
    const validated = validateGuardDecision(raw, config.requireExecutionClaims);
    if ('reason' in validated) {
      return {
        result: {
          block: true,
          blockReason: validated.reason,
        },
      };
    }
    return { value: validated.value };
  } catch (err) {
    const msg = errorMessage(err) || 'unknown error';
    if (config.failClosed) {
      return {
        result: {
          block: true,
          blockReason: `DashClaw unreachable — fail-closed policy (${msg})`,
        },
      };
    }
    console.warn(`[dashclaw-governance] guard call failed (fail-open): ${msg}`);
    return { result: undefined };
  }
}

type ClaimAwareGuardDecision = GuardDecision & {
  execution_claim_required?: boolean;
  claim_protocol?: number;
};

const GUARD_DECISIONS = new Set(['allow', 'block', 'warn', 'require_approval']);
const EXECUTION_CLAIM_TIMEOUT_MS = 30_000;

function validateGuardDecision(value: unknown, requireExecutionClaims: boolean):
  | { value: ClaimAwareGuardDecision }
  | { reason: string } {
  if (!value || typeof value !== 'object') {
    return { reason: 'DashClaw returned a malformed guard response; tool execution was interrupted.' };
  }
  const response = value as Record<string, unknown>;
  if (typeof response.decision !== 'string' || !GUARD_DECISIONS.has(response.decision)) {
    return { reason: 'DashClaw returned a malformed or unknown guard decision; tool execution was interrupted.' };
  }
  if (response.decision === 'block') {
    return { value: value as ClaimAwareGuardDecision };
  }
  const advertised = 'execution_claim_required' in response || 'claim_protocol' in response;
  const validClaims = response.execution_claim_required === true && response.claim_protocol === 1;
  if ((requireExecutionClaims || advertised) && !validClaims) {
    return {
      reason:
        'DashClaw server upgrade required: execution-claim protocol 1 was not advertised, so this tool call cannot run safely.',
    };
  }
  return { value: value as ClaimAwareGuardDecision };
}

function blockResultForDecision(
  decision: GuardDecision,
  toolName: string,
): HookBlockResult | undefined {
  if (decision.decision === 'block') {
    return {
      block: true,
      blockReason: decision.reason || 'Blocked by DashClaw policy',
    };
  }
  if (decision.decision === 'warn') {
    console.warn(
      `[dashclaw-governance] WARN ${toolName}: ${decision.reason || 'flagged by policy'}`
    );
  }
  return undefined;
}

interface OpenActionContext {
  client: DashClaw;
  classification: ActionClassification;
  decision: ClaimAwareGuardDecision;
  toolName: string;
  key: string;
  runId?: string;
  config: PluginConfig;
}

async function openActionRecord(ctx: OpenActionContext): Promise<HookResult> {
  const created = await createGovernanceAction(ctx);
  if ('result' in created) return created.result;

  const approval = await waitForRequiredApproval(ctx, created.value);
  if (approval) return approval;
  if (ctx.decision.execution_claim_required === true && ctx.decision.claim_protocol === 1) {
    const claim = await claimExecution(ctx, created.value.actionId);
    if (claim) return claim;
  }
  rememberPendingAction(ctx.key, created.value.actionId, ctx.runId);
  return;
}

async function createGovernanceAction(
  ctx: OpenActionContext,
): Promise<{ value: CreatedAction } | { result: HookResult }> {
  const { actionType, declaredGoal, riskScore, reversible, systemsTouched } =
    ctx.classification;
  try {
    const created = await ctx.client.createAction({
      action_type: actionType,
      declared_goal: declaredGoal,
      risk_score: riskScore,
      reversible,
      systems_touched: systemsTouched,
      client_capabilities: ['execution_claims'],
      ...(ctx.classification.act ? { act: ctx.classification.act } : {}),
      metadata: { openclaw_tool_name: ctx.toolName },
    });
    const ids = [created.action_id, created.action?.action_id, created.action?.id]
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0 || new Set(ids).size !== 1) {
      return {
        result: {
          block: true,
          blockReason: 'DashClaw action response did not contain one exact action ID; tool execution was interrupted.',
        },
      };
    }
    return { value: { actionId: ids[0], status: created.action?.status } };
  } catch (err) {
    const msg = errorMessage(err) || 'unknown';
    console.warn(`[dashclaw-governance] createAction failed: ${msg}`);
    if (ctx.config.failClosed) {
      return {
        result: {
          block: true,
          blockReason: `DashClaw action record could not be opened — fail-closed policy (${msg})`,
        },
      };
    }
    return { result: undefined };
  }
}

async function claimExecution(
  ctx: OpenActionContext,
  actionId: string,
): Promise<HookBlockResult | undefined> {
  const attemptId = randomUUID();
  const body = {
    claim_execution: true,
    attempt_id: attemptId,
    agent_id: ctx.config.agentId,
    ...(ctx.classification.act ? { act: ctx.classification.act } : {}),
  };
  let response: Response;
  let payload: unknown;
  const controller = new AbortController();
  const timeoutError = new Error(
    `execution claim timed out after ${EXECUTION_CLAIM_TIMEOUT_MS}ms`
  );
  const timer = setTimeout(
    () => controller.abort(timeoutError),
    EXECUTION_CLAIM_TIMEOUT_MS
  );
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : timeoutError),
      { once: true }
    );
  });
  try {
    response = await Promise.race([
      fetch(
        `${ctx.config.dashclawUrl}/api/actions/${encodeURIComponent(actionId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ctx.config.dashclawApiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      ),
      aborted,
    ]);
    if (!response.ok) {
      return {
        block: true,
        blockReason: `DashClaw execution claim failed (HTTP ${response.status}); reconcile action ${actionId} before retrying.`,
      };
    }
    payload = await Promise.race([response.json(), aborted]);
  } catch (err) {
    return {
      block: true,
      blockReason:
        `DashClaw execution claim failed (${errorMessage(err) || 'response lost'}); ` +
        `reconcile action ${actionId} before retrying.`,
    };
  } finally {
    clearTimeout(timer);
  }
  const claimed = payload as Record<string, unknown> | null;
  if (!claimed
      || claimed.claimed !== true
      || claimed.action_id !== actionId
      || claimed.attempt_id !== attemptId) {
    return {
      block: true,
      blockReason:
        `DashClaw execution claim returned a malformed acknowledgement; ` +
        `reconcile action ${actionId} before retrying.`,
    };
  }
  return undefined;
}

async function waitForRequiredApproval(
  ctx: OpenActionContext,
  created: CreatedAction,
): Promise<HookBlockResult | undefined> {
  const needsApproval =
    ctx.decision.decision === 'require_approval' ||
    created.status === 'pending_approval';
  if (!needsApproval) return undefined;

  const timeout = ctx.config.approvalWaitMs;
  try {
    const { action } = await ctx.client.waitForApproval(created.actionId, {
      timeout,
      interval: approvalPollInterval(timeout),
    });
    if (isApproved(action)) return undefined;
    return {
      block: true,
      blockReason: action?.error_message || 'Action denied by operator',
    };
  } catch (err) {
    if (isApprovalTimeout(err)) {
      // The server keeps the approval open past this bounded wait
      // (approval_wait_seconds = 300): the operator can still approve, and a
      // retry of the same call passes via the guard's approval grant and
      // createAction's idempotent-retry dedupe instead of opening a duplicate.
      return {
        block: true,
        blockReason:
          `Approval not received within ${Math.round(timeout / 1000)}s — ` +
          `action ${created.actionId} is still awaiting the operator. ` +
          `Approve it at ${ctx.config.dashclawUrl}/approvals, then retry this tool call.`,
      };
    }
    return {
      block: true,
      blockReason: `Approval denied or wait failed: ${errorMessage(err) || 'denied'}`,
    };
  }
}

/** Sample the approval at least ~4 times inside the window; keep the SDK's 5s ceiling. */
function approvalPollInterval(timeoutMs: number): number {
  return Math.min(5000, Math.max(50, Math.floor(timeoutMs / 4)));
}

/** Matches the SDK's approval-timeout error (a plain Error, distinct from denial). */
function isApprovalTimeout(err: unknown): boolean {
  return errorMessage(err).startsWith('Timed out waiting for approval');
}

function rememberPendingAction(
  key: string,
  actionId: string | undefined,
  runId: string | undefined,
): void {
  if (!actionId) return;
  pendingActions.set(key, actionId);
  if (runId) getTokenTurn(runId).turnActionIds.push(actionId);
}

async function handleLlmOutput(
  event: LlmOutputEvent,
  config: PluginConfig,
): Promise<void> {
  const { runId, model, usage } = event;
  if (!runId) return;

  const client = getClientForLlmOutput(config);
  if (!client) return;

  const state = getTokenTurn(runId);
  if (state.pendingUsage) {
    await distributePendingTokens(client, state);
  }

  const pendingUsage = tokenUsageFromEvent({
    usage,
    model,
    config,
    state,
    runId,
  });
  if (pendingUsage) state.pendingUsage = pendingUsage;
}

function getClientForLlmOutput(config: PluginConfig): DashClaw | undefined {
  try {
    return getClient(config);
  } catch (err) {
    console.warn(
      `[dashclaw-governance] llm_output dropped — client unavailable: ${errorMessage(err) || 'unknown'}`
    );
    return undefined;
  }
}

interface TokenUsageContext {
  usage: LlmOutputEvent['usage'];
  model?: string;
  config: PluginConfig;
  state: TokenTurnState;
  runId: string;
}

function tokenUsageFromEvent(ctx: TokenUsageContext): TokenTurnState['pendingUsage'] {
  const { usage, model, config, state, runId } = ctx;
  if (!usage) return undefined;
  const cacheReadEffective = Math.round((usage.cacheRead ?? 0) * 0.1);
  const tokens_in = (usage.input ?? 0) + (usage.cacheWrite ?? 0) + cacheReadEffective;
  const tokens_out = usage.output ?? 0;
  if (tokens_in <= 0 && tokens_out <= 0) return undefined;

  const resolvedModel = model && model.length > 0 ? model : config.defaultModel;
  warnOnceForMissingModel(resolvedModel, state, runId);
  return { tokens_in, tokens_out, model: resolvedModel };
}

function warnOnceForMissingModel(
  model: string,
  state: TokenTurnState,
  runId: string,
): void {
  if (model || state.warnedMissingModel) return;
  console.warn(
    `[dashclaw-governance] llm_output has no model for run ${runId} — ` +
      `tokens will land on action records but cost_estimate will stay $0. ` +
      `Set config.defaultModel or DASHCLAW_DEFAULT_MODEL to price these turns.`
  );
  state.warnedMissingModel = true;
}

async function handleAgentEnd(
  ctx: AgentEndContext | undefined,
  config: PluginConfig,
): Promise<void> {
  const runId = ctx?.runId;
  if (!runId) return;
  const state = tokenTurnByRun.get(runId);
  if (!state) return;

  const client = getClientForAgentEnd(config, state);
  if (client && state.pendingUsage && state.turnActionIds.length > 0) {
    await distributePendingTokens(client, state);
  }
  // Codex turns whose `llm_output` fired without usage stash their action_ids
  // to fold into the NEXT usage-bearing turn (the only in-process recovery
  // signal — the Codex app-server emits no late/secondary usage event). When a
  // run ends on such a turn, no later signal ever arrives and those actions
  // stay unattributed (their tokens are genuinely unrecoverable). That's the
  // existing behavior; we just refuse to drop them silently. (background path
  // → console.warn with context, never a bare drop.)
  if (state.turnActionIds.length > 0) {
    console.warn(
      `[dashclaw-governance] agent_end for run ${runId}: ${state.turnActionIds.length} ` +
        `action(s) end the run unattributed — their codex turn(s) reported no token ` +
        `usage and no later usage-bearing turn followed. tokens_in/out stay unrecorded.`
    );
  }
  if (client && state.sessionId) {
    await closeSession(client, state.sessionId);
  }
  tokenTurnByRun.delete(runId);
}

function getClientForAgentEnd(
  config: PluginConfig,
  state: TokenTurnState,
): DashClaw | null {
  try {
    return getClient(config);
  } catch (err) {
    const lost = state.turnActionIds.length;
    if ((state.pendingUsage && lost > 0) || state.sessionId) {
      console.warn(
        `[dashclaw-governance] agent_end cleanup dropped (client unavailable): ${lost} token action(s), session ${state.sessionId ?? 'none'}: ${errorMessage(err) || 'unknown'}`
      );
    }
    return null;
  }
}

async function closeSession(client: DashClaw, sessionId: string): Promise<void> {
  try {
    await client.updateSession(sessionId, { status: 'completed' });
  } catch (err) {
    console.warn(
      `[dashclaw-governance] updateSession(end) failed for ${sessionId}: ${errorMessage(err) || 'unknown'}`
    );
  }
}

async function handleAfterToolCall(
  event: ToolCallEvent,
  config: PluginConfig,
): Promise<void> {
  const { toolName, toolCallId, runId } = event;
  const key = callKey(toolName, toolCallId, runId);

  await handleGenericAfterToolCall(key, event.error, config);
}

function getClientForOutcome(config: PluginConfig): DashClaw | undefined {
  try {
    return getClient(config);
  } catch {
    return undefined;
  }
}

async function handleGenericAfterToolCall(
  key: string,
  error: string | undefined,
  config: PluginConfig,
): Promise<void> {
  const actionId = pendingActions.get(key);
  if (!actionId) return;
  pendingActions.delete(key);

  const client = getClientForOutcome(config);
  if (!client) return;

  try {
    await client.updateOutcome(actionId, {
      status: error ? 'failed' : 'completed',
      ...(error ? { error_message: error } : {}),
    });
  } catch (err) {
    console.warn(
      `[dashclaw-governance] updateOutcome failed: ${errorMessage(err) || 'unknown'}`
    );
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const pluginEntry: ReturnType<typeof definePluginEntry> = definePluginEntry({
  id: 'dashclaw-governance',
  name: 'DashClaw Governance',
  description:
    'Policy enforcement, human-in-the-loop approval, and decision recording for every OpenClaw tool call. Powered by DashClaw.',

  register(api: OpenClawPluginApi): void {
    const config = resolveConfig(api.pluginConfig);

    registerGovernanceGate(api, config);

    registerTokenAttribution(api, config);
    registerRunCleanup(api, config);

    registerOutcomeRecorder(api, config);
    registerLivenessProbe(api, config);
  },
});

export default pluginEntry;
