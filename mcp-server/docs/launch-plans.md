# Launch plans — stateful, verified launch tracking

A launch is a first-class local object: an ordered step checklist derived from
the [launch playbook](./launch-playbook.md) for the stack you declare. Steps
execute through the **existing guarded tools** — policy, the DashClaw gate,
approvals, and audit apply per-step, unchanged. **Plans track; they never
execute provider mutations and never bypass guard/policy/approvals.**

Completion is **verified, not self-reported**: every step declares a
machine-evaluable reality check, and `get_launch_status` re-evaluates it
against provider/local state on every call. A crashed session cannot leave
phantom "done" marks. Reality checks are reads — allowed by default, audited
like every other guarded read.

## Lifecycle

```
create_launch_plan  →  preflight_launch  →  [run steps via the guarded tools,
                                             re-checking get_launch_status]  →  verify_launch
```

1. **`create_launch_plan`** — derive the checklist for your stack.
2. **`preflight_launch`** — prove the stack is launchable before any money is
   spent (tokens present AND valid, mappings complete, Stripe mode sanity,
   Namecheap IP whitelisted).
3. Run each step with the tool named in its `toolHint` (the playbook explains
   every one). After any step — or any interruption — call
   **`get_launch_status`** for evaluated truth plus THE single next action.
4. **`verify_launch`** — end-to-end verification after the last step.

## Tools

### create_launch_plan

```json
{
  "project": "acme-crm",
  "environment": "production",
  "declared_stack": ["domain", "vercel", "neon", "stripe"],
  "domain": "acme.com"
}
```

Validates the stack (subset of `domain`, `vercel`, `neon`, `stripe`, `resend`,
`clerk`, `upstash`, `r2`, `sentry`, `posthog`; `domain` requires the `domain`
input) and returns the plan:

```json
{
  "status": "ok",
  "plan": {
    "id": "launch_4f6f…",
    "project": "acme-crm",
    "environment": "production",
    "declaredStack": ["domain", "vercel", "neon", "stripe"],
    "domain": "acme.com",
    "steps": [
      { "id": "domain.purchase", "title": "Purchase the domain acme.com (APPROVAL — always)",
        "toolHint": "purchase_domain", "dependsOn": [], "status": "pending",
        "realityCheck": { "kind": "domain-owned", "params": { "domain": "acme.com" } } },
      { "id": "vercel.project", "toolHint": "create_vercel_project", "…": "…" }
    ]
  }
}
```

### get_launch_status

```json
{ "plan_id": "launch_4f6f…" }
```

Loads the plan, evaluates every step's reality check, reconciles stored
status to evaluated truth, persists, and reports:

```json
{
  "status": "ok",
  "launch": {
    "plan_id": "launch_4f6f…",
    "steps": [
      { "id": "domain.purchase", "status": "done", "detail": "acme.com is registered in this Namecheap account." },
      { "id": "vercel.project", "status": "pending", "detail": "No vercel mapping for production — run map_provider_resource." }
    ],
    "counts": { "done": 1, "pending": 7, "blocked-on-approval": 0, "failed": 0 },
    "complete": false,
    "next_action": { "step_id": "vercel.project", "title": "Create the Vercel project and map it (create_vercel_project → map_provider_resource)", "tool_hint": "create_vercel_project" }
  }
}
```

Step statuses:

- `done` — the reality check holds right now.
- `pending` — not yet true; the step (or a dependency) still needs running.
- `blocked-on-approval` — a pending entry in the local approval queue
  (`list_pending_approvals`) matches the step's tool. DashClaw-decided
  approvals live in Mission Control; after approving there, re-run the step's
  tool and status moves on its own.
- `failed` — the reality check itself could not be evaluated (bad token,
  provider error); `detail` carries the error.

### preflight_launch

```json
{ "plan_id": "launch_4f6f…" }
```

Returns `pass`/`fail` plus per-check results with remediation hints:

| Check id | Verifies |
|---|---|
| `token:<provider>` | Credential env var present for every declared provider |
| `token-validity:<provider>` | A cheap authenticated read succeeds (skipped when the token or a required mapping is missing) |
| `mapping:<provider>` | `map_provider_resource` entry exists for the target environment |
| `stripe-mode` | Production launches have `STRIPE_LIVE_SECRET_KEY`; non-production have the test key |
| `namecheap-ip-whitelist` | Namecheap accepted the call (error 1011102 = re-whitelist your IP) |

### verify_launch

```json
{ "plan_id": "launch_4f6f…" }
```

End-to-end checks after the last step (each `pass`/`fail` with remediation):
`domain-resolves` (HTTPS probe of the domain), `deployment-ready` (latest
Vercel deployment READY), `env-vars-present` (every env key the plan wires,
by name — values are never fetched), `stripe-webhook-responding` (an enabled
endpoint exists), `email-domain-verified` (Resend domain verified).

## Reality checks

| Kind | Proves | Read it rides on |
|---|---|---|
| `domain-owned` | The domain is registered in this Namecheap account | `list_namecheap_domains` |
| `dns-points-at-app` | DNS has the Vercel record (A 76.76.21.21 / CNAME cname.vercel-dns.com) | `get_dns_records` |
| `provider-mapped` | A `map_provider_resource` entry exists for the environment | local state |
| `stripe-product-exists` / `stripe-price-exists` | Product/price exists in the target mode | Stripe list reads |
| `stripe-webhook-enabled` | An enabled webhook endpoint exists | `list_stripe_webhooks` |
| `env-var-present` | Required env var NAMES exist on the mapped Vercel app | Vercel env read (names only) |
| `deployment-ready` | Latest deployment is READY | `get_vercel_deployments` |
| `email-domain-exists` / `email-domain-verified` | Sending domain created / verified | `list_resend_domains` |

Note: the checklist folds a few adjacent playbook steps that share one
observable end state (e.g. `add_vercel_domain` + `set_dns_records` both land
as "DNS points at the app") — the playbook remains the human reference with
full granularity.

## Storage and resumability

One JSON file per plan under **`.dashclaw-local/launches/<id>.json`** (same
lock + atomic-rename conventions as the rest of the local state; override the
home with `DASHCLAW_LOCAL_HOME`). Plans are **local only** — nothing is sent
to the DashClaw dashboard.

Because status is evaluated against the world (not trusted from the file), a
fresh session can pick up any plan mid-flight: `get_launch_status` re-derives
done/pending/blocked from provider state, persists the reconciliation, and
points at the next action. Approval interruptions survive the same way —
approve, re-run the step's tool, and the next status call moves forward.
