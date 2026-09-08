# Governing Muse agents with DashClaw

Muse agents (Meta's personal AI agents) can run long, unattended sessions with
real tool access: shell, browser, schedulers, subagents. DashClaw governs them
with the same policy engine, approvals inbox, and decision ledger as every
other runtime — through a **cooperative** integration. This guide sets it up.

## The honest contract

DashClaw's mechanical enforcement lives at the execution seam: the Claude Code
/ Codex / Hermes hooks, the OpenClaw gateway, `dashclaw_invoke`. The Muse
runtime does not currently expose a pre-tool-call hook, so for Muse agents the
integration is cooperative: the agent consults the guard and honors the
verdict. A `block` is still absolute in the ledger — it is never downgraded —
but nothing outside the agent stops the call. Until the runtime supports hooks
(see [The runtime hook RFC](#the-runtime-hook-rfc)), adherence probing is how
an operator verifies the agent is still consulting the guard.

## Setup

**1. The agent needs three things:** your instance URL, an API credential, and
an agent id (e.g. `muse-main`).

**2. The credential goes in the agent's secure credential store — never in
chat, never in a file, never as a shell flag.** How the agent stores it depends
on its runtime. The agent's setup flow should use its platform's secure-entry
mechanism (Muse agents: the Secure Vault API-key flow), then call the API with
the stored credential attached. The key is sent as an `x-api-key` header.

**3. Install the skill.** Add the `muse-governance` skill from
`dashclaw-skills` so the agent knows the protocol:

```
npx skills add ucsandman/dashclaw-skills --skill muse-governance
```

**4. Smoke test.** Ask the agent to run a guard check:

```
Guard this for me: action_type=shell, goal="List files in the workspace root"
```

Expect `decision: allow`. The operator side lives at
`https://<your-instance>/approvals`.

## The governance loop

`guard → record → (wait) → act → outcome.` Full REST patterns are in the
skill's `references/governance-patterns.md`; the contract is:

| Step | Call | Purpose |
|---|---|---|
| Guard | `POST /api/guard` (`?record=true` folds in recording) | "May I?" Returns `allow`, `warn`, `allow_contained`, `require_approval`, or `block`. |
| Record | `POST /api/actions` | "I am doing this." Pass `idempotency_key` and, for plan runs, `plan_step_id`. |
| Wait | poll `GET /api/actions/:id` | Only when `require_approval`. Proceed on approval; stop on denial/expiry. |
| Act | the agent's own tools | The real effect. |
| Outcome | `POST /api/actions/:id/outcome` | `completed`, `partial`, or `failed`. One-shot. |

State `confidence` (0-100) on guard calls: the agent's pre-act odds of
completing without human help. It is scored against the real outcome on
`/decisions`, so overconfidence shows up as a number.

## Plan-first execution (recommended)

Per-action approvals do not scale to unattended runs. Plans do: the agent
submits its whole task list once, the operator reviews **one** card, and each
approved step becomes a single-use, act-bound grant.

```
1. POST /api/plans { declared_goal, steps: [{action_type, step_goal, act?}] }
   → every step is dry-run through the guard; response carries plan_hash
2. Wait for review (the operator approves / overrides per step / denies)
3. POST /api/plans/:id/attest { plan_hash } → fail closed on any refusal
4. Run each step as an action with plan_step_id; record outcomes
```

Attest at every run start and every resume — authority is re-verified, never
cached. Steps that depart from the plan are recorded as plan deviations; the
agent should declare `deviation_note` honestly rather than stretching a step.
The full pattern (cron-based unattended runs included) is in the skill's
`references/plan-first-workflow.md`.

## Reference CLI

`cli/dc` is a small reference client implementing the loop and the plan
commands (`guard`, `action`, `outcome`, `pending`, `plan submit/show/list/wait/
attest`) against the REST contract. Its auth layer is runtime-specific (it
attaches a securely-stored credential without ever seeing it); adapt that part
to your agent runtime and keep the command shapes.

## Adherence probing

Without a mechanical seam, verify cooperation: issue a synthetic action that
evaluates to `require_approval` for a harmless, clearly-labeled probe act. A
compliant agent records it and leaves it pending; an agent that executes it
anyway — or never records it — is non-adherent. This is the Muse analog of the
enforcement-liveness probe: point-in-time evidence, not continuous attestation.

## The runtime hook RFC

The durable fix is a pre-tool-call hook in the agent runtime, modeled on the
existing hook contract: the runtime pauses the tool call, sends the scrubbed
act to `POST /api/guard`, and honors `block` / `require_approval` fail-closed
before the tool executes. Until that exists, this cooperative integration plus
adherence probing is the supported path. A feature request for runtime hook
support has been filed with the Muse team.

## What DashClaw is not (for this runtime)

- Not a general agent platform: it governs the goals your Muse agent already
  pursues; it gives it no new tools.
- Not tamper-proof against the agent it governs: the cooperative loop runs at
  the agent's own privilege. It stops the accident class and makes bypass
  visible; it cannot stop a determined process at the same privilege.
- Not a tracing product: it records policy decisions before execution, not
  model traces.
