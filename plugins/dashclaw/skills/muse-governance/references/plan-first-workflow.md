# Plan-first workflow

Plans amortize approvals across long runs: the operator reviews **one** card
instead of one per action. Approved steps become single-use, act-or-goal-bound,
TTL-bound authority that your actions consume as they run.

## The pattern

```
submit -> wait for review -> attest at run start -> spend steps -> outcomes
```

### 1. Submit

```bash
dc plan submit \
  --goal "Nightly deploy run for the API service" \
  --steps-file steps.json \
  --ttl-minutes 180
```

`steps.json` — an ordered list; every step is dry-run through the full guard
pipeline server-side at submission:

```json
[
  {"action_type": "shell", "step_goal": "Run the test suite on build 402"},
  {"action_type": "deploy", "step_goal": "Deploy build 402 to staging",
   "act": {"target": "staging", "build": "402"}}
]
```

Step fields: `action_type`, `step_goal`, optional `act` (the exact payload;
scrub secrets client-side — the reference CLI redacts secret-looking keys).
The response returns `plan_id`, `plan_hash` (pinned at submission), `status`,
and per-step `preview_decision` / `preview_risk_score` / `grant_status`.

### 2. Wait

```bash
dc plan wait <plan_id> --timeout 600 --interval 10
# exits 0 on approved/partially_approved, 2 on denied/revoked, 3 on timeout
```

The operator sees one card on `/approvals` with per-step overrides. Nothing
auto-approves. A denied step is raised to `block` on match for the plan's TTL;
revocation (`verdict: revoke`) takes effect before any unclaimed attempt.

### 3. Attest (fail closed before the first act)

```bash
dc plan attest <plan_id>
# {"ok": true, "plan_id": ..., "plan_hash": ..., "expires_at": ..., "steps_remaining": N}
```

Any refusal — `not_approved`, `expired`, `revoked`, `hash_mismatch`,
`not_found` — means **stop**. Do not act on a plan you cannot attest. Attest
again when resuming a run after any gap (a cron wake, a new session).

### 4. Spend steps

Record each step's action bound to its step:

```bash
ACTION=$(dc action --action-type deploy \
  --goal "Deploy build 402 to staging" \
  --plan-step-id ps_abc123 | jq -r .action_id)
# ... do the work ...
dc outcome "$ACTION" --status completed
```

When a later action matches an approved step and would otherwise evaluate to
`require_approval`, the guard selects the step read-only and returns `allow`
with `builtin:plan_grant` provenance — no second interruption. Each grant is
single-use; the execution claim consumes it atomically with one attempt.

### 5. Stay honest: deviations

While a plan is live, every guarded action is classified against its steps. A
departure — different payload (`act_substitution`), wider scope
(`scope_escape`), different goal (`goal_drift`), no matching step
(`unplanned_action`), or a second spend of a consumed step (`budget_overrun`)
— is recorded as a plan deviation and echoed on the guard response.

- Declare honestly: pass `plan_step_id` / `deviation_note` on your actions.
  Self-reports are capped at low severity and can never suppress detection.
- Do not stretch a step to cover new work. If the run needs a new step, that
  is a new approval, or an operator-accepted amendment
  (`resolve_deviation` with `amend_plan: true`).

## Unattended runs (cron pattern)

A run that must survive the night:

1. Submit the plan; notify the operator it awaits review.
2. Schedule a watcher (cron) that runs `dc plan wait` with a long timeout,
   then attests.
3. On `ok: true`, execute the steps; on any refusal, stop and report.
4. Each wake re-attests before acting — authority is re-verified, never cached.

## What plans do not do

- A plan grant never downgrades a `block`.
- Deny-binding is org-wide by design (agent identities are self-asserted), so
  a denied step blocks the act for every agent in the org for the TTL.
- Attestation proves the *authority* is still good, not that the world is
  unchanged. Reconcile external state before retrying anything uncertain.
