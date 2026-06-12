# /goal: DashClaw Durable Execution Finality Release Readiness

## Goal

Audit and harden the six-phase Durable Execution Finality update so DashClaw is safe for a new user to install, migrate, run, integrate, and understand.

This is not a feature build. This is a release-readiness pass across docs, API contracts, migrations, startup/setup scripts, SDKs, skills, plugin packaging, and new-user onboarding.

By the end, the repo should accurately describe and verify the shipped Durable Execution Finality system:

- `POST/GET /api/actions/:actionId/outcome`
- `outcome_status` five-state machine
- repository-level one-shot outcome transitions
- `lost_confirmation` cron sweep and signal delivery
- Node SDK outcome helpers
- Python SDK parity
- `/decisions` outcome UI and badges
- idempotency-key helpers and route short-circuit behavior
- Vercel daily cron tradeoff vs hourly operator option
- generated skills/plugin/package info that matches the actual repo

## Context

The six phases have already shipped to `main`.

Recent commits:

| Phase | Commit | Summary |
| --- | --- | --- |
| 1 | `25599c35` | Schema + `POST/GET /api/actions/:id/outcome` + repo + tests + docs |
| 2 | `fdc45bf8` | `/api/cron/outcome-sweep` + `signal.detected lost_confirmation` + per-org timeout |
| 3 | `9a5e7930` | Node SDK: `reportActionOutcome`, `getActionOutcome`, convenience helpers |
| 4 | `1593e342` | Python SDK snake_case parity |
| 5 | `63c8c73c` | `/decisions` outcome filter, row badge, detail badge, `OutcomeBadge` component |
| 6 | `5407b6ca` | Idempotency keys: route short-circuit + Node/Python `deriveIdempotencyKey` helpers |

Reported verification from the feature build:

- `npm run lint` clean
- `npm run docs:check` clean
- `npm run route-sql:check` clean, still 85 vs 90 baseline with no new direct SQL in routes
- `npm run openapi:check` clean
- `npm run api:inventory:check` clean
- `npm test --run` full suite: 1837 pass, 5 skip across 228 files, 28 new tests
- Python SDK tests: 49 pass

Known shipped tradeoff:

- Vercel cron is registered daily, not hourly, to stay on Hobby tier. The spec allows operators to run hourly externally.

Open follow-up explicitly not shipped:

- Mission Control instrument trail counters for `pending` and `lost_confirmation` totals.
- `/operations/feed` surfacing for `lost_confirmation`.

Current local repo state before this goal may include uncommitted generated or AgentLens-related files:

- `CLAUDE.md` modified
- `.agents/` untracked
- `CLAUDE.NEW.md` untracked
- `plugins/` untracked

Do not delete or clobber these. Inspect them and decide whether they are expected generated assets, stale artifacts, or docs that need to be reconciled. If uncertain, document instead of deleting.

## Non-Negotiable Safety Rules

- Do not deploy.
- Do not run live SDK calls against production unless the command is already part of a safe local verification script and uses test/local env.
- Do not touch real Vercel, Neon, Stripe, OAuth, Telegram, Discord, GitHub settings, or external accounts.
- Do not rotate or reveal secrets.
- Do not commit automatically unless explicitly asked after this goal completes.
- Do not delete generated or untracked files without explicit human approval.
- Do not edit generated artifacts directly if the repo has a generator for them. Regenerate instead.
- Preserve the repository pattern. Do not add direct SQL in route handlers.
- Preserve org scoping via `getOrgId(request)` and existing auth helpers.
- Preserve idempotency semantics. Do not weaken one-shot transition guarantees.
- Keep docs honest about the daily Vercel cron tradeoff.
- Keep OpenClaw plugin/skill info grounded in actual package manifests and current OpenClaw docs, not memory.

## Preparation

Read these first:

- `CLAUDE.md`
- `PROJECT_DETAILS.md`
- `README.md`
- `QUICK-START.md`
- `docs/architecture/durable-execution-finality.md`
- `docs/sdk-parity.md`
- `sdk/README.md`
- `sdk-python/README.md`
- `packages/openclaw-plugin/package.json`
- `packages/openclaw-plugin/README.md`
- `packages/openclaw-plugin/openclaw.plugin.json`
- `plugins/dashclaw/.mcp.json`
- `plugins/dashclaw/.codex-plugin/plugin.json`
- `plugins/dashclaw/skills/dashclaw-governance/SKILL.md`
- `plugins/dashclaw/skills/dashclaw-platform-intelligence/SKILL.md`
- `plugins/dashclaw/skills/dashclaw-platform-intelligence/references/api-surface.md`
- `plugins/dashclaw/skills/dashclaw-platform-intelligence/references/platform-knowledge.md`
- `plugins/dashclaw/skills/dashclaw-platform-intelligence/references/troubleshooting.md`
- `vercel.json`
- `scripts/auto-migrate.mjs`
- `scripts/startup-smoke.mjs`
- `scripts/setup.mjs`
- `scripts/init-self-host-env.mjs`
- `app/api/actions/[actionId]/outcome/route.js`
- `app/api/cron/outcome-sweep/route.js`
- `app/lib/repositories/actions.repository.js`

