/**
 * @dashclaw/openclaw-plugin
 *
 * OpenClaw plugin that routes every tool call through DashClaw governance:
 *   1. `before_tool_call` → `guard()` + optional `waitForApproval()` +
 *      `createAction()` to open a governance record.
 *   2. `after_tool_call`  → `updateOutcome()` to close that record.
 *
 * x402 capability payments (e.g. an `agentcash fetch`) take a dedicated path:
 * `before_tool_call` gates them with `action_type:'x402_purchase'` (so an
 * `x402_spend_limit` policy can block an over-budget payment before it runs),
 * and `after_tool_call` records the settled spend via `recordPurchase()` +
 * `recordPurchaseResult()`. The agent still executes the payment itself
 * (govern-not-do); DashClaw only guards and records it.
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
  riskScoreDefault: number;
  highRiskTools: ReadonlySet<string>;
  // --- x402 spend governance ---
  x402Enabled: boolean;
  x402CommandPatterns: RegExp[];
  x402ToolNames: ReadonlySet<string>;
  x402EstimatedCostUsd: number;
  x402AutoRegisterProviders: boolean;
  x402Debug: boolean;
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

function compileX402Pattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    console.warn(`[dashclaw-governance] invalid x402CommandPattern ignored: ${pattern}`);
    return null;
  }
}

function resolveX402Patterns(raw: unknown): RegExp[] {
  const patterns =
    Array.isArray(raw) && raw.length
      ? raw.filter((v): v is string => typeof v === 'string')
      : ['agentcash[\\s\\S]*?fetch']; // matches the agentcash CLI `fetch` AND wrappers like .../agentcash/fetch-json.mjs
  return patterns
    .map(compileX402Pattern)
    .filter((r): r is RegExp => r !== null);
}

function resolveConfig(raw: Record<string, unknown> | undefined): PluginConfig {
  const cfg = raw ?? {};
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};

  const failClosed = cfg.failClosed !== false; // default true
  const riskScoreDefault = numberFromConfig(cfg.riskScoreDefault, 50);
  const highRiskTools = stringSetFromConfig(cfg.highRiskTools);

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

  const x402Enabled = cfg.x402Enabled !== false; // default true
  const x402CommandPatterns = resolveX402Patterns(cfg.x402CommandPatterns);
  const x402ToolNames = stringSetFromConfig(cfg.x402ToolNames);
  const x402EstimatedCostUsd = numberFromConfig(
    cfg.x402EstimatedCostUsd,
    0.01,
    false
  );
  const x402AutoRegisterProviders = cfg.x402AutoRegisterProviders !== false; // default true
  const x402Debug =
    cfg.x402Debug === true ||
    env.DASHCLAW_X402_DEBUG === '1' ||
    env.DASHCLAW_X402_DEBUG === 'true';

  return {
    dashclawUrl,
    dashclawApiKey,
    agentId,
    defaultModel,
    failClosed,
    riskScoreDefault,
    highRiskTools,
    x402Enabled,
    x402CommandPatterns,
    x402ToolNames,
    x402EstimatedCostUsd,
    x402AutoRegisterProviders,
    x402Debug,
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
 * x402 payment calls that passed the pre-payment gate at `before_tool_call` and
 * are awaiting their settlement receipt at `after_tool_call`. Keyed by call key.
 */
interface X402Pending {
  origin: string;
  declaredGoal: string;
  estimate: number;
}
const x402PendingByKey = new Map<string, X402Pending>();

/** Cache of x402 provider origin → DashClaw provider_id (best-effort auto-registration). */
const providerIdByOrigin = new Map<string, string>();

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
// x402 spend governance — detect agentcash-style capability payments, gate them
// before they execute, then record the settled spend after. The agent still
// performs the payment itself (govern-not-do); DashClaw guards + records it.
// ---------------------------------------------------------------------------

interface X402Detection {
  origin: string;   // provider host, e.g. "stableenrich.dev"
  url: string;
  estimate: number; // pre-payment USD estimate for the guard
}

/** Debug breadcrumb (enable with config.x402Debug or DASHCLAW_X402_DEBUG=1). */
function x402log(config: PluginConfig, msg: string): void {
  if (config.x402Debug) console.log(`[dashclaw-governance][x402] ${msg}`);
}

