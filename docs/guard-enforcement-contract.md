# Guard Enforcement Contract

> A trust spine that fails open isn't a trust spine. This document is the
> canonical reference for how the guard behaves when things go wrong:
> degradation, deadlines, unreachable instances, blind retries, and the org
> kill switch. Shipped by the Organ 3 program (v4.20.0).

The guard evaluation engine (`app/lib/guard.ts` `evaluateGuard`) is the single
chokepoint every governed surface flows through — the Claude Code hooks, the
MCP server, both SDKs, and direct `POST /api/guard` calls. Everything below
applies to all of them.

## 1. Degradation contract (fail closed)

When the guard **cannot complete** an evaluation, it no longer defaults to
`allow`. One resolver governs every degradation site, with this precedence:

| Priority | Source | Values |
|---|---|---|
| 1 | Per-policy override (`rules.on_timeout` for `webhook_check`, `rules.fallback` for `semantic_check`) | `allow` \| `block` \| `require_approval` |
| 2 | `DASHCLAW_GUARD_FALLBACK` env var (global) | `allow` \| `block` \| `require_approval` |
| 3 | Built-in default | **`require_approval`** (fail closed) |

Degradation sites covered:

- **Webhook timeout/failure** (`webhook_check` policies): a failed or
  timed-out customer webhook resolves through the contract. `on_timeout:
  "require_approval"` is honored; the old implicit fail-open default is gone.
- **Semantic LLM failure** (`semantic_check` policies): an LLM call that
  returns nothing resolves through the contract. The *missing-key* behavior is
  unchanged — no `GUARD_LLM_KEY`/`OPENAI_API_KEY` configured still yields
  `require_approval` with an explanatory reason.
- **Evaluation deadline exceeded** (below).

`DASHCLAW_GUARD_FALLBACK=allow` is the self-hoster escape hatch that restores
the historical fail-open behavior. `block` is the strictest posture (useful
during incidents). Unset means `require_approval`.

## 2. Evaluation deadline

Policy evaluation is bounded by a deadline — default **3500 ms**, overridable
with `DASHCLAW_GUARD_DEADLINE_MS`. The governed hooks give the entire guard
HTTP call a 5 s budget with zero retries (`DASHCLAW_GUARD_TIMEOUT=5`,
`DASHCLAW_GUARD_RETRIES=0`), so the server must answer inside that window
rather than hang the hook into a fail-closed timeout.

On deadline:

- The evaluation is abandoned (slow webhook/LLM/DB phase keeps running in the
  background and is discarded).
- A **degraded decision** is built from the state accumulated so far:
  `resolveDegradedAction()` applied on top — a `block` already found before
  the deadline is never downgraded.
- The decision is **still persisted** through the audit gate
  (`guard_decisions` row) before it is returned. A decision that cannot be
  durably recorded is refused (`GUARD_AUDIT_PERSIST_FAILED`), deadline or not.
- The response reason carries `Guard evaluation exceeded deadline (<ms>) —
  degraded decision (<action>)`, and any attached recovery recipe is marked
  `partial: true`.

## 3. MCP fail-closed (`DASHCLAW_GUARD_UNAVAILABLE_POLICY`)

The MCP server's `dashclaw_guard` tool maps **transport errors, non-2xx
responses, and malformed responses (no `decision` string)** to an explicit
fail-closed result instead of an error blob an LLM could misread as
permission:

```json
{ "decision": "block", "degraded": true,
  "reason": "DashClaw guard unreachable; refusing risky action (fail closed) — ECONNREFUSED",
  "guidance": "Do NOT proceed with the action. Check DASHCLAW_URL / DASHCLAW_API_KEY, then retry dashclaw_guard." }
```

`DASHCLAW_GUARD_UNAVAILABLE_POLICY` controls this on **both** client surfaces
with the same name and default:

| Surface | Default | `allow` (escape hatch) |
|---|---|---|
| Python hooks (`dashclaw_pretool.py`) | `block` — unreachable instance blocks the tool call | proceed ungoverned, stderr notice |
| MCP server (`dashclaw_guard` / `dashclaw_record`) | `block` — fail-closed result above | `decision: "allow"` with `degraded: true` |