Also inspect package scripts in `package.json` and verify the current startup path for a fresh clone.

## Required Work

### 1. Create a release-readiness report

Create:

`DURABLE_FINALITY_RELEASE_READINESS_REPORT.md`

Include:

- What shipped across all six phases.
- Current repo cleanliness and uncommitted files.
- Docs/API/SDK/plugin/skill/startup/migration findings.
- P0/P1/P2 issues found, if any.
- Commands run and exact outcomes.
- What is safe to claim now.
- What remains follow-up.

Acceptance:

- The report is specific enough that Wes can review it without reading every diff.
- It separates verified facts from recommendations.

### 2. Validate API surface and docs alignment

Verify that these agree with implementation:

- OpenAPI generated output and check script.
- API inventory generated output and check script.
- `PROJECT_DETAILS.md` route tables.
- `docs/architecture/durable-execution-finality.md`.
- `README.md` and `QUICK-START.md` if they mention actions, outcomes, finality, cron, SDK, setup, or approval flow.
- Skill reference files, especially platform-intelligence `api-surface.md` and troubleshooting.

Required checks:

```bash
npm run openapi:check
npm run api:inventory:check
npm run docs:check
```

If a generated contract is stale, regenerate with the repo's existing generator, inspect the diff, and document why it changed.

Acceptance:

- No stale route or SDK claims remain.
- Daily Vercel cron vs hourly external operator option is documented consistently.
- `lost_confirmation` is explained as terminal recovery when confirmation is missing, not as generic failure.

### 3. Validate migrations and fresh-install path

Inspect and test the migration path for a new user.

Minimum checks:

- `schema/schema.js` includes the finality columns/constraints expected by the feature.
- `drizzle/*.sql` includes needed schema changes.
- `scripts/auto-migrate.mjs` applies the changes idempotently.
- `npm run db:migrate` is documented where new users will see it after pulling schema changes.
- `.env.example` has every env var needed for local setup, cron timeout, SDK/plugin docs, and startup smoke, without secrets.

Run when safe:

```bash
npm run db:migrate
npm run startup:smoke
```

If local env points at production or any non-safe database, do not run the migration. Document the blocker and create a safer verification path instead.

Acceptance:

- New-user migration instructions are clear.
- Migration idempotency is verified or blocked with a named reason.
- No doc tells users to skip migrations after schema changes.

### 4. Validate startup and one-command setup experience

DashClaw should have a credible path from fresh clone to working local instance.

Inspect and, where safe, run:

```bash
npm install
npm run setup
npm run doctor
npm run dev
npm run startup:smoke
```

Do not leave long-running dev servers alive after verification.

Check:

- `install-windows.bat`, `install-mac.sh`, `scripts/setup.mjs`, `scripts/init-self-host-env.mjs`, `QUICK-START.md`, and `README.md` agree.
- The new Durable Finality feature does not require hidden manual SQL or undocumented env.
- `vercel.json` cron cadence is documented honestly.
- There is a clear local health or smoke path.

Acceptance:

- If `npm run setup` is the one-command setup path, docs say so.
- If setup is not enough, document the exact gap and add a follow-up task.
- No stale startup command remains in user-facing docs.

### 5. Validate SDK parity and examples

Inspect Node SDK and Python SDK exported surfaces.

Verify these are documented and tested consistently:

Node SDK:

- `reportActionOutcome`
- `getActionOutcome`
- convenience helpers for completed, partial, failed, lost confirmation if implemented
- idempotency key helper, e.g. `deriveIdempotencyKey`

Python SDK:

- snake_case parity for outcome reporting and retrieval
- idempotency key helper
- equivalent status/result payload naming

Run:

```bash
npm run sdk:integration
npm run sdk:integration:python
```

If those scripts require live env and are unsafe, inspect script behavior and run only safe unit-level tests. Document what was skipped and why.

Acceptance:

- `docs/sdk-parity.md`, `sdk/README.md`, and `sdk-python/README.md` agree with code.
- Examples use the current API paths and status names.
- Idempotency-key guidance is clear and not overcomplicated.

### 6. Validate OpenClaw plugin and packaged skills

The plugin and skills need to match the current product and current OpenClaw packaging reality.

Inspect:

- `packages/openclaw-plugin/package.json`
- `packages/openclaw-plugin/openclaw.plugin.json`
- `packages/openclaw-plugin/README.md`
- `plugins/dashclaw/.mcp.json`
- `plugins/dashclaw/.codex-plugin/plugin.json`
- `plugins/dashclaw/skills/*/SKILL.md`
- `plugins/dashclaw/skills/*/references/*.md`
- `.agents/plugins/marketplace.json`

Check for:

- stale package names
- stale install commands
- stale config keys, especially `dashclawUrl`, `baseUrl`, `DASHCLAW_BASE_URL`, `DASHCLAW_URL`, `dashclawApiKey`, `apiKey`, `DASHCLAW_API_KEY`
- stale API endpoints
- missing outcome/finality knowledge
- false claims about capabilities
- generated artifacts that should be regenerated, not edited

If the repo provides a validation script for platform-intelligence or plugin packaging, run it. Likely candidates:

```bash
npm run livingcode:refresh
node plugins/dashclaw/skills/dashclaw-platform-intelligence/scripts/diagnose.mjs
node plugins/dashclaw/skills/dashclaw-platform-intelligence/scripts/validate-integration.mjs
```

Only run scripts after inspecting whether they make external calls or write generated artifacts. If they write generated artifacts, inspect diffs afterward.

Acceptance:

- Skills and plugin docs know about Durable Execution Finality.
- OpenClaw config names are accurate and consistently explained.
- No obsolete package/install instruction remains.

### 7. Validate UI claims and outcome badge behavior

Inspect the `/decisions` implementation for:

- outcome filter behavior
- row badge behavior
- detail page badge behavior
- `OutcomeBadge` status naming and colors
- accessibility and responsive basics for new badge/filter controls

Do not do a broad redesign. Fix only correctness or obvious accessibility issues.

If safe and not too slow, run a targeted UI smoke or unit test. Otherwise rely on existing test suite plus code inspection and report limits.

Acceptance:

- UI labels match backend status names.
- `lost_confirmation` copy is clear and not alarmist.
- No misleading "completed" display for pending/lost outcomes.

### 8. Preserve and verify quality gates

Run the release verification gate unless a command is unsafe or blocked:

```bash
npm run lint
npm run docs:check
npm run route-sql:check
npm run openapi:check
npm run api:inventory:check
npm test -- --run
npm run sdk:integration:python
```

Also run any additional targeted tests added by this goal.

Do not claim success for skipped commands. If skipped, record exact reason in the report.

Acceptance:

- All required gates pass, or blockers are named clearly with next actions.
- Any docs or generated artifacts changed by checks are included in the final file list.

## Optional Fixes Allowed

You may make low-risk fixes discovered during the audit:

- stale docs
- wrong test counts
- wrong command names
- broken setup instructions
- SDK README examples that no longer match code
- skill reference stale endpoint names
- plugin README config key mismatch
- accessibility label for a new filter or badge
- generated artifact refresh when the repo's own generator requires it

Do not make large architecture changes. If you find a deeper bug, document it as P0/P1 and stop or ask for a follow-up goal.

## Expected Deliverables

At minimum:

- `DURABLE_FINALITY_RELEASE_READINESS_REPORT.md`
- updated docs and skill/plugin references if stale
- updated generated artifacts only if required by repo generators
- passing verification gates or named blockers

## Required Final Response

Report:

1. Files changed.
2. Commands run and pass/fail status.
3. Fresh-install/migration confidence.
4. API contract confidence.
5. SDK parity confidence.
6. Skill/plugin accuracy confidence.
7. Remaining P0/P1/P2 follow-ups.
8. Whether the repo is ready for Wes to tag/release or still needs another pass.

## Paste-Ready `/goal` Prompt

```text
/goal Perform a release-readiness audit and hardening pass for the six-phase DashClaw Durable Execution Finality update. Work in C:\Projects\DashClaw. Read DASHCLAW_DURABLE_FINALITY_RELEASE_READINESS_GOAL.md end to end first and follow it exactly. Do not deploy, do not touch external accounts, do not reveal secrets, do not delete untracked/generated files, and do not commit automatically. Verify docs, API contracts, migrations, fresh-install/startup path, Node SDK, Python SDK, OpenClaw plugin packaging, DashClaw skills, and /decisions UI claims against the actual implementation. Preserve parser/generator/source-of-truth rules: regenerate generated artifacts rather than hand-editing them when the repo provides a generator. Keep Vercel daily cron vs hourly external operator tradeoff honest. Run the required gates where safe: npm run lint, npm run docs:check, npm run route-sql:check, npm run openapi:check, npm run api:inventory:check, npm test -- --run, and npm run sdk:integration:python. Create DURABLE_FINALITY_RELEASE_READINESS_REPORT.md and make only low-risk correctness fixes needed for release readiness. Stop with a clear blocker if a deeper architecture issue appears.
```
