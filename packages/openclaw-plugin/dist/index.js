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
import { definePluginEntry, } from 'openclaw/plugin-sdk/plugin-entry';
import { DashClaw, } from 'dashclaw';
/**
 * Resolve the DashClaw URL from (in order of precedence):
 *   1. `config.dashclawUrl`                    (canonical plugin-config key)
 *   2. `config.baseUrl`                        (SDK-style alias)
 *   3. `process.env.DASHCLAW_BASE_URL`         (canonical env var — matches CLI, local scripts)
 *   4. `process.env.DASHCLAW_URL`              (legacy env var — matches MCP server docs)
 *
 * The same precedence applies to the API key (with DASHCLAW_API_KEY as the only env var).
 */
function firstString(...candidates) {
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0)
            return c;
    }
    return '';
}
function stringSetFromConfig(value) {
    return new Set(Array.isArray(value)
        ? value.filter((v) => typeof v === 'string')
        : []);
}
function numberFromConfig(value, fallback, allowNegative = true) {
    if (typeof value !== 'number')
        return fallback;
    if (!Number.isFinite(value))
        return fallback;
    if (!allowNegative && value < 0)
        return fallback;
    return value;
}
function compileX402Pattern(pattern) {
    try {
        return new RegExp(pattern, 'i');
    }
    catch {
        console.warn(`[dashclaw-governance] invalid x402CommandPattern ignored: ${pattern}`);
        return null;
    }
}
function resolveX402Patterns(raw) {
    const patterns = Array.isArray(raw) && raw.length
        ? raw.filter((v) => typeof v === 'string')
        : ['agentcash[\\s\\S]*?fetch']; // matches the agentcash CLI `fetch` AND wrappers like .../agentcash/fetch-json.mjs
    return patterns
        .map(compileX402Pattern)
        .filter((r) => r !== null);
}
function resolveConfig(raw) {
    const cfg = raw ?? {};
    const env = typeof process !== 'undefined' && process?.env ? process.env : {};
    const failClosed = cfg.failClosed !== false; // default true
    const riskScoreDefault = numberFromConfig(cfg.riskScoreDefault, 50);
    const highRiskTools = stringSetFromConfig(cfg.highRiskTools);
    const dashclawUrl = firstString(cfg.dashclawUrl, cfg.baseUrl, env.DASHCLAW_BASE_URL, env.DASHCLAW_URL);
    const dashclawApiKey = firstString(cfg.dashclawApiKey, cfg.apiKey, env.DASHCLAW_API_KEY);
    const agentId = firstString(cfg.agentId, env.DASHCLAW_AGENT_ID) || 'openclaw';
    const defaultModel = firstString(cfg.defaultModel, env.DASHCLAW_DEFAULT_MODEL);
    const x402Enabled = cfg.x402Enabled !== false; // default true
    const x402CommandPatterns = resolveX402Patterns(cfg.x402CommandPatterns);
    const x402ToolNames = stringSetFromConfig(cfg.x402ToolNames);
    const x402EstimatedCostUsd = numberFromConfig(cfg.x402EstimatedCostUsd, 0.01, false);
    const x402AutoRegisterProviders = cfg.x402AutoRegisterProviders !== false; // default true
    const x402Debug = cfg.x402Debug === true ||
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
let cachedClient = null;
let cachedClientKey = '';
/** Maps synthetic call key → DashClaw action_id so `after_tool_call` can close it. */
const pendingActions = new Map();
const x402PendingByKey = new Map();
/** Cache of x402 provider origin → DashClaw provider_id (best-effort auto-registration). */
const providerIdByOrigin = new Map();
const tokenTurnByRun = new Map();
// Cap for in-memory per-run state. `agent_end` deletes entries, but a crash
// or an agent framework that never fires `agent_end` in a long-lived gateway
// process would leak. At ~100 bytes/entry this cap bounds worst-case memory
// to ~100KB while still comfortably above typical concurrency.
const MAX_TURN_RUNS = 1000;
function getTokenTurn(runId) {
    let state = tokenTurnByRun.get(runId);
    if (!state) {
        if (tokenTurnByRun.size >= MAX_TURN_RUNS) {
            // Evict oldest (Map preserves insertion order). One at a time is enough
            // to stay at the cap under steady state — we only grow by one here.
            const oldest = tokenTurnByRun.keys().next().value;
            if (oldest !== undefined)
                tokenTurnByRun.delete(oldest);
        }
        state = { turnActionIds: [] };
        tokenTurnByRun.set(runId, state);
    }
    return state;
}
/** Split a non-negative integer `total` into `n` buckets, putting remainders
 *  in the earliest buckets so the sum is preserved exactly. */
function distributeEvenly(total, n) {
    if (n <= 0 || total <= 0)
        return new Array(Math.max(n, 0)).fill(0);
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
async function distributePendingTokens(client, state) {
    const usage = state.pendingUsage;
    const ids = state.turnActionIds;
    state.pendingUsage = undefined;
    state.turnActionIds = [];
    if (!usage || ids.length === 0)
        return;
    if (usage.tokens_in === 0 && usage.tokens_out === 0)
        return;
    const inParts = distributeEvenly(usage.tokens_in, ids.length);
    const outParts = distributeEvenly(usage.tokens_out, ids.length);
    await Promise.all(ids.map((actionId, idx) => client
        .updateOutcome(actionId, {
        tokens_in: inParts[idx],
        tokens_out: outParts[idx],
        ...(usage.model ? { model: usage.model } : {}),
    })
        .catch((err) => {
        console.warn(`[dashclaw-governance] token PATCH failed for ${actionId}: ${errorMessage(err) || 'unknown'}`);
    })));
}
function getClient(config) {
    const key = `${config.dashclawUrl}|${config.dashclawApiKey}|${config.agentId}`;
    if (cachedClient && cachedClientKey === key)
        return cachedClient;
    if (!config.dashclawUrl || !config.dashclawApiKey) {
        const missing = [];
        if (!config.dashclawUrl)
            missing.push('dashclawUrl');
        if (!config.dashclawApiKey)
            missing.push('dashclawApiKey');
        throw new Error(`dashclaw-governance plugin: missing ${missing.join(' and ')}. ` +
            'Provide via openclaw.plugin.json config (dashclawUrl/dashclawApiKey or baseUrl/apiKey), ' +
            'or set env vars DASHCLAW_BASE_URL and DASHCLAW_API_KEY before starting the gateway.');
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
function summarizeParams(params) {
    if (!params)
        return '';
    let serialized;
    try {
        serialized = JSON.stringify(params);
    }
    catch {
        return '[unserializable params]';
    }
    if (serialized.length <= 500)
        return serialized;
    return serialized.slice(0, 500) + '…[truncated]';
}
function callKey(toolName, toolCallId, runId) {
    // Prefer the provider-supplied tool call ID; fall back to runId-scoped tool
    // name so a later `after_tool_call` without a toolCallId can still find the
    // pending record.
    if (toolCallId)
        return `id:${toolCallId}`;
    if (runId)
        return `run:${runId}:${toolName}`;
    return `tool:${toolName}`;
}
function errorMessage(err) {
    if (!err)
        return '';
    if (typeof err === 'string')
        return err;
    if (err instanceof Error)
        return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
        const m = err.message;
        return typeof m === 'string' ? m : '';
    }
    return '';
}
/** Debug breadcrumb (enable with config.x402Debug or DASHCLAW_X402_DEBUG=1). */
function x402log(config, msg) {
    if (config.x402Debug)
        console.log(`[dashclaw-governance][x402] ${msg}`);
}
/**
 * Pull a command string from a tool's params across the common shapes — bash/exec
 * `command`, Codex `shell_command`, and wrapper tools — accepting a string or a
 * string[] under command / cmd / script / args.
 */
function extractCommand(params) {
    if (!params)
        return '';
    const c = params.command ?? params.cmd ?? params.script ?? params.args;
    if (typeof c === 'string')
        return c;
    if (Array.isArray(c))
        return c.map((x) => String(x)).join(' ');
    return '';
}
function matchesX402(toolName, command, config) {
    if (config.x402ToolNames.has(toolName))
        return true;
    return command.length > 0 && config.x402CommandPatterns.some((re) => re.test(command));
}
function resolveX402Url(params, command) {
    const urlFromParams = String(params?.url ?? params?.endpoint ?? params?.uri ?? '');
    return urlFromParams || command.match(/https?:\/\/[^\s'"`]+/)?.[0] || '';
}
function originFromUrl(url) {
    let origin = '';
    try {
        origin = url ? new URL(url).host : '';
    }
    catch {
        origin = '';
    }
    return origin || 'unknown-x402-provider';
}
function x402EstimateFromCommand(command) {
    const maxAmt = command.match(/--max-amount[=\s]+([0-9]*\.?[0-9]+)/);
    return maxAmt ? Number(maxAmt[1]) : null;
}
function x402EstimateFromParams(params) {
    if (typeof params?.maxAmount === 'number')
        return params.maxAmount;
    if (typeof params?.amount === 'number')
        return params.amount;
    return null;
}
function normalizeX402Estimate(value, fallback) {
    return value !== null && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function detectX402(toolName, params, config) {
    if (!config.x402Enabled)
        return null;
    // Match against ANY tool's command (bash/exec, Codex `shell_command`, a wrapper
    // script) — the command pattern is the real filter — plus explicit tool names.
    const command = extractCommand(params);
    if (!matchesX402(toolName, command, config))
        return null;
    // Pre-payment estimate: the agent's --max-amount ceiling, else an explicit
    // amount param, else the configured fallback. Conservative on purpose so the
    // guard evaluates the worst-case spend before the payment runs.
    const url = resolveX402Url(params, command);
    const estimate = normalizeX402Estimate(x402EstimateFromCommand(command) ?? x402EstimateFromParams(params), config.x402EstimatedCostUsd);
    return { origin: originFromUrl(url), url, estimate };
}
/**
 * Parse an agentcash success envelope from a tool result. Returns null when the
 * result is not a settled paid call (a free `check`, a 402-not-paid, or no
 * parseable payload), so we only record purchases that actually moved money.
 */
function unwrapX402ReceiptCandidate(result) {
    // Unwrap common shell-result shapes ({ stdout }, { output }, { text }, …) to
    // the JSON string when the result isn't already the raw agentcash envelope.
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const o = result;
        if (!(o.data || o.metadata || o.costDollars)) {
            return o.stdout ?? o.output ?? o.text ?? o.result ?? o.content ?? result;
        }
    }
    return result;
}
function parseJsonishX402Receipt(candidate) {
    if (typeof candidate !== 'string')
        return candidate;
    return parseJsonObject(candidate) ?? parseJsonObject(extractJsonBlock(candidate));
}
function parseJsonObject(source) {
    if (!source)
        return null;
    try {
        return JSON.parse(source);
    }
    catch {
        return null;
    }
}
function extractJsonBlock(source) {
    return source.match(/\{[\s\S]*\}/)?.[0] ?? null;
}
function extractX402Spend(data, metadata) {
    let spend = Number(data?.costDollars?.total);
    if (Number.isFinite(spend))
        return spend;
    const pm = String(metadata?.price ?? '').match(/([0-9]*\.?[0-9]+)/);
    spend = pm ? Number(pm[1]) : NaN;
    return Number.isFinite(spend) ? spend : NaN;
}
function parseX402Receipt(result) {
    const candidate = unwrapX402ReceiptCandidate(result);
    const obj = parseJsonishX402Receipt(candidate);
    if (!obj || typeof obj !== 'object')
        return null;
    const env = obj;
    const data = (env.data ?? env);
    const metadata = (env.metadata ?? {});
    const spend = extractX402Spend(data, metadata);
    if (!Number.isFinite(spend) || spend <= 0)
        return null; // not a settled payment
    return {
        spend,
        txHash: typeof metadata?.payment?.transactionHash === 'string'
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
async function resolveProviderId(client, config, origin) {
    if (!shouldResolveProvider(config, origin))
        return undefined;
    const cached = providerIdByOrigin.get(origin);
    if (cached)
        return cached;
    try {
        const providers = providerListFromResponse(await client.listProviders());
        const id = providerIdFromList(providers, origin) ??
            (await createProviderId(client, origin));
        if (id) {
            providerIdByOrigin.set(origin, id);
            return id;
        }
    }
    catch (err) {
        console.warn(`[dashclaw-governance] x402 provider resolve failed for ${origin}: ${errorMessage(err) || 'unknown'}`);
    }
    return undefined;
}
function shouldResolveProvider(config, origin) {
    return (config.x402AutoRegisterProviders &&
        origin.length > 0 &&
        origin !== 'unknown-x402-provider');
}
function providerListFromResponse(response) {
    if (Array.isArray(response))
        return response;
    return (response?.providers ?? []);
}
function providerIdFromList(providers, origin) {
    const match = providers.find((p) => p?.name === origin ||
        (typeof p?.base_url === 'string' && p.base_url.includes(origin)));
    return match?.provider_id ?? match?.id;
}
async function createProviderId(client, origin) {
    const created = (await client.createProvider({
        name: origin,
        base_url: `https://${origin}`,
        category: 'research',
        default_currency: 'USDC',
        metadata: { source: 'openclaw-x402' },
    }));
    return created?.provider?.provider_id ?? created?.provider_id ?? created?.id;
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
function classifyBash(command, defaultRisk) {
    if (!command) {
        return { actionType: 'other', riskScore: defaultRisk, reversible: true, systemsTouched: [], declaredGoal: 'Bash: (empty)' };
    }
    const goal = `Bash: ${command.slice(0, 120)}`;
    const patternClassification = classifyBashPattern(command, goal);
    if (patternClassification)
        return patternClassification;
    const firstToken = command.trim().split(/[\s|;&]/)[0].replace(/^.*[/\\]/, '');
    return classifyCommandToken(firstToken, command, goal, defaultRisk);
}
function classifyBashPattern(command, goal) {
    if (DESTRUCTIVE_PATTERN.test(command)) {
        return { actionType: 'security', riskScore: 90, reversible: false, systemsTouched: ['filesystem'], declaredGoal: goal };
    }
    if (DEPLOY_PATTERN.test(command)) {
        return { actionType: 'deploy', riskScore: 80, reversible: false, systemsTouched: ['production'], declaredGoal: goal };
    }
    return null;
}
function classifyGitCommand(command, goal) {
    const sub = command.match(/git\s+(\S+)/)?.[1] ?? '';
    if (GIT_READONLY.has(sub)) {
        return { actionType: 'review', riskScore: 10, reversible: true, systemsTouched: [], declaredGoal: goal };
    }
    if (sub === 'push') {
        return { actionType: 'deploy', riskScore: 75, reversible: false, systemsTouched: [], declaredGoal: goal };
    }
    return { actionType: 'apply', riskScore: 30, reversible: true, systemsTouched: [], declaredGoal: goal };
}
function classifyCommandToken(firstToken, command, goal, defaultRisk) {
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
function classifyFile(toolName, params, defaultRisk) {
    const filePath = String(params?.file_path ?? params?.path ?? '');
    const goal = `${toolName}: ${filePath || '(unknown)'}`;
    if (SENSITIVE_PATH_PATTERN.test(filePath)) {
        return { actionType: 'security', riskScore: 85, reversible: true, systemsTouched: ['filesystem'], declaredGoal: goal };
    }
    return { actionType: 'apply', riskScore: defaultRisk, reversible: true, systemsTouched: ['filesystem'], declaredGoal: goal };
}
function classifyToolCall(toolName, params, config) {
    const defaultRisk = config.highRiskTools.has(toolName) ? 85 : config.riskScoreDefault;
    const classified = TOOL_CLASSIFIERS
        .map((classify) => classify(toolName, params, defaultRisk))
        .find((result) => result !== null);
    return classified ?? classifyDefaultTool(toolName, params, defaultRisk);
}
const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch']);
const REVIEW_TOOLS = new Set([
    'read',
    'web_search',
    'web_fetch',
    'memory_search',
    'memory_get',
    'image',
]);
const TOOL_CLASSIFIERS = [
    classifyShellTool,
    classifyWriteTool,
    classifyReviewTool,
    classifyMessageTool,
];
function classifyShellTool(toolName, params, defaultRisk) {
    return toolName === 'bash' || toolName === 'exec'
        ? classifyBash(params?.command, defaultRisk)
        : null;
}
function classifyWriteTool(toolName, params, defaultRisk) {
    return WRITE_TOOLS.has(toolName) ? classifyFile(toolName, params, defaultRisk) : null;
}
function classifyReviewTool(toolName, params, defaultRisk) {
    if (!REVIEW_TOOLS.has(toolName))
        return null;
    const target = String(params?.file_path ?? params?.path ?? params?.query ?? '');
    return {
        actionType: 'review',
        riskScore: Math.min(defaultRisk, 15),
        reversible: true,
        systemsTouched: [],
        declaredGoal: `${toolName}: ${target.slice(0, 120) || '(unknown)'}`,
    };
}
function classifyMessageTool(toolName, params, defaultRisk) {
    if (toolName !== 'sessions_send')
        return null;
    return {
        actionType: 'message',
        riskScore: defaultRisk,
        reversible: false,
        systemsTouched: [],
        declaredGoal: `message: ${summarizeParams(params).slice(0, 120)}`,
    };
}
function classifyDefaultTool(toolName, params, defaultRisk) {
    return {
        actionType: 'other',
        riskScore: defaultRisk,
        reversible: true,
        systemsTouched: [],
        declaredGoal: `${toolName}: ${summarizeParams(params).slice(0, 120)}`,
    };
}
function isApproved(action) {
    if (!action)
        return false;
    if (action.approved_by)
        return true;
    return action.status === 'running' || action.status === 'completed';
}
function registerGovernanceGate(api, config) {
    api.on('before_tool_call', async (event, _ctx) => handleBeforeToolCall(event, config));
}
function registerTokenAttribution(api, config) {
    api.on('llm_output', async (event, _ctx) => handleLlmOutput(event, config));
}
function registerRunCleanup(api, config) {
    api.on('agent_end', async (_event, ctx) => handleAgentEnd(ctx, config));
}
function registerOutcomeRecorder(api, config) {
    api.on('after_tool_call', async (event, _ctx) => handleAfterToolCall(event, config));
}
async function handleBeforeToolCall(event, config) {
    const { toolName, params, toolCallId, runId } = event;
    const key = callKey(toolName, toolCallId, runId);
    const classification = classifyToolCall(toolName, params, config);
    const client = getBeforeClient(config);
    if ('result' in client)
        return client.result;
    await maybeStartSession(event, client.value, config);
    const x402Result = await handleX402Before({
        toolName,
        params,
        key,
        client: client.value,
        config,
    });
    if (x402Result.handled)
        return x402Result.result;
    const decision = await guardClassifiedAction(client.value, classification, config);
    if ('result' in decision)
        return decision.result;
    const block = blockResultForDecision(decision.value, toolName);
    if (block)
        return block;
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
function getBeforeClient(config) {
    try {
        return { value: getClient(config) };
    }
    catch (err) {
        const msg = errorMessage(err) || 'unknown error';
        if (config.failClosed) {
            return { result: { block: true, blockReason: `DashClaw config error: ${msg}` } };
        }
        console.warn(`[dashclaw-governance] config error (fail-open): ${msg}`);
        return { result: undefined };
    }
}
async function maybeStartSession(event, client, config) {
    if (!event.runId)
        return;
    const runState = getTokenTurn(event.runId);
    if (runState.sessionStarted)
        return;
    runState.sessionStarted = true; // guard before await — once per run
    const workspace = typeof event.workspace === 'string' ? event.workspace : undefined;
    const branch = typeof event.branch === 'string' ? event.branch : null;
    try {
        const res = await client.createSession(config.agentId, workspace, branch);
        const sessionId = res.session?.id ??
            res.id;
        if (sessionId)
            runState.sessionId = sessionId;
    }
    catch (err) {
        console.warn(`[dashclaw-governance] createSession failed: ${errorMessage(err) || 'unknown'}`);
    }
}
async function handleX402Before(ctx) {
    const x402 = detectX402(ctx.toolName, ctx.params, ctx.config);
    if (!x402)
        return { handled: false };
    const declaredGoal = `x402 purchase: ${x402.origin}`;
    x402log(ctx.config, `gate: tool=${ctx.toolName} origin=${x402.origin} estimate=$${x402.estimate}`);
    const decision = await guardX402Purchase(ctx.client, ctx.config, x402, declaredGoal);
    if (!decision.ok) {
        if (decision.failOpen)
            rememberX402Pending(ctx.key, x402, declaredGoal);
        return { handled: true, result: decision.result };
    }
    const block = blockResultForX402Decision(decision.value, x402);
    if (block)
        return { handled: true, result: block };
    warnOnX402Decision(ctx.config, decision.value, x402.origin);
    rememberX402Pending(ctx.key, x402, declaredGoal);
    return { handled: true };
}
async function guardX402Purchase(client, config, x402, declaredGoal) {
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
    }
    catch (err) {
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
function blockResultForX402Decision(decision, x402) {
    if (decision.decision !== 'block' && decision.decision !== 'require_approval') {
        return undefined;
    }
    const why = decision.decision === 'require_approval'
        ? 'requires approval — adjust the x402_spend_limit policy threshold to allow it'
        : decision.reason || 'blocked by x402 spend policy';
    return {
        block: true,
        blockReason: `x402 payment to ${x402.origin} (~$${x402.estimate}) ${why}`,
    };
}
function warnOnX402Decision(config, decision, origin) {
    if (decision.decision !== 'warn')
        return;
    console.warn(`[dashclaw-governance] WARN x402 ${origin}: ${decision.reason || 'flagged by policy'}`);
}
function rememberX402Pending(key, x402, declaredGoal) {
    x402PendingByKey.set(key, {
        origin: x402.origin,
        declaredGoal,
        estimate: x402.estimate,
    });
}
async function guardClassifiedAction(client, classification, config) {
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
    }
    catch (err) {
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
function blockResultForDecision(decision, toolName) {
    if (decision.decision === 'block') {
        return {
            block: true,
            blockReason: decision.reason || 'Blocked by DashClaw policy',
        };
    }
    if (decision.decision === 'warn') {
        console.warn(`[dashclaw-governance] WARN ${toolName}: ${decision.reason || 'flagged by policy'}`);
    }
    return undefined;
}
async function openActionRecord(ctx) {
    const created = await createGovernanceAction(ctx);
    if ('result' in created)
        return created.result;
    const approval = await waitForRequiredApproval(ctx.client, ctx.decision, created.value);
    if (approval)
        return approval;
    rememberPendingAction(ctx.key, created.value.actionId, ctx.runId);
    return;
}
async function createGovernanceAction(ctx) {
    const { actionType, declaredGoal, riskScore, reversible, systemsTouched } = ctx.classification;
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
    }
    catch (err) {
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
async function waitForRequiredApproval(client, decision, created) {
    const needsApproval = decision.decision === 'require_approval' ||
        created.status === 'pending_approval';
    if (!needsApproval || !created.actionId)
        return undefined;
    try {
        const { action } = await client.waitForApproval(created.actionId);
        if (isApproved(action))
            return undefined;
        return {
            block: true,
            blockReason: action?.error_message || 'Action denied by operator',
        };
    }
    catch (err) {
        return {
            block: true,
            blockReason: `Approval denied or wait failed: ${errorMessage(err) || 'denied'}`,
        };
    }
}
function rememberPendingAction(key, actionId, runId) {
    if (!actionId)
        return;
    pendingActions.set(key, actionId);
    if (runId)
        getTokenTurn(runId).turnActionIds.push(actionId);
}
async function handleLlmOutput(event, config) {
    const { runId, model, usage } = event;
    if (!runId)
        return;
    const client = getClientForLlmOutput(config);
    if (!client)
        return;
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
    if (pendingUsage)
        state.pendingUsage = pendingUsage;
}
function getClientForLlmOutput(config) {
    try {
        return getClient(config);
    }
    catch (err) {
        console.warn(`[dashclaw-governance] llm_output dropped — client unavailable: ${errorMessage(err) || 'unknown'}`);
        return undefined;
    }
}
function tokenUsageFromEvent(ctx) {
    const { usage, model, config, state, runId } = ctx;
    if (!usage)
        return undefined;
    const cacheReadEffective = Math.round((usage.cacheRead ?? 0) * 0.1);
    const tokens_in = (usage.input ?? 0) + (usage.cacheWrite ?? 0) + cacheReadEffective;
    const tokens_out = usage.output ?? 0;
    if (tokens_in <= 0 && tokens_out <= 0)
        return undefined;
    const resolvedModel = model && model.length > 0 ? model : config.defaultModel;
    warnOnceForMissingModel(resolvedModel, state, runId);
    return { tokens_in, tokens_out, model: resolvedModel };
}
function warnOnceForMissingModel(model, state, runId) {
    if (model || state.warnedMissingModel)
        return;
    console.warn(`[dashclaw-governance] llm_output has no model for run ${runId} — ` +
        `tokens will land on action records but cost_estimate will stay $0. ` +
        `Set config.defaultModel or DASHCLAW_DEFAULT_MODEL to price these turns.`);
    state.warnedMissingModel = true;
}
async function handleAgentEnd(ctx, config) {
    const runId = ctx?.runId;
    if (!runId)
        return;
    const state = tokenTurnByRun.get(runId);
    if (!state)
        return;
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
        console.warn(`[dashclaw-governance] agent_end for run ${runId}: ${state.turnActionIds.length} ` +
            `action(s) end the run unattributed — their codex turn(s) reported no token ` +
            `usage and no later usage-bearing turn followed. tokens_in/out stay unrecorded.`);
    }
    if (client && state.sessionId) {
        await closeSession(client, state.sessionId);
    }
    tokenTurnByRun.delete(runId);
}
function getClientForAgentEnd(config, state) {
    try {
        return getClient(config);
    }
    catch (err) {
        const lost = state.turnActionIds.length;
        if ((state.pendingUsage && lost > 0) || state.sessionId) {
            console.warn(`[dashclaw-governance] agent_end cleanup dropped (client unavailable): ${lost} token action(s), session ${state.sessionId ?? 'none'}: ${errorMessage(err) || 'unknown'}`);
        }
        return null;
    }
}
async function closeSession(client, sessionId) {
    try {
        await client.updateSession(sessionId, { status: 'completed' });
    }
    catch (err) {
        console.warn(`[dashclaw-governance] updateSession(end) failed for ${sessionId}: ${errorMessage(err) || 'unknown'}`);
    }
}
async function handleAfterToolCall(event, config) {
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
async function handleX402After(event, pending, config) {
    const client = getClientForOutcome(config);
    if (!client)
        return;
    logX402ResultPreview(config, pending, event);
    if (event.error) {
        console.warn(`[dashclaw-governance] x402 call to ${pending.origin} failed: ${event.error}`);
        return;
    }
    const receipt = parseX402Receipt(event.result);
    logX402Receipt(config, receipt);
    if (!receipt)
        return;
    await recordX402Purchase(client, config, pending, receipt);
}
function getClientForOutcome(config) {
    try {
        return getClient(config);
    }
    catch {
        return undefined;
    }
}
function logX402ResultPreview(config, pending, event) {
    if (!config.x402Debug)
        return;
    x402log(config, `record: origin=${pending.origin} hasError=${!!event.error} resultType=${typeof event.result} resultPresent=${event.result !== undefined} preview=${resultPreview(event.result)}`);
}
function resultPreview(result) {
    try {
        return typeof result === 'string'
            ? result.slice(0, 300)
            : JSON.stringify(result)?.slice(0, 300) ?? '';
    }
    catch {
        return '[unserializable]';
    }
}
function logX402Receipt(config, receipt) {
    x402log(config, receipt
        ? `parsed receipt: $${receipt.spend} tx=${receipt.txHash ?? 'none'}`
        : `parse FAILED — no settled spend found in tool result (set x402Debug to inspect the shape)`);
}
async function recordX402Purchase(client, config, pending, receipt) {
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
    }
    catch (err) {
        console.warn(`[dashclaw-governance] recordPurchase failed for ${pending.origin}: ${errorMessage(err) || 'unknown'}`);
    }
}
function purchaseActionId(res) {
    return res?.action?.action_id ?? res?.action_id ?? res?.action?.id;
}
async function recordX402Receipt(client, pending, receipt, actionId) {
    if (!actionId || (!receipt.txHash && !receipt.requestId))
        return;
    await client
        .recordPurchaseResult(String(actionId), {
        summary: `x402 settled: $${receipt.spend} USDC at ${pending.origin}`,
        data: {
            origin: pending.origin,
            transactionHash: receipt.txHash,
            requestId: receipt.requestId,
        },
    })
        .catch((err) => {
        console.warn(`[dashclaw-governance] recordPurchaseResult failed: ${errorMessage(err) || 'unknown'}`);
    });
}
async function handleGenericAfterToolCall(key, error, config) {
    const actionId = pendingActions.get(key);
    if (!actionId)
        return;
    pendingActions.delete(key);
    const client = getClientForOutcome(config);
    if (!client)
        return;
    try {
        await client.updateOutcome(actionId, {
            status: error ? 'failed' : 'completed',
            ...(error ? { error_message: error } : {}),
        });
    }
    catch (err) {
        console.warn(`[dashclaw-governance] updateOutcome failed: ${errorMessage(err) || 'unknown'}`);
    }
}
// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
const pluginEntry = definePluginEntry({
    id: 'dashclaw-governance',
    name: 'DashClaw Governance',
    description: 'Policy enforcement, human-in-the-loop approval, and decision recording for every OpenClaw tool call. Powered by DashClaw.',
    register(api) {
        const config = resolveConfig(api.pluginConfig);
        registerGovernanceGate(api, config);
        registerTokenAttribution(api, config);
        registerRunCleanup(api, config);
        registerOutcomeRecorder(api, config);
    },
});
export default pluginEntry;
