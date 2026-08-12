# DashClaw Hooks for Claude Code

Two Python hook scripts that connect Claude Code to your DashClaw governance policies. Tool calls are classified into semantic categories (execution, file_io, orchestration, interactive, mcp) and evaluated against your DashClaw guard before execution. MCP tool calls (`mcp__*`) are included, so connected-MCP actions like Gmail/Stripe/Calendar sends are governed too. After execution, the outcome is recorded as evidence. No SDK instrumentation or code changes required in your project. Just drop the hooks in and set your environment variables.

## v2 Intelligence Module

Hooks now use the `dashclaw_agent_intel` Python module for semantic classification of tool calls. This module is vendored alongside the hooks and requires only the Python standard library (zero external dependencies).

The intelligence module comprises five submodules:

- **bash_classifier**: Parses shell commands and classifies intent (e.g., destructive, network, filesystem, git) with structured validation results.
- **file_scanner**: Scans file paths and content for security-sensitive patterns (secrets, credentials, env files, auth configs).
- **tool_recognizer**: Maps Claude Code tool names to semantic categories and determines governance scope.
- **session_tracker**: Tracks session state across tool calls (cumulative risk, failure counts, branch staleness).
- **mcp_monitor**: Monitors MCP server health, latency, and degradation signals.

## Tool Governance Scope

v2 hooks classify every Claude Code tool into a semantic category and govern based on that category.

**Default governed categories:**

| Category | Example tools |
|---|---|
| `execution` | Bash, BashBackground |
| `orchestration` | Agent, Skill, TodoWrite |
| `file_io` | Edit, Write, MultiEdit, NotebookEdit |
| `interactive` | AskUserQuestion, SendUserMessage, SendMessage |
| `mcp` | Any `mcp__*` tool call |

**Default ungoverned categories:**

| Category | Example tools |
|---|---|
| `search` | Read, Glob, Grep, WebFetch, WebSearch |
| `system` | EnterPlanMode, ExitPlanMode, Config, Sleep |

Configure which categories are governed via the `DASHCLAW_GOVERNED_CATEGORIES` environment variable (comma-separated list). Unknown tools that do not match any category fail-safe to governed.

> **Narrowing this is visible on the dashboard.** A category you exclude never reaches the server at all — the hook exits before the guard call — so its tool calls are simply absent from `/decisions`, which looks identical to "that agent did nothing". Since v5.19 the hook declares the gap on the calls it *does* still make, and any category dropped below the default raises a red **Governance scope narrowed** signal naming what is unwatched. That is a visibility guarantee, not an enforcement one: the variable lives on the agent's own machine, so a compromised client can still lie about its scope. It catches the case that actually happens — an honest agent misconfigured, or a typo that silently dropped a real category.

> **Claude Code routing note.** Which tool calls reach the hook is decided by the `PreToolUse` / `PostToolUse` **matcher** in `.claude/settings.json`, which ships as `Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|Skill|mcp__.*`. So **sub-agent spawns are governed** (the `Agent` tool — named `Task` before Claude Code 2.1.63) and so are **Workflow fan-outs** (v4.3 — the spawn is guard-evaluated and recorded as `orchestration` before the run starts), alongside Bash and file edits. The `mcp__.*` segment puts **MCP tool calls inside the matcher too**, so connected-MCP actions (Gmail/Stripe/Calendar sends, etc.) are intercepted by the hook path before execution. `Skill` invocations fire the advisory skill auto-scan in PreToolUse (no PostToolUse entry — intentional). `PreToolUse` also fires *inside* sub-agents, so a sub-agent's own Bash/Edit/Write calls are governed too and recorded with sub-agent provenance (see "Sub-agent governance & tracking" below). Still outside the default matcher: `interactive` tools — govern those via the SDK/MCP server or by adding the names to the matcher. (Codex and Hermes installers wire their own routing.)

### Sub-agent governance & tracking

DashClaw governs and records delegated (sub-agent) work end to end on Claude Code:

