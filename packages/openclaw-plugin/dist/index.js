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
import { definePluginEntry, } from 'openclaw/plugin-sdk/plugin-entry';
import { DashClaw, } from 'dashclaw';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { maybeAutoPair } from './auto-pairing.js';
import { runLivenessProbe, shouldProbeNow, PROBE_AGENT_ID } from './liveness-probe.js';
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
function resolveConfig(raw) {
    const cfg = raw ?? {};
    const env = typeof process !== 'undefined' && process?.env ? process.env : {};
    const failClosed = cfg.failClosed !== false; // default true
    const autoPairing = cfg.autoPairing !== false; // default true
    const riskScoreDefault = numberFromConfig(cfg.riskScoreDefault, 50);
    const highRiskTools = stringSetFromConfig(cfg.highRiskTools);
    const approvalWaitMs = numberFromConfig(cfg.approvalWaitMs, 60_000, false) || 60_000;
    const dashclawUrl = firstString(cfg.dashclawUrl, cfg.baseUrl, env.DASHCLAW_BASE_URL, env.DASHCLAW_URL);
    const dashclawApiKey = firstString(cfg.dashclawApiKey, cfg.apiKey, env.DASHCLAW_API_KEY);
    const agentId = firstString(cfg.agentId, env.DASHCLAW_AGENT_ID) || 'openclaw';
    const defaultModel = firstString(cfg.defaultModel, env.DASHCLAW_DEFAULT_MODEL);
    return {
        dashclawUrl,
        dashclawApiKey,
        agentId,
        defaultModel,
        failClosed,
        autoPairing,
        riskScoreDefault,
        highRiskTools,
        approvalWaitMs,
    };
}
// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let cachedClient = null;
let cachedClientKey = '';
/** Maps synthetic call key → DashClaw action_id so `after_tool_call` can close it. */
const pendingActions = new Map();
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
function findScriptPathToken(command) {
    const segments = command.split(/&&|\|\||;|\|/);
    for (const segment of segments) {
        const tokens = segment.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0 || tokens[0] === 'cd')
            continue;
        while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]))
            tokens.shift();
        if (tokens[0] === 'timeout')
            tokens.splice(0, 2);
        if (tokens[0] === 'sudo')
            tokens.shift();
        if (tokens.length === 0)
            continue;
        const cmdWord = tokens[0].replace(/^.*[/\\]/, '');
        if (!SCRIPT_RUNNERS.has(cmdWord))
            continue;
        const pathToken = tokens.slice(1).find((t) => !t.startsWith('-'));
        if (pathToken)
            return pathToken;
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
function detectLocalScript(command, workspace) {
    try {
        const rawPath = findScriptPathToken(command);
        if (!rawPath)
            return undefined;
        const resolved = resolvePath(workspace || process.cwd(), rawPath);
        if (SENSITIVE_PATH_PATTERN.test(rawPath)) {
            return existsSync(resolved) ? { path: rawPath } : undefined;
        }
        if (!existsSync(resolved))
            return undefined;
        const stat = statSync(resolved);
        if (!stat.isFile() || stat.size > SCRIPT_CONTENT_MAX_BYTES)
            return undefined;
        const content = readFileSync(resolved, 'utf8');
        return { path: rawPath, content_excerpt: content.slice(0, SCRIPT_EXCERPT_MAX_CHARS) };
    }
    catch {
        return undefined;
    }
}
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
function classifyToolCall(toolName, params, config, workspace) {
    const defaultRisk = config.highRiskTools.has(toolName) ? 85 : config.riskScoreDefault;
    const classified = TOOL_CLASSIFIERS
        .map((classify) => classify(toolName, params, defaultRisk))
        .find((result) => result !== null);
    const base = classified ?? classifyDefaultTool(toolName, params, defaultRisk);
    const act = buildGuardAct(toolName, params, workspace);
    return act ? { ...base, act } : base;
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
function buildGuardAct(toolName, params, workspace) {
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
function registerLivenessProbe(api, config) {
    api.on('session_start', async (_event, _ctx) => {
        if (!config.dashclawUrl || !config.dashclawApiKey)
            return;
        if (!shouldProbeNow())
            return;
        const probeConfig = { ...config, agentId: PROBE_AGENT_ID };
        void runLivenessProbe({
            dashclawUrl: config.dashclawUrl,
            dashclawApiKey: config.dashclawApiKey,
            driveSeam: (event) => handleBeforeToolCall(event, probeConfig),
        }).catch((err) => {
            console.warn(`[dashclaw-governance] liveness probe failed: ${errorMessage(err) || 'unknown'}`);
        });
    });
}
async function handleBeforeToolCall(event, config) {
    const { toolName, params, toolCallId, runId } = event;
    const key = callKey(toolName, toolCallId, runId);
    const workspace = typeof event.workspace === 'string' ? event.workspace : undefined;
    const classification = classifyToolCall(toolName, params, config, workspace);
    const client = getBeforeClient(config);
    if ('result' in client)
        return client.result;
    // Fire-and-forget: answers a pending operator pairing request once per
    // gateway process. Never blocks or fails the tool call.
    void maybeAutoPair(client.value, config);
    await maybeStartSession(event, client.value, config);
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
async function guardClassifiedAction(client, classification, config) {
    try {
        return {
            value: await client.guard({
                action_type: classification.actionType,
                risk_score: classification.riskScore,
                declared_goal: classification.declaredGoal,
                reversible: classification.reversible,
                systems_touched: classification.systemsTouched,
                ...(classification.act ? { act: classification.act } : {}),
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
    const approval = await waitForRequiredApproval(ctx, created.value);
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
            ...(ctx.classification.act ? { act: ctx.classification.act } : {}),
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
async function waitForRequiredApproval(ctx, created) {
    const needsApproval = ctx.decision.decision === 'require_approval' ||
        created.status === 'pending_approval';
    if (!needsApproval || !created.actionId)
        return undefined;
    const timeout = ctx.config.approvalWaitMs;
    try {
        const { action } = await ctx.client.waitForApproval(created.actionId, {
            timeout,
            interval: approvalPollInterval(timeout),
        });
        if (isApproved(action))
            return undefined;
        return {
            block: true,
            blockReason: action?.error_message || 'Action denied by operator',
        };
    }
    catch (err) {
        if (isApprovalTimeout(err)) {
            // The server keeps the approval open past this bounded wait
            // (approval_wait_seconds = 300): the operator can still approve, and a
            // retry of the same call passes via the guard's approval grant and
            // createAction's idempotent-retry dedupe instead of opening a duplicate.
            return {
                block: true,
                blockReason: `Approval not received within ${Math.round(timeout / 1000)}s — ` +
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
function approvalPollInterval(timeoutMs) {
    return Math.min(5000, Math.max(50, Math.floor(timeoutMs / 4)));
}
/** Matches the SDK's approval-timeout error (a plain Error, distinct from denial). */
function isApprovalTimeout(err) {
    return errorMessage(err).startsWith('Timed out waiting for approval');
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
    await handleGenericAfterToolCall(key, event.error, config);
}
function getClientForOutcome(config) {
    try {
        return getClient(config);
    }
    catch {
        return undefined;
    }
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
        registerLivenessProbe(api, config);
    },
});
export default pluginEntry;
