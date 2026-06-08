# Behavior Learning Mode / Policy Coach (v1)

Behavior Learning passively records **real, redacted, local-only** samples of your
Claude Code + agent usage, analyzes them deterministically, and suggests
**evidence-backed DashClaw policies per agent**. v1 is **observe-only**: it never
blocks, never changes approval behavior, and never auto-enforces anything.

- **UI:** `/policy-coach` (Govern → Policy Coach)
- **Storage:** local JSONL under `.dashclaw/behavior-samples/` — nothing is uploaded
- **Enforcement:** none. Adopted suggestions become **inactive** policy drafts (`active=0`) you activate manually from `/policies`.

---

## How it works

```
Claude Code / agent
   │  Pre/PostToolUse hooks (Python)
   ▼
.dashclaw/behavior-samples/<YYYY-MM-DD>.jsonl   ← redacted, local-only
   │  read by the server (same machine)
   ▼
Deterministic analyzer  →  per-agent suggestions (confidence, evidence, draft policy)
   │
   ▼
Policy Coach UI  →  Simulate (replay over samples)  →  Adopt (inactive draft) / Edit / Dismiss
```

1. **Recorder** (`hooks/dashclaw_agent_intel/behavior_recorder.py`) — runs inside the existing PreToolUse/PostToolUse hooks. Pre-execution context (tool, command shape, risk, paths, guard decision) is stashed; PostToolUse finalizes it with the outcome and appends one redacted JSONL line. Fail-silent: a recorder error never blocks or slows a tool call.
2. **Analyzer** (`app/lib/behavior/analyzer.js`) — groups samples by agent and emits suggestions. Fully deterministic: the same samples always produce the same suggestions (and the same suggestion ids), which is what makes dismiss-suppression stable.
3. **Simulator** (`app/lib/behavior/simulate.js`) — replays samples against a candidate rule and returns allowed/warned/approval/block counts plus likely false positives. The analyzer and simulator share one evaluator (`app/lib/behavior/policy-model.js`), so a simulation reflects exactly what the analyzer (and, for enforceable types, the guard engine) would do.
4. **Policy Coach** (`/policy-coach`) — shows sample status, observed-agent envelopes, and suggestions with **Simulate / Edit / Adopt / Dismiss**. Adopt is gated on simulation review.

## Setup

The recorder is **opt-in**. Enable it in whichever environment your hooks read — two options:

**A) Claude Code `settings.json`** (`~/.claude/settings.json`, or a project's `.claude/settings.local.json`) — set it in the `env` block, where values are JSON **strings**:

```json
"env": {
  "DASHCLAW_BEHAVIOR_SAMPLES_ENABLED": "1"
}
```

**B) The repo's `.env` / `.env.local`** (loaded by the hooks via their dotenv walk) — `.env` files use the `KEY=value` form, unquoted:

```
DASHCLAW_BEHAVIOR_SAMPLES_ENABLED=1
```

The recorder accepts `1`, `true`, or `yes` (case-insensitive). Use the quoted-string form **only** inside JSON (`settings.json`); use the bare `KEY=1` form **only** inside `.env` files — never mix them.

Then use Claude Code normally — samples accumulate locally. Suggestions appear once an agent has at least **8 samples** (configurable) and a pattern repeats at least **3 times**. Watch progress with `dashclaw behavior status` or `/policy-coach`.

> Behavior Learning needs **no LLM key** — and no `DASHCLAW_BASE_URL` / `DASHCLAW_API_KEY`. Recording is local-only and writes even when the guard API is unreachable; the analyzer is deterministic and never calls a model.

### Where samples land vs. where the Policy Coach reads them (important)

By default the recorder writes to **`<cwd>/.dashclaw/behavior-samples/`** — the directory Claude Code is running in — while the Policy Coach UI reads from **the DashClaw app's own cwd**. So:

- **Dogfooding on the DashClaw repo itself** (Claude Code's cwd *is* the DashClaw checkout): the two line up automatically — nothing else to do.
- **Capturing other projects** and viewing them in one Policy Coach: point both the recorder *and* the server at the same absolute directory via `DASHCLAW_BEHAVIOR_SAMPLES_DIR` — set it in the hook env (`settings.json`) **and** in the DashClaw server's `.env.local`:

```json
"env": {
  "DASHCLAW_BEHAVIOR_SAMPLES_ENABLED": "1",
  "DASHCLAW_BEHAVIOR_SAMPLES_DIR": "C:/Users/you/.dashclaw/behavior-samples"
}
```

```
# DashClaw server .env.local
DASHCLAW_BEHAVIOR_SAMPLES_DIR=C:/Users/you/.dashclaw/behavior-samples
```

`.dashclaw/` is gitignored — sample data stays local and is never committed.

### Hosted dashboards: the "learning in the background" summary

Because samples are local-only, a **hosted** DashClaw (e.g. a Vercel deployment) can't read them — its serverless filesystem never sees your machine. Pointed at a hosted instance, the Policy Coach would otherwise show `0 samples` forever even while capture is working.

To close that gap **without breaking the local-only promise**, when the recorder is on the Stop hook pushes a **SAFE AGGREGATE snapshot** to `POST /api/behavior/insights`:

- **What syncs:** counts, per-agent tallies (count + destructive / protected-write / failed / tool-diversity), signal totals (destructive commands, protected-path writes, high-risk, failed, blocked, approvals), and timestamps. Plus an optional machine `host_label`.
- **What never syncs:** command shapes, paths, goals, file content, or any raw behavioral detail. The push is built from an allowlist on the client (`behavior_recorder.build_insights`) **and** rebuilt field-by-field on the server (`app/api/behavior/insights`), so a malformed payload can't smuggle anything else into storage.
- **Where the hosted UI shows it:** the Policy Coach renders a "DashClaw is learning in the background" panel (heartbeat + counts + per-agent tallies) with a link to open Policy Coach locally to review and adopt the actual policy drafts.
- **Cadence & control:** throttled to recompute at most every ~10 minutes; on by default whenever the recorder is on; opt out with `DASHCLAW_BEHAVIOR_INSIGHTS=0`. Stored as a single org setting (`BEHAVIOR_INSIGHTS_SNAPSHOT`), not a behavior-sample row.

## Privacy model & guarantees

- **Raw behavior is local only.** Samples are written to `.dashclaw/behavior-samples/` on the machine running the agent and are never uploaded. The Policy Coach reads these files server-side on the same machine (self-hosted / local dev). A hosted instance only ever receives the safe aggregate snapshot described above — counts, not behavior.
- **No database row.** Samples are never persisted to Postgres. The only database writes Behavior Learning makes are when you **adopt** an enforceable suggestion — it creates an inactive `guard_policies` draft, exactly as the manual policy authoring flow does.
- **Deterministic redaction before disk.** The recorder scrubs API keys, tokens, env-var assignments, JWTs, and private keys from command shapes and paths using the same pattern set as `app/lib/claude-code/optimal-files/secret-scan.js`. Paths are home-stripped and workspace-relativized. The server defensively re-redacts every sample on read (`app/lib/behavior/redaction.js`).
- **No raw transcripts or message bodies.** A sample stores a redacted *command shape* (verbs/flags preserved, operands replaced with `<path>` / `<url>` / `<REDACTED:…>`), redacted read/write paths, and structured metadata — never the full command, file content, or prompt.
- **Dismissals are local too.** Dismiss / accepted-advisory records live in `.dashclaw/behavior-samples/.dismissals.json`.

## Sample format

One JSON object per line in `<YYYY-MM-DD>.jsonl`:

```json
{ "schema_version": 1, "event_id": "bse_ab12…", "ts": "2026-06-02T14:03:00Z", "source": "claude-code", "session_id": "…", "agent_id": "claude-code", "agent_name": null, "model": "claude-opus-4-8", "project": "DashClaw", "tool": "Bash", "tool_category": "execution", "action_type": "security", "command_shape": "git push --force <path>", "bash_intent": "destructive", "read_paths": [], "write_paths": ["app/api/auth/route.js"], "risk_score": 85, "reversible": false, "guard_decision": "allow", "matched_policies": [], "outcome_status": "completed", "error_type": null, "duration_ms": 1240, "action_id": "act_…", "sensitive_path": true }
```

`event_id` is the primary evidence id; `action_id` links the sample to the Decisions ledger.

## Analyzer rules (suggestion types)

| Type | What it detects | Maps to | Decision |
|------|-----------------|---------|----------|
| `destructive_command_approval` | Destructive / high-risk shell commands (`rm -rf`, `git push --force`, `git reset --hard`, risk ≥ threshold) | **Enforceable** → guard `risk_threshold` | require approval |
| `protected_path_approval` | Writes to protected paths: auth, middleware, billing, secrets, `.organism`, livingcode, cron/gateway config | **Enforceable** → guard `protected_path` | require approval |
| `repeated_reload_warn` | Same file re-read N+ times in a window with no intervening change | Advisory | warn |
| `failed_loop_warn` | Same command failing N+ times in a window | Advisory | warn |
| `model_task_mismatch_warn` | A below-`mid`-tier (cheap) model doing heavy work — refactor, migration, security review, multi-file debugging, architecture | Advisory | warn |
| `agent_allowlist` | The agent's normal safe envelope (reads/tests/lints/builds) | Advisory (scopes other suggestions) | — |

Each suggestion carries `confidence`, `sample_size`, `matching_sample_size`,
`evidence_event_ids`, `evidence_examples`, `expected_effect`, `false_positive_risk`,
`severity`, and (for enforceable types) a `draft_policy`.

### Enforceable vs advisory

Two types compile to **faithful, enforceable guard policies** — what the Policy Coach
simulates is exactly what the guard would do once you activate the draft:

- `destructive_command_approval` → `risk_threshold` `{ threshold, action: require_approval }` (destructive commands reliably score high via the bash classifier + server risk scoring, which is how the analyzer picks the threshold).
- `protected_path_approval` → the **new `protected_path` guard policy type** `{ paths: [globs], action }`, matched against the action's target path with the same matcher the simulator uses (`app/lib/behavior/path-match.js`).

The other four are **advisory** in v1. DashClaw's guard evaluates a single action at a
PreToolUse check and has no model/task or cross-action-sequence context, so reload loops,
failure loops, model/task mismatch, and allowlists are surfaced as evidence-backed
observations (fully simulatable) rather than enforced policies. Adopting one records an
**accepted observation** locally so it stops re-surfacing. See *v2 follow-ups*.

## Simulation before adoption

The Policy Coach **requires** you to run a simulation before adopting a suggestion.
Simulation replays the agent's recorded samples through the candidate rule and reports:

- `allow` / `warn` / `require_approval` / `block` counts
- `flagged` (non-allow) total
- `likely_false_positives` — flagged actions that completed successfully (gating them would have added friction to work that was fine)

The server re-runs the simulation on adopt and refuses if there are no samples to back the
decision (`acknowledged_simulation: true` is also required).

## Adopt / Edit / Dismiss

- **Adopt** — enforceable: creates an **inactive** `guard_policies` draft (`active=0`). It appears on `/policies` where you can review and activate it. Advisory: records an accepted observation.
- **Edit** (enforceable only) — tweak the threshold / path globs / decision, simulate the edited rule, then adopt.
- **Dismiss** — records a local dismissal with an optional reason. Check *Suppress similar* to hide all suggestions of that type for that agent. Dismissals never re-surface the same suggestion.

## Using it from the CLI / MCP / other agents

- **CLI:** `dashclaw behavior status` (sample status) and `dashclaw behavior suggestions [--agent-id X]` (read-only list). Adopt/dismiss stay in the UI because they require simulation review.
- **MCP:** `dashclaw_behavior_suggestions` returns the suggestions for the calling agent — useful for "show me my own coaching."
- **MoltFire / OpenClaw and other sources:** the sample format is `source`-agnostic. Any agent runtime can emit redacted JSONL lines following the schema above into `.dashclaw/behavior-samples/` (use a distinct `source` value, e.g. `"openclaw"`). The analyzer treats all sources uniformly. **Never** write un-redacted content — strip secrets and full paths before writing.

## Storage & schema

Behavior Learning adds **no database migration**. Samples and dismissals are local files;
adopted drafts reuse the existing `guard_policies` table (`insertPolicy(..., { active: 0 })`).
The only schema-adjacent change is the new `protected_path` value in the `POLICY_TYPES`
enum (`app/lib/validate.js`) and its evaluation branch in the guard engine
(`app/lib/guard.js`) — both authorable from `/policies`.

## Limitations & v2 follow-ups

- **Advisory types are not enforced in v1.** Making reload/failure-loop, model/task-mismatch enforceable needs a sequence- and model-aware guard context (v2).
- **`model` is best-effort for Claude Code.** Claude Code does not expose the model to tool hooks, so the recorder reads it from `DASHCLAW_MODEL` / `ANTHROPIC_MODEL` / `CLAUDE_MODEL` if set; otherwise `model_task_mismatch_warn` stays quiet for that agent.
- **Tokens/cost are not in samples.** Hook samples lack per-action token/cost (the Stop hook computes those for the Decisions ledger, keyed by `action_id`). A v2 enrichment could join cost via `action_id`.
- **Local-first.** Hosted DashClaw instances can't read a developer's local sample dir; v1 targets the self-hosted / local-dev path. Opt-in cloud upload is a possible v2.