- **The spawn.** Invoking the `Agent` tool (or legacy `Task`) is a governed `PreToolUse` decision: it hits `/api/guard` and is recorded as an `orchestration` action, so you can see, gate, or require approval for *which* sub-agents get spawned.
- **The sub-agent's own tool calls.** Claude Code fires `PreToolUse` inside sub-agents (the hook stdin carries `agent_id` and `agent_type`), so a sub-agent's Bash/Edit/Write/MultiEdit calls are evaluated against the same policies as the parent.
- **Attribution — distinct fleet identities (default since v2.2).** By default (`DASHCLAW_SUBAGENT_IDENTITY=distinct`) each sub-agent *type* gets its own composed `agent_id` (`<parent>:<type>`, e.g. `claude-code:explore`) and appears as a distinct agent in `/agents`, grouped under its parent. Governance stays correct: pairing/identity lookups, agent-targeted policies, and agent-scoped x402 budgets all fall back to (or roll up to) the base parent, so a sub-agent inherits the parent's permissions and rules — and cannot escape the parent's budget — unless you pair the sub-agent id explicitly. Provenance rides along either way: `agent_name` = `<parent>/<agent_type>`, `swarm_id` = the session id (so the spawn and the delegated work group together in the decisions ledger and the Swarm view), and `intel.subagent = { agent_id, agent_type }`.
- **Legacy rollback.** Set `DASHCLAW_SUBAGENT_IDENTITY=provenance` to restore the pre-v2.2 behavior: sub-agent actions keep the parent's governed `agent_id` and sub-agent identity rides only the provenance fields. Design + rollout: `docs/rfcs/2026-06-01-subagent-fleet-identities.md`.

Plugin-defined sub-agents can't carry their own hooks (a Claude Code security restriction), but the session-level matcher above still covers them.

## Enriched Intel Context

The pretool hook builds an intel dict for every governed tool call and includes it in the guard request. This gives the guard server rich context for policy decisions.

The intel dict contains:

- **bash**: Intent classification, parsed command structure, and validation results (for Bash tools only).
- **file**: Security scan results for file paths and content patterns (for file_io tools).
- **tool**: Semantic category, governance permission, and tool metadata.
- **mcp**: MCP server health, latency, and degradation signals (for mcp tools).
- **session**: Cumulative session state including risk score, failure count, and branch info.

Example guard request with intel:

```json
{
  "agent_id": "claude-code",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/build"
  },
  "tool_use_id": "toolu_abc123",
  "intel": {
    "bash": {
      "intent": "destructive",
      "parsed": {
        "executable": "rm",
        "args": ["-rf", "/tmp/build"]
      },
      "validations": ["recursive_delete", "force_flag"]
    },
    "tool": {
      "category": "execution",
      "governed": true
    },
    "session": {
      "cumulative_risk": 42,
      "failure_count": 0,
      "branch": "feat/cleanup"
    }
  }
}
```

## Installation

### Recommended: one-command install

From the DashClaw repo root:

```bash
node scripts/install-hooks.mjs
# or, in any project that has DashClaw cloned alongside it:
node /path/to/DashClaw/scripts/install-hooks.mjs --target=.
```

This copies the three hook scripts (`dashclaw_pretool.py`, `dashclaw_posttool.py`, `dashclaw_stop.py`) and the vendored `dashclaw_agent_intel/` Python module into `.claude/hooks/`, then merges the matching `PreToolUse` / `PostToolUse` / `Stop` entries into `.claude/settings.json`. Re-run after `git pull` to refresh.

### Global capture across every project (capture-only)

To capture Claude Code sessions from *every* project on your machine — not only those with DashClaw installed locally — register a capture-only Stop hook once:

```bash
node scripts/install-hooks.mjs --global          # add --dry-run to preview, --uninstall to remove
```

This adds a single `Stop` entry to `~/.claude/settings.json` pointing at this repo's `hooks/dashclaw_stop.py` by absolute path. It is **capture-only**: no `PreToolUse`/`PostToolUse` governance runs for other projects (the Stop hook's token-attribution step no-ops when there are no governed actions to attribute against). The hook resolves `DASHCLAW_BASE_URL` and `DASHCLAW_API_KEY` from *this repo's* `.env.local`, so **no secret is written into global config** and `git pull` upgrades the hook automatically. Any third-party Stop hooks you already have are preserved.

### Global governance across every project (out-of-the-box, incl. Docker)

Project-level `.claude/settings.json` hooks only load **after** you accept Claude Code's "Do you trust the files in this folder?" prompt — so in a fresh clone, a Docker container, or a headless run they silently never fire (a user-level Stop hook *will* still fire, which is the classic "Stop ran but Pre/PostToolUse didn't" symptom). To govern **every** project with no per-folder trust step, install the full set at the user level:

