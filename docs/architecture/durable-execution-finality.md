# Durable execution finality

**Status:** Current implementation contract

**Updated:** 2026-09-05

**Supersedes:** the 2026-05-13 draft design associated with [issue #105](https://github.com/ucsandman/DashClaw/issues/105)

DashClaw keeps two related facts about governed work:

- an **execution claim** says that one caller won authority to begin one attempt;
- an **outcome** says what the caller or reconciliation sweep later recorded about that attempt.

Neither fact makes an external tool call exactly once. The target system remains
outside DashClaw's database transaction. A payment, deployment, file write, or
other effect can succeed even when the caller loses the response or cannot
record the outcome.

For the broader trust boundary and rollout rules, see
[Trust and failure model](trust-and-failure-model.md). For the wire-level action
contract, see [Runtime API](runtime-api.md).

## Current execution flow

1. The client obtains a current guard decision and creates or reuses its bound
   action record.
2. Immediately before invoking the callback, an enforcing client sends
   `PATCH /api/actions/:actionId` with:

   ```json
   {
     "claim_execution": true,
     "attempt_id": "a fresh UUID",
     "agent_id": "the bound agent",
     "act": { "the": "same scrubbed act used for guard and action creation" }
   }
   ```

3. The server atomically locks the candidate action, validates the guard and
   act binding, consumes any operator or plan authority, and stores the attempt
   claim. Exactly one concurrent caller can win new execution authority.
4. Only a confirmed claim acknowledgement permits the callback to begin.
5. After the callback returns or throws, the client reports a terminal outcome.

The claim is bound to the organization, action, agent, authenticated principal,
act hash, guard decision, and fresh attempt ID. The action must still be
`running`, have a `pending` outcome, use execution protocol 1, and have no prior
claim. A repeat, conflicting, stale, cross-tenant, or malformed claim is denied.
A lost claim response is ambiguous: the database may have committed the claim,
so the caller must reconcile rather than request fresh authority automatically.

## Outcome API

`GET /api/actions/:actionId/outcome` returns the action's current durable outcome:

```json
{
  "action_id": "act_7f3a2b",
  "status": "completed",
  "outcome_at": "2026-09-05T16:00:00Z",
  "summary": "Completed the governed operation",
  "error_message": null,
  "progress": null,
  "elapsed_ms": 4823
}
```

`POST /api/actions/:actionId/outcome` accepts one of these agent-reported
terminal states:

| State | Meaning |
|---|---|
| `completed` | The caller reports that the callback completed. |
| `partial` | The caller reports partial progress and supplies a progress object. |
| `failed` | The caller reports failure and supplies an error message. |

`lost_confirmation` is reserved for the server sweep. Outcome writes are
one-shot: the repository updates only a row whose `outcome_status` is still
`pending`. Competing or repeated terminal writes receive a conflict instead of
rewriting history. The route also refuses a reported outcome for actions whose
lifecycle is blocked, awaiting approval, cancelled, or already failed.

A successful outcome write closes an open lifecycle consistently:

| Outcome | Lifecycle status |
|---|---|
| `completed` | `completed` |
| `partial` | `failed` |
| `failed` | `failed` |
| `lost_confirmation` | `unknown` |

An already-terminal lifecycle stays authoritative, and the first closure
timestamp and closure provenance are preserved.

## Compatibility with legacy lifecycle updates

Older integrations close actions through `PATCH /api/actions/:actionId` by
setting the lifecycle `status`. That path implicitly sets a still-pending
outcome to `completed` or `failed`. This keeps legacy records internally
consistent, but it does not retroactively add an atomic execution claim.

Protocol rollout is explicit:

- A current server advertises `execution_claim_required: true` and
  `claim_protocol: 1`. An advertised malformed or unsupported contract fails
  closed.
- Hooks and OpenClaw preserve their prior guard and approval behavior when the
  advertisement is entirely absent. This compatibility mode has no atomic
  one-attempt claim. `DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` rejects that legacy
  response after an operator upgrades the server.
- Node `runGoverned()` and Python `run_governed()` always require a confirmed
  protocol-1 claim. They stop before the callback on an older server.

## Reconciliation and retries

An outcome is an audit assertion, not proof about the remote system. These
states guide investigation but do not independently authorize another effect:

| Observed state | Required interpretation |
|---|---|
| No confirmed claim | Do not invoke. Resolve whether the claim committed. |
| `pending` after a confirmed claim | Attempt may still be running or its result may be unreported. |
| `completed` | DashClaw recorded completion; verify target state when the consequence warrants it. |
| `failed` | The callback reported failure; the external system may still have applied some or all of the effect. |
| `partial` | Reconcile the recorded progress and target state before cleanup or another attempt. |
| `lost_confirmation` | Completion is unknown. Reconcile; never presume the effect did not happen. |

Safe automatic retry requires a target-system primitive such as an idempotency
key, compare-and-set token, transaction identifier, or authoritative read-back.
DashClaw's action idempotency key deduplicates ledger creation. It does not
deduplicate the external effect.

The governed SDK helpers preserve this distinction:

- callback failure is reported as a failed outcome and rethrown;
- completion-report failure after a successful callback raises a distinct
  confirmation error and requires reconciliation;
- claim rejection, loss, or malformed acknowledgement stops before callback
  execution.

## Stale outcome sweep

The outcome sweep atomically changes old `pending` outcomes to
`lost_confirmation` and reconciles an open lifecycle to `unknown`. It skips rows
whose legacy lifecycle is already terminal. The same `outcome_status =
'pending'` predicate resolves races between an agent report and the sweep: one
wins and the other observes a terminal row.

The sweep improves ledger visibility. It cannot determine whether an external
effect happened, and it does not grant replacement execution authority.

## Implementation references

- [Execution-claim repository](../../app/lib/repositories/actions.repository.execution.ts)
- [Action claim route](<../../app/api/actions/[actionId]/route.ts>)
- [Outcome repository](../../app/lib/repositories/actions.repository.outcome.ts)
- [Outcome route](<../../app/api/actions/[actionId]/outcome/route.ts>)
- [Node governed helper](../../sdk/dashclaw.js)
- [Python governed helper](../../sdk-python/dashclaw/client.py)
- [Audit remediation and verification](../audit-remediation-2026-09-05.md)
