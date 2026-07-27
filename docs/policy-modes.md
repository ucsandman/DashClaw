# Policy Modes

Policy Modes let you pick a **named operating contract** for an agent — "Claude Code Mode", "SOC 2 Mode", and so on — instead of hand-authoring individual guard policy types (`risk_threshold`, `require_approval`, `protected_path`, `rate_limit`, `x402_spend_limit`, …). Each mode **compiles to a pack of ordinary guard policies** and is applied through the normal policy storage path. Modes are additive: raw YAML import and every existing policy flow keep working unchanged.

## How it works

1. **Catalog** — the built-in modes live in code at `app/lib/policy-modes/catalog.ts` (human-facing metadata) and `app/lib/policy-modes/compile.ts` (the compiler). This is the source of truth.
2. **Compile** — `compileMode(modeId)` turns a mode into an array of guard policies in exactly the shape `validatePolicy` accepts and `insertPolicy` stores. Every compiled policy:
   - uses one of the 15 live `policy_type` values (nothing is fabricated),
   - carries a `_mode: <id>` tag **inside its rules JSON** — mirroring the existing `_shield` tag, so mode-generated policies are recognizable **without a schema migration**,
   - is named `[<Mode Name>] <title>` and applied **active**.
3. **Preview** — `POST /api/policies/modes/preview { mode_id }` returns the generated policy list, a decision summary, and a **best-effort friction simulation** (replays the mode's deterministic policies against recent action history). It writes nothing.
4. **Apply (import)** — `POST /api/policies/modes/import { mode_id }` (admin only) compiles the mode and inserts each policy via the normal repository. Applying a mode is **idempotent**: a policy whose name already exists is **reactivated and refreshed** to the mode's current compiled definition (so re-applying a mode whose policies were toggled off turns them back on), not silently skipped. The response reports `imported` (new) and `reactivated` (pre-existing) counts.

### API

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/policies/modes` | `GET` | org member | List the mode catalog; each entry includes `policy_count`. |
| `/api/policies/modes/preview` | `POST` | org member | `{ mode_id }` → `{ mode, policies, summary, friction }`. No writes. Unknown `mode_id` → `400`. |
| `/api/policies/modes/import` | `POST` | **admin** | `{ mode_id }` → compiles + inserts (active, `_mode`-tagged); existing-by-name policies are reactivated + refreshed (idempotent apply). `201`. Unknown `mode_id` → `400`; non-admin → `403`. |

### UI

`/policies` → **Modes** tab (the default). Mode cards show purpose + interruption level; selecting one opens a detail panel with the allow / warn / require-approval / block breakdown, a legend (**warn = record/surface · require approval = pause · block = deny**), the generated policy list, the friction preview (or an honest empty state when there's no history), and an admin-gated **Apply this mode**.

## What DashClaw can and cannot see

DashClaw governs only the actions an agent **reports** through the SDK or hooks. Routine work that is never reported is neither recorded nor gated. Destructiveness is derived from risk scoring of the declared goal (e.g. `rm -rf`, `drop table`) and the `reversible` flag — there is no dedicated "destructive" action type — so routine `cleanup` / `build` / `test` action types stay un-gated. Each mode's card lists its own visibility caveats.

## Built-in modes

| Mode | Interruption | Promise | Enforced (compiled policies) | Advisory only (surfaced, not enforced) |
|---|---|---|---|---|
| **Claude Code** | Low | Won't interrupt normal coding. | block ≥100 risk; warn ≥85; x402 ≥$5.00 approval / >$25.00 block; **warn** (record only) on external comms/sync/api — no interrupts; approval on deploy/migrate/workflow and explicit destructive types; protected governance/auth/secrets paths; rate-limit warn 250/30m + approval 650/60m | — |
| **OpenClaw** | Medium | Can help broadly, pauses before touching your life. | approval on messaging (telegram/discord/email/calendar), config writes + gateway, destructive types; any paid spend ≥$0.01; protected secrets/config paths; warn ≥85, block ≥100 | "personal data exposure" approximated by protected paths |
| **Custom Agent** | High | Unknown agents start boxed in. | approval on writes/network/elevation/memory-writes, external comms, destructive types; any paid spend; protected secrets/auth/config; warn ≥60, block ≥90; tight burst limit | "long-running autonomy" approximated by a rate limit |
| **Enterprise Strict** | High | Everything sensitive is reviewed and auditable. | approval on deploy/migrate, external APIs/sync/comms; protected auth/billing/customer-data/secrets; warn ≥70, block ≥90; paid-spend gate | "production/customer data" gated by paths + risk, not content classification |
| **SOC 2** | High | Actions produce evidence auditors can review. | approval on access/permission changes, exports, policy edits, deploy/migrate; protected secrets/auth/policy/customer-data; warn ≥80; non-fabrication gate on outputs vs a reported source of truth | **does not by itself make you SOC 2 compliant; makes no certification claim.** Source links / actor identity / before-after records are captured only when the agent reports them |
| **Research** | Low | Explore freely within a spend/privacy budget. | budget gate (approval above $5 paid spend); approval on external writes/posts/messages; protected secrets/personal-data; warn ≥85 | login walls and "scraping sensitive data" cannot be detected — surfaced as cautions |
| **Autonomous Overnight** | Medium | Can work while you sleep, but cannot run away. | runaway limits (warn 300/30m, approval 800/60m); paid-spend gate; approval on external actions + production changes; protected production/deploy/secrets; warn ≥80, block ≥95 | "scope drift" and "periodic summaries" are not natively enforceable — surfaced as cautions |
| **Deploy** | High | Shipping is deliberate. | **block** deploys from stale/diverged branches (branch-freshness) and below merge-ready test level (green-contract); approval on deploy/migrate/env-change; protected `.env`/migration paths; warn ≥80, block ≥90 | branch-freshness + green gates require the agent to report branch/test intel; "dirty branch", "backup", "explicit goal" are partly advisory |

## Policy packs (import-and-go)

Packs are plain YAML bundles of ordinary guard policies you import from `/policies` (or that are seeded for you). Unlike modes, a pack does not compile — its policies land as-is and you edit or delete them individually.

- **Catastrophe Only** — the **self-hosted default**, seeded automatically for every new org at its first migrate. Three catastrophe-only policies: **block** mass-destructive operations (`rm -rf`, `DROP TABLE`, force-push — server risk clamps to 100), **hold** secret-file writes (`.env`, `*.pem`, `*.key`, `secrets/**`) for one-click approval, and a **warn-only** rate limit (200 actions / 10 min) that nets runaways without interrupting. Everything else runs. It holds writes to secret files, not reads (the Read tool is not hooked today). Import it at `/policies` to retrofit an org that predates the seed.
- **Claude Code Starter** — the opt-in broader baseline: everything the catastrophe pack does, plus approval gates on network calls and package installs. Stack `layered-intelligence` on top once the baseline is in place.

## Notes

- **Honest language.** Compliance-oriented modes (SOC 2, Enterprise) describe what they *help enforce*; they never claim certification or guarantees.
- **No fabricated numbers.** The friction preview only simulates deterministic policy types and shows an empty state when there's no action history; it never invents counts.
- **Recognizing mode policies.** Filter on the `_mode` tag inside a policy's rules JSON to find policies a mode created. A first-class `source` column (for one-click "switch / remove mode") is a possible future enhancement.