```bash
node scripts/install-hooks.mjs --global --governance   # add --dry-run to preview, --uninstall to remove
```

This merges `PreToolUse` + `PostToolUse` + `Stop` into `~/.claude/settings.json`, pointing at this repo's `hooks/*.py` by absolute path. User-level hooks are **not** gated by folder trust, so they fire out of the box — including in Docker/headless. **No secret is written**: the hooks read `DASHCLAW_BASE_URL` (or `DASHCLAW_URL`) + `DASHCLAW_API_KEY` from the environment (or this repo's `.env.local`) at runtime, and `git pull` upgrades them automatically.

### Manual install

```bash
mkdir -p .claude/hooks
cp hooks/dashclaw_pretool.py .claude/hooks/
cp hooks/dashclaw_posttool.py .claude/hooks/
cp hooks/dashclaw_stop.py    .claude/hooks/
cp -r hooks/dashclaw_agent_intel .claude/hooks/
```

The intel module is required — `dashclaw_pretool.py` imports `dashclaw_agent_intel` for semantic tool classification, so omitting it causes an `ImportError` on the first governed tool call.

Then merge the hooks block from `hooks/settings.json` into your `.claude/settings.json`. If you do not have a settings file yet, copy it directly:

```bash
cp hooks/settings.json .claude/settings.json
```

> The committed `settings.json` template invokes the hooks through the `run_hook.cjs` node shim, which probes `python3` then `python` automatically — no manual interpreter edit is needed on any platform.

### Environment variables

```bash
export DASHCLAW_BASE_URL=https://your-dashclaw-instance.vercel.app
export DASHCLAW_API_KEY=your_api_key_here
export DASHCLAW_AGENT_ID=claude-code              # optional, defaults to "claude-code"; a --agent-id flag on the hook command (installer-written) beats this
```

### Smoke test

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_use_id":"test_001","session_id":"smoke"}' \
  | python .claude/hooks/dashclaw_pretool.py
