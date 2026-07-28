# Minimal Runtime API (v2.13.3)

DashClaw is a focused governance runtime. These endpoints are the smallest useful contract for agents and agent frameworks that want DashClaw governance without adopting DashClaw's higher-level UI, workflow, scoring, knowledge, or capability surfaces.

This page documents the minimal runtime contract. For the complete generated route inventory, see [`../api-inventory.md`](../api-inventory.md). For durable outcome semantics, see [`durable-execution-finality.md`](./durable-execution-finality.md).

## The Governance Loop

A fully governed action usually follows this flow:

1. **Guard** (`POST /api/guard`) -> "Can I do this?"
2. **Record** (`POST /api/actions`) -> "I am doing this."
3. **Assumption** (`POST /api/assumptions`) -> "This belief matters while I act." Optional, but recommended when reasoning integrity matters.
4. **Outcome** (`POST /api/actions/:actionId/outcome`) -> "This actually completed, partially completed, or failed."

`PATCH /api/actions/:actionId` still exists for legacy lifecycle updates, but the current durable-finality path is `POST /api/actions/:actionId/outcome` plus `GET /api/actions/:actionId/outcome` for polling.

One decision from step 1 forks the loop instead of following it straight through: `allow_contained` (see [Containment Verdicts](#containment-verdicts-allow_contained) below) records the action as usual, but the "doing this" happens inside a staged worktree — the lifecycle is record -> diff artifact -> `awaiting_promotion` -> promote (governed merge) or discard, in place of a synchronous approve/deny.

## Plan authorization (preflight)

Long-horizon runs amortize approvals: `POST /api/plans` submits an ordered
step list; every step is dry-run through the full guard pipeline
(side-effect-free) and stored with its preview verdict; the operator reviews
one card on /approvals (per-step overrides included). Approved steps become
single-use, act-or-goal-bound, TTL-bound grants: when the agent later
performs a matching action that evaluates to `require_approval`, the grant
is consumed atomically and the decision downgrades to `allow` with
`builtin:plan_grant` provenance. Explicitly denied steps are raised to
`block` on match for the plan's TTL. A plan grant never downgrades `block`,
nothing auto-approves, and revocation (`POST /api/plans/:id` verdict
`revoke`) is instant — the consumption path is uncached.

**Read authorization.** `GET /api/plans` and `GET /api/plans/:id` are
readable by any credential in the org — matching the approvals and
decisions model, the org credential is the trust boundary, and plans are
not agent-private.

**Accepted risk — deny binding is org-wide.** A denied step's match is
deliberately scoped to the org, not to the agent that submitted the plan:
agent identities are self-asserted at guard time (absent a verified JWT), so
scoping a denial to `agent_id` would let the denied act evade the operator's
"no" simply by resuming under a different claimed identity. The tradeoff: a
hostile org credential could submit a plan step that mirrors legitimate
work, bait an operator into denying it, and thereby block that act for
every agent in the org for the grant's TTL — a self-inflicted denial-of-service.
This is accepted, not mitigated away, because submitting a plan already
requires an org API key (inside the trust boundary), and three controls
bound the blast radius: the review card discloses the org-wide match before
the operator decides, `revoke` lifts a bad denial instantly, and the denial
expires with the TTL regardless.

---

## Core Endpoints

### 1. Guard (`POST /api/guard`)

Evaluates active guard policies for a proposed action. It does not execute the action. It returns `allow`, `warn`, `allow_contained`, `require_approval`, or `block`.

Risk scores are computed server-side from structured fields such as `action_type`, `reversible`, `systems_touched`, and `declared_goal`. The agent-supplied `risk_score` is advisory. DashClaw takes the max of the server heuristic, any active org risk-template score, and the agent-reported score, then may apply predictive-risk adjustment when enabled. Two calibration guarantees hold in the predictive layer: high velocity alone never raises risk (the +5 velocity term only amplifies a demonstrated failure rate), and the optional LLM adjustment (±20) is only consulted when *server-side* evidence crosses the threshold — an inflated agent-reported score can raise the final score but never recruits the LLM amplifier. The response returns `risk_score` (authoritative/effective), `agent_risk_score` (raw agent-supplied value, or `null`), and `risk_breakdown` — the full derivation ledger (`base` + `modifiers` -> `server_total`; `template`; `client_reported`; `effective`; `predictive` split into `statistical_adjustment` and `llm`; `final`). The same breakdown is persisted with the decision and exposed on `GET /api/actions/:id` under `guard_decision.risk_breakdown`, so every escalation is explainable after the fact.

Prompt-injection scanning runs against `declared_goal` before guard evaluation and can reject malicious input with `400`.

**Request:**
```json
{
  "action_type": "deploy",
  "declared_goal": "Deploy build #402 to production",
  "risk_score": 85,
  "agent_id": "deploy-agent-1",
  "agent_name": "Deploy Agent",
  "systems_touched": ["production"],
  "reversible": false
}
```

**Response:**
```json
{
  "decision": "allow | warn | allow_contained | require_approval | block",
  "decision_id": "act_gd_...",
  "action_id": "act_gd_...",
  "reason": "Risk score exceeds org threshold",
  "signals": ["Production access", "High risk score"],
  "matched_policies": ["pol_..."],
  "risk_score": 85,
  "agent_risk_score": 85,
  "evaluated_at": "2026-05-13T02:57:00.000Z",
  "reasons": ["Risk score exceeds org threshold"],
  "warnings": []
}
```

`decision_id` is the canonical id of this guard evaluation (`act_gd_…`). `action_id` is a **deprecated alias** of the same value, kept for back-compat. Do not pass either to `waitForApproval` / `GET /api/actions/:id` — use the `action_id` returned by `POST /api/actions` (an `act_…` id) for follow-up calls.

**Granted operator approvals are honored on re-evaluation.** When a decision would be `require_approval`, the guard first checks the action ledger for a recent human approval of the identical action — same `agent_id`, same exact `declared_goal`, approved within the last 15 minutes. A match downgrades the decision to `allow`, adds `builtin:operator_approval` to `matched_policies`, and names the covering approval in `warnings`. This closes the loop where an operator approves after the client's approval wait timed out and the retried call would otherwise re-queue for approval. A `block` decision is never downgraded — blocks are absolute at the decision layer, on every surface. Whether the blocked action is mechanically halted (hooks, server-executed capabilities) or cooperatively honored (SDK/MCP/chat callers) depends on the surface — the per-surface table is [`docs/architecture/enforcement-boundary.md`](./enforcement-boundary.md).

**Assumption-invalidation alerts ride the guard response.** When an operator invalidated an assumption this agent (or its identity family) recorded and the alert has not been acknowledged, the response carries an `assumption_alerts` array (newest 3): `{ message_id, assumption_id, assumption, invalidated_reason, action_id, invalidated_at }`. Advisory only — it never changes the decision. Acknowledge by marking the underlying inbox message read (`PATCH /api/messages { "message_ids": [...], "action": "read" }`); the Claude Code pretool hook surfaces the warning and acknowledges automatically. Until acknowledged, the alert rides every guard call — that is what "mid-task" means for agents that are not resident.

`GET /api/guard` lists recent guard decisions and supports filters such as `agent_id`, `decision`, `days`, `limit`, and `offset`. `days` (1–90) windows both the rows and the `total` count to the last N days, so `?decision=block&days=7` returns the true weekly denied count via `total`; without `days` the list spans all history.

**Scoped delegation constraints (`delegation_constraint` policy type).** A composed subagent's effective authority is a provable subset of its parent's, enforced on every guard call made with a `parent:child` identity.

| Rule field | Type | Effect |
|---|---|---|
| `parent` | string (default `*`) | Which parent identity this constraint applies to. |
| `child_types` | string[] (default `['*']`) | Which child segments are constrained. |
| `max_risk_score` | number 0–100 | Ceiling on `effectiveRiskScore` (the post-predictive value, same number the decision itself is judged on). |
| `allowed_action_types` / `blocked_action_types` | string[] | Action-type allow/block list. |
| `blocked_path_globs` | string[] | Path scope, matched with the same `matchesProtectedPath` semantics as `protected_path`. |
| `max_depth` | integer 1–8 | Maximum `parent:child:...` nesting depth. |
| `escalate_action` | `require_approval` \| `block` (default `require_approval`) | What happens on a violation — never a grant. |
| `require_verified_parent` | boolean | Fail closed on an unverified caller identity — without Phase-2 JWKS identity configured, every composed call is unverified and escalates. |

Worked example: a `Constrain subagents` policy sets `{ parent: '*', child_types: ['*'], max_risk_score: 40, escalate_action: 'require_approval' }`. A composed child `claude-code:explore` calls guard with `risk_score: 75` (above the 40 ceiling) — the decision downgrades from whatever the bare risk score would earn to `require_approval`, and the policy id appears in `matched_policies` with reason `risk 75 exceeds the delegated ceiling 40 for claude-code:explore`. The same child calling with `risk_score: 5` is unaffected; the constraint does not match. The bare parent `claude-code` (no `:` in `agent_id`) is never evaluated against this policy at all — it is a hard no-op for non-composed callers, so every existing single-agent fleet sees zero behavior change.

The evaluator fires only on composed identities — an `agent_id` containing the reserved `:` delimiter. Provenance-mode callers (a base `agent_id` plus `intel.subagent`) are documented **out of v1 scope**; only the composed-id calling convention is constrained today. Attenuation only tightens: this policy type can escalate a decision to `require_approval` or `block`, but it has no grant path of its own. Like every other raiser (risk calibration, other policies), a `require_approval` it produces can still be covered by an operator-sanctioned grant — `allow_grant`, a plan grant, or an operator approval; `block` remains absolute.

Attenuation is enforced against the identity the caller *asserts* in `agent_id`, not a cryptographically verified one. Combine `require_verified_parent: true` with the Phase-2 JWKS identity system for a cryptographic claim rather than a self-reported one.

#### Containment Verdicts (`allow_contained`)

A fifth decision sits between `warn` and `require_approval`: **execute now, but staged.** A `risk_threshold` policy may set `rules.contain_above` (must be strictly below `rules.threshold`); a score landing in `[contain_above, threshold)` returns `allow_contained` instead of `require_approval` — but only when the act is eligible. Eligibility is a split responsibility: the **server** (`isContainableAct`) proves the act itself is file-scoped — `Edit`/`Write`/`MultiEdit` file mutations, or a shell act the evidence classifier grades as a clean, non-network `apply` operation (no flags, not a `git push`/`pull`/`fetch`) — and falls back to `require_approval` if it cannot prove this, regardless of score. The server has **no git-repository check at all**. That requirement is enforced entirely **client-side, by the hook**: staging happens in a git worktree, so outside a git repository the hook cannot create one and fails toward interruption, simply never advertising the capability for that call. HTTP calls, SQL against live databases, payments, message sends, and deploys are never eligible server-side.

**Capability negotiation is non-negotiable.** A caller only ever receives `allow_contained` if it advertised `context.client_capabilities: ['allow_contained']` on the guard call. A caller that does not advertise, or whose act fails the server's eligibility check, gets `require_approval` instead, with `risk_breakdown._containment: { downgraded_to_interrupt: true, reason: 'client capability not advertised' }` (the `reason` is the eligibility-check's basis string when eligibility itself failed, e.g. `'git network subcommand'`) — version skew only tightens, never loosens. The bare Node and Python SDKs do not advertise the capability by default (a bare SDK caller has no worktree machinery to stage into); only hook-cooperating harnesses (Claude Code, Codex) that implement the redirect opt in.

**Lifecycle.** `action_records.containment_status` moves `null -> contained -> awaiting_promotion -> promoted | discarded`. The merge target (`containment_ref`, `dashclaw/contained-<session>-<instance>`) is **stamped server-side at guard `?record=true` time**, derived from the payload's `harness_session_id` plus the hook's instance discriminator (`containment_instance`, sha256(base_url|agent_id)[:12] — so two co-installed hook instances sharing a harness session never collide on the same branch/worktree), and returned in the guard response's `containment.ref`; the hook creates its worktree branch under that name (falling back to an identical local derivation for older servers). The later `awaiting_promotion` flip can only *fill* a missing ref on legacy rows — a client ref conflicting with the server stamp fails the flip with `409`, so the flip carries no attacker-controllable merge target. On a contained mutation the hook stages the effect into a per-session git worktree (`.dashclaw/contained/<branch-segment>`, the ref minus its `dashclaw/contained-` prefix) instead of the working tree, then posts the resulting diff as an artifact (`artifact_type: 'patch'`, capped by `DASHCLAW_CONTAINMENT_DIFF_CAP_BYTES`, default 1.5MB) linked to the action. An operator reviews the diff on `/approvals` (Containment tab) and clicks **Promote** or **Discard** — `POST /api/actions/:actionId/containment { verdict: 'promote' | 'discard' }` (operator-authenticated). Promotion is itself governed: it creates a synthetic, pre-approved `containment_promote` action whose act is the exact `git merge --no-ff <containment_ref>` command, act-hash-bound and single-use, so the merge that lands staged effects into the real tree goes through guard like everything else. `dashclaw contained list|diff|apply` is the CLI-side counterpart the agent/developer runs to execute an already-promoted merge.

`block` is never emitted or reached via containment — containment only ever replaces what would otherwise be `require_approval`.

### 2. Actions (`POST /api/actions`)

Records an action in the DashClaw ledger. This endpoint also runs guard evaluation internally. If policy blocks the action, DashClaw creates a blocked action record and returns `403`. If approval is required, the action is created with `status: "pending_approval"`.

Required fields are `agent_id`, `action_type`, and `declared_goal`.

`idempotency_key` is optional but strongly recommended for durable execution. If a row already exists for `(org_id, idempotency_key)`, DashClaw returns the existing action with `idempotent_replay: true` instead of inserting a duplicate.

**Request:**
```json
{
  "agent_id": "deploy-agent-1",
  "agent_name": "Deploy Agent",
  "action_type": "deploy",
  "declared_goal": "Deploy build #402 to production",
  "authorization_scope": "production deploy for service api",
  "risk_score": 85,
  "systems_touched": ["production"],
  "reversible": false,
  "idempotency_key": "sha256:..."
}
```

**Allowed lifecycle statuses:**
```text
running, completed, failed, cancelled, pending, pending_approval, blocked
```

DashClaw can also set `expired` server-side (never client-suppliable): a
`pending_approval` row whose requesting client provably stopped waiting flips
to `expired` and is no longer approvable (see "Approval lifecycle" below).

Agent-reported cost and token values are clamped server-side. If `tokens_in` or `tokens_out` are provided without an explicit `cost_estimate`, DashClaw estimates cost from the configured pricing table.

### 3. Durable Outcomes (`POST /api/actions/:actionId/outcome`)

Records the terminal outcome of an action. This is the current durable-finality endpoint and should be preferred over legacy `PATCH /api/actions/:actionId` completion updates.

Allowed agent-reported terminal states are:

```text
completed, partial, failed
```

`lost_confirmation` is reserved for the system sweep at `/api/cron/outcome-sweep`.

**Completed request:**
```json
{
  "status": "completed",
  "summary": "Success: build #402 is live."
}
```

**Failed request:**
```json
{
  "status": "failed",
  "summary": "Deploy did not complete.",
  "error_message": "Health check failed after rollout."
}
```

**Partial request:**
```json
{
  "status": "partial",
  "summary": "Deploy started but manual cleanup is required.",
  "progress": {
    "completed_steps": ["image pushed", "rollout started"],
    "remaining_steps": ["rollback or finish rollout"]
  }
}
```

Rules:

- `error_message` is required when `status` is `failed`.
- `progress` object is required when `status` is `partial`.
- First terminal outcome wins.
- A later POST returns `409 { "error": "outcome already set", "current_status": "..." }`.
- Summary, error, and progress strings are secret-scanned/redacted before storage.

`GET /api/actions/:actionId/outcome` returns the current outcome state, including elapsed time where available.

**Closure provenance (`close_source`).** Every closed row is stamped server-side with how it closed: `outcome` (this endpoint, or a legacy PATCH carrying a real terminal status), `stop_autoclose` (a `close_if_running: true` PATCH won the close), or `direct` (created already terminal, e.g. via MCP `dashclaw_record`). This makes outcome coverage computable from durable data instead of matching a summary string. Separately, the Claude Code Stop hook posts one fail-silent per-turn report to `POST /api/coverage` comparing the transcript's `tool_use` ground truth against the session's recorded actions ("record coverage"). Both figures render as a Coverage column on `/agents`, with an explicit "no evidence" state, and feed a posture finding when either drops below 90%.

**Lineage stamping (`harness_session_id`, `subagent_uuid`).** Every recorded action — pretool's `?record=true` payload, the `POST /api/actions` fallback, and the Stop hook's text-turn actions — carries its harness session (`harness_session_id`), and subagent leaf calls also carry the subagent instance uuid (`subagent_uuid`). Spawn (`Agent`/`Task`/`Workflow`) rows carry the spawned agent's uuid via `outcome_metadata.spawned_agent_uuid` on the outcome PATCH — the only `outcome_metadata` key the server persists (into `outcome_progress`); every other key is still dropped. A multi-agent fan-out is joined from this evidence at read time (never guessed client-side) and surfaced on the `/agents` Fan-outs panel, deep-linking to the scoped `/swarm` graph.

### 4. Assumptions (`POST /api/assumptions`)

Records beliefs underpinning an action. Assumptions are useful for drift detection, auditability, and post-action review.

The parent action must exist. DashClaw returns `404` if `action_id` is unknown.

**Request:**
```json
{
  "action_id": "act_...",
  "assumption": "The staging tests passed successfully.",
  "basis": "CI run 402 was green before deploy."
}
```

**Response:**
```json
{
  "assumption": {
    "assumption_id": "asm_...",
    "action_id": "act_...",
    "assumption": "The staging tests passed successfully.",
    "basis": "CI run 402 was green before deploy."
  },
  "assumption_id": "asm_...",
  "security": {
    "clean": true,
    "findings_count": 0,
    "critical_count": 0,
    "categories": []
  }
}
```

`GET /api/assumptions` supports filters such as `action_id`, `agent_id`, `validated`, `stale`, `limit`, and `offset`. `drift=true` adds a drift summary. Invalidated rows carry `notification_status` (`unread` | `acknowledged`) — the delivery state of the invalidation notice sent to the owning agent.

**Invalidating notifies the owning agent.** `PATCH /api/assumptions/:assumptionId` with `{ "validated": false, "invalidated_reason": "..." }` (operator action — the context menu on `/assumptions`, or a direct API call) also sends the assumption's owning agent a durable inbox message (`message_type: "assumption_invalidated"`, `doc_ref` = the `asm_…` id, body = a JSON directive with the assumption, reason, and parent `action_id`). The PATCH response reports `notification: { message_id }` on success or `notification_error: "notification_failed"` if the message could not be created — the invalidation itself still succeeds. From then on the agent's guard calls carry `assumption_alerts` until the message is marked read.

---

## Non-Fabrication Policy & Signed Evidence

A `non_fabrication` guard policy verifies that an action's outbound **content** states no fabricated operational fact before the action proceeds.

**How it works.** Attach two fields to a guard call or `createAction`:

- `content` — the outbound text to check (e.g. a drafted message or letter).
- `source_of_truth` (Node SDK: `sourceOfTruth`) — the facts the content is allowed to state: `{ allowedFacts, requiredFacts, forbiddenPatterns?, extract? }`.

The verifier confirms that every operational token (currency amount, date, percentage, and any caller-registered pattern such as an account or invoice ID) traces verbatim to an allowed fact, that every declared required fact is present, and that no forbidden pattern (e.g. an invented statute citation) appears. It returns **pass** or **block** with structured violations.

**Policy config** (the `rules` of a `non_fabrication` policy):

| field | meaning | default |
|---|---|---|
| `action_types` | action types the policy applies to | all types |
| `content_path` | dotted path in the action context holding the content | `content` |
| `source_path` | dotted path holding the source-of-truth | `source_of_truth` |
| `on_violation` | `block` or `require_approval` | `block` |

`require_approval` routes through the existing multi-channel approval flow (dashboard / CLI / Telegram / Discord / PWA — all resolving one decision).

**Fail-closed.** Any error, ambiguity, or a missing/malformed source-of-truth **blocks**; extraction over-blocks rather than under-blocks. The decision, matched policy, and violations are recorded in the guard-decision ledger (visible in `/decisions`, `/replay/[actionId]`, and the trace) and returned on the response under `non_fabrication`.

### Signed, re-verifiable evidence

Each `non_fabrication` decision attempts to attach a **signed Ed25519 proof receipt**, and the compliance export is a **signed, hash-chained bundle** rather than unsigned markdown/JSON. Receipt signing is best-effort and never gates the verdict: if the instance signing key is unavailable, the decision is still enforced and recorded, but `receipt` may be `null`.

- Public key: `GET /.well-known/jwks.json` (also `GET /api/integrity/jwks`).
- Re-verify a receipt or a bundle: `POST /api/integrity/verify` with `{ "receipt": … }` or `{ "bundle": … }`. Returns `{ "ok": true|false }`. No API key required.
- The compliance export download (`/api/compliance/exports/:id/download`) returns the signed bundle JSON; the human-readable report lives in `bundle.payload.report`.

The signing key is the DashClaw instance's own Ed25519 key — generated and stored on first use, or supplied via the `DASHCLAW_SIGNING_KEY_JWK` env var. It is published once via the JWKS above; there is no separate key system.

**What a signature proves — and does not.** A valid receipt or bundle proves **integrity** (nothing was altered after issuance), the **verdict**, the **ruleset version** (a content hash of the source-of-truth), and the **issuer signature**. It does **not** prove **time-of-issuance** (`issuedAt` is issuer-asserted; there is no trusted timestamp) nor the **semantic correctness** of prose that carries no extractable operational token.

---

## Minimal SDK Flow

The canonical Node SDK is `dashclaw` on npm (version tracked in `sdk/package.json`). The canonical SDK file `sdk/dashclaw.js` exposes 39 public methods across the core runtime and extension surfaces (verify with `npm run sdk:count`).

The minimal governance loop uses only a small subset:

```javascript
import { DashClaw, GuardBlockedError } from 'dashclaw';

const claw = new DashClaw({ baseUrl, apiKey, agentId: 'deploy-agent-1' });

const decision = await claw.guard({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402 to production',
  risk_score: 85,
});

if (decision.decision === 'block') {
  throw new GuardBlockedError(decision);
}

const { action, action_id } = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402 to production',
  idempotency_key: claw.deriveIdempotencyKey({
    agent_id: 'deploy-agent-1',
    action_type: 'deploy',
    declared_goal: 'Deploy build #402 to production',
  }),
});

if (action?.status === 'pending_approval') {
  await claw.waitForApproval(action_id);
}

try {
  await deployBuild402();
  await claw.reportActionSuccess(action_id, 'Build #402 is live.');
} catch (error) {
  await claw.reportActionFailure(action_id, error.message);
  throw error;
}
```

See [`../../sdk/README.md`](../../sdk/README.md) for the full SDK catalogue and [`../sdk-parity.md`](../sdk-parity.md) for Node/Python parity status.

## Legacy Support

Legacy v1 paths are still routed through server-side rewrites in `next.config.js`:

- `/api/actions/signals` -> `/api/signals`
- `/api/actions/assumptions` -> `/api/assumptions`
- `/api/actions/assumptions/:assumptionId` -> `/api/assumptions/:assumptionId`
- `/api/actions/:actionId/approve` -> `/api/approvals/:actionId`

Both legacy and canonical paths are live. New integrations should target canonical routes.

## Approval Lifecycle (expiry)

A pending approval is only approvable while approving it can still release
something. Clients declare their poll window at request time with the optional
`approval_wait_seconds` field (integer, 5–86400) on `POST /api/guard` and
`POST /api/actions`; the hooks, MCP server, and both SDKs send their own
defaults (Python pretool hook: `DASHCLAW_APPROVAL_TIMEOUT`, default 30;
MCP/SDKs: 300). The server stamps
`approval_expires_at = now + approval_wait_seconds + 15 min retry grace` on the
pending row — the grace mirrors the operator-approval grant window, so
"operator approves after the hook timed out, agent retries the identical call"
keeps working. Clients that declare nothing get the conservative default
(300 s + grace); rows created before the expiry stamp existed expire 24 h after
creation.

Expiry is lazy (no cron): overdue rows flip to `expired` when the approval
queue is listed (`GET /api/actions?status=pending_approval`), when the action
is read (`GET /api/actions/:actionId`), or when someone tries to approve them.
Acting on an expired record returns **`410 Gone`** with
`code: "APPROVAL_EXPIRED"` — a truthful "this can no longer release anything"
instead of a fake success. `/approvals` renders expired approvals in a
distinct, non-approvable section. For `x402_purchase` actions the paired
purchase row is reconciled in the same lifecycle (`execution_status`:
`pending → expired` on expiry, `pending → denied` on deny), so dead approvals
stop reserving x402 budget.

## Optional Approval Channels

`waitForApproval()` resolves via any approval surface that posts to the same `/api/approvals/:actionId` endpoint:

- Dashboard approval queue and action detail surfaces
- CLI approval flows
- Mobile PWA approval route at `/approve`
- Telegram approvals when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` are configured
- Discord/webhook approval bridges when configured

Telegram inbound callbacks hit `POST /api/telegram/webhook`. See [`../telegram-setup.md`](../telegram-setup.md) for setup.
