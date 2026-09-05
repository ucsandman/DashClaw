# Release and deployment checks

**Last regenerated:** 2026-07-10 · **Commit:** `eb9e6ecc`

This doc owns three things and nothing else: the **release gate** (`npm run release:check`),
the **deployment preflight profiles** (self-hosted vs hosted), and the **entry-path
drill layer**. It deliberately carries **no hardcoded counts** — route totals, SDK
method counts, MCP tool/resource counts, and table counts drift every ship, so the
single sources of truth are:

- **`PROJECT_DETAILS.md`** — canonical system map (route inventory, SDK/MCP surface).
- **`docs/api-inventory.json`** — generated route inventory (`npm run api:inventory:generate`).
- `scripts/check-doc-counts.mjs --strict` — the gate that reconciles every cited
  count in the docs that *do* own counts against those sources. If you need a number,
  read it there, do not copy it here.

## The release gate — `npm run release:check`

`npm run release:check` (alias: `npm run production:check`) is the repository's
release gate. A green **static** run means the checked revision passed the listed
local gates; it does not establish an uptime SLA, external-system behavior, or
production readiness for a specific deployment. The script
runs every static check CI runs, with the same flags. It writes a machine-readable
`release-check-report.json` (gitignored) with per-gate pass/fail, duration, and the
commit SHA, and prints its path.

### Static gates (always run)

| Gate | Command |
|---|---|
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| docs | `npm run docs:check` |
| openapi | `npm run openapi:check` |
| api-inventory | `npm run api:inventory:check` |
| doc-counts | `node scripts/check-doc-counts.mjs --strict` |
| route-sql | `npm run route-sql:check` |
| surface | `npm run surface:check` |
| version-hardcodes | `npm run version:check` |
| version-sync | `npm run version:sync:check` |
| contracts | `npm run contracts:check` |
| guide-drift | `npm run guide:drift:check` |
| security-scan | `node scripts/security-scan.js` |
| vitest | `npx vitest run` (full suite) |
| sdk-integration | `npm run sdk:integration` |
| sdk-integration-python | `npm run sdk:integration:python` |
| build | `npm run build` |
| script-syntax | `npm run scripts:check-syntax` |
| smoke | `npm run test:smoke` (Playwright) |
| prod-audit | `npm audit --omit=dev --audit-level=moderate` |

### Live gates (`npm run release:check -- --live`)

The live suite mirrors CI's separate `startup-smoke` job: it boots a real server
against a real Postgres and runs the behavioral proofs. It is **opt-in** so a
laptop run does not require a database. Without `--live`, `release:check` prints one
explicit line noting the live suite was skipped and that CI still covers it — a
visible decision, not a silent gap.

`--live` requires `DATABASE_URL`. The `startup:smoke` gate self-spawns its own
server; `policy-smoke` and `cross-org-smoke` need a server **already running** at
`--base-url` (default `http://127.0.0.1:3000`, e.g. `npm run start`), or the gate
fails with that instruction.

| Gate | Command |
|---|---|
| live-auto-migrate | `node scripts/auto-migrate.mjs` |
| live-startup-smoke | `npm run startup:smoke` |
| live-policy-smoke | `node scripts/policy-smoke.mjs <base-url>` |
| live-cross-org-smoke | `node scripts/cross-org-smoke.mjs <base-url>` |

## Deployment preflight profiles

Run the profile that matches the target **before** deploying.

### Self-hosted

The self-host path needs only a workspace token and a Postgres URL (no LLM key).
Verify the instance is ready with the doctor:

```bash
npm run doctor            # or GET {baseUrl}/api/doctor on a running instance
npm run db:migrate        # after any pull that touches schema/schema.js or drizzle/*.sql
```

### Hosted (multi-tenant, `DASHCLAW_HOSTED=true`)

Hosted deployments have a stricter preflight — `npm run hosted:check-ready`
(`scripts/check-hosted-ready.mjs`) **hard-fails** on every secret the runtime needs
to boot and let anyone sign in:

- `DATABASE_URL` — all persistence.
- `NEXTAUTH_SECRET` — middleware `getToken` cannot verify any session without it.
- `NEXTAUTH_URL` — seeds the middleware host allowlist and OAuth callback URLs.
- `ENCRYPTION_KEY` — must be **exactly 32 bytes**; `app/lib/encryption.ts` throws otherwise.
- a sign-in **provider pair** — Google, GitHub, or OIDC (or `DASHCLAW_LOCAL_ADMIN_PASSWORD`
  for solo self-host); zero providers means nobody can sign in.
- `TURNSTILE_SECRET_KEY` — public trial mint is abuse-open without it.
- `DASHCLAW_API_KEY` — seeded admin key, format `oc_live_<32 hex>`.

Redis (`REDIS_URL` / `UPSTASH_REDIS_REST_URL`) is a **loud warning, not a blocker**:
rate limiting (`app/lib/hosted/rate-limit.ts`) and the realtime bus
(`app/lib/events.ts`) fall back to in-memory, which is only lossy across serverless
cold starts. `HOSTED_CLEANUP_SECRET`/`CRON_SECRET` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
are warnings with explicit "what breaks" text. Full runbook:
`docs/hosted-deployment-runbook.md`.

## Entry-path drills

CI's `build-and-test` and `startup-smoke` jobs exercise the app from source on
dev-imaged runners; they do **not** cover the distribution path on a factory-fresh
machine. The drills do (`scripts/drills/README.md`):

- `npm run drill:fresh-windows` / `npm run drill:fresh-linux` — a release touching
  `cli/**`, `scripts/setup.mjs`, or the `up` path must run the matching fresh-machine
  drill first.
- `npm run drill:hosted` — a release touching hosted mint/export/import must run the
  hosted-stranger drill.

A drill failure is a broken ship: fix on the spot and log it in the maintainer log.