```

If DashClaw is reachable, the hook evaluates the command against your guard policies. If not, it exits silently and Claude Code proceeds normally.

> Use `python3` here if your system has no `python` on PATH. (Installed hooks don't have this concern — they run through the `run_hook.cjs` shim, which resolves the interpreter automatically.)

### Token capture (Stop hook)

`dashclaw_stop.py` runs at the end of every assistant turn. It reads the session transcript, sums LLM token usage across that turn's assistant messages (with cache-read tokens weighted at 0.1× to match real Anthropic billing), and PATCHes `tokens_in`, `tokens_out`, and `model` onto each action_id the pretool opened during the turn. Cost is derived server-side from the configured pricing table.

The Stop hook also auto-closes any action still in `status='running'` at turn end (PostToolUse safety net) — terminal statuses written by PostToolUse are preserved, never overwritten.

### Enforcement-liveness probe (SessionStart hook)

`enforcement_liveness_probe.py` is wired as the SessionStart hook (`--source session-start`). It proves the enforcement seam still holds end to end: it drives a synthetic action that policy must hold through the SAME PreToolUse hook seam real actions use, and verdicts by observing whether the action executed — never by reading the decision ledger (the ledger is exactly what kept lying in v4.72.1). Its verdict is filed to `POST /api/enforcement-liveness`.

To keep session start instant, the SessionStart entry point throttles itself to at most once per 12h (a marker file under `~/.dashclaw/liveness-probe/`) and runs the actual probe in a DETACHED child — session start is never delayed or broken by it. It reads the same configuration as the other hooks (`DASHCLAW_BASE_URL`/`DASHCLAW_URL`, `DASHCLAW_API_KEY`). Set `DASHCLAW_LIVENESS_PROBE_DISABLED=1` to turn it off without uninstalling. The installer wires it automatically (per-project and `--global --governance`). Run it manually any time with `python hooks/enforcement_liveness_probe.py` (or `npm run liveness:probe`).

## Common setup failures

- **Plugin installed but nothing is governed.** `claude plugin install dashclaw` ships MCP tools + skills **only** — not these hooks (they're Python files needing Python on PATH, so they're intentionally not bundled). Install the governance hooks separately: `node scripts/install-hooks.mjs` (per-project) or `--global --governance` (user-level, fires everywhere). "Install the plugin" ≠ "install governance."
- **Hooks don't fire in a fresh clone / Docker / headless run.** Claude Code's **Folder Trust** gate prevents a project `.claude/settings.json` (and its hooks) from loading until you accept the workspace-trust prompt for that folder. A user-level `~/.claude` hook (e.g. the global Stop hook) still fires — hence "Stop ran but Pre/PostToolUse didn't." Fix: accept the trust prompt and restart the session, **or** install at the user level with `node scripts/install-hooks.mjs --global --governance` (no trust gate).
- **Hook does nothing / no `[DashClaw]` output.** The hooks read `DASHCLAW_BASE_URL` (they now also accept `DASHCLAW_URL` as a fallback) plus `DASHCLAW_API_KEY`. If **exactly one** is set, PreToolUse prints a one-line `half-configured` warning naming the missing var; if **both** are unset it stays silent by design (non-DashClaw users see nothing).
- **Every request answers 503 `SCHEMA_NOT_INITIALIZED`.** The instance DB is on an old schema. Run `npm run db:migrate` on the instance to apply the pending schema. (Instances older than v4.61.0 answer this as a misleading 401 "Invalid or missing API key".)
- **Hook warns `[Demo mode]`.** `DASHCLAW_BASE_URL` points at the demo deployment. Repoint it at your own instance.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DASHCLAW_BASE_URL` | Yes | -- | URL of your DashClaw instance |
| `DASHCLAW_API_KEY` | Yes | -- | Operator API key from `/settings` |
| `DASHCLAW_AGENT_ID` | No | `claude-code` | Identity for this agent in DashClaw. A `--agent-id <id>` flag on the hook command line (written by the harness installers since v2.2) takes precedence, so each harness on a machine reports its own identity even when this var is exported machine-wide. |
| `DASHCLAW_SUBAGENT_IDENTITY` | No | `distinct` | `distinct` (default since v2.2) gives each sub-agent type its own composed agent_id (`<parent>:<type>`) — a distinct fleet agent; the server falls back to the parent's pairing/targeted policies and rolls agent-scoped x402 budgets up to the family base. `provenance` restores the legacy behavior (agent_id stays the parent; sub-agent identity rides the provenance fields only). |
| `DASHCLAW_HOOK_MODE` | No | `enforce` | `enforce` blocks on policy violations. `observe` logs everything but never blocks. The hook reports this mode on every guard call and action record (`enforcement_mode`), so observe-mode agents surface as a **red** signal, a red banner on `/approvals` and `/decisions`, and a doctor warning with a fix. When an observe-mode block or approval gate executes anyway, PostToolUse stamps `executed_despite` on the row — the ledger renders it "Executed despite block," never identically to an enforced block. CAUTION: the hook loads `.env` files by walking up from the **hook file's** directory, so one `observe` override applies to every session using that hook install. |
| `DASHCLAW_PERMISSION_MODE` | No | `danger` | Permission mode passed to the guard for policy evaluation |
| `DASHCLAW_GOVERNED_CATEGORIES` | No | `execution,orchestration,file_io,interactive,mcp` | Comma-separated list of tool categories that are governed |
| `DASHCLAW_GUARD_TIMEOUT` | No | `5` | Timeout in seconds for the guard request. By default the guard makes **one attempt** (no retries); set `DASHCLAW_GUARD_RETRIES=2` to restore the old three-attempt behavior. |
| `DASHCLAW_GUARD_RETRIES` | No | `0` | Extra guard attempts after the first (0 = single attempt). Action create/update calls retry independently (2 retries = 3 attempts). |
| `DASHCLAW_GUARD_CONNECT_TIMEOUT` | No | `2` | Timeout in seconds for the conditional TCP preflight used when a prior turn found the guard unreachable. |
| `DASHCLAW_SKILL_SCAN` | No | `1` | Set `0` to disable the advisory skill auto-scan fired on `Skill` tool invocations. |
| `DASHCLAW_HOOK_DEBUG` | No | unset | Set `1` to capture PostToolUse invocation breadcrumbs (useful when diagnosing missed PostToolUse events). |
| `DASHCLAW_BEHAVIOR_UPLOAD` | No | unset (off) | Opt-in anonymized behavior-sample upload (`1`/`true`/`yes`); requires the server-side org setting too. |
| `DASHCLAW_BEHAVIOR_INSIGHTS` | No | on | Set `0` to opt out of the throttled behavior-insights push from the Stop hook. |
| `DASHCLAW_TRACK_TEXT_TURNS` | No | unset (off) | Set `1` to record synthetic `conversation` actions for text-only turns so their tokens land in analytics. |
| `DASHCLAW_GUARD_UNAVAILABLE_POLICY` | No | `block` | Behavior when the guard is unreachable after retries. `block` fails closed (exits 2). `warn` prints a stderr warning and proceeds. `allow` prints a stderr notice and proceeds. All three paths still write the orphan log for backfill. |
| `DASHCLAW_APPROVAL_TIMEOUT` | No | `30` | Timeout in seconds when polling for operator approval |
| `DASHCLAW_DISABLE_DOTENV` | No | unset | Test isolation escape hatch. When set to any truthy value, the hooks skip the `.env` walk so the subprocess only sees env vars the caller passes in. The hook test suite sets this. **Never set this in production**: it disables the standard `.env.local` and `.env` loading the install flow relies on. |
| `DASHCLAW_CONTAINMENT` | No | `1` | Full kill switch for Containment Verdicts. `1` (default) redirects an eligible `allow_contained` tool call into a staged worktree. `0` disables containment locally even if the server still emits `allow_contained` (version skew, mixed hook versions) — the hook treats it as an interrupt instead of ever creating a worktree. |
| `DASHCLAW_CONTAINMENT_REWRITE` | No | `1` | `1` (default) rewrites an eligible `Edit`/`Write`/`MultiEdit` call in place to target the containment worktree, transparent to the agent. `0` falls back to an instructive deny (exit 2) that tells the agent to re-run the call against the worktree path. **Bash is never rewritten either way** — the Bash tool input schema has no `cwd` field, so an eligible Bash call always gets the instructive deny (Locked Decision 6, RFC containment-verdicts). |
| `DASHCLAW_CONTAINMENT_DIFF_CAP_BYTES` | No | `1500000` | Byte cap on the staged-diff text uploaded as an artifact after a contained mutation (keeps a single artifact under the `/api/artifacts` request-body cap). |