/**
 * Pull a command string from a tool's params across the common shapes — bash/exec
 * `command`, Codex `shell_command`, and wrapper tools — accepting a string or a
 * string[] under command / cmd / script / args.
 */
function extractCommand(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const c = params.command ?? params.cmd ?? params.script ?? params.args;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => String(x)).join(' ');
  return '';
}

function matchesX402(toolName: string, command: string, config: PluginConfig): boolean {
  if (config.x402ToolNames.has(toolName)) return true;
  return command.length > 0 && config.x402CommandPatterns.some((re) => re.test(command));
}

function resolveX402Url(
  params: Record<string, unknown> | undefined,
  command: string,
): string {
  const urlFromParams = String(params?.url ?? params?.endpoint ?? params?.uri ?? '');
  return urlFromParams || command.match(/https?:\/\/[^\s'"`]+/)?.[0] || '';
}

function originFromUrl(url: string): string {
  let origin = '';
  try {
    origin = url ? new URL(url).host : '';
  } catch {
    origin = '';
  }
  return origin || 'unknown-x402-provider';
}

function x402EstimateFromCommand(command: string): number | null {
  const maxAmt = command.match(/--max-amount[=\s]+([0-9]*\.?[0-9]+)/);
  return maxAmt ? Number(maxAmt[1]) : null;
}

function x402EstimateFromParams(params: Record<string, unknown> | undefined): number | null {
  if (typeof params?.maxAmount === 'number') return params.maxAmount as number;
  if (typeof params?.amount === 'number') return params.amount as number;
  return null;
}

function normalizeX402Estimate(value: number | null, fallback: number): number {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function detectX402(
  toolName: string,
  params: Record<string, unknown> | undefined,
  config: PluginConfig,
): X402Detection | null {
  if (!config.x402Enabled) return null;

  // Match against ANY tool's command (bash/exec, Codex `shell_command`, a wrapper
  // script) — the command pattern is the real filter — plus explicit tool names.
  const command = extractCommand(params);
  if (!matchesX402(toolName, command, config)) return null;

  // Pre-payment estimate: the agent's --max-amount ceiling, else an explicit
  // amount param, else the configured fallback. Conservative on purpose so the
  // guard evaluates the worst-case spend before the payment runs.
  const url = resolveX402Url(params, command);
  const estimate = normalizeX402Estimate(
    x402EstimateFromCommand(command) ?? x402EstimateFromParams(params),
    config.x402EstimatedCostUsd
  );
  return { origin: originFromUrl(url), url, estimate };
}

interface X402Receipt {
  spend: number;
  txHash?: string;
  requestId?: string;
}

/**
 * Parse an agentcash success envelope from a tool result. Returns null when the
 * result is not a settled paid call (a free `check`, a 402-not-paid, or no
 * parseable payload), so we only record purchases that actually moved money.
 */
function unwrapX402ReceiptCandidate(result: unknown): unknown {
  // Unwrap common shell-result shapes ({ stdout }, { output }, { text }, …) to
  // the JSON string when the result isn't already the raw agentcash envelope.
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const o = result as Record<string, any>;
    if (!(o.data || o.metadata || o.costDollars)) {
      return o.stdout ?? o.output ?? o.text ?? o.result ?? o.content ?? result;
    }
  }
  return result;
}

function parseJsonishX402Receipt(candidate: unknown): unknown {
  if (typeof candidate !== 'string') return candidate;
  return parseJsonObject(candidate) ?? parseJsonObject(extractJsonBlock(candidate));
}

function parseJsonObject(source: string | null): unknown {
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function extractJsonBlock(source: string): string | null {
  return source.match(/\{[\s\S]*\}/)?.[0] ?? null;
}

function extractX402Spend(data: Record<string, any>, metadata: Record<string, any>): number {
  let spend = Number(data?.costDollars?.total);
  if (Number.isFinite(spend)) return spend;
  const pm = String(metadata?.price ?? '').match(/([0-9]*\.?[0-9]+)/);
  spend = pm ? Number(pm[1]) : NaN;
  return Number.isFinite(spend) ? spend : NaN;
}

function parseX402Receipt(result: unknown): X402Receipt | null {
  const candidate = unwrapX402ReceiptCandidate(result);
  const obj = parseJsonishX402Receipt(candidate);
  if (!obj || typeof obj !== 'object') return null;
  const env = obj as Record<string, any>;
  const data = (env.data ?? env) as Record<string, any>;
  const metadata = (env.metadata ?? {}) as Record<string, any>;

  const spend = extractX402Spend(data, metadata);
  if (!Number.isFinite(spend) || spend <= 0) return null; // not a settled payment

  return {
    spend,
    txHash:
      typeof metadata?.payment?.transactionHash === 'string'
        ? metadata.payment.transactionHash
        : undefined,
    requestId: typeof data?.requestId === 'string' ? data.requestId : undefined,
  };
}

/**
 * Best-effort: resolve (or create) a DashClaw provider_id for an origin so the
 * Spend → x402 surface can group purchases by provider. Cached per origin;
 * never throws — on any failure the purchase is recorded with a free-text
 * provider and a null provider_id.
 */
async function resolveProviderId(
  client: DashClaw,
  config: PluginConfig,
  origin: string,
): Promise<string | undefined> {
  if (!shouldResolveProvider(config, origin)) return undefined;
  const cached = providerIdByOrigin.get(origin);
  if (cached) return cached;

  try {
    const providers = providerListFromResponse(await client.listProviders());
    const id =
      providerIdFromList(providers, origin) ??
      (await createProviderId(client, origin));
    if (id) {
      providerIdByOrigin.set(origin, id);
      return id;
    }
  } catch (err) {
    console.warn(
      `[dashclaw-governance] x402 provider resolve failed for ${origin}: ${errorMessage(err) || 'unknown'}`
    );
  }
  return undefined;
}

function shouldResolveProvider(config: PluginConfig, origin: string): boolean {
  return (
    config.x402AutoRegisterProviders &&
    origin.length > 0 &&
    origin !== 'unknown-x402-provider'
  );
}

function providerListFromResponse(response: unknown): Array<Record<string, any>> {
  if (Array.isArray(response)) return response as Array<Record<string, any>>;
  return ((response as { providers?: Array<Record<string, any>> })?.providers ?? []);
}

function providerIdFromList(
  providers: Array<Record<string, any>>,
  origin: string,
): string | undefined {
  const match = providers.find(
    (p) =>
      p?.name === origin ||
      (typeof p?.base_url === 'string' && p.base_url.includes(origin))
  );
  return match?.provider_id ?? match?.id;
}

async function createProviderId(
  client: DashClaw,
  origin: string,
): Promise<string | undefined> {
  const created = (await client.createProvider({
    name: origin,
    base_url: `https://${origin}`,
    category: 'research',
    default_currency: 'USDC',
    metadata: { source: 'openclaw-x402' },
  })) as Record<string, any>;
  return created?.provider?.provider_id ?? created?.provider_id ?? created?.id;
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
}

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
): ActionClassification {
  const defaultRisk = config.highRiskTools.has(toolName) ? 85 : config.riskScoreDefault;
  const classified = TOOL_CLASSIFIERS
    .map((classify) => classify(toolName, params, defaultRisk))
    .find((result): result is ActionClassification => result !== null);
  return classified ?? classifyDefaultTool(toolName, params, defaultRisk);
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
  actionId?: string;
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

async function handleBeforeToolCall(
  event: ToolCallEvent,
  config: PluginConfig,
): Promise<HookResult> {
  const { toolName, params, toolCallId, runId } = event;
  const key = callKey(toolName, toolCallId, runId);
  const classification = classifyToolCall(toolName, params, config);

  const client = getBeforeClient(config);
  if ('result' in client) return client.result;

  await maybeStartSession(event, client.value, config);

  const x402Result = await handleX402Before({
    toolName,
    params,
    key,
    client: client.value,
    config,
  });
  if (x402Result.handled) return x402Result.result;

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

interface X402BeforeContext {
  toolName: string;
  params?: Record<string, unknown>;
  key: string;
  client: DashClaw;
  config: PluginConfig;
}

async function handleX402Before(
  ctx: X402BeforeContext,
): Promise<{ handled: false } | { handled: true; result?: HookBlockResult }> {
  const x402 = detectX402(ctx.toolName, ctx.params, ctx.config);
  if (!x402) return { handled: false };

  const declaredGoal = `x402 purchase: ${x402.origin}`;
  x402log(
    ctx.config,
    `gate: tool=${ctx.toolName} origin=${x402.origin} estimate=$${x402.estimate}`
  );

  const decision = await guardX402Purchase(ctx.client, ctx.config, x402, declaredGoal);
  if (!decision.ok) {
    if (decision.failOpen) rememberX402Pending(ctx.key, x402, declaredGoal);
    return { handled: true, result: decision.result };
  }

  const block = blockResultForX402Decision(decision.value, x402);
  if (block) return { handled: true, result: block };
  warnOnX402Decision(ctx.config, decision.value, x402.origin);
  rememberX402Pending(ctx.key, x402, declaredGoal);
  return { handled: true };
}

async function guardX402Purchase(
  client: DashClaw,
  config: PluginConfig,
  x402: X402Detection,
  declaredGoal: string,
): Promise<
  | { ok: true; value: GuardDecision }
  | { ok: false; result?: HookBlockResult; failOpen: boolean }
> {
  try {
    return {
      ok: true,
      value: await client.guard({
        action_type: 'x402_purchase',
        provider: x402.origin,
        cost_estimate: x402.estimate,
        risk_score: 40,
        declared_goal: declaredGoal,
        reversible: false,
        systems_touched: ['x402', x402.origin],
      }),
    };
  } catch (err) {
    const msg = errorMessage(err) || 'unknown error';
    if (config.failClosed) {
      return {
        ok: false,
        failOpen: false,
        result: {
          block: true,
          blockReason: `DashClaw unreachable — x402 payment to ${x402.origin} blocked (fail-closed): ${msg}`,
        },
      };
    }
    console.warn(`[dashclaw-governance] x402 guard failed (fail-open): ${msg}`);
    return { ok: false, failOpen: true };
  }
}

function blockResultForX402Decision(
  decision: GuardDecision,
  x402: X402Detection,
): HookBlockResult | undefined {
  if (decision.decision !== 'block' && decision.decision !== 'require_approval') {
    return undefined;
  }
  const why =
    decision.decision === 'require_approval'
      ? 'requires approval — adjust the x402_spend_limit policy threshold to allow it'
      : decision.reason || 'blocked by x402 spend policy';
  return {
    block: true,
    blockReason: `x402 payment to ${x402.origin} (~$${x402.estimate}) ${why}`,
  };
}

function warnOnX402Decision(
  config: PluginConfig,
  decision: GuardDecision,
  origin: string,
): void {
  if (decision.decision !== 'warn') return;
  console.warn(
    `[dashclaw-governance] WARN x402 ${origin}: ${decision.reason || 'flagged by policy'}`
  );
}

function rememberX402Pending(
  key: string,
  x402: X402Detection,
  declaredGoal: string,
): void {
  x402PendingByKey.set(key, {
    origin: x402.origin,
    declaredGoal,
    estimate: x402.estimate,
  });
}

async function guardClassifiedAction(
  client: DashClaw,
  classification: ActionClassification,
  config: PluginConfig,
): Promise<{ value: GuardDecision } | { result: HookResult }> {
  try {
    return {
      value: await client.guard({
        action_type: classification.actionType,
        risk_score: classification.riskScore,
        declared_goal: classification.declaredGoal,
        reversible: classification.reversible,
        systems_touched: classification.systemsTouched,
      }),
    };
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
  decision: GuardDecision;
  toolName: string;
  key: string;
  runId?: string;
  config: PluginConfig;
}

async function openActionRecord(ctx: OpenActionContext): Promise<HookResult> {
  const created = await createGovernanceAction(ctx);
  if ('result' in created) return created.result;

  const approval = await waitForRequiredApproval(ctx.client, ctx.decision, created.value);
  if (approval) return approval;
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
      metadata: { openclaw_tool_name: ctx.toolName },
    });
    return {
      value: {
        actionId: created.action_id ?? created.action?.action_id ?? created.action?.id,
        status: created.action?.status,
      },
    };
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

async function waitForRequiredApproval(
  client: DashClaw,
  decision: GuardDecision,
  created: CreatedAction,
): Promise<HookBlockResult | undefined> {
  const needsApproval =
    decision.decision === 'require_approval' ||
    created.status === 'pending_approval';
  if (!needsApproval || !created.actionId) return undefined;

  try {
    const { action } = await client.waitForApproval(created.actionId);
    if (isApproved(action)) return undefined;
    return {
      block: true,
      blockReason: action?.error_message || 'Action denied by operator',
    };
  } catch (err) {
    return {
      block: true,
      blockReason: `Approval denied or wait failed: ${errorMessage(err) || 'denied'}`,
    };
  }
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

  const x402pending = x402PendingByKey.get(key);
  if (x402pending) {
    x402PendingByKey.delete(key);
    await handleX402After(event, x402pending, config);
    return;
  }

  await handleGenericAfterToolCall(key, event.error, config);
}

async function handleX402After(
  event: ToolCallEvent,
  pending: X402Pending,
  config: PluginConfig,
): Promise<void> {
  const client = getClientForOutcome(config);
  if (!client) return;
  logX402ResultPreview(config, pending, event);

  if (event.error) {
    console.warn(`[dashclaw-governance] x402 call to ${pending.origin} failed: ${event.error}`);
    return;
  }
  const receipt = parseX402Receipt(event.result);
  logX402Receipt(config, receipt);
  if (!receipt) return;

  await recordX402Purchase(client, config, pending, receipt);
}

function getClientForOutcome(config: PluginConfig): DashClaw | undefined {
  try {
    return getClient(config);
  } catch {
    return undefined;
  }
}

function logX402ResultPreview(
  config: PluginConfig,
  pending: X402Pending,
  event: ToolCallEvent,
): void {
  if (!config.x402Debug) return;
  x402log(
    config,
    `record: origin=${pending.origin} hasError=${!!event.error} resultType=${typeof event.result} resultPresent=${event.result !== undefined} preview=${resultPreview(event.result)}`
  );
}

function resultPreview(result: unknown): string {
  try {
    return typeof result === 'string'
      ? result.slice(0, 300)
      : JSON.stringify(result)?.slice(0, 300) ?? '';
  } catch {
    return '[unserializable]';
  }
}

function logX402Receipt(config: PluginConfig, receipt: X402Receipt | null): void {
  x402log(
    config,
    receipt
      ? `parsed receipt: $${receipt.spend} tx=${receipt.txHash ?? 'none'}`
      : `parse FAILED — no settled spend found in tool result (set x402Debug to inspect the shape)`
  );
}

async function recordX402Purchase(
  client: DashClaw,
  config: PluginConfig,
  pending: X402Pending,
  receipt: X402Receipt,
): Promise<void> {
  try {
    const providerId = await resolveProviderId(client, config, pending.origin);
    const res = await client.recordPurchase({
      agent_id: config.agentId,
      provider: pending.origin,
      declared_goal: pending.declaredGoal,
      purchase_reason: `Paid x402 capability call to ${pending.origin}`,
      context_gap: `Capability gated behind payment at ${pending.origin}`,
      expected_value: `Paid result from ${pending.origin}`,
      spend_amount: receipt.spend,
      cost_estimate: receipt.spend,
      currency: 'USDC',
      payment_method: 'x402',
      ...(providerId ? { provider_id: providerId } : {}),
    });
    await recordX402Receipt(client, pending, receipt, purchaseActionId(res));
  } catch (err) {
    console.warn(
      `[dashclaw-governance] recordPurchase failed for ${pending.origin}: ${errorMessage(err) || 'unknown'}`
    );
  }
}

function purchaseActionId(res: any): string | undefined {
  return res?.action?.action_id ?? res?.action_id ?? res?.action?.id;
}

async function recordX402Receipt(
  client: DashClaw,
  pending: X402Pending,
  receipt: X402Receipt,
  actionId: string | undefined,
): Promise<void> {
  if (!actionId || (!receipt.txHash && !receipt.requestId)) return;
  await client
    .recordPurchaseResult(String(actionId), {
      summary: `x402 settled: $${receipt.spend} USDC at ${pending.origin}`,
      data: {
        origin: pending.origin,
        transactionHash: receipt.txHash,
        requestId: receipt.requestId,
      },
    })
    .catch((err: unknown) => {
      console.warn(
        `[dashclaw-governance] recordPurchaseResult failed: ${errorMessage(err) || 'unknown'}`
      );
    });
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

export default definePluginEntry({
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
  },
});