`dashclaw_record` fails **loud**: a transport failure returns
`recorded: false` plus an explicit "the action was NOT written to the audit
ledger" error and retry guidance — never a silent continue.

The MCP guard payload also carries optional `target`, `write_paths`,
`content`, and `tool_name` fields so protected-path, secret-scan, and content
policies fire on MCP-originated calls.

## 4. Idempotency keys (every record path)

Blind client retries must not duplicate the ledger or distort the
time-window counters (approval-flood budget, signals, fleet digest).

**Derivation** — one convention on every surface (reference implementation:
`sdk/dashclaw.js` `deriveIdempotencyKey`; mirrors in
`hooks/dashclaw_pretool.py` and `mcp-server/src/tools.ts`, pinned by
cross-language golden vectors):

```
key = sha256hex( sorted parts joined as "k=v" with "|" )
```

| Surface | Parts | Discriminator |
|---|---|---|
| Hooks | `agent_id`, `action_type`, `tool_use_id` | `tool_use_id` — exact per tool call; omitted when the harness supplies none |
| MCP | `agent_id`, `action_type`, `declared_goal`, (`target`/`tool_name` or `status`/`session_id`) | UTC hour bucket |
| SDKs (`createAction`, auto when caller didn't supply) | `agent_id`, `action_type`, `declared_goal`, `session_id` | UTC hour bucket |

An explicit caller-supplied `idempotency_key` always wins over
auto-derivation.

**Server behavior:**

- `POST /api/actions` (pre-existing): duplicate key → the original row is
  returned with `idempotent_replay: true`.
- `POST /api/guard?record=true`: the record branch short-circuits on an
  existing `(org_id, idempotency_key)` action row and heals a missing one.
- `POST /api/guard` (any): a duplicate key inside a **10-minute replay
  window** returns the *prior decision* (`idempotent_replay: true`, prior
  `decision_id`) and writes **no new `guard_decisions` row** — flood/signal/
  digest counts stay honest by construction. The window is short on purpose:
  replay absorbs retries, never policy changes.

**Retries** are transient-only in the hook HTTP client: non-transient 4xx
fail immediately (auth and validation errors don't change on retry); 408,
429, 5xx, and connectivity errors keep the retry+backoff behavior.

## 5. Org kill switch

One audited switch halts every governed surface for an org.

- **State:** the `DASHCLAW_ORG_HALT` org setting
  (`{halted, actor, reason, at}`), written only by the endpoint below.
- **Endpoint:** `GET /api/halt` (status) / `POST /api/halt`
  (`{halted: boolean, reason?}`) — **admin-only**; both transitions write
  `activity_logs` audit rows (`org.halted` / `org.resumed`).
- **Effect:** `evaluateGuard` checks halt **first** — a halted org evaluates
  no policies; every call returns an immediate `block` with
  `Org halted by <actor>: <reason>`, persisted like any decision. Hook, MCP,
  SDK, and API paths all inherit it because they all flow through
  `evaluateGuard`.
- **Immediacy:** the endpoint eagerly invalidates the guard settings cache,
  so the switch takes effect on the very next call — not after the ~30 s
  cache TTL. The halt read rides the existing cached hot-path settings query
  (no added per-call query).
- **CLI:** `dashclaw halt on|off|status [--reason "<why>"]` (admin API key).

## Environment variables

| Var | Where | Default | Meaning |
|---|---|---|---|
| `DASHCLAW_GUARD_FALLBACK` | server | `require_approval` | Global degradation action (`allow` \| `block` \| `require_approval`) |
| `DASHCLAW_GUARD_DEADLINE_MS` | server | `3500` | Policy-evaluation deadline (keep safely under the hooks' 5 s budget) |
| `DASHCLAW_GUARD_UNAVAILABLE_POLICY` | hooks + MCP server | `block` | What clients do when the instance is unreachable (`allow` = escape hatch) |
| `DASHCLAW_GUARD_TIMEOUT` / `DASHCLAW_GUARD_RETRIES` / `DASHCLAW_GUARD_CONNECT_TIMEOUT` | hooks | `5` / `0` / `2` | The hook-side guard HTTP budget the server deadline must fit inside |