## Behavior

The PreToolUse hook calls `POST /api/guard` before each governed tool executes. The guard returns one of five decisions:

- **allow**: The tool proceeds. An action record is created for the evidence trail.
- **warn**: The tool proceeds. A warning is printed to the Claude Code terminal. An action record is created.
- **block**: In enforce mode, the tool is blocked and Claude Code sees the policy reason. In observe mode, the warning is logged but the tool proceeds — and because the tool ran despite a gating verdict, PostToolUse stamps `executed_despite: block` on the blocked row (F0): the ledger shows the block did not stop execution.
- **allow_contained** (Containment Verdicts): only ever returned to a caller that advertised `client_capabilities: ['allow_contained']` in the guard call — this hook does so by default (`DASHCLAW_CONTAINMENT=1`). In enforce mode, an eligible `Edit`/`Write`/`MultiEdit`/`Bash` call is redirected into a per-session git worktree (`.dashclaw/contained/<session_id>`) instead of the working tree; the tool proceeds against the staged copy. For `Edit`/`Write`/`MultiEdit` this is transparent (`updatedInput` rewrite) when `DASHCLAW_CONTAINMENT_REWRITE=1`, or via an instructive deny otherwise. **`Bash` always gets the instructive deny regardless of `DASHCLAW_CONTAINMENT_REWRITE`** — the Bash tool input schema has no `cwd` field, so its command text is never rewritten in place (Locked Decision 6). After execution, PostToolUse posts the resulting `git diff` as a capped artifact on the action. An operator later promotes (governed merge) or discards the staged change from `/approvals` or `dashclaw contained apply`. If the working directory is not a git repo, or containment is disabled locally (`DASHCLAW_CONTAINMENT=0`), the hook fails toward interruption and treats the call as `require_approval` instead of ever creating a worktree. In observe mode, the action is recorded but the tool proceeds unstaged.

  **Second-person-gate caveat:** the `operator` identity is exempt from the separation-of-duties check on the containment resolve route (mirrors the accepted approvals precedent). If this hook authenticates with the bootstrap `DASHCLAW_API_KEY`, its actions are attributed to `operator`, and `operator` can promote its own contained work — `SELF_APPROVAL_FORBIDDEN` never fires. For containment to have a real second-person gate, install the hook with a database-backed `api_keys` credential rather than the bootstrap operator key.
