# Architecture — what this thing actually is

Written for a smart non-expert. If you can explain the guard flow to someone
else after one read, this doc did its job.

## 1. What MCP actually is

MCP (Model Context Protocol) is a plug standard. Claude Code (or any other AI
agent app) is the **host**. It connects to small local programs called
**servers**. Each server exposes a set of named **tools** — functions with
typed inputs — that the model is allowed to call.

Think of the agent as a laptop and MCP as its USB hub: every server you plug
in adds a capability (a port). The model doesn't get your passwords or shell —
it only gets the tools each server chooses to expose.

**This repo IS one of those servers.** It runs on your PC as a normal process
(`node dist/index.js`), talking to the agent over stdio. Nothing is hosted in
the cloud; "installing" it just means telling your MCP client how to start the
process. Your provider tokens stay in environment variables on your machine.

## 2. What this server does

It is **one governed front door** to your real infrastructure: GitHub, Vercel,
Supabase, Stripe, Railway, Neon, Upstash Redis/QStash, Cloudflare R2, Namecheap, Sentry, PostHog, Clerk, Resend, and Twilio. The agent never calls those
APIs directly — every tool call goes through a single choke point
(`runGuarded`) that decides whether the action may run and writes an audit
entry either way.

```
agent (Claude Code)
   │  tool call, e.g. create_vercel_deployment
   ▼
offlocal MCP server (this repo, on your PC)
   │  build ActionContext: project + environment + provider + capability
   ▼
runGuarded ──────────────────────────────────────────────┐
   │ 1. resolve local policy (defaults + your rules)     │
   │ 2. risky action? → ask DashClaw /api/guard          │
   │      • allow            → continue                  │
   │      • require_approval → STOP, wait for human      │
   │      • block            → STOP                      │
   │      • DashClaw down    → STOP (fail closed)        │
   │ 3. only if allowed: call the real provider API      │
   │ 4. write EXACTLY ONE audit entry (success or not)   │
   │ 5. report the outcome back to DashClaw              │
   └─────────────────────────────────────────────────────┘
   ▼
real API (Vercel / Stripe / Namecheap / Neon / ...)
```

Blocked or approval-required actions **never reach the provider** — the agent
gets a structured response telling it what happened and what to do next.

## 3. Where DashClaw sits

DashClaw is the **authoritative gate**: it holds the policies, scores risk,
runs the approval queue, and mirrors the evidence trail. offlocal stays the
execution layer.

- Opt-in via `DASHCLAW_BASE_URL` + `DASHCLAW_API_KEY`.
- Every **risky** action (anything that isn't a plain read, plus anything
  flagged live) is sent to DashClaw's guard before execution.
- If DashClaw says `require_approval`, you approve or reject **in the DashClaw
  UI**; the agent then re-runs the action.
- If DashClaw is unreachable or unconfigured, risky actions **fail closed** —
  they refuse to run rather than run unguarded. Reads still work.

## 4. Governed vs ungoverned — the warning

The Stripe and Vercel **marketplace MCP plugins**, and raw CLIs like `vercel`
or `stripe`, talk to the same accounts but **bypass DashClaw entirely**. No
guard, no approval queue, no audit entry.

Rule of thumb: **for production mutations, use the offlocal tools.** Keep
ungoverned MCPs/CLIs for read-only inspection and dev conveniences — or
disable them in sessions where the agent works autonomously. A governance gate
only governs traffic that goes through it.

## 5. Capability & risk model

The policy engine reasons about **capabilities**, not tool names, so new tools
inherit safe defaults automatically:

| Capability | Meaning | Default treatment |
|---|---|---|
| `read` | Inspect things | Allowed everywhere |
| `write` | Create/update non-destructively | Allowed in dev/staging; approval in production; approval when live |
| `deploy` | Trigger a deployment | Allowed in dev/staging; approval in production |
| `env_change` | Change env vars / DNS records | Allowed in dev/staging; approval in production |
| `delete` | Remove a resource | Blocked everywhere by default |
| `destructive_sql` | DROP/TRUNCATE/DELETE/ALTER | Blocked everywhere by default |
| `purchase` | Spend real money (domain purchase) | **Approval required — always** |

`purchase` is special **by design, not by policy**: even an explicit `allow`
rule is clamped back to `approval_required` (see `clamp:purchase` in
`src/policy.ts`). There is no configuration that lets an agent spend money
without a human.

## 6. Credentials

Tokens are read from environment variables at call time and are **never
persisted** to `.offlocal/` or sent to DashClaw. See [.env.example](../.env.example)
for the full list (`GITHUB_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
`STRIPE_TEST_SECRET_KEY` / `STRIPE_LIVE_SECRET_KEY`, `RAILWAY_TOKEN`,
`NEON_API_KEY`, `UPSTASH_EMAIL`, `UPSTASH_API_KEY`, `QSTASH_TOKEN`,
`QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `CLOUDFLARE_API_TOKEN`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SENTRY_AUTH_TOKEN`,
`POSTHOG_PERSONAL_API_KEY`, `CLERK_SECRET_KEY`, `RESEND_API_KEY`, `TWILIO_AUTH_TOKEN`, `NAMECHEAP_API_USER` / `NAMECHEAP_API_KEY` /
`NAMECHEAP_CLIENT_IP` / `NAMECHEAP_SANDBOX`, `DASHCLAW_*`).

Some tool **results** legitimately contain secrets — that is the point of
`get_neon_connection_uri` (a `postgres://` URL with a password) and
`create_stripe_webhook` (a `whsec_` signing secret). Those values go to the
calling agent **only**. A sanitizer strips secret-shaped strings
(`postgres://...`, `sk_live_...`, `whsec_...`, `FOO_TOKEN=...`) from every
audit summary and every DashClaw payload, and tests assert it
(`test/providers.test.ts`, `test/dashclaw.test.ts`).
Sentry client-key tools intentionally return only public DSNs suitable for
`SENTRY_DSN`; returned secret DSNs are stripped before the tool result.
PostHog project tools intentionally return the public project token for
`NEXT_PUBLIC_POSTHOG_KEY`; private `secret_api_token` fields are stripped before
the tool result.
Upstash Redis env tools return REST tokens for app wiring only; those tokens are
kept out of audit summaries and DashClaw payloads.
QStash env tools return the app token and signing keys for job delivery and
request verification; QStash tokens, signing keys, schedule bodies, and
forwarded headers are kept out of audit summaries and DashClaw payloads.
Cloudflare R2 env tools return S3-compatible app credentials from
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; Cloudflare API tokens and R2 secret
access keys are kept out of audit summaries and DashClaw payloads.
Clerk tools return public publishable-key env wiring and user/domain summaries;
`CLERK_SECRET_KEY` is never returned, persisted, audited, or sent to DashClaw.

Next: the [launch playbook](launch-playbook.md) walks an entire
domain-to-production launch through these tools.