- **require_approval**: In enforce mode, an action record is created in `pending_approval` status. The hook prints the action ID and a replay link, then polls for up to 30 seconds waiting for an operator to approve or deny. If approved, the tool proceeds. If denied or timed out, the tool is blocked. In observe mode, the action is recorded but the tool proceeds immediately, and PostToolUse stamps `executed_despite: require_approval` on the pending row so the ledger shows the gate did not hold.

The PostToolUse hook runs after execution completes. It updates the action record with the outcome (completed or failed) and a summary of the output (up to 500 characters). The hook sends structured `outcome_metadata` including `exit_code` and `error_type` when applicable. Errors are classified into four types: `timeout`, `permission`, `not_found`, and `runtime`. The posttool hook never blocks.

If DashClaw is unconfigured (`DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` missing), the hooks exit silently and Claude Code operates normally. If DashClaw is configured but unreachable, behavior is governed by `DASHCLAW_GUARD_UNAVAILABLE_POLICY` (default `block`). See the Failure safety section below for the full policy table. The hooks never crash your session.

## Failure safety

If `DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` is unset, both scripts exit 0 silently and Claude Code is never blocked.

If DashClaw is configured but the API is unreachable (timeout, network error, 5xx) — by default the guard makes a single attempt; set `DASHCLAW_GUARD_RETRIES` to add retries — behavior is governed by `DASHCLAW_GUARD_UNAVAILABLE_POLICY`:

| Policy value | Behavior on unreachable guard |
|---|---|
| `block` (default) | Hook exits 2, the tool call is blocked, the action is logged to `~/.dashclaw/orphan-actions.jsonl` for backfill when the guard recovers. |
| `warn` | Hook prints a stderr warning, the action is logged, the tool proceeds. |
| `allow` | Hook is silent, the action is logged, the tool proceeds. |

The `block` default is correct for production governance posture: destructive actions should not proceed without a guard check. For development environments or single operator setups, `warn` is often the better choice. Set it in your environment:

```bash
export DASHCLAW_GUARD_UNAVAILABLE_POLICY=warn
```

Action create/update calls retry transient failures up to three attempts with 0.4 second and 0.8 second backoff, so most cold start blips on Vercel and Neon are absorbed automatically. The guard check itself makes a single attempt by default (it sits on the hot path before every governed tool call); set `DASHCLAW_GUARD_RETRIES=2` on flaky networks to give it the same three-attempt behavior.

## Threat model — what this hook is, honestly

These scripts run at the same privilege level as the agent they govern. The hook file, the intelligence module, and the `PreToolUse` registration in `.claude/settings.json` are all writable by any process that can write your home directory — including the governed agent itself. That makes the hook a **seatbelt against accidents, not a cage against intent**: it reliably stops the destructive command a busy model emits mid-run, and it makes tampering visible (a write to the hook path is itself a governed, recorded action; the enforcement-liveness probe reports the seam dead on its next run) — but it cannot stop a determined process executing at its own privilege.

What to do about it, in increasing order of strength:

1. **Control-plane policy (software, included).** Keep a `protected_path` policy of type `block` with `rules.ungrantable: true` over `**/.claude/settings.json`, `**/.claude/hooks/**`, and your hooks directory. Self-disable becomes a blocked, logged act instead of a silent one.
2. **Read-only hook path (deployment).** Mount or ACL the hook directory and settings file read-only for the account the agent runs as.
3. **Separate OS user (deployment).** Run the agent as a user with no write access to the hook path or its own harness config.
4. **Container (deployment).** Run the agent in a container whose image owns the hook; the workspace is the only writable mount.

DashClaw ships 1 and documents 2–4; it cannot provide them for you. Full statement: [`docs/architecture/enforcement-boundary.md`](../docs/architecture/enforcement-boundary.md).

**Composition detection (script-then-execute).** Two individually-benign calls can compose into a destructive one: write a script whose payload would be blocked inline, then execute the script path (which grades as a routine interpreter call). The hook closes this: PostToolUse records every path the session writes (file tools, shell redirects, `tee`, `curl -o`/`wget -O`) in a per-session ledger, and PreToolUse grades the **content** of any recently-self-written script being executed with the same classifiers inline commands get — so the split form earns exactly the inline grade, and routine write-then-run workflows (`bash cleanup.sh` deleting build artifacts) keep their calibrated low score. A ledger hit whose content can't be read (missing/oversized) floors at the review band. The signal appears as `script_then_execute` in the decision's classifier signals on `/decisions`. Documented residuals: indirection (`eval "$(< x.sh)"`), cross-session splits, and writer flags the parser doesn't model — all inside the privilege boundary above. TTL is tunable via `DASHCLAW_SCRIPT_EXEC_TTL_MINUTES` (default 60). Spec: [`docs/plans/2026-08-06-script-then-execute-spec.md`](../docs/plans/2026-08-06-script-then-execute-spec.md).

## Approving from the terminal

When a tool call requires approval, the hook prints the action ID:

```
[DashClaw] Approval required
Action ID: act_abc123
Goal:      Bash: git push origin main
...
Approve from terminal: dashclaw approve act_abc123
```

If you have the `@dashclaw/cli` package installed, run `dashclaw approve act_abc123` from another terminal to approve inline. You can also approve from the DashClaw dashboard at `/approvals`. The replay link printed in the terminal (`<DASHCLAW_BASE_URL>/replay/<action_id>`) opens the full decision evidence in your browser.

## Recovery Context

Guard responses now include an optional `recovery` field when the intel signals indicate a recoverable issue. When present, the recovery context contains a recipe type and suggested actions for the operator or agent.

Six recovery recipe types are supported:

| Recipe | Trigger |
|---|---|
| `session_stalled` | Session has high failure count or repeated blocked actions |
| `branch_stale` | Working branch is significantly behind the base branch |
| `mcp_degraded` | One or more MCP servers report high latency or errors |
| `repeated_failures` | The same tool or command has failed multiple times in sequence |
| `green_insufficient` | Test coverage or passing rate has dropped below threshold |
| `assumption_drift` | Agent behavior has diverged from the declared plan or goal |

The recovery field is informational. It does not block tool execution on its own but gives operators and agents structured guidance to self-correct.

## What gets governed

All tools in governed categories are evaluated against DashClaw policies. With the default `DASHCLAW_GOVERNED_CATEGORIES`, this includes:

- **execution**: Bash, BashBackground. Shell commands are enriched with bash intent classification. Git operations, deployments, infrastructure commands, destructive operations, and HTTP calls get elevated risk scores.
- **file_io**: Edit, Write, MultiEdit, NotebookEdit. File operations are enriched with security scan results. Sensitive files (`.env`, secrets, credentials), migrations, infrastructure configs, and auth-related files get elevated risk scores.
- **orchestration**: Agent (plus the legacy `Task` alias), Skill, TodoWrite. The `Agent`/`Task` spawn tools **are** in the shipped matcher, so sub-agent spawns are governed and recorded as `orchestration` actions (see "Sub-agent governance & tracking"). `Skill`/`TodoWrite` are classified but not in the default matcher — add them if you want them intercepted.
- **interactive**: AskUserQuestion, SendUserMessage, SendMessage. Prompt/interaction tools are governed by default.
- **mcp**: Any `mcp__*` tool call. Enriched with server health signals. `mcp__*` is in the shipped matcher, so MCP tool calls **are** intercepted by the `PreToolUse` hook before execution (connected-MCP actions like Gmail/Stripe/Calendar sends). The DashClaw MCP server remains the governance path for hosts that don't run Claude Code hooks.

Unknown tools that do not match any configured category fail-safe to governed.

## What does not get governed

- Tools in ungoverned categories: **search** (Read, Glob, Grep, WebFetch, WebSearch) and **system** (EnterPlanMode, ExitPlanMode, Config, Sleep) pass through without evaluation by default.
- Any tool call when `DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` is not set.

Configured but unreachable behavior is controlled by `DASHCLAW_GUARD_UNAVAILABLE_POLICY` (see Failure safety above). With the default `block` policy, unreachable means the tool call is denied, not waived.

## Replay

Every governed action creates a replayable evidence record in DashClaw. Visit `<DASHCLAW_BASE_URL>/replay/<action_id>` to see the full causal chain: what the agent intended, which policy was matched, whether approval was required, who approved it, and what the outcome was. This works for both allowed and blocked actions, giving operators a complete audit trail of what Claude Code did and why.
