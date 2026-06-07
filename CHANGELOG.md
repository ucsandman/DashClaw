# DashClaw Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning

As of **4.0.0**, DashClaw uses **one version across the platform and both SDKs**. The Next.js app (`package.json`), the npm SDK (`sdk/package.json`), and the PyPI SDK (`sdk-python/pyproject.toml`) always share the same version — enforced by `npm run version:sync:check` in CI and the pre-commit hook. Bump all three together with `npm run version:set <x.y.z>`; every release ships the platform deploy and (re)publishes both SDK packages at that number.

Through 3.x the platform and the SDKs versioned independently, which is why older entries below carry separate platform `[2.x]` numbers and `### SDK [3.0.0]`-style numbers, listed newest-first by release date. The `dashclaw` plugin bundle and CLI keep their own manifest versions and are prefixed with the package name.

## [Unreleased]

## [4.4.3] — 2026-06-06

### Changed

- **`/policies` redesign — a front door instead of four equal tabs** — the Policies page no longer opens on a flat `Modes · Shields · Custom · Activity` tab bar with no obvious starting point. With no policies yet it shows one guided screen (not a wizard): Claude Code Mode recommended, its compiled allow / warn / require-approval / block behavior and a real interruption forecast (replayed against your own action history via `previewMode().friction`, honest when there's no history), with agent scope and a spend cap inline and a single Apply. Once policies exist it becomes one consolidated console: a calm summary of which modes and policies govern which agents, plus an apply/change-mode action. Shields, custom authoring (raw YAML import, AI-generate, simulate, test, proof), and the decision Activity feed are demoted intact into a single labeled "Advanced" disclosure — every capability preserved, nothing competing with the primary action. Pure UX/information-architecture reorganization: reuses the existing modes engine, guard, and `/api/policies` (scope/cap applied through the existing `PATCH`); no new routes, SDK methods, MCP tools, guard policies, or schema. SDKs republish at 4.4.3 per the unified-version model.

## [4.4.2] — 2026-06-06

### Changed

- **UI readability + brightness lift** — a site-wide pass, at the token layer, to pull the dark theme out of the flat near-black/low-contrast register that made dense surfaces (the Policies page in particular) hard to read. The surface ramp was raised off pitch-black with a faint cool-slate undertone and stepped further apart for real depth (`bg-primary #0a0a0a → #0e1014`, through `#272b32`); `border` opacity lifted so card and panel edges read. Secondary/tertiary body text was brightened to clear WCAG AA with headroom (`text-secondary #a1a1aa → #c2c2cc` ≈ 10.8:1, `text-tertiary #808088 → #9b9ba8` ≈ 6.9:1). The small type steps were enlarged (`text-xs` 12→13px, `text-sm` 14→15px) so everyday copy stops whispering, and the Policies authoring helper text was lifted off its 10/11px `text-disabled`/`text-tertiary` sizing. On-doctrine signs of life: a soft brand glow on the active nav item and brand-tinted text selection. Still dark-mode only, orange still reserved as a signal. Design context (`.impeccable.md`, `DESIGN.md`, `PRODUCT.md`) updated to match. No platform or SDK surface change — SDKs republish at 4.4.2 per the unified-version model.

### Added

- **Skill auto-scan (out of the box)** — the PreToolUse governance hook now scans a skill's files for embedded secrets and dangerous/injection patterns when it loads, warning the operator (advisory — never blocks; opt out with `DASHCLAW_SKILL_SCAN=0`). Reuses the existing scanner + content-hash cache. Re-run the hook install to pick up the new `Skill` matcher.
- **`dashclaw_assumption_record` MCP tool** — agents can record an assumption an action rests on (validate/refute later), so the Assumptions ledger fills from real activity instead of staying demo-only. MCP tools 28 → 29 (Node/Python SDK method counts unchanged).
- **Learning export** — `GET /api/learning/export?format=agents|claude` generates a downloadable `AGENTS.md` / `CLAUDE.md` from recorded decisions + learned recommendations; the `/learning` page gains one-click generate buttons, a purpose banner, and a clearer title.
- **Messages facelift** — a "Replying to …" smart-reply banner and Sent-tab delivery/read receipts.

### Fixed

- **Capabilities "Run test" + webhook delivery** — call undici's `fetch` so the SSRF-pinned Agent dispatcher is honored; the global fetch's mismatched internal undici was throwing a causeless "fetch failed".
- **Default dashboard** — saved card layouts no longer clip content: grid min-height raised (160 → 272px) and the layout version bumped so collapsed saved layouts self-heal to the roomier defaults.
- **Agent Sessions** — abandoned rows stuck at `spawning` are swept to `closed` (migration `0024`) and the schema default aligned to `running`, so the page stops showing perpetual "spawning".
- **Drift** — the alert `metric` filter now actually filters (it was accepted but silently dropped).
- **Quality / Labs sidebar** — the collapsible Labs group auto-expands when the active route is inside it, so Quality (and siblings) highlight correctly.
- **Messages** — replying to a messaging-only agent no longer 403s (`agentExistsInOrg` now counts a sent message as org membership), and send failures surface in the compose modal instead of being swallowed.
- **Evaluations** — `eval_scorers` added to the drizzle migration chain (`0025`) so fresh deploys no longer 500 on the Scorers tab.

## [4.4.1] — 2026-06-06

### Added

- **living-merge** — dev-workflow tooling so multiple Claude Code sessions in parallel git worktrees can all push to `main` without ever conflicting on generated files. Generated projections (doctor shape, MCP inventory, the livingcode dashboard, the platform-intelligence `SKILL.md` + bundle zips + plugin skill/hook mirrors, and `docs/` api-inventory + openapi) get a `merge=regenerate` git driver that keeps one side (never writes conflict markers) plus `post-merge`/`post-rewrite` hooks that re-derive them via a single `regenerate-all` wrapper, so `main` stays self-consistent regardless of merge order. Hand-authored files stay protected — a SessionStart hook surfaces cross-worktree AUTHORED-file overlap as factual context. One-time setup: `npm run living-merge:install` (runs automatically via the `prepare` script on `npm install`). No platform or SDK surface change — SDKs republish at 4.4.1 per the unified-version model. See `docs/living-merge.md`.

## [4.4.0] — 2026-06-06

### Added

- **Policy Modes** — named operating contracts that compile to packs of ordinary guard policies, so operators pick a posture ("Claude Code Mode", "SOC 2 Mode", …) instead of authoring policy types by hand. Ships an 8-mode built-in catalog (`app/lib/policy-modes/`), three routes (`GET /api/policies/modes`, `POST /api/policies/modes/preview`, `POST /api/policies/modes/import`), and a "Modes" tab on `/policies` with per-mode preview (generated policy list, decision legend, best-effort friction simulation) and an admin-gated **Apply**. Mode-generated policies are tagged with `_mode` inside their rules JSON (mirrors the existing `_shield` tag — no schema migration) and applied as active. Claude Code Mode won't interrupt routine coding (reads/edits/bash/test/build) while pausing for money (x402), external comms, deploys, migrations, destructive ops, protected paths, and runaway loops. Raw YAML import and existing policy flows are unchanged. SOC 2 / Enterprise modes use careful, non-hype language and make no compliance guarantee. See `docs/policy-modes.md`.
- **Live status widget** — a chrome-free, embeddable `/widget` surface showing fleet posture, key metrics, a recent decision log, and a footer, backed by a composed `GET /api/widget/summary` (pure normalization over existing posture/metrics/log sources). Updates live via polling + realtime with an explicit connection-state indicator. Read-only observability — never an agent tool and never calls a model. Includes a usage doc and a privacy-assertion test.

## [4.3.1] — 2026-06-06

> Patch: fixes the `dashclaw code apply` (Optimal Files) pipeline end-to-end. Platform + CLI only; no SDK method change (Node 126 / Python 224 unchanged), both SDKs republish at 4.3.1 per the unified-version model.

### Fixed

- **Optimal Files manifests were saved without file content**, so `dashclaw code apply` returned `no_content` for every entry and wrote nothing. The manifest builder (`POST /api/code-sessions/sessions/[sessionId]/optimal-files/manifest`) planned unknown-existence selections as `safe` (path-only) and never copied the file bodies — already validated against `built.bundle` — into the saved plan. It now backfills `content` for every entry, so manifests are applyable.
- **CLI `@dashclaw/cli` 0.3.1: `dashclaw code apply --dest=<dir>` failed with "--dest required".** `getFlag` parsed only the space-separated form (`--dest <dir>`), but the UI-generated command and `--help` use `--dest=<dir>`. It now accepts both `--name value` and `--name=value`.
- **CLI `@dashclaw/cli` 0.3.1: every command crashed at load, and `code ingest-codex` could never run from the published package.** `cli/lib/code/ingest-codex.js` imported the app's TypeScript parser (`app/lib/codex/parser.js`) — unresolvable by the raw-Node CLI and absent from the published tarball (which ships only `cli/`), and eagerly loaded by the bin, so it took down every command. The parser is now vendored as a compiled ESM copy (`cli/lib/code/codex-parser.vendored.js`), matching the CLI's existing `vendored.js` pattern; the whole CLI loads and `code ingest-codex` actually works.

## [4.3.0] — 2026-06-06

> Governance Posture Score + remediation loop — a new govern-the-governance subsystem. Minor bump (additive routes/tools/CLI/page); no SDK method change (Node 126 / Python 224 unchanged), both SDKs republish at 4.3.0 per the unified-version model.

### Added

- **Governance Posture Score + human-gated remediation loop.** A gaming-resistant, org-wide governance posture score (0–100) across six dimensions (identity, enforcement, spend, auditability, approval, data protection) that measures what the fleet *can* do versus what it actually *governs*, with a prioritized remediation queue. Surfaced as: the `/posture` operator page (score hero + dimension cards + queue + draft-only resolve modal + risk-accepted ledger); four experimental routes (`GET /api/posture`, `GET /api/posture/findings`, `POST /api/posture/findings/[key]/resolve`, `POST /api/posture/scan`); two **read-only** MCP tools (`dashclaw_posture`, `dashclaw_posture_next` — taking the MCP surface to **28 tools in 10 groups**); and three CLI commands (`dashclaw posture` / `dashclaw next` / `dashclaw posture resolve <key>`, draft-only). New tables `posture_findings_state` + `posture_snapshots` (migration `0022`). No new SDK methods.
- **The core trust property is enforced end-to-end:** the score rises *only* from active, proven-to-fire policies. Resolving a finding via `create_draft` inserts an **inactive** policy draft (or `snooze` / `accept_risk` records state) — it never activates enforcement and never raises the score. A human activates the policy at `/policies`, and a later `scan` that proves it fires is what moves the number. Verified at the engine, route, UI, and live dev-DB level.

### Fixed

- **`GET /api/posture` would have 500'd in production.** The incident-signal query referenced `guard_decisions.action_id` and `outcome_status` — columns that do not exist (the table's identifier is `act_gd_*`). Pinned to the real columns (`id`, `risk_score`, `action_type`, `created_at`); the incident deep-link now points at the `/decisions` ledger. Caught by a live end-to-end honesty smoke against the dev database (the mocked test suite passed regardless).

## [4.2.3] — 2026-06-06

> Docs-accuracy sweep. No code or public-surface change; the SDK is byte-identical to 4.2.2 (republishing at 4.2.3 is optional).

### Changed

- **`PROJECT_DETAILS.md` now references the migrated source files by their real `.ts` paths.** After the TypeScript migration, the canonical architecture doc still named modules by stale `.js` paths (`app/lib/db.js`, `guard.js`, `signals.js`, `integrity/sign.js`, the `app/api/**/route.js` glob, etc.) — 23 references corrected to `.ts`. (`docs:check` only validates markdown links, so these inline-code references weren't caught automatically.)

## [4.2.2] — 2026-06-06

> Internal: completes the TypeScript migration by converting the remaining 167 `app/lib/*.js` modules to strict `.ts` (behavior-preserving), closing the `allowJs` island so internal callers get real types. No public API, route, or SDK-surface change (Node 126 / Python 224 unchanged); both SDK packages republish at 4.2.2 per the unified-version model.

### Changed

- **Internal `app/lib` modules migrated to strict TypeScript** (167 files: claude-code analytics, behavior, compliance, integrity, hosted, routing, demo fixtures, and singletons). Crypto/security invariants (encryption, integrity signing, URL/SSRF guards, timing-safe compares) preserved byte-for-byte. `app/lib/validate.js` remains JavaScript by design (authoritative runtime validator). An adversarial-review-class fix unified the canonical `SqlTag` so `getSql()` returns it.
- **Added `tsx` (devDependency)** and wired the `app/lib`-importing operational scripts (`setup`, `doctor`, `init:self-host-env`, backfills, seeds, the `_run-with-env` runner) to run under it — Node has no `.js`→`.ts` extensionAlias, so these scripts now resolve the migrated modules. The Vercel deploy is unaffected (its `auto-migrate` step talks to Postgres directly).

## [4.2.1] — 2026-06-06

> Internal: the Next.js platform is migrated from JavaScript/JSX to strict TypeScript/TSX (587 `.ts`/`.tsx` files; incremental and behavior-preserving). No public API, route, or SDK-surface change (Node 126 / Python 224 unchanged); both SDK packages republish at 4.2.1 per the unified-version model. One user-visible fix ships alongside: the Fleet spend total.

### Fixed

- **Fleet spend total (the `/spend` headline KPI) could render `$0.00` when an org had both agent LLM cost and x402 purchases.** The x402 / code-sessions spend aggregations returned their `::real` SUM as a database-driver string, so the server-side `Agent + x402` sum concatenated (`"5.51.25"`) → NaN. `getX402SpendAggregation` / `getCodeSessionSpendAggregation` now coerce stored aggregates with `Number()` (matching the agent-cost path), with a defense-in-depth guard at the Fleet-total site. The breakdown tiles and the trend chart were already correct (the UI re-coerces). Caught by the migration's adversarial review.

### Changed

- **Platform migrated to strict TypeScript** (JS/JSX → TS/TSX, dependency-ordered and behavior-preserving). The build now uses webpack (`next build --webpack`) with a `next.config.js` `extensionAlias` so existing `.js` import specifiers resolve to the converted `.ts`/`.tsx` files with zero import-site churn. The Node SDK internals (the `index.cjs` bridge) and ~150 internal `app/lib` utility modules remain JavaScript as documented exceptions. No runtime behavior change beyond the Fleet fix above.

## [4.2.0] — 2026-06-05

> Adds a one-call x402 self-report path to both SDKs and fixes server-side provider attribution for name-only purchases, so spend an agent makes OUTSIDE an OpenClaw hook (a Codex native shell, a wrapper script) still lands correctly on Spend → x402. The SDK surface grows by one method each (Node 125 → 126, Python 223 → 224); additive, no breaking changes. `@dashclaw/openclaw-plugin` 1.3.2 documents the same fallback.

### Added

- **`recordX402Purchase` / `record_x402_purchase` — one-call x402 self-report (both SDKs).** Records a settled x402 payment end-to-end — govern + record the purchase, mark it succeeded, and (when a tx hash / request id is given) attach the on-chain receipt — in a single call. For the **pay-outside-a-hook** pattern: when an agent pays through a runtime OpenClaw doesn't proxy (e.g. a Codex native `shell_command` or a wrapper script), the plugin's `before_tool_call`/`after_tool_call` hooks never fire, so the paying code must self-report. The server resolves/auto-registers the provider from the `provider` name, so callers don't register one first. Node `recordX402Purchase({ agent_id, provider, spend, transaction_hash?, request_id? })`; Python `record_x402_purchase(...)`. No new routes — it composes the existing `/api/x402/purchases`, `/api/actions/:id/outcome`, and `/api/artifacts`.

### Fixed

- **x402 purchases recorded with a provider name but no `provider_id` showed a blank provider on Spend → x402.** `POST /api/x402/purchases` accepted `provider` (a name/origin) for guard context but only persisted `provider_id`, so any name-only caller (the SDK self-report path, MCP, a wrapper) left `x402_purchases.provider_id` null. The route now resolves/auto-registers a provider from the `provider` name server-side (`resolveProviderByName`) before guard and persists it — mirroring the plugin's client-side resolution, so every caller gets attribution without registering a provider first. `scripts/backfill-x402-provider-id.mjs` repairs pre-fix null rows (dry-run by default, side-effect-free).

## [4.1.2] — 2026-06-05

> Security/reliability hardening of the governed-action paths (identity, authoritative risk, durable guard audit, x402 integrity), plus the accumulated session_id-stamping and policy-form work. No SDK API changes (Node 125 / Python 223 unchanged); both SDK packages republish at 4.1.2 per the unified-version model.

### Added

- **MCP + SDK `session_id` stamping for exact session→action linkage.** `action_records.session_id` was already accepted, persisted, and unioned in the per-session aggregate (a Direct path plus a time-window Fallback), but no client ever set it. Now the MCP `dashclaw_record` tool auto-stamps the session opened by `dashclaw_session_start` — an ambient id held in the per-client `createToolHandlers` closure, so it persists across calls in a stdio process but stays inert per-request on the stateless `/api/mcp` HTTP transport (no cross-org leak); an explicit `session_id` argument overrides it, and a matching `dashclaw_session_end` clears it. The Node SDK documents `createAction({ session_id })` as first-class (the `...action` spread already forwarded it), and the Python SDK adds an explicit `create_action(session_id=None, …)` parameter (sent only when provided, backward compatible). When omitted, the server still falls back to time-window correlation by `agent_id`. No new routes, methods, tools, or migrations — purely client-side.

### Fixed

- **Custom action types couldn't be authored from the policy form — only imported.** The "New policy" form (Policies → Custom) limited action types to ~20 preset tags, so policies targeting the custom strings real orgs actually use (`marketplace_publish`, `ps-finance:charge_customer`, `stripe.charge`, `outreach_send`) could only be created by hand-writing YAML and using Import. The Action Types picker now has a free-text input alongside the preset quick-picks: type any action type and press Enter/comma to add it as a removable chip (deduped, non-empty validated; Backspace removes the last). The same picker is now used by `require_approval`, `block_action_type`, `green_contract`, `branch_freshness`, and `non_fabrication`. Selected types still compile into `rules.action_types` — the only field the guard matches on for these types — so a form-authored policy (e.g. `marketplace_publish` → require approval) fires identically to the equivalent imported one. UI-only: the create endpoint, validator, and guard already accepted arbitrary action types.

### Security

- **Governance hardening pass (identity, risk, audit durability, x402).** A security/reliability sweep that closes integrity gaps across the governed-action paths, with no database-schema, money-precision, or public-API-contract changes:
  - **Authoritative risk is now persisted.** `action_records` (and x402 purchase actions) previously stored the agent-asserted `risk_score`; they now store the server-authoritative guard score (client risk may raise it, never lower it), so the Decisions ledger, alerts, analytics, and dashboards reflect the value the guard actually decided on.
  - **Durable guard audit evidence.** The `guard_decisions` audit row is now written synchronously (previously fire-and-forget) — a guard decision is never returned as a success if its required audit row could not be persisted.
  - **Consistent agent identity.** A shared `resolveAgentIdentity()` now backs `/api/actions` and `/api/x402/purchases` (previously only `/api/guard` verified JWTs): a JWKS-verified JWT `sub` overrides the self-asserted body `agent_id`, and self-asserted identity is never recorded as verified.
  - **x402 spend governance.** Purchase creation now rejects negative / non-finite spend, malformed currency, and oversized text; validates that a supplied `provider_id`/`endpoint_id` exists in the org, is active/enabled, and that the endpoint belongs to the provider; aligns `x402_spend_limit` allow/block matching with the stored provider; compensates (deletes the orphan action) on a partial action→purchase write; masks wallet/payment references at rest and in responses; and syncs purchase `execution_status` when an outcome is reported. `x402_spend_limit` is now an authorable policy type.
  - **Outcome integrity.** The outcome endpoint now rejects outcomes for actions that were blocked, denied, cancelled, or not yet approved.
  - `.env.example` now documents `DASHCLAW_ALLOWED_ISSUER` / `DASHCLAW_JWT_AUDIENCE`; x402 provider/endpoint/purchase routes adopt the shared error contract.

## [4.0.2] — 2026-06-04

> Platform fixes + features after 4.0.1 (out-of-box governance hooks, team-invite security, secret/prompt-injection auto-scan, Policy Coach recorder toggle, live Decisions ledger, dashboard/sessions/drift/quality fixes). The core `dashclaw` SDK code is unchanged, but both SDK packages republish at 4.0.2 per the unified-version model. The `dashclaw` plugin bundle (2.14.1) and `@dashclaw/openclaw-plugin` (1.2.6) version independently.

### Fixed

- **Claude Code governance hooks didn't fire out-of-the-box (fresh / Docker / headless).** Two compounding causes: (1) `claude plugin install dashclaw` ships MCP + skills only — the Pre/PostToolUse governance hooks are a separate `install-hooks.mjs` step (plugin ≠ hooks); (2) a project `.claude/settings.json` is gated by Claude Code's folder-trust prompt, so in a fresh/Docker session its hooks silently never load while a user-level `~/.claude` Stop hook still fires ("Stop ran but Pre/PostToolUse didn't"). Fix: new `install-hooks.mjs --global --governance` installs the full set at the user level (no trust gate; no secret written). Hooks now also accept `DASHCLAW_URL` as a fallback for `DASHCLAW_BASE_URL`, and PreToolUse logs a one-line breadcrumb when half-configured instead of exiting invisibly. Documented in `hooks/README.md`, the `/guides/claude-code` page, the platform-intelligence skill troubleshooting reference, and the plugin README.
- **🔒 Team-invite security hole.** An invite link could be consumed by a different-email account, and any OAuth login dropped a new user straight into the shared `org_default` workspace. Restored an email-matched `/api/invite/[token]` accept route (rejects link-only/no-email invites; atomic consume), required an email on invite creation, and isolated new non-first logins into their own workspace — joining a real workspace now only happens via an email-matched invite.
- **Dashboard default layout clipped widgets.** The grid renders all 13 cards but the default only positioned 10 (projects/learning/integrations were auto-placed tiny); all 13 are now sized to their content, card bodies scroll instead of silently clipping, and the layout version bump pushes the new default to existing users.
- **Capabilities "Run test" showed an opaque "fetch failed".** Now surfaces the real cause (e.g. `(ENOTFOUND)`) and the SSRF-pinned dispatcher fails over across all validated IPs.
- **Messages: human operator couldn't reply** ("from_agent_id not found in this org") — the reserved `dashboard` sender is now allowed past the anti-spoof gate.
- **Agent Sessions stuck "Spawning".** Sessions start in `running`; terminal statuses (completed/cancelled/closed) now render and roll up under the Finished filter.
- **Drift "Run detection" was a silent no-op.** It now reports results (or explains an empty result) and the empty state is honest about needing baseline data.
- **Quality sidebar item didn't highlight on `/scoring`** and the page title mismatched — sidebar now points at `/scoring` and the page is titled "Quality".
- **`/learning` page crash (React #31).** The recommendation-metrics row rendered `metric.outcomes.applied` / `.baseline` (summary objects) directly in JSX — "objects are not valid as a React child" — crashing the page for any org with recommendation-outcome data. Renders the scalar `.total` now.
- **`/api/learning/suggestions` 500.** `generatePolicySuggestions` joined a table named `actions`; the table is `action_records` (`relation "actions" does not exist`). The suggestions feature never worked.
- **Scoring auto-calibrate 500.** `scoringProfiles.autoCalibrate` selected nonexistent `prompt_tokens` / `completion_tokens` from `action_records` (real columns: `tokens_in` / `tokens_out`).
- **Code-session alerts never recorded.** `insertAlerts` used `ON CONFLICT ON CONSTRAINT code_session_alerts_dedup`, but that name is a unique *index* on `COALESCE()` expressions — which `ON CONSTRAINT` can't match — so every ingest logged "constraint does not exist". Switched to index-inference `ON CONFLICT (org_id, kind, (COALESCE(project_id,'')), (COALESCE(session_id,'')))`.
- **Latent schema gaps (migration `0017`).** Added the missing `token_budgets` NULL-safe unique index (budget upserts were 500ing on `ON CONFLICT`), and created the `message_attachments` and `prompt_injection_scans` tables that live routes referenced but no migration ever created.

### Added

- **Plugin now bundles the governance hooks** (`dashclaw` plugin bundle 2.14.1). `claude plugin install dashclaw@dashclaw` previously shipped MCP + skills only; it now ships the Pre/Post/Stop hooks (`plugins/dashclaw/hooks/hooks.json`, commands via `${CLAUDE_PLUGIN_ROOT}`). Plugin-provided hooks fire on enable and are **not** gated by Claude Code's per-folder trust prompt the way a project `.claude/settings.json` is — so governance works out-of-the-box (incl. fresh/Docker) given Python on PATH + `DASHCLAW_BASE_URL`(or `DASHCLAW_URL`)+`DASHCLAW_API_KEY`. The bundled `.py` payload is a generated mirror of canonical `hooks/` (new step in `livingcode-refresh.mjs`), so it never drifts. The standalone `install-hooks.mjs` path remains for non-plugin / global installs.
- **OpenClaw agents appear in Agent Sessions** (`@dashclaw/openclaw-plugin` 1.2.6). The plugin opens an Agent Session on a run's first tool call and closes it on `agent_end` (`updateSession → completed`), fail-safe. Previously OpenClaw only fed Code Sessions.
- **Live Decisions ledger.** The ledger now subscribes to the same SSE stream Activity uses and refreshes in real time (no manual Refresh).
- **Policy Coach recorder toggle.** A UI control on `/policy-coach` turns the behavior recorder on/off with an optional auto-stop window (persisted as org settings; the local hook honors it, env var still overrides). The "Recorder" tile now reflects configured state, not the server process env.
- **Auto-scan secrets at guard time.** `/api/guard` scans outbound `content` for secrets — advisory `secret_scan` in the response by default (never the raw secret), hard-block when the org sets `DASHCLAW_AUTOSCAN_BLOCK`; the PreToolUse hook forwards Write/Edit content and surfaces the warning.
- **Skill scanner upload.** Scan a skill by uploading a `.zip`, a folder, or multiple files (unzipped in-browser via `fflate`) instead of pasting each file.
- **`install-hooks.mjs --global --governance`** — user-level full-governance install (see Fixed above).
- **App-level error boundaries** (`app/error.js`, `app/global-error.js`). The app had none, so any render error became an opaque browser "This page couldn't load" with no diagnostics. Now an on-brand surface with the server `digest` (and the stack logged to the console). This is what made the `/learning` client error debuggable.

### Changed

- **"My Agent" → "Agent Summary"** (sidebar + page) — it was never scoped to your own agent; reframed as the plain-English daily recap with a cross-link to the Activity stream. Sidebar "Sessions" relabeled **"Agent Sessions"** to match its page title and be findable. Secret Rotation page clarified as a rotation reminder (it never stores key values).

### Removed

- **Dead onboarding feature.** `OnboardingChecklist` (rendered `null` in every mode since the onboarding API was archived in v2.1.0) + its dashboard render, the demo-mode `/api/onboarding/status` middleware stub, and `scripts/bootstrap-prompt.md` (built on the long-removed `syncState` / archived `/api/sync`). Demo fixtures no longer deep-link to the retired `/workspace` page.

## [4.0.1] — 2026-06-04

> A correctness + hardening patch from a gated senior-quality pass. **The most important fix is for the Python SDK:** PyPI `dashclaw 4.0.0` shipped with an inverted `_request` argument order that left whole method families non-functional — upgrade to 4.0.1. Platform and both SDKs move together at 4.0.1.

### SDK — Python (PyPI `dashclaw` 4.0.1)

- **Fixed (critical) — `_request` argument inversion at 41 call sites.** Compliance exports/schedules/trends, drift, learning-analytics, and scoring methods passed the HTTP verb where the path belonged, so the entire surface 404'd/failed on 4.0.0. Every call site now uses `_request(path, method=...)`.
- **Changed — SSE streaming sends `Authorization: Bearer`** when `auth_token` is set (parity with the REST path).
- **Removed — `sync_state`.** It wrapped `/api/sync`, archived since v2.1.0 (always 404'd). Public-method count **204 → 203**. (Removed the private dead `_guard_check` helper too.)
- **Deprecated — `record_assumption`** now emits a `DeprecationWarning`; use `register_assumption`.
- **Fixed — LangChain `report_token_usage`** is now called with positional args.
- Input guards on `score_with_profile` / `batch_score_with_profile`.

### SDK — Node (npm `dashclaw` 4.0.1)

- **Fixed — CJS bridge (`sdk/index.cjs`).** Rewritten with a recursive deferred proxy so nested namespaces (`execution.capabilities.*`) resolve and `instanceof ApprovalDeniedError` / `GuardBlockedError` works across the ESM/CJS boundary.
- **Changed — SSE streaming sends `Authorization: Bearer`** when `authToken` is set.
- **Added — `deleteCapability(capabilityId)`** (`DELETE /api/capabilities/:id`).
- **Removed — `syncState`** (`/api/sync`, archived since v2.1.0). Net public-method count **unchanged at 104** (`syncState` −1, `deleteCapability` +1).
- **Changed — `scoreWithProfile` / `batchScoreWithProfile`** now throw `TypeError` on wrong input shape instead of failing opaquely; `waitForApproval` re-raises `GuardBlockedError`; `limit: 0` is no longer dropped.
- **Legacy** (`dashclaw/legacy`) keeps its frozen `syncState` / context shims unchanged.

### Platform

- **Fixed — bounded learning-analytics growth.** `computeVelocity()` / `computeLearningCurves()` plain-INSERTed on every run, so `learning_velocity` / `learning_curves` grew without bound. Migration `drizzle/0016` dedupes to one row per natural key and adds unique indexes; both compute paths now `ON CONFLICT DO UPDATE`. **Run `npm run db:migrate` after pulling.**
- **Hardened — governance routes.** Centralized the `redactAny` DLP helper (was duplicated across 9 routes); core routes now return **400 on malformed JSON** instead of 500; the action-detail route uses the shared `apiErrorResponse`.
- **Fixed — compliance evidence shape.** The evidence response is now correctly nested for its consumer.
- **Fixed — Telegram setting keys** reconciled (`TELEGRAM_ADMIN_CHAT_ID`, `DASHCLAW_ALERTS_TELEGRAM`) so admin-chat values aren't mis-encrypted.

### UI / reachability

- **Removed — orphan pages `/notifications`, `/bug-hunter`, `/workspace`** (no inbound links; superseded by `/mission-control` + settings) and the unused memory-health widget.
- **Added — nav links** for previously orphaned but live pages (`/team`, `/swarm`, `/my-agent`, `/dashboard`).
- Numerous P2/P3 cleanups: type-safety guards, helper dedup, config fixes, and hardcoded-hex → CSS-token replacements.

## [4.0.0] — 2026-06-03

> First release on the unified version line — the platform jumps from 2.19.0 to **4.0.0** to align with the SDK; from here the platform and both SDKs move together.

### Retired the archived "Context" surface (key points + threads)

The `/api/context/*` namespace has been archived since the platform-convergence cleanup — it lives only under `app/api/_archive/`, has no `next.config` rewrite, and its `context_threads` table was never created, so every call 404'd. This release removes the last live remnants that still pointed at it:

- **Removed — the `/workspace` Context tab.** It fetched `/api/context/points` + `/api/context/threads` in one `Promise.all` and threw "Failed to fetch context data" on load. Workspace now shows 5 tabs: Overview, Handoffs, Snippets, Preferences, Memory.
- **Removed — the `/docs` "Context Manager" section.** It documented Node SDK methods (`captureKeyPoint`, `getContextSummary`) that never existed in the Node SDK.
- **Left as pre-existing dead code.** The archived routes (`app/api/_archive/context/*`) and the now-orphaned `context_points` / `context_entries` tables (no live reader or writer).

### AI policy authoring is now iterative

The natural-language policy generator no longer dead-ends on vague input. Instead of rejecting a request with "be more specific," it returns a best-effort draft, the assumptions it made, and targeted clarifying questions you answer with one-click chips — refining the draft until it is right, then saving your reviewed edits.

- **Changed — the generator never rejects.** `POST /api/policies/generate` (dry-run) now returns `{ drafts, assumptions, clarifications }` instead of an empty array on ambiguity. The model is instructed to always make progress: a draft with stated assumptions, clarifying questions with suggested values, or both. Answered clarifications thread back in to refine. (`app/lib/policy-generator.js`.)
- **Added — `protected_path`, `semantic_check`, and `behavioral_anomaly`** to the generator's vocabulary. Requests like "stop my agents from deleting things I care about" now map to a real `protected_path` policy; previously the generator knew only 7 of the 12 enforceable policy types and returned nothing for the rest.
- **Changed — one authoring loop, one place.** The generate → review → refine → save loop lives in the discoverable Policies → Custom → **AI generator** panel. Edits are preserved on save (the reviewed draft is stored via `POST /api/policies`, never silently re-generated).
- **Removed — the orphaned `/policies/generate` standalone page**, which nothing in the app linked to. Its review-before-save step is folded into the panel.

### Behavior Learning Mode / Policy Coach (v1, observe-only)

A passive learning loop that records real, **redacted, local-only** Claude Code + agent usage, analyzes it deterministically, and suggests evidence-backed DashClaw policies per agent. v1 is **observe-only** — it never blocks, never changes approvals, and never auto-enforces. Full docs: `docs/behavior-learning.md`.

- **Added — passive recorder.** `hooks/dashclaw_agent_intel/behavior_recorder.py`, wired through the existing Pre/PostToolUse hooks (opt-in `DASHCLAW_BEHAVIOR_SAMPLES_ENABLED=1`). Writes one redacted JSONL sample per governed tool call to `.dashclaw/behavior-samples/<date>.jsonl`: event id, timestamp, agent, model (best-effort), tool/action type, command *shape*, read/write paths, risk, guard decision, outcome, duration, and `action_id`. Deterministic secret/path redaction (same pattern set as code-sessions); fail-silent — never blocks a tool call. No raw secrets, env values, message bodies, or full transcripts.
- **Added — deterministic analyzer + simulator.** `app/lib/behavior/*` (path-match, redaction, task-classifier, model-tier, policy-model, analyzer, simulate, sample-store). Emits six suggestion types — destructive-command approval, protected-path approval, repeated-reload warn, failed-loop warn, model/task-mismatch warn, and agent safe-envelope — each with confidence, sample size, evidence event ids, expected effect, and false-positive risk. Analyzer and simulator share one evaluator, so simulations are faithful.
- **Added — Policy Coach UI** at `/policy-coach` (Govern → Policy Coach): sample status, observed-agent operating envelopes, and suggestions with **Simulate / Edit / Adopt / Dismiss**. Adoption is **gated on simulation review**. Dismiss supports *suppress similar*.
- **Added — API.** `GET /api/behavior/samples`, `GET/POST /api/behavior/suggestions` (adopt/dismiss, simulation-gated), `POST /api/behavior/simulate`. Adopting an enforceable suggestion creates an **inactive** (`active=0`) guard-policy draft via the existing policy path — enforcement is never enabled automatically.
- **Added — new `protected_path` guard policy type** (`app/lib/validate.js` + `app/lib/guard.js`), authorable from `/policies` and matched with the same path matcher the Policy Coach simulates with. `risk_threshold` covers the destructive-command type. The other four suggestion types are advisory observations in v1.
- **Added — surfaces.** CLI `dashclaw behavior status|suggestions`; MCP tool `dashclaw_behavior_suggestions` (read-only).
- **Storage.** Local files only (samples + dismissals); **no database migration**. The only DB write is the inactive policy draft on adopt.

### SDK — BREAKING: removed the archived context namespace (threads + key points)

Continues the dead-archived-endpoint cleanup behind SDK 3.0.0. The `/api/context/*` namespace lives only under `app/api/_archive/` (no `next.config` rewrite; the `context_threads` table was never created), so every wrapped call always 404'd. Removed as a **breaking** change; both SDKs ship as a **major** — **Node 4.0.0** (npm) and **Python 4.0.0** (PyPI).

- **Removed (Node, 107 → 104).** Context-thread methods `createThread`, `addThreadEntry`, `closeThread` (`/api/context/threads*`). Canonical public-method count **107 → 104**. (Removed in source by `bbbb517b`; 4.0.0 is the release that publishes and documents it.)
- **Removed (Python, 211 → 204).** Context-thread methods `create_thread`, `add_thread_entry`, `close_thread`, `get_threads` (211 → 207, also `bbbb517b`), plus the key-point methods `capture_key_point`, `get_key_points`, `get_context_summary` (`/api/context/points`) — 207 → **204**.
- **Unchanged.** The legacy Node SDK (`dashclaw/legacy`) keeps its frozen context shims (points + threads).
- **Versioning.** From 4.0.0 the platform and both SDKs share one version, enforced by `npm run version:sync:check`; the root `package.json` self-dependency tracks the published SDK.

### SDK [3.0.0] — 2026-06-02 — BREAKING: removed methods that targeted archived endpoints

The dead-`/routing`+`/feedback`-page cleanup surfaced SDK methods wrapping endpoints that live ONLY under `app/api/_archive/` (no `next.config` rewrite → they always 404'd). Removed as a **breaking** change; both SDKs shipped as a **major** — **Node 3.0.0** (npm) and **Python 3.0.0** (PyPI).

- **Removed (Node, → 3.0.0).** `submitFeedback` (`POST /api/feedback`). Canonical public-method count 108 → **107**.
- **Removed (Python, → 3.0.0).** Routing suite — `list_routing_agents`, `register_routing_agent`, `get_routing_agent`, `update_routing_agent_status`, `delete_routing_agent`, `list_routing_tasks`, `submit_routing_task`, `complete_routing_task`, `get_routing_stats`, `get_routing_health` (`/api/routing/*`); and feedback suite — `submit_feedback`, `list_feedback`, `get_feedback`, `resolve_feedback`, `delete_feedback`, `get_feedback_stats` (`/api/feedback/*`). Public-method count 227 → **211**.
- **Unchanged.** The legacy Node SDK (`dashclaw/legacy`) keeps its frozen routing/feedback shims; the live agent-registry/matching logic in `app/lib/routing/*` (used by `/api/cron/routing-maintenance`) is unrelated and stays.

### Fixed — `GET /api/handoffs` (Handoffs tab + SDK `getLatestHandoff`/`get_handoffs`)

- **Fixed.** `/api/handoffs` only exported `POST`, so every `GET /api/handoffs` 405'd — breaking the Workspace **Handoffs** tab (always empty) and the documented SDK read methods (Node `getLatestHandoff`, Python `get_handoffs`/`get_latest_handoff`). Added a `GET` handler: list mode (`?agent_id=&project_id=&limit=`, most-recent first) and single-latest mode (`?latest=true`, the SDK contract), backed by a new `listHandoffs` repository function. The Handoffs tab now reads the real freeform `bundle` shape (`summary`, `decisions_made`, `open_loops`, `state_snapshot`) instead of a legacy flat shape that never existed in this API.

### MoltFire + Claude Code "Branch Finish" loop (DashClaw Labs)

A real operating loop that uses the Labs surfaces together to finish a Claude Code branch with governance — render the review prompt, search the standards knowledge, approval-gate the push, simulate a policy, check capability health, score quality, and record the outcome.

- **Added.** `scripts/branch-finish.mjs` (`npm run branch-finish`) — the governed loop. `--dry-run` makes **zero writes** (no learning record, no mark-read) and never touches anything external; proven end-to-end. `scripts/seed-branch-finish-loop.mjs` (`npm run seed:branch-finish`) idempotently seeds 6 prompt templates, a "Wes Coding Standards" knowledge collection (ZERO SLOP, launcher policy, DashClaw facts, MoltFire prefs — bodies stored in item metadata so search works without an embedding key), and a draft workflow template linking them.
- **Added.** `/labs/branch-finish` operator page (Labs sidebar) — wired, no placeholders: branch-finish templates with inline render, knowledge search (graceful no-embedding-key fallback), capability health, a dry-run quality-scorer form, and recent renders/decisions.
- **Added.** `POST /api/evaluations/scorers/preview` — side-effect-free scorer dry-run (wraps `executeScorer`, writes no `eval_scores`). Lets an operator validate a quality gate before creating a scorer or run.
- **Added.** SDK (`sdk/dashclaw.js`): Prompt Library wrappers (`listPromptTemplates`, `getPromptTemplate`, `createPromptTemplate`, `updatePromptTemplate`, `deletePromptTemplate`, `listPromptVersions`, `createPromptVersion`, `getPromptVersion`, `activatePromptVersion`, `getPromptStats`, `listPromptRuns`), plus `recordDecision`, `getLearningRecommendations`, `simulatePolicy`, `previewScorer`, and `deleteKnowledgeCollection`.
- **Added.** CLI: `dashclaw prompts …` (list/get/versions/render/create/add-version/activate/stats) and `dashclaw inbox …` (list/read/archive), implemented as direct-API calls so they work regardless of the installed SDK version.

### Fixed

- **MCP inbox tools.** Added `dashclaw_inbox_list` and `dashclaw_messages_mark_read` MCP tools — MCP-only agents (Claude app / OpenClaw) can now read and mark their inbox read without an SDK install (previously no tool existed for this).
- **Platform-intelligence skill (OpenClaw fallback).** The generated `dashclaw-platform-intelligence` skill no longer assumes `python -m livingcode` is available. The emitter (`livingcode/emitters/skill.py`) now documents an HTTP/repo fallback (`GET {baseUrl}/api/doctor` with the workspace key, then the committed `shape.json`/`api-inventory.json`, else the snapshot) for environments without Python/livingcode/the repo.
- **Branch-finish runner robustness.** `scripts/branch-finish.mjs` treats a not-yet-deployed scorer-preview endpoint (HTTP 405/404 — `POST /api/evaluations/scorers/preview` is shadowed by `/scorers/[scorerId]` until its deploy lands) as a calm warning rather than a loop failure, and uses `process.exitCode` instead of `process.exit()` after network I/O so it exits cleanly on Windows (avoids a libuv `UV_HANDLE_CLOSING` abort during undici socket teardown).

### Sub-agent governance & tracking (Claude Code)

Delegated work is now first-class in DashClaw. Verified against the Claude Code hooks/sub-agents docs: `PreToolUse` fires for the sub-agent spawn (the `Agent` tool — named `Task` before CC 2.1.63) **and** inside sub-agents.

- **Added.** `Agent|Task` is now in the shipped Claude Code `PreToolUse`/`PostToolUse` matcher (installer, template, live `.claude/settings.json`, and the `/guides/claude-code` snippet), so sub-agent spawns are governed decisions recorded as `orchestration` actions. `Task` is registered as an `Agent` classifier alias for pre-2.1.63 sessions.
- **Added.** A sub-agent's own tool calls are now recorded with provenance. The governed `agent_id` stays the parent (sub-agents inherit the parent's pairing/permissions, matching Claude Code), and the sub-agent is surfaced via `agent_name` (`<parent>/<agent_type>`), `swarm_id` (the session id — grouping the spawn and the delegated work in the decisions ledger and the Swarm view), and `intel.subagent`.
- **Added (opt-in).** `DASHCLAW_SUBAGENT_IDENTITY=distinct` gives each sub-agent *type* its own composed `agent_id` (`<parent>:<type>`) so sub-agents appear as distinct agents in `/agents`. An always-on, safe server fallback resolves a composed id's pairing/identity to the base parent (`guard.js` permission_escalation + the trust-posture lookups), so permission inheritance is preserved; an exact pairing for the sub-agent wins. Default `provenance` keeps `agent_id`=parent (no behavior change). Design + rollout: `docs/rfcs/2026-06-01-subagent-fleet-identities.md`.
- **Changed.** The orchestration category records as `action_type: orchestration` instead of the misleading `deploy`.
- **Docs.** `hooks/README.md` gains a "Sub-agent governance & tracking" section; the routing note reflects the new matcher.
- **Tests.** Python integration tests (spawn governed, `Task` alias, provenance, distinct-mode composed id) + JS pairing/identity fallback (guard pipeline + trust posture) + a `baseAgentId` unit test.

### External-agent feedback audit — fixes

Fixes verified against an external agent's first-run feedback (each finding was re-checked against the codebase before acting). Every change ships a regression test; full suite green.

- **Changed (risk scoring) — operators read this.** Bash commands are no longer floored at the Bash tool's base risk of **70**. The per-command classifier is now authoritative for recognized intents, so read-only shell scores low (`echo hello` / `ls` → 5, `curl` → 40) instead of a flat 70 — **risk-threshold policies will see materially lower scores for benign shell commands.** Safety is preserved where the floor actually mattered: a shell redirection counts as a write (≥35), a redirect into a protected system path (e.g. `echo x > /etc/passwd`) escalates to ≥75, and `unknown`/unparseable commands keep the 70 floor.
- **Added.** `guard()` results now expose `decision_id` — the canonical name for the guard-evaluation id (`act_gd_*`). The existing `decision.action_id` is retained as a **deprecated alias** of the same value (slated for removal in a future major). Use `decision_id` from `guard()` and the `action_id` from `createAction()` for follow-up calls.
- **Added.** Pairing-request TTL is configurable via `DASHCLAW_PAIRING_TTL_MINUTES` (default 15, unchanged).
- **Added.** Predictive risk tags the zero-history cold-start adjustment with `basis: 'no_history'` (vs `'history'`) so the fixed `+5` prior isn't mistaken for a learned signal.
- **Fixed.** The agent Trust Posture panel showed `permission_level: unknown` for every agent — `getAgentTrustPosture` filtered `agent_pairings` on the never-set status `'active'` instead of `'approved'` (the real pairing lifecycle).
- **Fixed (installer).** `scripts/install-hooks.mjs` resolves `python` vs `python3` at install time. Debian/Ubuntu ship only `python3`, so the hardcoded `python` silently disabled every governance hook there.
- **Docs.** Main README gains a hook-install "verify it fires" smoke test; `agent-identity.md` now leads with enrollment (pairing + JWKS paths); new `docs/operator/mission-control-reference.md` badge/counter legend; the `/identities` empty state points to the real enroll path; `hooks/README.md` no longer overstates governance scope (the shipped Claude Code matcher is `Bash|Edit|Write|MultiEdit`, so sub-agent spawns and MCP calls are **not** hook-intercepted by default); and the stale `(extensions)` / "AI Safety Research" route-group tree in `FULL_CONTEXT.md` is corrected to reality.
- **Tests.** Regression coverage for the Trust Posture query, interpreter detection, the Bash scoring change (3 Python integration tests), the `decision_id` alias, and the predictive-risk `basis` field.

### Overnight hardening pass (branch `overnight/cleanup-2026-06-01`)

A batch of behavior-preserving bug fixes from an unattended cleanup run. No new routes, SDK methods, or contract changes; each fix ships a regression test and the full suite stays green. See `OVERNIGHT-CLEANUP-REPORT.md` for root-cause detail and the per-fix commits.

- **Fixed (MCP).** `dashclaw_loop_list` no longer returns 500: the `/api/actions/loops` count query was missing the `action_records` join the main query has, so any `agent_id` filter (always sent by a configured server) errored. `dashclaw_learning_query` now reads `/api/learning` (the store `dashclaw_learning_log` writes to) instead of the recommendations consolidator, so logged decisions can be queried back.
- **Fixed (Node SDK).** `_request` drops `undefined`/`null` query params instead of sending the literal `status=undefined` (a regression from v1 that silently emptied filtered lists); a non-JSON error body (502/504/413/429) now throws a status-bearing error instead of a `SyntaxError`; and `waitForApproval`'s polling fallback returns the same `{ action, open_loops, assumptions, message_summary }` shape as the SSE fast-path.
- **Fixed (API).** A literal `null` JSON body returns 400 instead of crashing with 500 on validated POST routes; `GET /api/learning/analytics/velocity` and `/curves` no longer return 500 on a non-numeric `?limit`; the live Code Sessions finalize pass reads session fields off the correct `getSessionDetail` shape (the optimizer and alert rules were running on zeroed cost/token data); and the terminal-outcome SSE frame now carries the `action` object (was `data: null`).
- **Fixed (workflows).** The execute and resume routes gate the parent terminal-outcome write on `status='running'` so a concurrent operator cancel is not clobbered, and resume transitions the parent out of `running` on a throw.
- **Fixed (middleware).** Auth and rate-limit error responses (401/403/429/503) now carry the same CORS headers their success responses set, so a configured cross-origin browser client can read the real status.
- **Docs.** MCP read-only resource count corrected from 4 to 6 across the SDK READMEs, the website `/docs` page, `mcp-server/README.md`, and the platform-intelligence reference docs.
- **Tests.** Added regression coverage for every fix above, plus the middleware API-key auth contract (fast path, slow path, readonly enforcement, cross-origin rejection) and first coverage for `GET /api/learning`.

### Code Sessions — multi-project live capture (`install-hooks --global`)

`node scripts/install-hooks.mjs --global` registers a capture-only `Stop` hook in `~/.claude/settings.json` so every project on the machine ships Claude Code sessions to DashClaw — not just repos with the hooks installed locally. It points at this repo's `hooks/dashclaw_stop.py` by absolute path, so credentials resolve from this repo's `.env.local` and **no API key is written into global config**; `git pull` upgrades the hook automatically. Capture-only means no `PreToolUse`/`PostToolUse` governance runs for other projects (the Stop hook's token-attribution step no-ops without governed actions). Existing third-party `Stop` hooks are preserved. `--dry-run` previews, `--global --uninstall` removes. Adds 9 unit tests.

- **Docs.** `DASHCLAW_CODE_SESSIONS_ENABLED` is now documented in `.env.example`; `hooks/README.md` gains a global-capture section; and the stale "gzip+base64 / 1 MB" ingest claims in `app/docs`, `cli/README.md`, and the CLI header comment are corrected to the raw-gzip wire transport (`x-dashclaw-encoding: gzip`, 40 MB skip ceiling) shipped earlier in `937bc438`.

### Phase 2c action binding — `act_status` + `urn:dashclaw:act-binding` (#121)

Narrows *what* a single verified token can do: an issuer commits the token to one
intended `(action, target, goal)` tuple at mint time, and the guard records whether
the incoming call matches — so a token minted to `read` one record can't be
repurposed to `delete` a different one (the prompt-injected / over-broad-token
threat). Design by @piiiico, scoped + corrected in review; merged 2026-05-30
(`b4c33c72`). Audit tripwire + opt-in block, defaulting `off`.

- **Server**: `app/lib/act-binding.js` is the single source of truth for
  canonicalization (a constrained RFC 8785 / JCS profile — string-forced,
  NFC-normalized, lexicographic keys) and the SHA-256 digest. Claim name is
  `urn:dashclaw:act-binding` (a URN, deliberately *not* `act`, to avoid the
  RFC 8693 actor-claim collision). The verifier (`jwks-verifier.js`) surfaces
  `act` + `act_typ_supported`; the guard (`guard.js`) resolves `act_status` ∈
  `not_applicable | match | mismatch | not_present | unsupported_typ |
  ctx_incomplete` over the **raw** request context and persists it.
- **Modes**: `DASHCLAW_ACT_BINDING=off|best_effort|required` (default `off` —
  needs issuer cooperation that doesn't exist yet) and
  `DASHCLAW_ACT_BINDING_TYP` (accepted `typ` allowlist). `mismatch` blocks under
  `best_effort`+`required`; `not_present`/`unsupported_typ`/`ctx_incomplete`
  block only under `required`. Status is recorded in **every** mode, including
  `off`, so operators can see when an issuer starts minting bindings.
- **Schema**: `drizzle/0012_guard_decisions_act_binding.sql` adds `act_status`
  (`DEFAULT 'not_applicable'`) + `act_hash` (claim-side digest only — the
  unfakeable half; never recomputed over the redacted context) plus a partial
  index on `act_status = 'mismatch'`. New optional `target` guard-input field.
- **Tests**: `__tests__/unit/act-binding.test.js` (canonicalization determinism +
  NFC, digest, parse, full `resolveActStatus` matrix) plus verifier + guard-engine
  block-wiring coverage.
- **Docs**: `docs/agent-identity.md` Phase 2c section (claim shape, canonicalization,
  `act_status` enum, mode matrix).

### Phase 2b jti replay protection — `replay_status` (#120)

Closes the capture-and-replay gap left by Phase 2 (signature-only verification):
a `verified` token captured inside its `exp` window can otherwise be replayed.
Design by @piiiico; merged 2026-05-15 (`b5aadac3`). Adds `jti` + a per-issuer
seen-set; first use is `unique`, a second use is `replayed`.

- **Server**: `app/lib/repositories/jti-replay.repository.js` — Postgres
  `jwt_replay_log`, composite PK `(issuer, jti)`, race-free
  `ON CONFLICT DO NOTHING RETURNING jti` check-and-record, 1% in-line sweep +
  `/api/cron/jti-sweep`. `/api/guard` returns `replay_status` ∈
  `not_applicable | disabled | unique | replayed | not_present | unavailable |
  exp_too_far`. The verifier also rejects tokens whose `exp` is more than the
  cap into the future (`exp_too_far`), defeating unbounded seen-sets.
- **Modes**: `DASHCLAW_JTI_REPLAY_PROTECTION=off|best_effort|required`
  (default `best_effort`); `DASHCLAW_JTI_MAX_TTL_SECONDS` (default 86400).
  `replayed`/`exp_too_far` always block; `unavailable`/`not_present` block only
  under `required` (closes the "hostile IdP strips jti" vector).
- **Schema**: `drizzle/0010_jti_replay_protection.sql` (the `jwt_replay_log`
  table + `replay_status`/`jti` columns on `guard_decisions`) and
  `drizzle/0011_*` (forensic partial index on `replay_status = 'replayed'`).
- **Docs**: `docs/agent-identity.md` Phase 2b section (modes, sweep, storage).

### Phase 2 agent identity — JWKS verification + `verification_status` (#104)

Cryptographic agent attribution layered on top of Phase 1 trust-on-assertion.
Originally PR #104 by @piiiico, rebased and merged on 2026-05-14 (`fb464879`,
`4b552f4e`). Provider-agnostic OIDC bearer tokens; fail-soft on JWKS outage;
JWT `sub` claim overrides body `agent_id` on successful verification (proof
beats self-assertion). See `docs/agent-identity.md` for the full setup guide.

- **Server**: `app/lib/jwks-verifier.js` (EdDSA / RS256–512 / ES256–512,
  1-hour JWKS cache per issuer, 30 s circuit breaker, 5 s fetch timeout).
  `/api/guard` now extracts `Authorization: Bearer <JWT>`, verifies via JWKS,
  and returns `verification_status: 'verified' | 'unverified' | 'expired' |
  'failed' | 'unknown_issuer'` on every response. Two new env vars (no YAML):
  `DASHCLAW_ALLOWED_ISSUER` (restrict trusted issuers) and
  `DASHCLAW_JWT_AUDIENCE` (validate `aud` claim).
- **Schema**: `drizzle/0008_guard_decisions_verification_status.sql` adds the
  `verification_status` column with `DEFAULT 'unverified'` (idempotent
  `ADD COLUMN IF NOT EXISTS`; existing rows valid without backfill).
- **Tests**: 20 unit tests in `__tests__/unit/guard-jwks-verification.test.js`
  using real Ed25519 keys + in-memory JWKS fixtures (no AgentLair dep).
- **Docs**: `docs/agent-identity.md` (140 lines, with Keycloak / Auth0 /
  AgentLair examples). `docs/sdk-parity.md` updated to "full parity".

### `/api/health` exposes `mode` field (todo-001)

Health endpoint now returns `mode: 'demo' | 'live'` derived from
`DASHCLAW_MODE` or `NEXT_PUBLIC_DASHCLAW_MODE`. The middleware short-circuit
that intercepts `/api/health` in demo mode also includes the field
(`middleware.js` — caught by post-merge audit; without this the Python hook
warning would never have fired against actual demo instances).

### Hook startup warning when `DASHCLAW_BASE_URL` points to demo (todo-001)

`hooks/dashclaw_pretool.py` does a 500 ms `GET /api/health` on first
invocation per `BASE_URL` (cached 15 min, per-URL key), and prints a
prominent stderr warning when `mode: 'demo'` is detected. Closes a
~30-minute debugging cliff: stale env vars silently routing real Claude
Code traffic to a local sandbox container, where fixture blocks looked
indistinguishable from real policy decisions. Cache hits are silent; probe
failures stay silent (no noise on transient outages); never blocks
enforcement. 4 regression tests in `hooks/tests/test_pretool_demo_mode_warning.py`
spin up an in-process HTTP server fixture.

### Demo policy fixture rename — unambiguous sandbox label (todo-002)

`app/lib/demo/demoMiddleware.js` and `app/lib/homepageDemoActions.js`:
`'Demo Production Guard'` → `'[Demo fixture] Production Guard'`. The old
label was indistinguishable from a real user-defined policy at first glance
— a real user (todo-002 source conversation) deleted their actual policies
trying to clear what looked like a real block. Reason text now leads with
`[Demo mode]` and tells the operator to repoint `DASHCLAW_BASE_URL` if a
real agent saw it.

### Livingcode pre-commit gotcha — known issue

`scripts/livingcode-refresh.mjs` regenerates derivative artifacts (zip
bundles, plugin SKILL.md, generated/) but does not `git add` them, so
pre-commit refresh produces dirty-but-uncommitted files. Today's audit
re-staged the stale `dashclaw-claude-code-hooks.zip`,
`dashclaw-governance-plugin.zip`, and plugin SKILL.md (`1eaff4c5`). The
zip hadn't been refreshed in committed form since `d23ccb45`. Worth a
follow-up to make the refresh stage its own outputs.

### `@dashclaw/mcp-server@1.0.2` — server-configured agent_id wins over LLM input

Followup to 1.0.1. Auto-derivation worked, but the LLM-supplied
`input.agent_id` was still being checked FIRST in `agentId()`, which meant
a prompt like "smoke test the MCP server fully" caused Claude to pass
`agent_id: "claude-mcp-smoketest"` in every tool call — overriding the
user's explicit `DASHCLAW_AGENT_ID="claude-desktop"` config.

Priority order is now correct: `client.agentId` (explicit env var /
CLI arg / auto-derived from MCP `clientInfo.name`) wins over the
tool-input field. The input field remains as a last-resort fallback for
configurations that intentionally run without a server-level default.

This closes the "agent_id spoofing via prompt" attack surface — a
malicious or confused prompt can no longer attribute its actions to a
different agent identity than the one the server was configured with.

### `@dashclaw/mcp-server@1.0.1` — auto-derive agent_id from MCP clientInfo

End-to-end testing surfaced a real UX cliff: Claude Desktop tool calls were
silently being bucketed under `claude-code` (or whatever default the server
fell back to) because the user's MCP config didn't set `DASHCLAW_AGENT_ID`
and no agent appeared on `/fleet` matching their `claude-desktop` API key.
The MCP protocol already identifies the connecting client via
`clientInfo.name` on the initialize handshake — the server just wasn't
reading it.

- **stdio transport** (`bin/dashclaw-mcp.js`): wraps the transport's
  `onmessage` after `server.connect()` to capture `clientInfo.name` from
  the initialize request. If `--agent-id` / `DASHCLAW_AGENT_ID` is unset,
  uses the captured name as the default `agent_id` for every subsequent
  tool call. Logs the derived value to stderr for transparency.
- **Quick Start docs** updated to mark `DASHCLAW_AGENT_ID` as recommended
  and explain the auto-derivation fallback. Most users want a friendly
  name like `claude-desktop` rather than the protocol-level `claude-ai`.
- **HTTP transport** (`/api/mcp`) is unchanged — it's stateless per-request
  so the initialize→tool-call handoff doesn't apply. Agent identification
  for HTTP MCP relies on caller-supplied `agent_id` in the tool body; a
  future fix can pull from `clientInfo.name` on the initialize response
  echo or from the API key's name.
- `createServer()` now returns `{ server, client }` instead of just
  `server`, so the bin can hold a reference to the client for the
  auto-derivation hook. Only `bin/dashclaw-mcp.js` consumes this factory
  function (the HTTP route constructs its own client), so the shape
  change is internal.

### Publishing & docs

- **`@dashclaw/mcp-server` published to npm.** The MCP server is now installable
  via `npx @dashclaw/mcp-server` instead of the local-path workaround. The
  package was structurally ready (`bin`, `exports`, `files` allow-list, scoped
  `@dashclaw/` name) but had never been pushed to the registry; the README,
  landing page, `/connect`, `/docs`, plugin templates, and managed-agent
  example all assumed it was published, so the actual `npm publish` closes a
  documentation-vs-reality gap.
- **Doc fixes for the 8-tool → 23-tool expansion.** Several surfaces still
  claimed "8 tools and 4 resources" from the v2.12 launch; they now reflect
  the 23-tool / 7-group reality (`mcp-server/README.md`, `README.md`,
  `app/page.js`, `app/landingData.js`, `app/docs/page.js`, `app/downloads/page.js`,
  `sdk/README.md`, `examples/managed-agent-mcp/`, `examples/README.md`, and the
  `dashclaw-platform-intelligence` skill references). The "6 groups"
  miscount in user-facing copy was also corrected to "7 groups". Historical
  changelog entries from v2.12 and the v2.17 expansion are left intact.
- **Hooks made cwd-independent.** `.claude/settings.json` hooks now resolve
  via `$CLAUDE_PROJECT_DIR` instead of relative or hardcoded paths, so they
  no longer fail when an agent `cd`s into a subdirectory.

## [2.18.0] - 2026-05-14 — Retract the monetization surface entirely

DashClaw is an open-source project for governing AI agents. The earlier
"50-integration trigger" pricing commitment (formerly MON-01 / Plan 03-03)
is fully retracted. There is no `/pricing` page, no public counter, no
Pro tier framing, no "Free while we grow" copy. The product is free.
That's it.

### Why retract

Two reasons surfaced over a few hours of dogfooding:

1. **The counter is structurally unfixable.** It read 0 indefinitely
   because the marketing-site Neon DB and a user's own DashClaw-instance
   Neon DB are different databases. The counter could only ever measure
   what hit the marketing site directly, which is approximately nothing.
   Either the metric has to change (phone-home consent, hand-curated
   attestations) or it has to go. The simplest answer was: go.
2. **The framing was a SaaS funnel pretending to be a commitment.** "Pro
   tier launches when…" reads apologetic ("we won't charge you yet")
   even when reframed as a public commitment. DashClaw is open source.
   It helps people control AI agents. There is no charging mechanic the
   project is building toward — so don't put one in the marketing.

### Deleted (full removal, not deprecation)

- `app/pricing/page.jsx`
- `app/api/monetization/verified-integrations-count/route.js` +
  parent `app/api/monetization/` directory
- `app/lib/repositories/monetization.repository.js`
- `docs/launch/` — three drafts (hn-post.md, blog-post.md,
  tweet-thread.md) that cited the live counter URL
- `scripts/check-launch-content.mjs` — the pre-launch gate that
  enforced trigger-commitment presence across the launch drafts
- Six tests:
  - `__tests__/unit/pricing-page.test.jsx`
  - `__tests__/unit/monetization-repository.test.js`
  - `__tests__/unit/readme-monetization-trigger.test.js`
  - `__tests__/unit/verified-integrations-count.route.test.js`
  - `__tests__/unit/launch-content-assertions.test.js`
  - `__tests__/unit/blog-post-claude-code-beachhead.test.jsx`
  - `__tests__/unit/project-md-content.test.js`
  - `__tests__/unit/require-tier.test.js` + the
    `__tests__/fixtures/pro-gated-route-fixture.js` fixture

### Tier infrastructure — neutralized, not ripped out

`requireTier()` in `app/lib/org.js` is called by seven routes (actions,
capabilities/invoke, keys, setup/migrate, team/invite, webhooks/stripe,
workflows/templates/execute). Rather than sweep those call sites, the
helper is now a no-op shim that always returns null — every org is
rank 1 in a `{ free: 1, pro: 1 }` ladder. The "Coming soon / 50 verified
Claude Code integrations / see /pricing" 403 branch is gone. Schema
columns (`organizations.plan`, `stripe_customer_id`, etc.) and the
Stripe webhook route are preserved as dormant infrastructure — they
don't appear on any user surface.

### User-facing surfaces scrubbed

- `README.md` — removed the "A public commitment, not a pricing
  strategy" section shipped earlier today.
- `app/components/PublicNavbar.js` — removed `/pricing` link (desktop
  + mobile menu).
- `app/components/PublicFooter.js` — removed `/pricing` link.
- `middleware.js` — removed `/api/monetization/verified-integrations-count`
  from `PUBLIC_ROUTES` and removed the demo-mode passthrough block.
- `app/blog/claude-code-beachhead/page.jsx` — removed the entire
  "50-integration commitment" section (~50 lines).
- `app/blog/codex-parity/page.jsx` — replaced the "Free for solo devs,
  same 50-integration commitment" bullet with "Free for everyone, no
  tier gating."
- `app/blog/layout.js` — removed the `/pricing` chrome-match comment.
- `docs/SECURITY.md` — removed the public-route entry for the now-deleted
  counter API.

### Planning docs

- `.planning/PROJECT.md` — Monetization commitment row and `[x]` Key
  Decisions item rewritten to reflect the retraction (history of the
  prior decision is in the commit log + earlier CHANGELOG entries).
- `DASHCLAW_README_REPOSITIONING_GOAL.md` moved to
  `.planning/seeds/readme-repositioning-goal.md` (root cleanup).
- `.planning/phases/03-public-launch/*` left untouched — the launch
  phase happened, this is what came of it.
- `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`
  left untouched as historical record.

### Auto-regenerated

`npm run livingcode:refresh` regenerated `app/lib/doctor/generated/`,
the platform-intelligence skill at all four mirror targets,
`docs/api-inventory.md` / `.json`, the OpenAPI spec, and both download
zips. Route count drops from 259 → 256 (three monetization routes gone).

## [2.17.2] - 2026-05-14 — MON-01 counter visible + accurate

Three fixes to the public-commitment surface. Together they take the
"0 / 50" reading on /pricing (which read as broken) to a live, accurate,
discoverable counter.

### `/pricing` is now linked from the public chrome

`PublicNavbar` (desktop + mobile menu) and `PublicFooter` both link to
`/pricing` now. Previously the page existed but was unreachable except
via direct URL — defeating the point of a public-commitment page.

### Counter no longer excludes the founder's own production instance

`countVerifiedIntegrations` default exclusion changed from
`['org_default', 'org_demo']` to `['org_demo']`. The original framing
treated `org_default` (founder's own dogfooded instance) as ineligible —
which produced a "0 / 50" reading on /pricing even while the founder
was actively governing coding-agent actions through DashClaw. That read
as broken. `org_default` *is* a verified coding-agent integration in
the wild, so it counts. `org_demo` (canned demo sandbox) still doesn't.
Tests that want the stricter "non-founder only" framing pass
`excludeOrgIds: ['org_default', 'org_demo']` explicitly.

### Counter API is no longer 403-gated by demo mode

`GET /api/monetization/verified-integrations-count` was already in
`PUBLIC_ROUTES`, but middleware's demo-mode block (line 1035) fires
before the PUBLIC_ROUTES bypass (line 1155). So the launch tweet's
publicly-cited live URL was returning 403 demo-mode for everyone except
the SSR pricing page. Added a passthrough next to `/api/marketing/`
(same reasoning: marketing site IS the demo deployment, this endpoint
returns aggregate-only data with no per-org leak).

### Pricing page hero reframed

Headline changed from "DashClaw is free while we grow." (apologetic
ramp tone) to "A public commitment, not a pricing strategy." Matches
the README reframe from earlier today. Subhead now enumerates the
free-forever surface explicitly: 23 MCP tools, 87 Node SDK methods,
235 Python SDK methods.

### Test coverage

- `monetization-repository.test.js` Case 5 updated to assert
  `['org_demo']` only; added negative assertion that `org_default` is
  NOT in the default exclusion.
- `pricing-page.test.jsx` continues to pass (only checks for the
  trigger commitment text, N/50 format, bullet lists, no-paywall, and
  no-hex — all preserved).
- `readme-monetization-trigger.test.js` continues to pass.

37/37 affected tests pass; lint clean.

## [2.17.1] - 2026-05-14 — Plugin + hooks bundles in livingcode-refresh

Follow-up to 2.17.0. The plugin tree and Claude Code hooks now get packaged
alongside the two skill zips on every `npm run livingcode:refresh`, so the
"upload to ClawHub" flow is one source-of-truth refresh away — no manual zip
step, no risk of shipping a stale plugin.

### New artifacts in `public/downloads/`

- `dashclaw-governance-plugin.zip` (~76K, 21 files) — full `plugins/dashclaw/`
  tree: all three plugin manifests (Claude Code / Codex / Hermes), MCP configs,
  both mirrored skills, assets, `PLUGIN_PARITY.md`. Manifest version v2.14.0.
- `dashclaw-claude-code-hooks.zip` (~80K, 22 files) — the four hook scripts
  (pretool, posttool, stop, code-session reporter), `dashclaw_agent_intel/`,
  default `settings.json`, and the test suite. Drop the unzipped `hooks/` into
  `<project>/.claude/`.

### Script changes

`scripts/livingcode-refresh.mjs`:
- `refreshSkillZip` generalized to `refreshBundleZip(srcDir, zipPath,
  manifestPath, excludeRe = null)`. Optional `excludeRe` lets the hooks bundle
  skip `__pycache__/` and `.pytest_cache/` so test runs don't churn the bundle
  hash. Old name kept as a back-compat alias.
- `hashDirectory` takes the same optional regex so the manifest-hash check
  agrees with what actually ends up in the zip.
- New `stageFiltered` helper copies filtered tree to a temp dir before zipping
  (PowerShell's `Compress-Archive` has no native exclude flag).
- `SOURCE_PATH_RE` widened: hand-edits under
  `plugins/dashclaw/{.claude-plugin,.codex-plugin,.hermes-plugin,assets,*.json,PLUGIN_PARITY.md}`
  and `hooks/` (minus the cache dirs) now trigger the refresh.
- `GENERATED_PATH_RE` extended to include the two new zip + manifest pairs so
  staging the regenerated artifacts doesn't loop back into a "needs refresh"
  signal.

### Downloads page

`app/downloads/page.js` surfaces both new zips:
- Plugins section: full plugin bundle as a primary download card above the
  per-ecosystem install commands.
- Hooks section: hooks bundle as a primary download card above the
  install-from-checkout commands.

## [2.17.0] - 2026-05-14 — Agent toolkit absorbed into the runtime

The Python `agent-tools/` CLI (52 files across 14 tools) is retired. Every operation
it provided is now a first-class governed surface — DB-backed, org-scoped, and
exposed as an MCP tool, an HTTP route, and (where it makes sense) a Hermes hook.
Agents that loaded `agent-tools/` previously should remove it and re-instrument
through the MCP server; the plugins for Claude Code, Codex, and Hermes Agent
pick up the new tools automatically.

### New tables (drizzle/0007_agent_toolkit_into_runtime.sql)

Three additive tables with proper FKs, `NULLS NOT DISTINCT`, quoted identifiers,
statement breakpoints, idempotent guards. `auto-migrate.mjs` applies them on every
Vercel deploy.

- `code_session_handoffs` — handoff bundle (`{summary, open_loops, decisions_made,
  state_snapshot, generated_at}`) keyed by `(org_id, agent_id, project_id)`, with
  `consumed_at` for one-shot semantics.
- `governed_secrets` — operator-tracked credential rotation metadata. No secret
  values stored; only names, rotation intervals, last-rotated timestamps.
- `skill_scan_results` — cached static-safety scan results, keyed by content hash
  to dedupe scans of identical skill files.

### 11 new API routes (4 stable + 5 experimental)

| Family | Routes |
|---|---|
| Session handoffs | `POST/GET /api/handoffs`, `GET /api/handoffs/latest`, `GET /api/handoffs/{id}`, `POST /api/handoffs/{id}/consume` (all `stable`) |
| Operator-tracked secrets | `GET/POST /api/secrets`, `PATCH/DELETE /api/secrets/{id}`, `GET /api/secrets/rotation-due` |
| Skill safety scan | `POST /api/skills/scan`, `GET /api/skills/scans/{id}` |

All routes follow the repository pattern (no direct route SQL) — see
`app/lib/repositories/code-session-handoffs.repository.js`,
`governed-secrets.repository.js`, `skill-scan-results.repository.js`. Sync
`getOrgId(request)` + `apiErrorResponse(...)` matching the rest of the runtime.

### 13 new MCP tools (8 → 23)

`mcp-server/lib/tools.js` adds six new groups behind a single discovery surface.
The plugin manifests (Claude Code / Codex / Hermes Agent) reference the same
on-disk `mcp-server/` — no separate npm publish; users get the new tools on the
next agent restart after a `git pull`.

- **Session continuity:** `dashclaw_handoff_create`, `dashclaw_handoff_latest`,
  `dashclaw_handoff_consume`.
- **Credential hygiene:** `dashclaw_secret_list`, `dashclaw_secret_due`,
  `dashclaw_secret_mark_rotated`.
- **Skill safety:** `dashclaw_skill_scan` (11-rule static detector; lookbehind
  `(?<![.\w])` to avoid method-call false positives; multi-line exfil; secret
  masking in stored findings).
- **Open loops (action-scoped):** `dashclaw_loop_add`, `dashclaw_loop_list`,
  `dashclaw_loop_close` — open loops attach to a parent `action_id`; close maps
  to `status: 'resolved'`.
- **Learning + retrospection:** `dashclaw_learning_log`, `dashclaw_learning_query`,
  `dashclaw_decisions_recent` — log non-obvious decisions; query prior reasoning;
  ledger of recent governed actions filterable by verdict / `since`.

Return shape was normalized to the existing `JSON.stringify(result)` MCP text
content protocol after a code-review round.

### Hermes Agent hooks — wire on_session_end / on_session_start / pre_llm_call

`.hermes/hooks/dashclaw_common.py` adds `post_handoff_create`, `get_handoff_latest`,
`post_handoff_consume` helpers. `on_session_end` packs `{summary, open_loops,
decisions_made, state_snapshot}` and POSTs `/api/handoffs`. `on_session_start`
fetches `/api/handoffs/latest`, caches the bundle on disk, and POSTs
`/api/handoffs/{id}/consume`. `pre_llm_call` injects the cached handoff bundle
(bounded to 1500 chars) on the first turn of a session, then degrades back to
the standard per-turn governance context.

Open loop / decisions collection retargets to existing routes after a code-review
round: `/api/actions/loops` (not a non-existent `/api/loops`) and
`/api/guard/decisions` (not `/api/decisions`).

### Governance skill — 6 new "when to use" sections

`plugins/dashclaw/skills/dashclaw-governance/SKILL.md` adds: Session Continuity,
Skill Safety, Credential Hygiene, Commitment Tracking, Learning From Prior
Sessions, In-Session Retrospection. Each section teaches the new MCP tool with
the action-scoped loop semantics and the operator-vs-agent boundary (e.g. agents
don't register secrets — that's an operator task — but they DO check rotation
due-dates before acting on credentials).

Plugin manifest version bumped 2.13.3 → 2.14.0 in all three (`.claude-plugin/`,
`.codex-plugin/`, `.hermes-plugin/`) reflecting the additive skill content.

### Retirement — agent-tools/ + /toolkit page

- Deleted `agent-tools/` (52 files, 11283 lines removed). Includes
  `sync_to_dashclaw.py` (the script there was no clear "where do I run this"
  answer for — that confusion is now gone because MCP tools are auto-discovered
  by every agent that loads the plugin).
- Deleted `app/toolkit/page.js`. Added a `/toolkit → /docs#mcp-tools` redirect
  in `next.config.js` so any stale link still lands somewhere useful.
- `PublicFooter.js`, `CONTRIBUTING.md`, `README.md`, and
  `docs/operator/first-15-minutes.md` updated to drop `/toolkit` references and
  point at MCP / Hermes / Codex installer commands instead.

### Generated artifacts

`livingcode-refresh.mjs` now mirrors `dashclaw-governance` into
`plugins/dashclaw/skills/dashclaw-governance/` as a third target alongside
`public/downloads/` and `~/.claude/skills/`. Platform intelligence snapshot
SHA-1 advances to `bdfbcfb2…`; route count `203 → 212`, table count `81 → 84`.

### Doc surfaces

- `sdk/README.md` — heading + surface-area version → 2.12.0; MCP section
  expanded from 8 tools to 23 across 6 groups; added "Agent runtime endpoints
  (server-side, no SDK wrapper)" pointer table.
- `sdk-python/README.md` — same MCP tool-count update; Node v2 method-count
  reference corrected from 80 → 87.
- `app/docs/page.js` — version line, MCP description, and tools table updated
  to reflect 23 tools across the 6 categories.
- `docs/sdk-parity.md` — three new rows in Non-SDK Surfaces table making
  explicit that handoffs / secrets / skill-scan are intentionally NOT in the
  SDK; agents reach them via MCP or hooks.
- `PROJECT_DETAILS.md` — title version, runtime version, npm package version,
  route count (230 → 259), and a new Tier 2 row for each of the three new
  surfaces.
- `CLAUDE.md` — Platform `2.13.3` → `2.14.0`, npm `2.11.1` → `2.12.0`,
  method-count `80` → `87`.
- `docs/sdk-reference.md` — `2.11.1` → `2.12.0`; method-count references
  updated.

### Verification

- `npm run lint`, `npm run docs:check`, `npm run openapi:check`,
  `npm run api:inventory:check` all clean.
- `npm test` — 2160 passing / 5 skipped (was 2137 — +23 new tests across
  schema, repositories, scanner, routes, MCP tools, Hermes hooks, governance
  skill, livingcode mirror, toolkit retirement).
- Production probe — `/api/handoffs/latest`, `/api/secrets`,
  `/api/skills/scan` all return 403 `Demo mode: endpoint disabled` from
  `www.dashclaw.io` (route + table present, gated by demo middleware as
  expected).

## [2.16.0] - 2026-05-13

### Security — `postcss` XSS via unescaped `</style>` (GHSA-qx2v-qp2m-jg93)

`next@16` pinned `postcss@8.4.31` in its dependency subtree; the rest of the
toolchain (vite, tailwind, autoprefixer, postcss-load-config, etc.) was
already on 8.5.10+. The top-level `postcss` devDep was at `^8` — semver-
compatible with 8.4.31 but allowing the fix. Bumped the direct devDep to
`^8.5.10` and added a wildcard override so next's nested copy resolves to
the patched version. `npm audit` clears to 0 vulnerabilities.

### Tooling — vitest excludes `.worktrees/`

Git worktrees can hold sibling-branch copies of the test suite with their
own divergent state. Adding `.worktrees/**` to `vitest.config.js exclude`
stops the runner from inadvertently picking up tests from co-located
worktrees (a `.worktrees/codex-parity/` worktree present on the host added
73 false-positive failures to the local run before the exclude landed).

### Weekly pricing-refresh workflow

`.github/workflows/refresh-model-pricing.yml` runs every Sunday at 05:00
UTC and on `workflow_dispatch`. Captures the dry-run diff for the PR body,
applies `npm run pricing:refresh:apply`, runs the pricing-adjacent test
suite (gating against regressions), and opens a PR on
`chore/pricing-refresh` via `peter-evans/create-pull-request@v6` only when
something actually changed.

One-time repo setup: Settings → Actions → General → Workflow permissions
→ Read and write + Allow GitHub Actions to create and approve pull
requests.

### Dynamic model pricing — driven by LiteLLM's community JSON

`npm run pricing:refresh` now syncs `app/lib/billing.js DEFAULT_PRICING` and
`app/lib/claude-code/pricing.js PRICES_PER_MTOK` against [LiteLLM's
`model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json),
the de-facto industry pricing source. Anthropic / OpenAI / Google don't
publish machine-readable rates; LiteLLM is the most widely-trusted
community-maintained mirror (~50K developers, weekly updates).

- Script writes to marker-bounded blocks (`MODEL_PRICING_GENERATED:*:START/END`)
  so hand-curated rows (unversioned family defaults, Codex, Llama variants
  LiteLLM doesn't track) stay outside the regen path.
- Dry-run by default; `--apply` to commit. Prints a per-pattern diff so
  rate changes are visible before the file write.
- Registry mapping in the script defines DashClaw-pattern → LiteLLM-key
  candidates per family. First match wins; misses are logged but don't
  fail the run.
- `__tests__/unit/refresh-model-pricing.test.js` locks in: per-million
  conversion, multi-candidate fallback, placeholder-entry skip, no-cache-
  columns handling, REGISTRY coverage, and the marker-replace contract.

Applied the first refresh; the live diff vs. the prior hand-maintained
table surfaced these real provider updates:

- **o3: input \$10 → \$2, output \$40 → \$8** (OpenAI's mid-2025 price cut).
- **o3-pro: input \$150 → \$20, output \$600 → \$80** (same cut).
- **GPT-4o / GPT-4o-mini / GPT-4.1 family: cache_read rates added**
  (previously \$0 — we were under-counting cache-heavy spend for those
  models the same way we did for opus-4-6).
- **o3-mini / o4-mini: cache_read rates added** (\$0.55 / \$0.275).
- **Gemini 2.5 Flash: input \$0.15 → \$0.30, output \$0.60 → \$2.50**,
  cache_read added at \$0.03.
- **Gemini 2.5 Pro: cache_read added at \$0.125**.

The next operator can re-run `npm run pricing:refresh` weekly (manually or
via a GitHub Action — workflow scaffolding is straightforward but not
included in this commit) to keep the table fresh.

### Pricing accuracy fix — Claude 4.5/4.6/4.7 family

Pre-LiteLLM-integration cleanup of the same root cause that drove the
Code Sessions vs Mission Control 6× cost divergence (see below). Both
pricing tables carried legacy Opus 4.1 rates (\$15/\$75) for every Opus
4-x — Anthropic dropped Opus 4.5/4.6/4.7 to \$5/\$25 (with \$6.25 cache
write, \$0.50 cache read). Sonnet 4.5 and Haiku 4.5 cache columns were
also missing; Haiku 4.5 input/output had \$0.80/\$4 (Anthropic publishes
\$1/\$5). All corrected to match
[platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing).

`scripts/backfill-code-session-cache-cost.mjs` is the path to recompute
historical `cost_usd` against the corrected rates — opt-in, dry-run by
default. The detail-page divergence flag now points operators at the
script.

### Bugfix — backfill script needed env loading

`scripts/backfill-code-session-cache-cost.mjs` silently returned 0 rows
when `DATABASE_URL` was unset (mock driver fallback). Switched to the
sibling-script pattern: `import './_load-env.mjs'` + `createSqlFromEnv()`
auto-loads `.env.local` and errors out with a clear message when the
env is missing.

## [2.15.0] - 2026-05-13

### Code Sessions polish (post-absorption follow-ups)

Same-day fixes and UX work landing on top of the 2.14.0 AgentLens absorption to take the Code Sessions surface from "shipped" to "usable end-to-end."

- **CLI ingest** — gzip+base64 payload encoding for large JSONL files (`302f835d`); the original `lines: string[]` shape inflated past Vercel's 4.5 MB body limit on transcripts over ~3.5 MB raw. New CLI cap is 30 MB raw. Retry-with-backoff added earlier for 429/5xx (`06855be9`). The 54 prior 413 errors against `~/.claude/projects` cleared to 1 (a single 10.6 MB transcript whose compressed payload still exceeds Vercel's hard edge — chunked POST is the only path past that).
- **Server body cap** — per-route override raising `/api/code-sessions/ingest-jsonl` from the global 2 MB middleware cap to 4.4 MB (`368f051a`). Vercel's 4.5 MB edge is the binding constraint above that.
- **Middleware matcher + page-route header injection** — `/code-sessions` and nested routes now run through middleware (`d9973217`). The page-route branch injects `x-org-id` / `x-org-role` / `x-user-id` from the session token (`368f051a`) so server components that read `headers().get('x-org-id')` resolve to the user's actual org instead of falling back to `org_default`. Fixes the "page renders empty despite 600 ingested sessions" bug.
- **Optimal Files panel** (`8de605ed`, `e2f0f92d`, `01690f79`, `7b9627f0`, `67391ac9`, `dfe427ac`) — moved into its own full-width section; group-by-category presentation with sentence-case labels and 1-line descriptions; per-row content preview with auto-expand for the top 2 manifestable rows per group; per-file Copy and Edit controls (textarea, "edited" badge, Reset to discard); edited content rides through to the manifest via `selections[i].content` and the server route honors the override after path-allowlist validation; primary CTAs (`Generate Optimal Files`, `Create manifest`) use the filled brand-orange treatment per `.impeccable.md`. Virtual placeholder paths (`(none — pattern needs more sessions)`) filtered from default selection so the 400 they used to cause is gone; server error bodies now surface in the panel for any future similar drift.
- **Signal overhaul** — payload `title` and `description` from each rule now render via `app/lib/claude-code/signal-labels.js`; named signals sort by severity × confidence; the 79+ `repeated_run` signals collapse into a single `<details>` cluster with confidence counts and top tools by call frequency.
- **Cost reconciliation divergence flag** — Code Sessions vs Mission Control costs now show a callout when they diverge >2× with three candidate causes. Token breakdown (input / output / cache_write / cache_read) added to the Summary card so the next root-cause investigation has numbers to read.
- **Timeline cap** — 50-message default with a `<details>` reveal for the rest; per-message tool-count badge.
- **Project session list** wrapped in `PageLayout` (`a45715b8`) — was missing the sidebar and used light-theme `zinc-*` classes that made the Source badge invisible.
- **CI portability** — `path.win32.isAbsolute` added to the `absolutize` path-traversal guard (`8b1de809`); on POSIX runners `path.isAbsolute` doesn't recognize `C:\Windows\System32` as absolute, so the guard was silently joining drive-rooted strings into the project tree.
- **Test regressions cleared** — cron-cache-crater test rewired to mock the refactored repository helpers after the route-SQL guardrail fix (`916a9485`); `bg-bg-primary` typo fixed to the real `bg-primary` token (`dfe427ac`) so the edit-mode textarea stopped rendering on a browser-default white background.

### AgentLens absorption — Phases 6-9 (final batch)

- **Phase 6 — Optimal Files routes + MCP tools.** `POST .../sessions/[id]/optimal-files/{preview,manifest,merge-preview}`, `GET /api/code-sessions/manifests/[id]` (24h TTL). Manifest endpoint validates paths against an allowlist (`CLAUDE.md`, `.claude/agentlens/`, `.claude/rules/`, `.claude/hooks/`, `.claude/skills/`) and refuses traversal. Two new MCP tools: `dashclaw_optimal_files_preview`, `dashclaw_optimal_files_manifest`. Tool-count expectations in `mcp-tools.test.js` and `mcp-route.test.js` bumped from 8 to 10.
- **Phase 7 — /goal autopsy, Subagent ROI, weekly memo.** `GET /api/code-sessions/sessions/[id]/autopsy` (uses `buildAutopsy` with messages + tool_uses + repeated-run detection). `GET /api/code-sessions/subagent-roi[?project_id=...]` prefers `action_records` chains when present (higher fidelity than JSONL re-derivation) and falls back to `code_session_tool_uses`. `GET /api/code-sessions/memos?project=<slug-or-id>` + `POST /api/code-sessions/memos/regenerate`. **Vercel cron `/api/cron/code-session-weekly-memo`** (Mondays 04:00 UTC) iterates code_projects with sessions in the trailing 7 days, saves one memo per (org, project, iso_week_tag) via the partial unique index on `code_session_memos`.
- **Phase 8 — MCP resources + archive + plugin notes.** `mcp-server/lib/resources.js` adds `dashclaw://code-sessions/projects` and `dashclaw://code-sessions/sessions/{session_id}`, both calling the existing REST routes via the bound client. Resource-count expectation bumped from 4 to 6. `__tests__/unit/mcp-server-code-sessions.test.js` smoke-tests presence + non-trivial descriptions for the new entries. AgentLens repo gets `C:\Projects\RevenueGoalExperiment-V3\ARCHIVED.md` pointing at this absorption (no deletions). DashClaw memory note + `CLAUDE.md` should also be updated by the operator after Wes runs the live smoke gate.
- **Phase 9 — operator scripts.** `scripts/repair-code-sessions.mjs` finds orphan `code_sessions` rows (no children) and re-ingests when `source='jsonl'` and the original JSONL still exists on disk; dry-run by default, `--apply` to write. `scripts/backfill-code-session-cache-cost.mjs` re-prices historical sessions through the new 5-arg `estimateCost` with cache extras; opt-in, dry-run by default, logs every change. Neither script modifies `action_records`.

### Verification gates (status at end of autonomous run)

- `npm test` — **2028 passing**, 5 skipped (pre-existing). Suite went from 1996 pre-Phase-1 to 2028 here, adding ~32 distinct route/repository/cron tests on top of the 149 new `claude-code/` algorithmic tests (counted under Phase 1).
- `npm run lint` — clean.
- Hook fail-silent regression — `hooks/tests/test_stop_fail_silent.py` covers `DASHCLAW_BASE_URL=""` + `DASHCLAW_CODE_SESSIONS_ENABLED=1` (Phase 3). Full Python hook suite **276 passing**.
- Pricing parity — `__tests__/unit/billing-cache.test.js` proves the 4-arg legacy `estimateCost` is bit-for-bit identical to the 5-arg call with `extras=null` on every `DEFAULT_PRICING` entry.
- `npm run db:migrate` against a fresh local Postgres — operator-run; the migration is `drizzle/0006_code_sessions.sql` per the corrected Phase 2 numbering. The pre-commit hook regenerates derivative artifacts on every commit; nothing else needs to run.
- Mission Control regression check, manual smoke list, real-session Wes-runs — all deferred to operator runs per the goal's hard rules ("Wes runs the live smoke gate himself"; no deployments or live ingestion from the autonomous build).

### AgentLens absorption — Phase 5: Code Sessions UI, signals/alerts wiring, weekly cron, learning bridge

- **Ingest now computes signals + alerts** in the same request. After `upsertSessionWithChildren` returns a non-skipped result, the route runs `detectRepeatedRuns` + the 7-rule optimizer, calls `replaceSignalsForSession`, then runs `detectForSession` (cost anomaly, stuck-loop streak, multi-project usage) and `insertAlerts` with the `code_session_alerts_dedup` ON-CONFLICT target. Wrapped in try/catch so a signals failure can't block ingest.
- **`/api/cron/code-session-cache-crater`** — Vercel cron at Monday 03:00 UTC. Auth = `Authorization: Bearer ${CRON_SECRET}` via `timingSafeCompare` (same shape as `/api/cron/outcome-sweep`). Iterates code_projects, sums this-week vs prior-week usage, runs `detectCacheCrater`, inserts alerts with `scope: 'project'`. Schedule added to `vercel.json` crons array.
- **`/api/learning/code-signals?period=7d|30d|90d`** — aggregates optimizer findings by `kind` for the last N days. Returns `{period, days, findings: [{kind, occurrence_count, session_count, total_savings_usd}]}`. Does **not** write to `learning_recommendations` (per A11-style read-only bridge contract).
- **UI under `app/code-sessions/`**:
  - `page.js` — projects table with session count + total cost + last-activity timestamp; empty-state copy points the user at the hook flag and the CLI.
  - `[projectId]/page.js` — per-project sessions list with source badge.
  - `[projectId]/[sessionId]/page.js` — three-panel session detail: Summary (with the **A10 Mission Control reconciliation tile** — shows the raw-cache cost side-by-side with the folded-cache Mission Control attribution), Signals, Timeline (messages + inline tool calls, with a "governed" badge linking to `/replay/<action_id>` when present).
- **Sidebar entry** under "Observe", between Security and Analytics, using the Terminal icon. Unread alert count is fetched and surfaced at the top of the projects page.
- **Tests** — `__tests__/unit/cron-cache-crater.route.test.js` covers the auth gate (503 / 401), the project iteration, and the alert insertion. Existing ingest tests still pass (the signals/alerts step is best-effort and doesn't change the existing response surface). Vitest full suite: 2025 passing (+3 from Phase 4). `npm run lint` clean.

### AgentLens absorption — Phase 4: local CLI (Path B)

Backfill path for sessions that pre-date the hook install, or that come from un-hooked Claude Code runs. Sibling package; no workspaces; treats `dashclaw` as an installed peer per the existing CLI design.

- **`dashclaw code` subcommand group** in `cli/bin/dashclaw.js`:
  - `dashclaw code ingest [--dry-run] [--projects-dir <path>]` — Path B JSONL backfill. Walks `~/.claude/projects` (or the platform-appropriate default, overridable via `CLAUDE_PROJECTS_DIR` or `--projects-dir`), stream-reads each `.jsonl` line-by-line, and POSTs to `/api/code-sessions/ingest-jsonl` with `source_host: 'jsonl'`. Slug = parent directory basename per addendum #3. Files larger than 50 MB are skipped with a stderr warning (chunked POST is out of scope). **Never** logs raw line content — per-file log line is just `{file, posted_lines, status, reason}`.
  - `dashclaw code memo --project=<slug> [--save]` — fetch and print the latest weekly memo. `--save` writes to `./memos/<weekTag>-<slug>.md`.
  - `dashclaw code apply <manifestId> --dest=<dir> [--yes] [--allow-redactions] [--overwrite]` — Phase 6 wire-up. Disk-side implementation lives in `cli/lib/code/apply.js`; the manifest API route arrives in Phase 6, at which point this command becomes end-to-end usable.
- **CLI never imports `app/lib/claude-code/*`** per A6. The vendored copy of the markdown merge helpers and the `_ensureInsideProject` path-traversal guard lives in `cli/lib/code/vendored.js` with a header comment pointing at the canonical sources.
- **`scripts/sync-cli-vendored-code.mjs`** — operator-run drift check. Each canonical source declares which symbols the vendored copy is required to expose (including the `absolutize` -> `_ensureInsideProject` rename); the script exits non-zero when any required symbol is missing. Auto-editing is intentionally out of scope to avoid silent overwrites of the renamed export.
- **`cli/package.json`** gets a `"test": "node --test test/**/*.test.js"` script; runs the new `node:test` suite under `cli/test/code/`. Vitest now excludes `cli/test/**` so the two runners don't trip over each other.
- **Tests**:
  - `cli/test/code/ingest.test.js` — env-var resolution; payload shape (slug, source_host, ISO mtime, raw-string jsonl_lines); dry-run reporting; live mode with a `node:http` stub server; `skipped_unchanged` passthrough from the server; HTTP error → per-file `error` record (no thrown exception); empty directory handled gracefully.
  - `cli/test/code/memo.test.js` — most-recent memo selection; `--save` writes to `./memos/`; empty list handled; HTTP error throws with code.
  - `cli/test/fixtures/claude-projects/` — 2 projects, 3 sessions, one with a repeated-Read pattern that exercises the parser end-to-end through the stub server.
- 12 new CLI tests passing. Vitest full suite 2022 passing (unchanged). `npm run lint` clean.

### AgentLens absorption — Phase 3: Stop-hook code-session reporter (Path A)

Opt-in path that lets the existing DashClaw governance hook stack also feed `code_sessions`. Telemetry stays primary; this is additive.

- **`hooks/dashclaw_code_session_reporter.py`** — new module imported lazily by `dashclaw_stop.py`. Gated by `DASHCLAW_CODE_SESSIONS_ENABLED` (accepts `1`/`true`/`yes`). Re-reads raw lines from the transcript (the parsed `entries` list isn't enough — the server needs bytes), slices since the previous cursor, looks up each new tool_use's `id` against a per-session map, and POSTs to `/api/code-sessions/ingest-jsonl` with `source_host: "hook"` and `project.slug = basename(dirname(transcript_path))` per addendum #3.
- **`hooks/dashclaw_pretool.py`** — `write_action_id` now also appends `<tool_use_id>\\t<action_id>` to `<tempdir>/dashclaw_session_tool_map_<session_id>`. Necessary because the existing per-tool_use temp file is cleaned up by PostToolUse before Stop fires, so there's no other persistent record of the mapping at end-of-turn. Six call sites pick up the new behavior automatically (no per-call-site change).
- **`hooks/dashclaw_stop.py`** — adds the `CODE_SESSIONS_ENABLED` constant and the post-`_apply`/pre-`_write_cursor` invocation. The body is wrapped in a try/except that logs to `dashclaw_hook_errors.log` and swallows; the fail-silent contract is preserved.
- **`hooks/tests/test_code_session_reporter.py`** — `unittest` integration test that stands up a `http.server.HTTPServer` on a random port, pre-seeds the session tool-map log, runs Stop as a subprocess, and asserts: ingest is POSTed exactly once; body shape matches A6; slug is the parent-directory basename; `tool_use_action_map` carries the pre-seeded `tu_42 -> ar_governed_1`; jsonl_lines are raw strings. Plus a "no POST when flag disabled" case and an idempotency case (second run with unchanged transcript posts zero times).
- **`hooks/tests/test_stop_fail_silent.py`** — regression test for the contract Wes called out in the goal hard-rules. Asserts that with `DASHCLAW_BASE_URL=""` + `DASHCLAW_CODE_SESSIONS_ENABLED=1` the Stop hook exits 0 with no stderr Traceback. Adds a second case for `BASE_URL="http://127.0.0.1:1"` (closed port) to cover the unreachable-server path.
- Five new Python tests; full suite 276 passing (was 271).
- Vitest: full suite 2022 passing — no regressions. `npm run lint` clean.

### AgentLens absorption — Phase 2: schema + repository + ingest endpoint + pricing extension

Schema, repository, REST surface, and cache-aware billing extension.

- **Schema** — 8 new tables in `schema/schema.js` and a hand-written `drizzle/0006_code_sessions.sql` migration:
  - `code_projects(id, org_id, slug, cwd, source_host, timestamps)` with `UNIQUE(org_id, slug)`.
  - `code_sessions(id, org_id, project_id, session_uuid, source, source_file, source_mtime, started_at, ended_at, message_count, model_primary, raw token totals incl. cache_read/cache_creation, cost_usd, cache_savings_usd, model_requests, jsonl_records, duplicate_fragments_skipped, naive_* mirrors, parser_version, timestamps)` with `UNIQUE(org_id, session_uuid)` and `CHECK source IN ('hook','jsonl')`.
  - `code_session_messages(serial id, session_id FK→code_sessions ON DELETE CASCADE, role, model, timestamp, token columns, request_id, message_id, text_preview)`.
  - `code_session_tool_uses(serial id, session_id FK, message_id FK→code_session_messages ON DELETE SET NULL, action_id FK→action_records.action_id ON DELETE SET NULL, name, target, tool_use_id, request_id, source_line)`.
  - `code_session_signals(serial id, session_id FK, kind, confidence, savings_usd, payload jsonb)`.
  - `code_session_alerts(serial id, org_id, project_id?, session_id?, kind, severity, scope, title, body, read_at)` + the manually-written **NULL-safe dedup unique index** `code_session_alerts_dedup` on `(org_id, kind, COALESCE(project_id,''), COALESCE(session_id,''))`. Named explicitly so the alerts upsert path can target it via `ON CONFLICT ON CONSTRAINT`.
  - `code_session_memos(serial id, org_id, project_id, iso_week_tag, body_md)` with `UNIQUE(org_id, project_id, iso_week_tag)`.
  - `code_optimal_file_manifests(id, org_id, session_id, project_cwd, plan jsonb, expires_at, created_at)`.
- **`app/lib/billing.js`** — `DEFAULT_PRICING` entries gained optional `cache_write` / `cache_read` rates for `opus-4-7` (18.75 / 1.50), `sonnet-4-6` (3.75 / 0.30), and `haiku-4-5` (1.25 / 0.10) per the AgentLens 4-column table. `estimateCost` gained an optional 5th `extras` argument carrying `{ cache_creation_tokens, cache_read_tokens }`; legacy 4-arg behavior is **bit-for-bit identical** (verified by an exhaustive parity test in `__tests__/unit/billing-cache.test.js`). Unknown models still return `0` with the one-time warn — extras ignored.
- **`app/lib/repositories/code-sessions.repository.js`** — full read/write surface on tagged-template SQL. `upsertSessionWithChildren` implements the non-atomic AgentLens semantics: freshness check → upsert parent → delete child rows → row-by-row insert of messages (capturing `RETURNING id`) → row-by-row insert of tool_uses (translating `messageIndex` to the new message FK and stamping `action_id` from `toolUseActionMap`). Source comment documents the non-atomic property and points at the Phase 9 repair script for crash recovery.
- **API routes** under `app/api/code-sessions/`:
  - `POST /api/code-sessions/ingest-jsonl` — single entry point for Path A (hook) and Path B (CLI). Validates `body.project.source_host` (`'hook'|'jsonl'`), derives `slug` from `cwd` basename when missing, runs the canonical JS parser on `body.jsonl_lines`, returns 400 `mismatched_session_uuid` when `body.session_uuid` disagrees with the parser, and refuses payloads above 200k lines.
  - `GET /api/code-sessions/projects` — list with session count + rollup totals.
  - `GET /api/code-sessions/projects/[projectId]/sessions` — paginated session list.
  - `GET /api/code-sessions/sessions/[sessionId]` — session + messages + tool_uses.
  - `GET /api/code-sessions/sessions/[sessionId]/insights` — tool events + repeated-runs + stored signals. Phase 5 will populate the signals.
  - `GET /api/code-sessions/alerts?onlyUnread=1&limit=50` + `POST /api/code-sessions/alerts/read-all`.
- **Tests** — 26 new ones across `__tests__/integration/code-sessions/` (route shape, slug derivation, mismatched-uuid 400, org isolation, parser_skipped counting, skip semantics passthrough), `__tests__/unit/code-sessions/repository-upsert.test.js` (exact statement order against `createSqlMock`, messageIndex→message_id translation, action_id stamping, idempotency short-circuit, missing-sessionUuid early return), and `__tests__/unit/billing-cache.test.js` (5-arg/legacy parity, cache pricing on the three Anthropic models, custom pricing with cache columns).
- **Migration runner** — `npm run db:migrate` will pick up `drizzle/0006_code_sessions.sql` automatically via `scripts/auto-migrate.mjs`. Wes runs this against his local Postgres.

### AgentLens absorption — Phase 1: pure module port

Ported the AgentLens (`C:\Projects\RevenueGoalExperiment-V3`) algorithmic core into DashClaw as `app/lib/claude-code/`. All modules are ESM, dependency-injected, and free of DB / HTTP / fs side-effects (except `optimal-files/apply.js` which holds the CLI-only disk writes). 149 new vitest tests pass under `__tests__/unit/claude-code/`, comfortably above the ≥140 floor stated in the phase exit gate.

- **`parser.js`** — v2 JSONL dedup (`requestId → message.id → row uuid`), redacted `safeTarget`, refactored per addendum #2 into an internal `_processLine` helper plus two wrappers: `parseSessionFile(filePath, { mtime })` (streams from disk via `readline`) and `parseSessionLines(lines, { mtime, sourceFile })` (in-memory, used by the future ingest endpoint).
- **`pricing.js`** — 4-column pricing table (input, output, cache_write, cache_read) preserving the raw cache signal that the 2-column `app/lib/billing.js` folds into `tokens_in`.
- **Optimizer** — `optimizer.js` + 7 rules in `rules/`: `MODEL_DOWNSHIFT`, `CACHE_WRITE_BLOAT`, `STUCK_LOOP_COST`, `SUBAGENT_PROMPT_BLOAT`, `REPEATED_READ_CYCLES`, `BAD_CACHE_HIT`, `CONTEXT_GAPS_DETECTED`. `buildSessionContext` dropped — context assembly moves to the repository layer in Phase 2.
- **Signals** — `repeated-runs.js` (confidence-labelled), `insights.js` (stuck loops, cost anomaly, cache health).
- **Alerts** — `alerts.js` with `PLAN_FIT` renamed to `MULTI_PROJECT_USAGE` (DashClaw has no free-tier upsell concept). SQLite SCHEMA + `persistAlerts`/`listAlerts`/`markAllRead` dropped; those move to the repository in Phase 2. Kept `detectForSession`, `detectCacheCrater`, `digestMarkdown`, `resolveScope`.
- **Goals / autopsy** — `goals.js` (`classifyOutcome`, `extractGoalText`, `buildAutopsy`, `topMoneyBuckets`). `buildAutopsyFromDb` dropped.
- **Memo** — `memo.js` reshaped to accept pre-loaded `sessions` / `priorSessions` / `findings` / `stuckLoopTotal` instead of running queries. `writeMemoToDisk` dropped (disk writes are CLI-only).
- **Subagent ROI** — `subagent-roi.js` (`computeRoi`, `recommend`). `buildInvocationsFromDb` dropped.
- **Audit** — `audit.js` reshaped to `buildAudit({ session, livedParse })`. The route layer is responsible for loading the stored row and (optionally) supplying a live re-parse for top-requests provenance.
- **CLAUDE.md generator** — `claudemd.js` reshaped to accept a `projectFiles: Map<relPath, content>` parameter instead of reading from disk. Missing entries produce a stub summary. Pure.
- **Hook generators** — `hooks-gen.js`. Renamed `agentlens-*` filenames to `dashclaw-*` and the state directory to `~/.claude-dashclaw`.
- **Optimal Files** — 10 modules under `optimal-files/`. `analyze.js` and `bundle.js` refactored per A4: dependency-injected aggregates (`projectMedianCost`, `similarSessionCount`), `projectFiles` map instead of fs probes, and an `existingPaths: Set<string>` argument for `overwriteRisk` instead of `fs.existsSync`. `writeBundleSelections` is now the pure `planBundleSelections`; the original side-effecting `applyBundlePlan` and `listGeneratedFiles` moved to a CLI-only `optimal-files/apply.js`. `previewBundleMerge` takes an `existingContent` string parameter.

The new tree imports as `@/lib/claude-code/...` thanks to the existing vitest alias. No schema changes, no API routes, no UI yet — those land in Phases 2 onwards.

## SDK [2.13.1] - 2026-06-01 — agent message read-state methods (Node)

Promotes the full agent-message surface to the main Node SDK at parity with the
live API and the legacy SDK. Node only — the Python SDK already exposes these.

### Added (Node — `sdk/dashclaw.js`)

- `markRead(messageIds)` / `archiveMessages(messageIds)` — `PATCH /api/messages`
  with `{ message_ids, action: 'read' | 'archive', agent_id }`. Fixes wrappers that
  called `claw.markRead(...)` and hit "not a function".
- `getSentMessages(...)`, `getMessages(...)`, `getMessage(messageId)` — read
  variants completing the surface. Node SDK now exposes 92 public methods (was 87).

## SDK [2.13.0] - 2026-05-15 — Phase 2 agent identity (`authToken` / `auth_token`)

First SDK release that ships the Phase 2 agent-identity client surface.
Pairs with the [Unreleased] platform Phase 2 entry above. Published to
both **npm** (`dashclaw@2.13.0`) and **PyPI** (`dashclaw==2.13.0`) on
2026-05-15.

### Added (Node — `sdk/dashclaw.js`)

- **`authToken` constructor option** — pass a JWT bearer token from your
  OIDC provider (Keycloak, Auth0, AgentLair, or any compatible issuer).
  When set, every outbound request includes `Authorization: Bearer
  <token>`. The server verifies via JWKS and the JWT `sub` claim
  overrides `agentId` in the audit record on successful verification.
- **`guard()` response shape extended** — now includes `verification_status`
  (`verified` | `unverified` | `expired` | `failed` | `unknown_issuer`),
  `agent_id`, and `agent_name`. JSDoc updated.

### Added (Python — `sdk-python/dashclaw/client.py`)

- **`auth_token` constructor parameter** (mirrors Node `authToken`).
- **`agent_name` auto-include on `guard()`** — when the constructor sets
  `agent_name` and the per-call `context` doesn't, the SDK now appends
  it to the payload. Closes a Phase 1 parity gap that pre-dated #104
  (Node SDK already did this).
- **`guard()` docstring** documents the `verification_status` enum and
  points at `docs/agent-identity.md`.
- 7 new unit tests in `sdk-python/tests/test_sdk_v2_surface.py` —
  constructor storage, agent_name auto-include behavior, and a
  `urllib.request.urlopen` patch that captures real headers to verify
  the Bearer token is sent (and that `x-api-key` still goes alongside,
  not in place of).

### Notes for SDK consumers

- Phase 1 trust-on-assertion (passing `agentId` / `agent_name` in the
  constructor or per-call body) keeps working unchanged. Phase 2 is
  fully additive — no breaking changes.
- Without `authToken` / `auth_token`, every guard response now carries
  `verification_status: 'unverified'`. That's the correct "no token
  presented" signal, not an error.
- On JWKS outage the server fails-soft to `'unverified'` (not `'failed'`)
  so a downed identity provider can never block agent decisions. Phase 1
  body-field attribution is the fallback.

## SDK [2.12.0] - 2026-05-13 — Durable execution finality wrappers

First SDK release that ships the durable-execution-finality client surface. Pairs with platform 2.14.0 below.

### Added

- **`reportActionOutcome(actionId, { status, summary?, error_message?, progress? })`** — record a terminal outcome via `POST /api/actions/:id/outcome`. One-shot at the repository layer; second call returns 409 with `current_status`. `status` must be `completed`, `partial`, or `failed`; `lost_confirmation` is reserved for the system sweep.
- **`getActionOutcome(actionId)`** — read the current outcome state via `GET /api/actions/:id/outcome`. Returns `{ status, outcome_at, summary, error_message, progress, elapsed_ms }`. Call before retry to avoid double-execution.
- **`reportActionSuccess(actionId, summary?)`**, **`reportActionFailure(actionId, errorMessage, summary?)`**, **`reportActionPartial(actionId, progress, summary?)`** — convenience wrappers for the three agent-reportable terminal states.
- **`deriveIdempotencyKey(parts)`** — SHA-256 hex digest of intent fields. Order-independent. Pass the result as `idempotency_key` on `createAction` so a retried create returns the existing row instead of inserting a duplicate.
- Equivalent Python SDK methods ship in the **`dashclaw`** PyPI package version `2.12.0` (snake_case: `report_action_outcome`, `get_action_outcome`, `report_action_success` / `failure` / `partial`, `derive_idempotency_key`).

### Notes for SDK consumers

The legacy `updateOutcome` PATCH flow still works and is now wired into the durable-finality contract on the server side (platform 2.14.0 below): if you call `updateOutcome(id, { status: 'completed' })` against a 2.14.0+ instance, the server implicitly sets `outcome_status` to match. New integrations should still prefer `reportActionOutcome` for retry-safe semantics, but legacy callers no longer trip the `lost_confirmation` sweep.

## [2.14.0] - 2026-05-13 — Durable Execution Finality

### Added

- **Durable execution finality (issue #105, Phases 1–6, commits `25599c35` → `5407b6ca`)**: every approved action now carries a five-state terminal outcome (`pending` → `completed` / `partial` / `failed` / `lost_confirmation`). Closes the audit-trail gap between "what was approved" and "what actually completed." See [`docs/architecture/durable-execution-finality.md`](./docs/architecture/durable-execution-finality.md).
  - **Schema** (`drizzle/0004_action_outcome_finality.sql`): six new columns on `action_records` (`outcome_status`, `outcome_at`, `outcome_summary`, `outcome_error`, `outcome_progress`, `idempotency_key`); CHECK constraint on the five terminal states; partial index on `pending` rows; conditional unique `(org_id, idempotency_key)` index. All `IF NOT EXISTS` / `IF NOT EXISTS`-guarded; `scripts/auto-migrate.mjs` applies idempotently.
  - **API**: `POST /api/actions/[actionId]/outcome` (one-shot CAS at the repository layer; 409 on double-terminate; rejects `lost_confirmation` from agents; 8 KB cap on progress payload; DLP redaction on summary/error/progress). `GET /api/actions/[actionId]/outcome` (returns current state + derived `elapsed_ms` for retry-safe polling).
  - **Cron sweep**: `/api/cron/outcome-sweep` (CRON_SECRET-gated, daily on Vercel Hobby, hourly externally if operators wire it up). Marks pending rows past their org's timeout as `lost_confirmation` and fires a `signal.detected` event of type `lost_confirmation` per swept row, with webhook delivery for subscribed orgs.
  - **Per-org timeout**: `DASHCLAW_OUTCOME_TIMEOUT_MINUTES` setting (default 15, clamped `[1, 1440]` minutes). Allow-listed in `app/lib/repositories/settings.repository.js`.
  - **Idempotency keys**: `POST /api/actions` accepts `idempotency_key`; on `(org_id, idempotency_key)` hit returns the existing row with `{ idempotent_replay: true }` and zero downstream work (no quota / guard / signature / insert). Unique DB index prevents race-condition duplicates.
  - **Node SDK wrappers** (Phase 3, ship in next `dashclaw` npm release): `reportActionOutcome`, `getActionOutcome`, `reportActionSuccess` / `Failure` / `Partial`, `deriveIdempotencyKey`.
  - **Python SDK wrappers** (Phase 4, ship in next `dashclaw` PyPI release): `report_action_outcome`, `get_action_outcome`, `report_action_success` / `failure` / `partial`, `derive_idempotency_key`.
  - **Dashboard**: outcome filter on `/decisions`; new `OutcomeBadge` component (`pending` / `completed` / `partial` / `failed` / `lost` with token-driven semantic colors); terminal-state badge on each row when non-pending; Final Outcome badge plus summary/error line on the action detail page.
  - **Webhook event catalog**: new `lost_confirmation` event type (parallel to existing `cost_exceeded`, `stale_action`, etc.). Subscribers filter via `events: [...]` on the webhook config.
  - 28 new unit tests covering repo-layer CAS enforcement, route 409 / 404 / DLP handling, sweep auth and fan-out, SDK wrapper signatures, idempotency-key short-circuit (no-key → no lookup, hit → no downstream work, miss → normal path), and the helper hash properties (identical / differs-on-change / order-independent / type-validated).
- **Sweep guard against false-positive `lost_confirmation`** (commit `1605ba33`): `/api/cron/outcome-sweep` now skips actions whose legacy `status` column is already terminal (`completed`, `failed`, `cancelled`, `blocked`). Without this guard, every existing integration that uses `updateOutcome` (OpenClaw plugin, Claude Code hooks, any SDK consumer calling `claw.updateOutcome`) would have its completed actions re-marked as `lost_confirmation` 15 minutes after creation — producing misleading signals, grey "Lost" badges on `/decisions`, and webhook noise. Genuinely orphan actions (status `null` / `running` / `pending` / `pending_approval`) still sweep as intended.
- **Implicit durable-finality outcome on legacy PATCH** (commit `86af80a0`): `updateActionOutcome` atomically sets `outcome_status` when the caller transitions `status` to a terminal value AND `outcome_status` is still `pending`. Mapping: `completed` → `completed`; `failed` / `cancelled` / `blocked` → `failed`. Respects the one-shot rule, so an explicit `reportActionOutcome` call always wins. Legacy integrations now get first-class durable-finality semantics — agents calling `getActionOutcome` against a legacy-terminated action see the correct terminal state without code changes on the integration's side.

### Fixed

- **BUG-04 (Hook audit-trail gap on guard outage)**: `dashclaw_pretool.py` no longer silently exits 0 when `/api/guard` is unreachable. In enforce mode (default), the hook now blocks the tool (exit 2). In observe mode, it proceeds but logs the action to `~/.dashclaw/orphan-actions.jsonl` so the audit record is recoverable on guard recovery. New env var `DASHCLAW_GUARD_UNAVAILABLE_POLICY=block|warn|allow` (default `block`) governs enforce-mode behavior. Structurally same failure class as BUG-02 — both are silent governance without audit.
- **Docker build for `better-sqlite3@12.10.0`** (commit `0f07fc50`): `node:20-alpine` deps stage now installs `python3 make g++` so node-gyp can compile native modules when no prebuilt musl/x64 binary is published upstream. Unblocks the GHCR demo image workflow that broke after dependabot PR #114 bumped `better-sqlite3` from 12.9.0 to 12.10.0.
- **API inventory `last-verified` stamp** (`scripts/generate-api-inventory.mjs`): the frontmatter date is no longer hardcoded. It now reflects the actual regeneration date, with an `API_INVENTORY_VERIFIED_DATE` env override for deterministic CI/snapshot builds. Previous behavior left every regen with a permanently stale `2026-02-13` stamp.

### Docs

- **README repositioning** (commit `8bb3c7f8`): hero rewritten as "Govern AI agents before they act." Claude Code reframed from product identity to one of six integration paths (MCP server, SDK, Claude Code hooks, OpenClaw plugin, direct REST + webhooks, platform-intelligence skill). New "What DashClaw does" + "Durable execution finality (v2.13.3)" + "Safety and governance model" + "Approvals beyond the dashboard" sections. Net diff: 184 insertions / 310 deletions (tighter doc).
- **`QUICK-START.md`**: Option A / Option B split; full required-env list for the Vercel deploy path (matches the deploy-button URL); switched to `npm run setup` over `node scripts/setup.mjs` for consistency; added a retry-safe-outcomes callout box pointing at `reportActionOutcome` and the finality spec; added Python SDK reference to Essential Docs.
- **`sdk/README.md`**: Claude Code Hooks section now describes all three hooks (`dashclaw_pretool.py`, `dashclaw_posttool.py`, `dashclaw_stop.py`) plus the `dashclaw_agent_intel/` tool-classification module; recommends `npm run hooks:install` over manual `cp`. New "Durable Execution Finality" subsection in Core Runtime inventory listing the six new methods. Plus the existing detailed "Action Outcome" code-block subsection in Execution Studio.
- **`docs/architecture/durable-execution-finality.md`**: full design spec including five-state machine, retry semantics, sweep architecture, failure modes, and open questions. Cron-cadence prose accurately documents the daily-on-Hobby + hourly-externally tradeoff.
- **`docs/sdk-parity.md`**: new "Action outcome (durable execution finality)" row showing full Node + Python parity. Date stamp bumped. Canonical Node Surface bullet list updated to mention the new methods.
- **`PROJECT_DETAILS.md`**: Core Runtime route table now lists `POST/GET /api/actions/:actionId/outcome` and `/api/cron/outcome-sweep` with the honest "Daily on Vercel free tier; operators can run hourly externally" cadence note.
- **`public/downloads/dashclaw-platform-intelligence/references/api-surface.md`** (shipped skill bundle): new Action Recording row + "Durable execution finality (v2.13.3+)" prose block. Auto-mirrored to `.claude/skills/...` via `npm run livingcode:refresh`.

## [2.13.3] - 2026-04-21 — Parallel-Reviewer Round

A five-agent parallel review over axes the earlier sweeps hadn't touched
(app/api/_archive reachability, workflow executor state machine, file
upload handling, CSP/non-API headers, performance / N+1 / indexes)
surfaced 10 findings plus 2 moot audits. 9 atomic commits between
`91a7fb36` and `fe4c2d09` closed all 8 fix-worthy findings; 1 was a
verified false positive (filename XSS — React text nodes auto-escape)
and 2 audits came back clean (archive routes are unreachable by Next.js
convention; page-route security headers are already complete via
next.config.js).

### Security

- **Workflow cancel CAS** (F1, `7864cabd`): `cancelWorkflowRun` read
  `status='running'` then UPDATEd to `'cancelled'` with no gate in the
  WHERE clause. A concurrent executeWorkflow completing between the
  read and the UPDATE had its terminal status/output/timestamp
  overwritten — the completed workflow's result became irretrievable.
  UPDATE now carries `AND status = 'running'` + RETURNING, and a lost
  race re-reads the current status so the route surfaces "already
  completed" instead of silently stomping.
- **Attachment MIME verification** (F4+F5, `6e7a13ec`):
  `POST /api/messages` previously took the client's `mime_type` on
  faith — an attacker could upload HTML/JS bytes labelled
  `application/pdf` and GET would echo them back at our origin.
  `verifyMagicBytes` now sniffs PNG / JPEG / GIF / WebP / PDF / JSON
  structure and returns 400 on mismatch. GET also sets
  `X-Content-Type-Options: nosniff` as a second line against browsers
  that ignore `Content-Disposition: attachment`.
- **Per-org attachment storage quota** (F8, `fe4c2d09`): per-attachment
  (5MB) and per-message (3 attachments) caps existed but total DB
  footprint was unbounded. New `MAX_ORG_ATTACHMENT_BYTES` (default
  100MB, env-configurable via `DASHCLAW_MAX_ORG_ATTACHMENT_BYTES`) with
  a SUM(size_bytes) check on upload returning 413 with detailed
  usage/incoming/quota.

### Data integrity / state machines

- **Step result CAS** (F3, `6bd614ba`): `updateStepResult` had no status
  guard, so a duplicate persistStepResult call, a stale retry from an
  in-flight resume, or a natural completion racing against the cancel
  cascade could silently overwrite a terminal row. Added
  `AND status = 'running'` — first writer to transition out of running
  wins; later writers match zero rows.
- **Resume by step.id, not positional index** (F2, `384a780f`): the
  executor's "is this step reused?" check used
  `steps.indexOf(step) < resumeContext.resumeFromIndex`, comparing the
  OLD run's index against the (possibly edited) CURRENT template.
  Template edits between runs silently misaligned the check — a new
  step inserted before the failure point would cause all subsequent
  completed steps to re-execute. Switched to
  `resumeContext.priorSteps?.[step.id]` — stable across edits.

### Performance

- **getAgentTrustPosture parallelized + consolidated** (F6, `0b8ac660`):
  7 serial SQL round-trips per agent-profile view → 5 parallel queries
  with the three action_records COUNTs collapsed into one scan with
  FILTER clauses. Roughly 35ms → 5ms per view against Neon.
- **Hot-path indexes** (F7, `91ce92b8`): six indexes on four tables
  that had zero coverage —
  `idx_activity_logs_org_created`,
  `idx_webhook_deliveries_org_status`,
  `idx_webhook_deliveries_webhook_status`,
  `idx_guard_decisions_org_created`,
  `idx_eval_scores_org_action`,
  `idx_eval_scores_run`. Dashboard listings, retry-delivery checks,
  and evaluation analytics flip from Seq Scan to Index Scan on the
  next ANALYZE.
- **workflow_step_results index** (F11, `b52958b9`): single-column
  `idx_workflow_step_results_run_action` so the LATERAL aggregation
  in listWorkflowRuns scales with page size (≤100) rather than total
  step history.

### Observability

- **knowledge_search token accounting** (F10, `8701d998`): embedding
  tokens from the OpenAI embeddings call now propagate through
  `generateEmbeddings` → `searchCollection` → `handleKnowledgeSearch` →
  `action_records.tokens_in`. Previously every knowledge_search step
  wrote zero tokens regardless of query length — a metering blind
  spot for non-prompt step types. capability_invoke stays at 0/0 (no
  token semantics from our side; it's an opaque HTTP call).

## Systematic Hardening Follow-Up - 2026-04-21

After the April 21 sprint closed, a fresh round of pattern-class audits
surfaced a second batch of issues — each a systematic class rather than
a one-off finding. 13 atomic commits between `c7dbcbef` and `48c3fd60`;
full test suite ran between every commit (1639 tests passing).

### Security

- **BUG-03b — local-password admins were silently read-only across every
  admin-gated UI** (`c7dbcbef`, `bed8fc04`, `4a8b302e`, `6925a6e4`): 14
  client components and one hook derived `isAdmin` from NextAuth's
  `useSession()`, which only reads the `next-auth.session-token` cookie
  and ignores the `dashclaw-local-session` cookie issued by
  `POST /api/auth/local`. Any self-hoster who signed in with
  `DASHCLAW_LOCAL_ADMIN_PASSWORD` saw the orange READ-ONLY banner on
  `/approvals`, `/decisions`, `/identities`, `/integrations`, `/webhooks`,
  `/api-keys`, `/routing`, and `/approve`, was auto-redirected away from
  `/login` even while signed in, couldn't accept invite links, and
  received no realtime SSE events. Fix: new `/api/session/effective`
  endpoint backed by the existing `getViewerContextFromCookieHeader`
  helper (which already unifies both auth paths), plus a new
  `useEffectiveRole` hook that every admin-gated UI now consumes.
  Regression test `__tests__/unit/approvals.page.test.jsx` pins the
  five settled/admin/member/local-admin/endpoint-fail states.
- **SSRF consolidation — 6 more outbound-fetch call sites pinned to
  validated IPs** (`405381ca`, `48c3fd60`): `safeUrlWithIps` +
  `buildPinnedDispatcher` exported from `app/lib/webhooks.js` and adopted
  by `app/lib/knowledge-ingest.js`:`fetchSourceContent` (member-reachable
  via `POST /api/knowledge/collections/[id]/items`),
  `app/lib/routing/router.js` (`dispatchToAgent` + `fireCallback`, both
  used their own duplicate SSRF helper with no DNS pinning),
  `app/lib/notification-adapters/slack.js`,
  `app/lib/notification-adapters/discord.js`, and
  `app/lib/integration-health.js` (discord checker). Router loses ~50
  lines of duplicated validation. DNS-rebinding window closed across the
  whole outbound fetch surface now.
- **Admin-role gate on 8 mutation handlers** (`85dc50a7`):
  `POST /api/drift/alerts` (run detection / compute baselines / record
  snapshots), `PATCH|DELETE /api/drift/alerts/[alertId]`,
  `POST /api/prompts/templates`,
  `PATCH|DELETE /api/prompts/templates/[templateId]`,
  `POST /api/prompts/templates/[templateId]/versions`, and
  `POST /api/prompts/templates/[templateId]/versions/[versionId]` all let
  any authenticated member mutate org-wide state — a silent privilege
  escalation where non-admins could reshape the governance surface for
  the whole org. Each now returns 403 on `getOrgRole(request) !== 'admin'`,
  matching the pattern already enforced on /policies, /identities, /team,
  /webhooks, and /orgs. New regression test on drift/alerts POST pins the
  member-rejection path.
- **`force-dynamic` pass across 21 tenant-aware routes** (`2b8f3db5`):
  Most were implicitly dynamic via `request.headers` access, but the
  explicit `export const dynamic = 'force-dynamic'` prefix was missing.
  `/api/health`'s `GET()` took no request arg and was the highest-risk
  case — eligible for static build-time caching despite reading live DB
  state. 181/181 of the other tenant-aware routes already carried the
  prefix; this closes the remaining 21 for consistency.

### Deploy correctness

- **Orphaned Drizzle migrations — 0001-0003 never landed on fresh
  deploys** (`6ed2f0db`): `scripts/auto-migrate.mjs` hardcoded the read
  path to `drizzle/0000_clammy_falcon.sql`, so the three migration files
  that followed it were silently skipped. Any Vercel deploy was landing
  a schema frozen at 0000 — `agent_sessions`, `session_events`,
  `organizations.hosted_mode`, `trial_action_cap`, `trial_actions_used`,
  `api_keys.scope`, the `agent_pairings.permission_level` column, and the
  `agent_messages(org_id, action_id)` index all never existed. Iterate
  `drizzle/*.sql` in filename order; the pgvector `skippedTables` set
  persists across files so ALTERs in later migrations against skipped
  tables are handled correctly.
- **Hotfix — `agent_pairings` / `agent_identities` missing from the
  original schema** (`c6ffe28c`): Once 0002 started actually running (per
  the fix above), the ALTER on `agent_pairings.permission_level` tripped
  `42P01 relation does not exist` on fresh Neon databases. Both tables
  had been added to `schema/schema.js` but never made it into
  `0000_clammy_falcon.sql`. Prepend `CREATE TABLE IF NOT EXISTS` for
  both + the `agent_identities_org_agent_unique` index to 0002; existing
  installs are untouched.
- **Role allowlist constraint on `users.role` + `api_keys.role`**
  (`10845ab5`): Both columns were plain `TEXT DEFAULT 'member'` with no
  enum or CHECK, so typos (`'Admin'`, `'administrator'`) and stale
  import values could silently grant or withhold permissions. Added
  drizzle `check()` definitions and a null-repair-then-ADD-CONSTRAINT
  block to the DDL. If any row holds an unexpected value the constraint
  trips loudly so the operator reconciles manually.

### Observability

- **12 empty catch blocks surfaced** (`d4d9b130`): Audited every
  `} catch {}` in live code; 6 are legitimate cleanup (useRealtime
  `es.close()`, events.js Redis unsubscribe, OnboardingChecklist
  localStorage, downloadable script JSON parsers, test mock). The other
  12 hid real failures. User-action paths (drift acknowledge/delete,
  compliance export/schedule delete/toggle) now `alert()` matching the
  existing convention on the same pages. Background/server paths
  (`fetchHealth` in integrations, three signal categories in signals.js)
  now `console.warn` with context so operators can debug when a whole
  signal category stops producing.

## Bug Hunt Sprint - 2026-04-21

Three consecutive read-only sweeps by parallel reviewer agents surfaced
60 real bugs plus 2 false positives. Every finding was fixed as an
atomic commit with the full test suite run between each. See commits
`92ab6823` through `58982c6c` on main for the per-fix detail.

### Security (high-severity)

- **RCE in `custom_function` scoring / evaluations** (F36): `extractRawValue` in `app/lib/scoringProfiles.js` and `_executeCustomFunction` in `app/lib/eval.js` both evaluated org-supplied JavaScript via the `Function` constructor on bodies stored by any org member through the scoring-dimension or scorer APIs. The resulting function had full access to the enclosing realm (`process.env`, `require`, filesystem, network). Both call sites now run the body inside a `node:vm` context seeded with only the allowed fields and a 100ms timeout; the outer realm is unreachable from the sandbox.
- **Webhook SSRF — DNS rebinding** (F39): `assertSafeWebhookUrl` resolved DNS and validated that every returned IP was public, but `fetch` then re-resolved the hostname at connect time. A short-TTL attacker-controlled record could pass the initial check then flip to `127.0.0.1` before the socket opened. `deliverWebhook` and `deliverGuardWebhook` now build an `undici` `Agent` whose `connect.lookup` is pinned to a validated IP and pass it to fetch via `dispatcher`.
- **`/api/setup/migrate` unauthenticated post-init** (F56): The route was in `PUBLIC_ROUTES` with no handler-side auth. Any unauthenticated POST re-ran DDL, forced `plan='pro'` on `org_default`, and — if `DASHCLAW_API_KEY` was set — seeded a predictable `api_keys` row. Now: public during first-run bootstrap (before `org_default` seeded), gated after that with a Bearer token matching `DASHCLAW_API_KEY` (timing-safe) or an admin-role `api_keys` row.
- **Turnstile fails closed in production** (F05): `verifyTurnstile` returned `{ ok: true, bypassed: true }` whenever `TURNSTILE_SECRET_KEY` was absent — so an operator who deployed with `DASHCLAW_HOSTED=true` but forgot the secret served a completely unprotected workspace-provisioning endpoint. The bypass is now gated on `NODE_ENV !== 'production'`; production refuses to run without the secret.
- **Webhook audit log no longer fire-and-forget** (F35): `deliverWebhook` and `deliverGuardWebhook` used `.catch()` on the `webhook_deliveries` INSERT, returned `success:true` before the audit row committed. Now awaited — returns carry `delivery_logged: boolean` so downstream tooling can distinguish "delivered and logged" from "delivered but audit lost".
- **`POST /api/messages` tenant-verifies `from_agent_id`/`to_agent_id`** (F33): Previously accepted the caller-supplied value with no org-ownership check, letting a valid API key holder spoof messages as originating from any agent in any org. Now rejects with 403 if the agent isn't in the caller's org.
- **Access-rule uniqueness via DB constraints** (F04): `createAccessRule` used a separate SELECT duplicate-check followed by an INSERT. Two partial unique indexes on `capability_access_rules` (agent-specific and org-wide-default) now enforce uniqueness at the DB level; route catches `23505` for the "already exists" error.
- **Workflow template admin gate** (F32): `POST` / `PATCH` `/api/workflows/templates[/:id]` previously accepted any authenticated org member. Now requires `x-org-role: admin` like the sibling `DELETE` already did.
- **Timing-safe cleanup-secret** (F58): `app/api/hosted/cleanup/route.js` replaced `===` with `timingSafeCompare` for both `HOSTED_CLEANUP_SECRET` and `CRON_SECRET` paths.

### Data integrity / state machines

- **Action PATCH terminal-state gate** (F03): The non-`close_if_running` PATCH path called `updateActionOutcome` with no `gateStatus`, so the WHERE clause's `(gate IS NULL OR status = gate)` fired unconditionally. Any caller could PATCH a `completed`/`failed`/`blocked` action back to `running` and rewrite its `output_summary`. Close-fields (status/output_summary/timestamp_end) now pass via a `status='running'` gate and terminal rows return 409; token/cost/model fields apply unconditionally so late billing reconciliation still lands.
- **Open-loop PATCH atomic compare-and-set** (F07): Two concurrent operators resolving the same loop could both pass the separate status-check read, both fire the UPDATE, silently clobbering one operator's `resolution` text. Collapsed to a single `UPDATE ... WHERE status = 'open'`; zero-row result triggers a single lookup to distinguish 404 from 409.
- **Assumption PATCH compare-and-set on `invalidated`** (F31): Concurrent invalidation requests both passed the read-check-then-update pattern and clobbered each other's `invalidated_reason`. Added `gateInvalidated` option to `updateAssumption` that appends `WHERE invalidated = 0`; route returns 409 when the gate fails.
- **Workflow execute orphan rescue** (F59): Any exception inside `executeWorkflow` bypassed `updateActionOutcome`, leaving the parent action `status='running'` forever and firing `workflow_stuck` + `stale_running_action` signals on every subsequent cron tick. `executeWorkflow` is now wrapped in a try/catch that marks the parent `failed` before re-throwing.
- **Eval runs — run-scoped distribution + CAS on pending→running** (F51+F52+F54): `getEvalRun`'s distribution query aggregated across every run sharing the scorer; `executeEvalRun`'s UPDATE had no current-state guard so double-POSTs double-wrote `eval_scores`. Added `run_id` + `scorer_id` columns to `eval_scores` (schema migration), write them from the executor, filter the distribution exclusively on `run_id`, and gate the `pending→running` transition with an atomic CAS.
- **`updateProfile` / `updateRiskTemplate` COALESCE action_type** (F40): `action_type = ${val ?? null}` overwrote the column with NULL on every PATCH that omitted the field. Swapped to `COALESCE` consistent with every other column.
- **Learning recommendations — upsert-then-prune** (F55): `rebuildLearningRecommendations` cleared every row before upserting the new batch, leaving the table empty mid-rebuild. Reordered: capture `batchTime`, upsert (stamping `updated_at=now`), then DELETE only rows with `updated_at < batchTime`.
- **Doctor migrate surfaces real DDL errors** (F09): Non-SAFE_CODES errors were silently logged as Warnings and skipped. Now returns `applied:false` with the first error code and message.
- **auto-migrate fatal on non-SAFE DDL** (F45): Same silent-skip pattern in the build script. Now throws. Includes pgvector cascade (skip CREATE TABLE and all its dependent indexes/FKs when the extension is unavailable on CI).

### Infrastructure

- **`publishOrgEvent` dual-publish** (F37): Memory backend was published to on every call regardless of selected backend, causing duplicate SSE frames when Redis was active and a memory subscriber also existed. Now publishes only to the selected backend; falls back to memory only on Redis error.
- **`require('resend')` crashed in ESM** (F38): `sendSignalAlertEmail` threw `ReferenceError: require is not defined` on every call — silently caught, so signal emails have never been delivered. Swapped to `await import('resend')`.
- **WorkflowEditor stale closures + node-ID counter** (F23+F26): Interleaved drag+connect dropped the most recent change from the saved `steps_json`. Node IDs were a module-level mutable counter shared across every mounted editor and StrictMode double-invocation. Fixed with nested functional setters + `useRef`-scoped counter.
- **`GuardSimulation` bad React imports** (F22): Imported `useActionState`, `useOptimistic`, `transition` — none exist in React 18. Dropped the dead imports.
- **`/approvals` optimistic removal** (F25): A 200 with a malformed body still passed `res.ok` and the row vanished locally, then reappeared on the next 10s poll. Replaced optimistic filter with `await fetchPending()`.
- **Mission Control cross-tab dismiss sync** (F27): `dismissedSet` memo only re-read localStorage when `signals` changed, so a dismiss in another tab stayed invisible indefinitely in a quiet system. Added `storage`-event listener.
- **`useRealtime` inline callbacks** (F24): `RecentActionsCard`, `FleetPresenceCard`, `RiskSignalsCard` passed un-memoized arrows; the hook's ref-sync effect fired every render. Wrapped each in `useCallback`.
- **Sessions DDL check pinned to globalThis** (F41): Every serverless cold-start re-ran the four `CREATE TABLE / CREATE INDEX` statements. Now pinned to `globalThis.__dashclaw_sessions_table_checked` like `app/lib/db.js`.
- **LivingCode** — stale-lock auto-recovery (F11), snapshot lexical sort for NTFS (F12), `sensing.py` errors now logged to `.organism/errors.log` (F17), `increment_cycle_counter` O_EXCL file lock (F19), heartbeat `_safe_timestamp` deduped with `state.py` (F20).

### API contract changes (callers will notice)

- `PATCH /api/actions/:id` returns `409` for terminal-state modifications (F03).
- `PATCH /api/assumptions/:id` returns `409` on concurrent invalidate-then-invalidate (F31).
- `POST /api/messages` returns `403` for `from_agent_id` / `to_agent_id` not in the caller's org (F33).
- `POST` / `PATCH /api/workflows/templates[/:id]` now require `x-org-role: admin` (F32).
- `POST /api/setup/migrate` returns `401` after `org_default` is seeded unless an admin Bearer token is provided (F56).
- `MCP dashclaw_wait_for_approval` response shape now includes `denied: boolean` and `denial_reason: string|null` so MCP agents can distinguish operator denial from approval (F44).
- `MCP notifications/initialized` now returns `204 No Content` instead of a spurious jsonrpc frame (F15). JSON-RPC compliant.
- `GET /api/cron/reset-meters` semantic changed: now purges prior-period rows instead of the broken archive-then-delete that wiped the current period (F01+F02). Fail-closed on `CRON_SECRET`.
- `POST /api/capabilities/:id/invoke` now honors capability-level `require_approval` rules and returns `202` with `pending_approval` (F08).

### SDK + tooling

- **Python `submit_feedback` auto-injects `self.agent_id`** (F42). Matches JS SDK behavior — feedback rows are no longer unattributed when caller omits the field.
- **`backfill-embeddings.mjs` safe-by-default** (F43): Added `--apply` (defaults to dry-run), `--org` filter, `--limit`, and `sql.end()` cleanup. Matches sibling `backfill-null-model-cost.mjs`.
- **Stop hook timestamp** (F46): `datetime_now_iso()` in `hooks/dashclaw_stop.py` now returns `Z` suffix instead of `+00:00`.

### Observability / operator UX

- **Doctor rate-limit backing-store warning** (F06): New check warns when hosted mode is active on a serverless platform without a shared rate-limit store — the in-memory limiter resets on every cold start.
- **Doctor config check stops coercing `'info'` to `'pass'`** (F10).
- **Signal hash + overlap repairs** (F60+F61+F62): `hashSignal` now includes `session_id` and `provider` so same-agent/different-resource signals dedupe correctly. `staleRunning` query excludes `workflow_execute` so a stuck workflow no longer fires two simultaneous signals (`stale_running_action` + `workflow_stuck`).

### Test infrastructure

- **Vitest env-var auto-reset** (F50): `unstubEnvs: true` added to `vitest.config.js`. Previously 15+ test files set `process.env.X` in `beforeEach` without restoring — safe only because the default `forks` pool isolates each file. Now robust to pool changes.
- **Demo fixture isolation** (F48): `_cached` singleton removed — `getDemoFixtures()` rebuilds per call so demo writes don't mutate the canonical fixtures in place.
- **Demo guard ReferenceError** (F47): `demoGuardPost` referenced an undeclared `shouldBlock` on the unknown-agent fallback branch, causing a stack-trace-leaking 400 on every demo request from non-seeded agents.
- **Demo recommendations missing `active` field** (F49): The demo filter now returns non-empty results.

### Minor

- `drift.js` DRIFT_METRICS deep-frozen and validated against a safe-character allowlist (F53) — defensive hardening against any future config-sourced metric.
- Scoring GET — radix + cap on `limit`/`offset` (F13).
- Agent heartbeat `status` enum-validated (F34).

### Deployment notes

- **Schema migration**: `eval_scores` gains `run_id` and `scorer_id` columns; `capability_access_rules` gains two partial unique indexes. Auto-applied on next deploy via `auto-migrate.mjs`. Run `npm run db:migrate` locally after pulling.
- **No env-var changes**.
- **No breaking SDK changes** — SDK version unchanged.

## [2.13.2] - 2026-04-13

### Added

- **Telegram approval bridge (optional).** When an action lands on `pending_approval`, DashClaw can push an inline Approve/Reject prompt to a Telegram admin chat; one tap on the phone resolves the action through the same `/api/approvals/:id` path as the dashboard, CLI, and mobile PWA. New inbound webhook at `POST /api/telegram/webhook` (Bot API callback sink, authed via `X-Telegram-Bot-Api-Secret-Token` header plus chat-id allowlist). New outbound emitter `fireTelegramApproval(action, sql, orgId)` in `app/lib/telegramApprovals.js`, fired alongside `fireActionAlert('pending_approval', …)` in `app/api/actions/route.js`. Four new env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_APPROVER_ORG_ID`), one kill switch (`DASHCLAW_ALERTS_TELEGRAM=false` to disable even when the token is present), and two npm scripts (`npm run telegram:register`, `npm run telegram:verify`). Feature is off unless `TELEGRAM_BOT_TOKEN` is set; if Telegram is unreachable, DashClaw warn-logs and moves on — approvals stay available on every other surface. Spec: `docs/superpowers/specs/2026-04-13-telegram-approval-bridge-design.md`. Plan: `docs/superpowers/plans/2026-04-13-telegram-approval-bridge.md`.

### Fixed

- **Race condition in `recordApproval`** (affects both `/api/approvals/:id` and the new `/api/telegram/webhook`): added `AND status = 'pending_approval'` to the atomic UPDATE so concurrent approve/deny taps from multiple surfaces can't both succeed. Callers now handle zero-row return as "already resolved."
- **Vercel serverless freeze** dropping fire-and-forget notifications (Discord alerts, Telegram approvals, generic webhooks): wrapped in `after()` from `next/server` so the work survives past response return.

## @dashclaw/openclaw-plugin [1.0.1] - 2026-04-11

### Fixed
- **`waitForApproval` was called with the wrong `action_id`, starving the PWA approval queue.** `packages/openclaw-plugin/src/index.ts` called `client.waitForApproval(decision.action_id)` on the `require_approval` branch, where `decision.action_id` is a row in the `guard_decisions` table (prefix `act_gd_…`, written by `app/lib/guard.js:218`). But `waitForApproval` polls `GET /api/actions/:id`, which resolves against the `action_records` table — so the wait target never existed, the operator never saw the action in the PWA queue, and the plugin either timed out or failed in a confusing way. The flow is now **createAction first, then waitForApproval on the action_records ID**, which matches what `/api/actions/route.js:291-301` actually returns for `pending_approval` cases (HTTP 202 with `action.status='pending_approval'`). The fix also trusts the server's `action.status` over the guard advice, so actions the server independently gates (e.g. capabilities with `requires_approval=true`) are waited on correctly even when guard itself returned `allow`. `dashclaw` peer dep bumped to `^2.11.1`.

## Docs & Surface Sync - 2026-04-11

### Changed
- **`sdk/README.md`**: Added a dedicated **Human-in-the-Loop (HITL) Approval Flow** section with the canonical `guard → createAction → waitForApproval → updateOutcome` sequence, and an explicit warning that `waitForApproval` must be passed the `action_id` from `createAction()`, not the decision ID from `guard()`. Governance Loop example updated to check the guard decision and branch on `action.status`. Fixed `renderPrompt` signature (was `renderPrompt(context)`, actually `renderPrompt({ template_id, version_id, variables, record })`). Fixed `GuardBlockedError` description — it is only thrown by the SDK's `_request` on HTTP 403 with a block decision payload, not every time `guard()` returns `block`. Heartbeat note now correctly attributes the implicit-heartbeat behavior to **platform 2.13.0** (not the SDK package version).
- **`PROJECT_DETAILS.md`**: Replaced the obsolete "5-method core surface" claim with the real v2 method count — **80 methods** across Core Governance, Decision Integrity, Scoring, Execution Studio, Sessions, Messaging, Handoffs, and Capability Runtime, verified against `sdk/dashclaw.js`. Core Runtime route table now has 8 rows (was mis-titled "7 endpoints"). Added explicit note about the `next.config.js` rewrites for `/api/actions/signals`, `/api/actions/assumptions`, and `/api/actions/:id/approve` so the relationship between legacy and canonical paths is documented.
- **`CLAUDE.md`**: Fixed the Tech Stack line that still said "SDK: v2 (5-method core surface)" — now lists current versions (platform 2.13.1, `dashclaw` 2.11.1, 80 methods) and points to `sdk/README.md` and `docs/sdk-parity.md`.
- **`docs/agent-bootstrap.md`**: Rewrote the golden-path example — previously it called `guard()` and immediately ignored the decision before calling `createAction()`, which would have let a `block` decision sail through into production. Now checks `decision.decision`, throws `GuardBlockedError` on block, and shows the `action.status === 'pending_approval'` + `waitForApproval(action_id)` branch.
- **`docs/prompts/dashclaw-agent-connect.md`**: Same anti-pattern fix in the smoke-test example. Also fixed a silent v1/v2 import mix — the pairing example used `claw.createPairingFromPrivateJwk(...)` against the bare `'dashclaw'` import, but that method only exists in the legacy subpath; the example now explicitly imports from `'dashclaw/legacy'`.
- **`app/docs/page.js`**: Removed the stale "Phase 1 — no SDK wrapper methods exist yet in Node or Python" banner from the Execution Studio section (every surface there has had a v2 SDK wrapper since 2.10.0). Quick Start sample now shows the approval branch. `createAction` and `waitForApproval` MethodEntry cards updated with HITL guidance and the action-ID distinction. Version stamp bumped to 2.11.1.
- **`QUICK-START.md`**: Governance loop now shows the optional approval step as step 3, with a link to the canonical HITL flow in `sdk/README.md`.
- **`docs/architecture/runtime-api.md`**: Removed the obsolete "DashClaw SDK v2 is a 1:1 wrapper for this minimal API surface" claim — the v2 SDK spans 80 methods, not 4. Minimal governance loop example now shows the approval branch. Legacy-support section now references the specific `next.config.js` rewrites.
- **`.planning/codebase/ARCHITECTURE.md`**: Fixed the broken `import dashclaw from 'dashclaw'` syntax (that was a default import; `DashClaw` is a named export and the default would resolve to `undefined`). Methods list updated from 5 to 80 with domain summary.
- **`README.md`** (root): Documentation section now points to `sdk/README.md` as the canonical SDK reference, plus `sdk-parity.md`, `PROJECT_DETAILS.md`, and `runtime-api.md`. Removed the stale `docs/sdk-reference.md` link from the Drift Detection row. Root `package.json` pin for `dashclaw` bumped from `^2.10.0` to `^2.11.1`.
- **`CHANGELOG.md`**: Added a "Two version tracks" header explaining that SDK (2.11.x) and platform (2.13.x) move on separate cadences, so readers no longer get whiplash when `[SDK 2.11.1]` appears above `[2.13.1]`.

### Archived
- **`docs/sdk-reference.md`**: Retired as a second source of truth. This file had drifted to claim "45 methods" while the real v2 surface had grown to 80, and was missing the entire HITL flow, Execution Studio surfaces (workflow templates, model strategies, knowledge collections, capability runtime), Sessions, and the canonical `execution.capabilities.*` namespace. Content preserved at `docs/archive/sdk-reference-2026-04-11.md` with a prominent "do not trust this" banner. The file at `docs/sdk-reference.md` is now a thin pointer that redirects to `sdk/README.md` and `docs/sdk-parity.md` so old links still resolve.

### Verified
- **`docs/api-inventory.md`** regenerated via `npm run api:inventory:generate` — zero diff against the prior snapshot, so 217 routes / 40 stable / 20 beta / 157 experimental is still accurate. `last-verified` bumped to 2026-04-11.
- **`docs/sdk-parity.md`** reviewed domain-by-domain against the 80-method v2 surface. No corrections needed — this doc was the most trustworthy SDK reference in the audit. `last-verified` bumped to 2026-04-11.
- **`public/downloads/dashclaw-platform-intelligence/SKILL.md`** title stamp corrected from `(v2.8)` to `(platform 2.13.1, SDK 2.11.1)`.

## SDK [2.11.1] - 2026-04-11

### Fixed
- **Legacy SDK starved the approval queue on `require_approval`** (`sdk/legacy/dashclaw-v1.js:_guardCheck`): the guard handler treated `require_approval` as equivalent to `block`, so in `guardMode='enforce'` it threw `GuardBlockedError` **before** `POST /api/actions` ever fired. The server therefore never persisted a `pending_approval` row, `fireActionAlert('pending_approval')` and the `approval_pending` webhook never ran, and the approval queue UI stayed empty even though the guard-decision callback still surfaced a "Requires approval" notification on the home screen. Only `block` is a hard stop now; `require_approval` falls through so the server's own `evaluateGuard` re-evaluation can set `actionStatus='pending_approval'` and the row lands in the queue. Also hardens the warn-mode log line against guard decisions that carry a scalar `reason` instead of a `reasons[]` array. Adds 4 regression tests (`__tests__/unit/sdk-legacy-guard-approval.test.js`) covering block/enforce, require_approval/enforce, hitlMode off, and hitlMode='wait'. Ships as `dashclaw/legacy` subpath export of the `dashclaw` npm package. The v2 Node SDK (`sdk/dashclaw.js`) and the Python SDK are not affected.

## [2.13.1] - 2026-04-10

### Fixed
- **Capability runner sent request body on GET/HEAD**: `app/lib/capability-invoke.js:singleAttempt` unconditionally attached `body: JSON.stringify(...)` regardless of HTTP method, causing undici to throw `"Request with GET/HEAD method cannot have body"` and blocking every GET/HEAD-based capability (HN Story Detail, HN Top Stories, IP Geolocation) from ever testing successfully. Body and `Content-Type` are now gated on whether the normalized method can carry a request body. Method is normalized to uppercase so `method: "get"` is treated the same as `"GET"`. Adds 5 regression tests covering GET, HEAD, lowercase method normalization, auth header preservation on bodyless requests, and POST round-trip.
- **Workflow template vars produced `"[object Object]"`**: `app/lib/template-vars.js:resolveString` used `String(resolved)` when substituting `${...}` placeholders inline, which returned the literal string `"[object Object]"` for any object-typed value. This silently broke the Daily Market Briefing workflow's `analyze` step — Claude correctly diagnosed the bug from inside the prompt: *"the strategic context and Hacker News stories were both passed as [object Object]"*. Objects and arrays are now `JSON.stringify`-ed inline so prompts see real content. Single-variable templates still return the raw value so downstream code can destructure the object directly.
- **Capability handler corrupted array responses**: `app/lib/step-handlers.js:handleCapabilityInvoke` returned `{ ...result.data, elapsed_ms }`, which spread arrays into numeric-keyed objects. HN Top Stories' `[47719602, 47719942, ...]` response came out as `{ "0": 47719602, "1": 47719942, ..., "elapsed_ms": 29 }`, breaking any downstream step that referenced `${steps.fetch_news.output}` as an array. Arrays are now preserved as-is; object responses still get `elapsed_ms` merged in; primitives get wrapped as `{ data, elapsed_ms }` for a stable downstream shape.
- **Demo seed endpoints had drifted**: `scripts/seed-demo-capabilities.mjs` pointed Team Notification at `httpbin.org/post` (which now returns 503s and 20s+ latencies exceeding the capability timeout) and Publish Briefing at `dpaste.org/api/` (which now returns 405 Method Not Allowed). Swapped to `postman-echo.com/post` and `jsonplaceholder.typicode.com/posts` respectively. Adds `scripts/patch-demo-capability-endpoints.mjs` — an idempotent one-shot patch script for upgrading existing instances whose capability rows have the known-broken endpoints.
- **Seed workflow prompt step used wrong config field**: The `analyze` step in `scripts/seed-demo-capabilities.mjs` wrote `config.prompt`, but the step handler in `app/lib/step-handlers.js:handlePrompt` expects `config.prompt_template` and throws `"prompt step requires prompt_template"` at execute time. Renamed the field in the seed script. The new `scripts/verify-demo-e2e.mjs` also includes an idempotent auto-healer that migrates any already-deployed workflow template still using the legacy field name before executing.

### Added
- **`scripts/verify-demo-e2e.mjs`**: Single-command end-to-end verification script for the Market Intelligence Briefing demo against a live DashClaw instance. Prompts for the admin API key and (if missing) the Anthropic API key, health-checks the instance, auto-heals drifted capability endpoints and workflow step configs, tests all 5 demo capabilities individually, executes the Daily Market Briefing workflow, and prints per-step outputs (HN stories, full LLM briefing text, webhook response, published resource) along with a pass/fail summary. Defaults to `https://my-dashclaw.vercel.app` with `--url` / `DASHCLAW_URL` override. Zero new dependencies (Node built-ins only).
- **`.impeccable.md` design context**: Canonical design context for DashClaw — users, brand personality (Serious · Precise · Trustworthy), aesthetic direction, 4 anti-references, and 7 tiebreaker design principles. Wired into `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` so coding agents consult it before any UI, design, copy, or marketing change.

## [2.13.0] - 2026-04-09

### Added
- **Agent Profiles**: Full governance profile per agent at `/agents/[agentId]`. Vitals strip (status, name, action count, last seen), trust posture (permission level, identity verification, signature enforcement, active policies, approval record, blocks), active signals, filtered decision history with expandable rows, assumptions track record, and policies section. New `GET /api/agents/[agentId]/profile` endpoint and `getAgentTrustPosture` / `getAssumptionsSummary` repository functions.
- **Policy Builder (Shields)**: Complete rebuild of `/policies` as a shields-first experience. 8 pre-built safety switches (Deploy Gate, High Risk Review, Critical Risk Block, Destructive Ops Block, Rate Limiter, API Call Review, Secret Exposure Guard, Outbound Message Gate) toggleable instantly. Three tabs: Shields (default), Custom (full CRUD + AI generator + YAML import), Activity (guard decision feed with risk score breakdowns). Inline configure panels per shield type with auto-save, risk score explainer, and agent scope picker.
- **Cost & Usage Analytics** (`/analytics`): Hero stats with trend comparison (total cost, actions, active agents, avg latency), cost trend area chart, action volume stacked bar chart, breakdowns by agent / action type / policy enforcement, and token efficiency summary with top consumers. Time range toggle (7d / 30d / 90d). New `GET /api/analytics` endpoint.
- **Guard Decisions API** (`GET /api/guard/decisions`): Query guard decision history with filters (decision type, agent_id), pagination, and 7-day stats.
- **59 new route tests**: Covering core governance routes (approvals, assumptions, signals) and tier 2 extension routes (knowledge collections, model strategies, operations feed, operations summary).
- **Webhooks sidebar entry**: Existing `/webhooks` page now accessible from the Configure sidebar section.

### Changed
- **All plan quotas removed**: Free, pro, business, and enterprise tiers all have Infinity limits. DashClaw is fully unlimited while open-source. Metering infrastructure preserved for future monetization.
- **Implicit heartbeat on action submission**: `POST /api/actions` now auto-updates agent presence. Agents that actively submit actions show as "online" without requiring explicit `heartbeat()` calls.
- **Mission Control responsive header**: PageLayout header now wraps gracefully at narrow widths. Non-essential items (LIVE indicator, agent filter) hide at small breakpoints.
- **Mission Control readability**: All `text-[10px]` bumped to `text-xs` (12px). Low-contrast `text-zinc-500`/`text-zinc-600` labels bumped to `text-zinc-400`. Fleet agent names brighter. View Decisions button redesigned as borderless pill.

### Fixed
- **Operations feed "now" bug**: Signals from `computeSignals()` now carry `detected_at` using the best source timestamp. The operations feed no longer displays every signal as "now".
- **Runtime card stuck loading**: Operations summary queries individually wrapped in `safe()` fallbacks. `PERCENTILE_CONT` replaced with `AVG`/`MAX` for broader Postgres compatibility. Card shows "Unable to load" error state instead of infinite spinner.
- **Shield toggle overflow**: Toggle knob on shield cards now stays within card bounds (fixed `translate-x` overflow with proper `left` positioning + `overflow-hidden`).
- **AI Generator navigation**: Fixed AI Generator button in Custom policies tab to open an inline panel instead of navigating to a separate page with no sidebar.
- **Skeleton.js JSX transform**: Renamed `app/components/ui/Skeleton.js` to `Skeleton.jsx` to fix vitest transform errors in tests that imported it.

## [2.12.0] - 2026-04-09

### Added
- **Market Intelligence Briefing Demo**: Full-stack demo seeding knowledge collections, 5 real-API capabilities, 3 guard policies, a model strategy, and a 5-step workflow. Run `node scripts/seed-demo-capabilities.mjs` then execute "Daily Market Briefing" from Workflows. Exercises every major DashClaw feature in one workflow run. See `DEMO.md`.
- **DashClaw MCP Server**: New `@dashclaw/mcp-server` npm package exposing DashClaw governance as an MCP server. 8 tools (guard, record, invoke, capabilities_list, policies_list, wait_for_approval, session_start, session_end) and 4 resources (policies, capabilities, agent history, status). Dual transport: stdio for Claude Code/Desktop, Streamable HTTP at `/api/mcp` for Claude Managed Agents.
- **Managed Agent MCP Example**: New `examples/managed-agent-mcp/` — the recommended way to govern Claude Managed Agents with DashClaw. ~120 lines vs ~410 in the custom tools example. One config line gives the agent full governance.
- **DashClaw Governance Skill**: New `dashclaw-governance` skill at `public/downloads/dashclaw-governance/` for Claude Managed Agents. Teaches agents the governance protocol (risk thresholds, guard decisions, recording rules, session lifecycle) and loads org-specific policies/capabilities from MCP resources. Upload with `node scripts/upload-skill.mjs`.

## [2.11.0] - 2026-04-07

### Added
- **`livingcode` Python Framework**: DashClaw now monitors its own codebase health as a living organism. Zero-dependency Python module (`livingcode/`) implements a 5-collector sensing layer, immune system, tiered planner, lifecycle orchestrator, heartbeat runner, and CLI — all stdlib only.
- **5 Sensing Collectors**: `git_stats` (bus factor, stale branches, commit velocity), `test_health` (JS + Python test counts, untested routes), `code_quality` (files over limit, TODOs, ESLint status, archive size), `dependency_health` (npm audit, outdated packages), `ci_health` (30-day pass rate via `gh` CLI, graceful degradation).
- **Immune System**: 6 checks (4 hard-block: CI gates, OpenAPI contract, test regression, dependency safety; 2 soft-warn: file length, SDK parity) → verdict (`merge` / `fix_required` / `needs_discussion`).
- **Tiered Planner**: 5-tier work item prioritization (Critical → Regression → Maintenance → Improvement → Growth) from sensing data. Backlog persisted to `.organism/backlog/`.
- **Lifecycle Orchestrator**: SENSE → PLAN → REVIEW → REFLECT cycle with kill switch, cycle lock, consecutive failure tracking (3 failures → pause), and cycle history.
- **Heartbeat Runner**: Quick mode (post-commit: git_stats + code_quality, ~1s) and full mode (complete lifecycle cycle).
- **CLI**: `python -m livingcode sense|plan|review|cycle|heartbeat|status`. `--path` works both before and after subcommands.
- **`Organism` Public API**: `from livingcode import Organism; o = Organism(repo_path); o.sense(); o.cycle()`.
- **`organism.json`**: DashClaw's self-identity file at repo root — identity, growth/forbidden zones, quality standards, CI gates, lifecycle config.

- **Claude Managed Agent Governed Example**: New `examples/managed-agent-governed/` with a Python agent running in Anthropic's cloud infrastructure, governed by DashClaw custom tools (`dashclaw_guard`, `dashclaw_invoke`, `dashclaw_record`). Demonstrates full governance loop for cloud-hosted autonomous agents.

### Infrastructure
- `.organism/` directory: state-reports, heartbeats, backlog, cycle-history, baselines, cycle-counter. Ephemeral paths gitignored.
- `baselines.json` seeded from first cycle run — immune system compares all future sensing against it.

### Tests
- 91 tests across 14 test files. All stdlib (no pytest plugins, no mocks beyond `unittest.mock`).

## [2.10.0] - 2026-04-07

### Added
- **SSE-Powered `waitForApproval()` (Node SDK)**: `waitForApproval()` now connects to `/api/stream` via Server-Sent Events for instant approval notification. Falls back to polling silently if SSE is unavailable (503, network error, no Upstash). Zero new dependencies — uses native `fetch` + `ReadableStream`. New private `_connectSSE()` async generator parses SSE frames from the stream.
- **SSE-Powered `wait_for_approval()` (Python SDK)**: Same SSE-first behavior with polling fallback. Uses `urllib.request` (stdlib only) — zero new dependencies. New private `_connect_sse()` method handles stream parsing.
- **AutoGen Governed Example**: New `examples/autogen-governed/` with a governed deploy tool demonstrating the full 4-step loop (guard → create_action → record_assumption → update_outcome), HITL approval for production deploys, and staged risk (low for staging, high for production).
- **Enhanced CrewAI Example**: `examples/crewai-governed/` now demonstrates multi-tool governance with two tools at different risk levels, HITL approval flow, assumption recording, and outcome tracking. Added "What's Governed" feature table to README.
- **Enhanced LangGraph Example**: `examples/langgraph-governed/` now uses conditional graph routing based on guard decisions (allow → research, require_approval → approval → research, block → abort). Added dedicated approval, outcome, and abort nodes with assumption recording. Added "What's Governed" section with graph structure diagram to README.

### Changed
- **Node SDK `waitForApproval()`**: Now SSE-first with automatic polling fallback. API unchanged — same method signature, same return shape. The `interval` parameter is only used during polling fallback.
- **Python SDK `wait_for_approval()`**: Now SSE-first with automatic polling fallback. API unchanged.
- **SDK READMEs**: Updated `waitForApproval` / `wait_for_approval` descriptions to reflect SSE support. Removed "Node SDK only" SSE note from Python README.

### Tests
- Added 5 new SSE-specific tests for Node SDK: approval via SSE, fallback on 503, fallback on network error, denial via SSE, event filtering by action ID. Adapted 10 existing HITL tests for SSE-first behavior.

## [2.9.0] - 2026-04-07

### Added
- **AI Policy Generator**: New `POST /api/policies/generate` endpoint converts natural language company policies into enforceable guard rules + recovery recipes. Supports dry-run preview mode. New UI at `/policies/generate`.
- **Predictive Risk Scoring**: Guard evaluations now include statistical behavior analysis — failure rates, action velocity, and historical patterns adjust risk scores automatically. Optional LLM-enhanced assessment for high-stakes actions (risk score >= threshold).
- **`predictive-risk.js` Module**: Statistical + LLM risk assessment engine. Always-on statistical scoring queries last 30 days of action history. LLM scoring (opt-in) consults BYOK provider for actions above configurable threshold.
- **`policy-generator.js` Module**: LLM prompt construction with few-shot examples, response parsing, and validation against existing `validatePolicy()`. Reuses BYOK provider execution via `executeCompletion()`.
- **Predictive Risk Settings**: `PREDICTIVE_RISK_ENABLED` (boolean, default false) and `PREDICTIVE_RISK_THRESHOLD` (integer 0-100, default 60) org settings control LLM risk assessment behavior.
- **Database Index**: `idx_action_records_predictive` composite index on `action_records (org_id, agent_id, action_type, timestamp_start DESC)` for fast historical lookups.
- **Public ROADMAP.md**: Community-facing roadmap with shipped, in-progress, and exploring sections.
- **SDK Tiers Documentation**: Comparison table in SDK README explaining Node (67 methods, lightweight) vs Python (185+ methods, enterprise) SDK scope.
- **"Beyond the Basics" README Section**: Surfaces drift detection, recovery recipes, scoring profiles, learning loop, prompt injection scanning, and session lifecycle features.

### Changed
- **Guard Engine**: `evaluateGuard()` now integrates predictive risk scoring. Risk scores are adjusted based on historical failure rates and action velocity before policy evaluation. Guard response includes optional `predictive_risk` field with statistical and LLM assessment details.
- **Python SDK Packaging**: Migrated from legacy `setup.py` to modern `pyproject.toml`.

### Tests
- Added 23 new tests: policy generator lib (8), policy generator route (5), predictive risk module (10).

## [2.8.0] - 2026-04-03

### Added
- **`dashclaw-agent-intel` Python Module**: Local semantic classification for agent tool calls — bash intent detection, file security analysis, 40-tool catalog, session tracking, and MCP health monitoring.
- **Pretool Hook v2**: Governs 40+ tools with enriched intel context, replacing the regex-based 4-tool classification.
- **Posttool Hook v2**: Structured outcome metadata, error classification, and 500-char summaries.
- **`agent_sessions` and `session_events` Database Tables**: New schema for session lifecycle tracking.
- **`permission_level` Column on `agent_pairings`**: Graduated autonomy levels — `readonly`, `workspace_write`, `danger`, `prompt`, `allow`.
- **Session Lifecycle API**: `POST /api/sessions`, `GET /api/sessions`, `PATCH /api/sessions`, `GET /api/sessions/{id}/events`.
- **3 New Guard Policy Types**: `permission_escalation`, `green_contract`, `branch_freshness`.
- **4 New Signal Types**: `session_stalled`, `branch_stale`, `mcp_degraded`, `green_insufficient`.
- **Recovery Recipe Engine**: 6 recipes mapping signals to suggestions and auto-actions.
- **Guard Recovery Field**: Guard response now includes a `recovery` field with suggested remediation.

## [2.3.0] - 2026-03-19

### Added
- **Approval Webhooks**: Webhook subscriptions now support `approval_pending`, `approval_granted`, and `approval_denied` events. Webhooks fire when agents require approval and when admins approve or deny actions, enabling PagerDuty, Opsgenie, and custom bot integrations. Payloads include an `approval_url` for direct approve/deny from external systems.
- **Policy Template Gallery**: New `GET /api/policies/templates` endpoint returns browsable previews of all policy packs (Enterprise Strict, SMB Safe, Startup Growth, Development). The import endpoint now supports `?preview=true` for dry-run mode showing what would be created vs skipped. Policies page includes a "Browse Templates" gallery with one-click install.
- **Cost Dashboard**: New `GET /api/actions/costs` endpoint with by-agent and by-day cost breakdowns. Mission Control gains an "Agent Spend" widget showing total spend, sparkline, and top agents. Cost and token columns added to the decisions list. Decision Replay shows cost and token usage in the result section.
- **Communication Trail in Decision Replay**: Messages between agents are now visible in Decision Replay. New `GET /api/actions/{actionId}/messages` endpoint uses a hybrid strategy — explicit `action_id` tags first, time-window correlation as fallback. Chat-bubble UI shows the conversation that led to a decision.
- **`webhook_deliveries` Table**: Tracks all webhook delivery attempts with status, response, and duration. Previously referenced in code but missing from the schema.
- **Messages API Restored**: `/api/messages`, `/api/messages/threads`, and `/api/messages/attachments` routes moved from archive back to active, fixing SDK `sendMessage()` which was returning 404.

### Changed
- **SDK `sendMessage()`**: Added optional `actionId` parameter that links messages to action records for the communication trail (Node SDK v2.6.0, Python SDK v2.6.0).
- **Webhook Event Types**: `VALID_SIGNAL_TYPES` renamed to `VALID_EVENT_TYPES` to reflect the broader scope of supported events.
- **Policy Pack Previews**: `PACK_PREVIEWS` metadata extracted from the policies page into shared `app/lib/policyPackPreviews.js` module with `inferPolicyType` and `summarizeRules` utilities.

### Tests
- Added 32 new tests: approval webhook wiring (7), policy templates endpoint (9), cost aggregation (8), message trail endpoint (8).

## [2.2.0] - 2026-03-16

### Added
- **CLI Approval Client (`@dashclaw/cli`)**: New terminal package with an interactive approval inbox and `approve`/`deny` commands, enabling terminal-first governance workflows without opening a browser.
- **Structured Approval Block in SDK**: `waitForApproval()` now prints a formatted, boxed approval block on first poll showing action ID, agent, risk score, goal, and replay URL — giving operators all the context needed to act from the terminal.
- **SDK Approval Methods (Node)**: Added `getAction()`, `getPendingApprovals()`, and `approveAction()` to the Node SDK, completing the full CLI approval channel surface.
- **Claude Code Hooks**: New `hooks/dashclaw_pretool.py` and `hooks/dashclaw_posttool.py` Python hooks for Claude Code governance. Pre-tool hook calls the guard before every tool use; post-tool hook records the outcome.
- **Anthropic Claude SDK Governed Demo**: New `examples/anthropic-governed-agent/` showing the four-step governance loop with HITL approval using the Anthropic Claude SDK.
- **OpenAI Agents SDK Governed Demo**: New `examples/openai-agents-governed/` showing governance integration with the OpenAI Agents SDK, including a guard gate and approval wait.
- **CLI Governance Examples**: `examples/claude-code-review-agent/`, `examples/openai-deploy-pipeline/`, and `examples/python-research-agent/` with a shared `examples/README.md` and two-terminal demo instructions.
- **`npx dashclaw-demo`**: New one-command local demo. Starts the runtime in demo mode, runs the governed agent, extracts the replay URL from agent output, and opens the browser to the decision evidence automatically.
- **GitHub Traffic Polling**: `npm run traffic:poll` (`scripts/poll-github-traffic.mjs`) persists GitHub clone and view data to Neon for historical adoption signals beyond the 14-day API window.

### Changed
- **Prompt Injection Scanning Default**: Prompt injection scanning is now on by default for all guard evaluations. Opt out with `DISABLE_PROMPT_INJECTION_SCAN=true`. Aligns with the platform's security-first posture.
- **Platform Skill v2.3**: Updated `dashclaw-platform-intelligence` skill with CLI approval channel and Claude Code hooks workflows. Skill description trimmed for better trigger matching.
- **Demo Replay Correlation**: `openai-governed-agent` example now uses `openai-deployer-1` agent ID and `deploy` action type, matching the demo middleware fixture data so the replay page always loads with full context after `npx dashclaw-demo`.
- **SDK Documentation**: Replaced hardcoded `dashclaw.io` references with env vars. Added CLI Approval Channel and Claude Code Hooks sections. `?legacy=true` toggle for Copy as Markdown / View raw.
- **Connect Prompt**: Uses the four-step governance loop and CLI approval channel pattern in the generated onboarding prompt.
- **Marketing Site**: Added terminal-first agent frameworks (Claude Code, OpenClaw) to the Works With section. New quickstart uses env vars instead of hardcoded keys.

### Fixed
- **Demo Guard Evaluations**: `app/api/guard/route.js` and `middleware.js` now always return a `200 OK` for all guard evaluations (including blocks and approvals). This prevents the SDK from throwing generic errors and properly exposes the `decision` object to agents.
- **SDK `GuardBlockedError` Propagation**: Updated both JS and Python SDKs so that if `_request()` encounters a `403` status due to a policy block, it explicitly raises `GuardBlockedError` instead of a generic `Error`/`DashClawError`.
- **Demo Replay Action States**: Updated the hardcoded `demoTestEval` mock to return `require_approval` instead of `block` so `npx dashclaw-demo` successfully triggers the Human-In-The-Loop terminal wait flow.
- **Demo Replay URL Extraction**: `run-demo.mjs` now parses the replay URL directly from agent stdout using a regex match, ensuring the correct `act_*` ID is opened in the browser every time.
- **Python Examples**: Fixed `first-governed-action.py` to pass a dict to `guard()` instead of kwargs, add missing `agent_id`, remove incorrect `async/await` (Python SDK is sync), and correct `"allowed"` → `"allow"`. Fixed `loop-monitoring.py` to use `register_open_loop`/`resolve_open_loop` instead of non-existent `create_loop`/`update_loop`.
- **CJS Legacy Bridge**: Fixed `sdk/index-v1.cjs` which was importing the wrong file after the v2 SDK refactor.
- **SDK Method Names**: Corrected examples and skill files that referenced removed v1 method names (`registerAssumption` → `recordAssumption`, `createLoop` → `registerOpenLoop`).
- **Dead SDK File**: Deleted diverged `sdk/dashclaw-v2.js` to eliminate confusion between the v2 SDK and the live `sdk/dashclaw.js`.
- **jsdom Vulnerability**: Upgraded `jsdom` 28→29 to resolve three undici CVEs (undici <7.24.0).

### Security
- **Race Condition Fix (Team DELETE)**: `DELETE /api/team/:userId` now uses an atomic CTE query to prevent concurrent requests from removing the last admin.
- **Cross-Tenant Write Fix (createVersion)**: `POST /api/prompts/templates/:templateId/versions` now verifies template ownership before inserting, preventing cross-org writes.
- **ENCRYPTION_KEY Enforcement**: Missing `ENCRYPTION_KEY` in production is now a hard error (was a warning), ensuring encryption is never silently disabled.

### Tests
- **Python SDK v2 Surface Tests**: Added `sdk-python/tests/test_sdk_v2_surface.py` mirroring the Node `sdk-v2.test.js` test suite for cross-language parity verification.
- **HITL Edge Case Coverage**: Expanded `waitForApproval` tests to cover the bypass path (action never entered `pending_approval`), the denial path, and the timeout path.
- **v2 SDK Unit Tests**: Added 41 unit tests covering all 19 public methods of the v2 Node SDK.

## [2.1.5] - 2026-03-15

### Fixed
- **Local Admin Approval Bug**: Fixed an issue in `middleware.js` where the `x-user-id` header was incorrectly set to an empty string instead of the resolved local-admin fallback value (`usr_local_admin`). This prevented the `approved_by` metadata from being correctly recorded in the database when an action was approved locally, causing the strict SDK parity checks to reject the approval as invalid.
- **Unified SDK Versioning**: Bumped both Node.js and Python SDKs to `2.1.5` to stay in sync with the platform and confirm they are tested against the middleware fix.

## [2.1.4] - 2026-03-15

### Fixed
- **SDK `waitForApproval` Bypass Bug**: Fixed a bug where calling `wait_for_approval` on an action that was allowed directly by the guard (never entered `pending_approval`) would crash the SDK instead of acting as a no-op. The strict metadata check is now correctly scoped only to actions that were actually intercepted.

## [2.1.3] - 2026-03-15

### Added
- **HITL Metadata Tracking**: Added `approved_by` and `approved_at` columns to the platform and SDKs to provide a machine-readable source of truth for human approval decisions.
- **SDK v2 Parity (HITL Hardening)**: Synchronized Node.js and Python SDKs with strict approval metadata verification. `waitForApproval` now explicitly requires `approved_by` to be present before resolving.
- **Migration Scripts for HITL**: Added `scripts/migrate-hitl-metadata.mjs` and updated the setup flow to automatically ensure existing databases have the required columns for metadata tracking.

### Changed
- **Mission Control Visual Hierarchy**: Renamed unresolved assumption status to `unresolved_assumption` (labeled "Awaiting Validation") to visually distinguish them from pending approvals.
- **SDK Safety Rails**: Both Node and Python SDKs now throw descriptive errors if an action leaves the `pending_approval` state without explicit approval metadata, preventing "auto-approval" bugs.

## [2.1.1] - 2026-03-15

### Changed
- **SDK Parity Unification**: Synchronized Node.js and Python SDKs to version 2.1.1, ensuring consistent implementation of the 5 core governance methods.
- **Documentation High-Fidelity Sweep**: Comprehensive overhaul of the SDK documentation with richer, production-realistic code examples and a dedicated legacy reference appendix.
- **Next.js 16+ Compatibility**: Updated documentation server components to correctly handle asynchronous search parameters.

## [2.1.0] - 2026-03-14

### Added
- **Governance Boundary CI**: New CI rule (`npm run governance:boundary:check`) that prevents "platform creep" by failing if non-core routes are added to the active API namespace.
- **Minimal Governance Loop Example**: Shipped `examples/dashclaw-example-openai-agent`, a 30-line "Aha! Moment" demo that shows DashClaw blocking a risky action in under 8 minutes.
- **v2 SDK Compatibility Bridge**: New `sdk/index.cjs` providing a clean CommonJS entry point for the minimal v2 runtime.

### Changed
- **Minimal Governance Runtime**: Physically isolated over 140 non-core API routes into the `_archive/` namespace. The active runtime is now hardened to 7 canonical governance primitives.
- **SDK Surface Area Collapse**: Flipped the default `dashclaw` SDK to the v2 runtime. Surface area reduced from 178+ methods to 5 core governance methods (`guard`, `createAction`, `updateOutcome`, `recordAssumption`, `waitForApproval`).
- **Sanitized Mission Control**: Stripped all productivity and analytics bloat from the main dashboard to focus strictly on **Posture, Interventions, Risk Signals, and Fleet Health**.
- **Documentation Overhaul**: Every core document (README, Quickstart, Project Details) has been rewritten to reflect the "Decision Infrastructure" narrative.

### Fixed
- **Friendly Fire Restoration**: Restored essential infrastructure routes (`/api/auth`, `/api/keys`, `/api/usage`) that were accidentally quarantined during the big purge.
- **TypeError in Demo Simulation**: Resolved a crash in the demo middleware where `signals` were incorrectly processed as objects instead of arrays.
- **Ghost Fetch Silence**: Stripped legacy background fetches from the UI that were triggering terminal 404s after the API quarantine.

## [2.5.5] - 2026-03-13

### Changed
- **High-Fidelity Replay Storytelling**: Redesigned Decision Replay visual hierarchy to make the governance signal (ALLOWED, BLOCKED, REQUIRE APPROVAL) the dominant, high-impact focal point.
- **Robust Decision Inference**: Implemented smart fallback logic to correctly identify "Action Prevented" outcomes for high-risk failed actions, even when explicit guard correlation is missing in demo/edge cases.
- **Impactful Simulator Story**: Updated the Simulator Bot to return a compelling "Blocked" narrative (preventing a $12,000 unauthorized charge) to instantly demonstrate product value.
- **Meaningful Outcome Summaries**: Improved description text across all replay views to provide clearer context on why an action succeeded or was intercepted.

### Fixed
- **Confusing Status Labels**: Resolved a bug where high-risk failed actions were incorrectly labeled as "ALLOW" in the replay view.
- **Navigation Breadcrumbs**: Corrected breadcrumb paths for shareable replay and internal detail pages.

## [2.5.0] - 2026-03-13

### Added
- **High-Impact Simulator Story**: Replaced routine success with an emotionally engaging "Blocked" story (intercepted $12,000 charge) to demonstrate governance power instantly.
- **Viral Decision Replays**: Redesigned Public Replay pages to be high-fidelity and screenshot-friendly, condensing the "Intent → Governance → Outcome" narrative into a single viewport.
- **Iframe Embedding Support**: Enabled iframe embedding for decision stories, allowing DashClaw governance evidence to be integrated into external docs, blog posts, and incident reports.
- **Dominant Decision Signal**: Reworked the visual hierarchy of replay pages to make the governance decision (ALLOWED, BLOCKED, REQUIRE APPROVAL) the primary visual focal point.

### Changed
- **Decision Inference Engine**: Implemented robust decision inference logic that correctly identifies "PREVENTED" outcomes for high-risk failed actions even when explicit guard correlation is missing.
- **Outcome Storytelling**: Improved summary text descriptions to provide more meaningful context for both successful and blocked decisions.
- **QuickStart Progression**: Refined the onboarding flow with real-time event listeners that automatically unlock steps as users interact with the SDK.

### Fixed
- **Logic Bug in Replay**: Fixed an issue where high-risk failed actions incorrectly showed as "ALLOW" instead of "BLOCK" in the replay view.
- **SDK Naming**: Corrected the package name to `dashclaw` in all documentation and QuickStart snippets.
- **Security Header Refinement**: Dynamically managed `X-Frame-Options` and `Content-Security-Policy` to support embedding for `/replay/` routes while maintaining system-wide security.

## [2.4.5] - 2026-03-13 (Earlier today)

### Added
- **Dedicated Activity Stream**: New `/activity` page providing a unified, real-time feed of agent intents, guard decisions, and system events.
- **Relocated Decisions Ledger**: Moved actions to `/decisions` to clarify the governance focus.
- **Integrated Audit Log**: Moved workspace activity to `/audit-log` under the Evidence group.

### Changed
- **Setup Page Integration**: Migrated the `/setup` page into the main `PageLayout`, ensuring the sidebar and unified header are always present.
- **High-Fidelity Compliance Reports**: Enhanced the Markdown proof report with realistic framework coverage and enforcement evidence.

### Fixed
- **Decision Detail 404**: Resolved 404 errors by correctly relocating dynamic decision routes to `/decisions/[actionId]`.
- **JSX Syntax Fix**: Corrected malformed nesting in the Decision Replay page that caused 500 build failures.
- **Policy Suite Reliability**: Fixed "Import" button visibility and property mapping in the Policy Test Runner.
- **Tailwind Build Refresh**: Fixed a race condition in the build system where Tailwind failed to track new files after directory moves.

## [2.4.0] - 2026-03-13 (Earlier today)

### Added
- **Agent Governance Transformation**: Pivoted the platform architecture around "Decision Infrastructure," focusing on the causal chain from intent to outcome.
- **Agent Governance Dossier**: New dedicated profile page at `/agents/[agentId]` providing a unified view of an agent's posture, active policies, permissions, and decision history.
- **Status-based Fleet Filtering**: Enhanced the Agent Fleet overview with real-time status filtering (Online, Critical, Offline).
- **Decision Replay Permalinks**: Enabled shareable, public-safe `/replay/[id]` links for decision storytelling and audit reviews.
- **Onboarding QuickStart**: New interactive onboarding component with an integrated "Success Story" simulator to demonstrate governance impact instantly.
- **Policy Lifecycle Parity**: Fully functional Policy CRUD, Simulation, Testing, and Proof Generation enabled in Demo Mode.

### Changed
- **Navigation Realignment**: Standardized the sidebar and header into Command, Governance, Evidence, and System groupings.
- **Unified Page Shell**: Migrated `/setup`, `/replay`, and Agent Profiles to the shared `PageLayout` for consistent navigation and breadcrumbs.
- **Terminology Shift**: Systematically transitioned UI labels from "Actions" to "Decisions" and "Productivity" to "Governance."

### Fixed
- **Audit Log Crash**: Fixed a `TypeError` in demo mode caused by a fixture name mismatch (`activityLogs` vs `activityEvents`).
- **Policy Test UI**: Resolved "undefined fail" and "No policies to test" errors in the Policy Test Runner.
- **Proof Report Format**: Fixed Markdown proof report generation by wrapping the response in a JSON object for client parsing.
- **Demo Middleware Stability**: Standardized fixture mapping across all demo endpoints to prevent data-related crashes.
- **Security Header Consistency**: Applied standard security headers and CORS to all demo responses.

## [2.3.5] - 2026-03-13 (Earlier today)

### Fixed
- **High Severity Vulnerabilities**: Resolved 11 High severity vulnerabilities across `jspdf`, `minimatch`, `xlsx`, and `ajv` via patching and migration to `@e965/xlsx`.
- **Next.js Security**: Upgraded `next` to `^16.1.6` to resolve a medium-severity memory consumption vulnerability.
- **ESLint Migration**: Migrated from deprecated `next lint` to the standard ESLint CLI.
- **React Hook Optimization**: Fixed an unnecessary dependency warning in `DraggableDashboard.js` `useMemo` hook.

## [2.3.4] - 2026-03-11

### Changed
- **Mission Control Continuity**: Added parent/child action-chain expansion in the Decision Timeline so spawned sub-actions can be inspected inline under the decision that created them.
- **Decision Basis Visibility**: Assumptions now appear as first-class governance events in Mission Control, making unresolved or invalidated decision basis visible alongside actions, loops, and guard outcomes.
- **Recent Change Digest**: Added a "What changed in the last 15 minutes" digest that summarizes decision movement, governance pressure, interventions, and landed outcomes.
- **Shared Operator Lens**: Introduced synchronized operator filters across both the Decision Timeline and Mission Feed so operators can focus on decisions, governance, interventions, or outcomes without re-filtering each surface independently.

### Added
- **Mission Control Tests**: Added lightweight unit coverage for `missionControl.js` normalization, telemetry collapse, operator brief summaries, and the recent-change digest.

## [2.3.3] - 2026-03-10

### Changed
- **Mission Control Signal Quality**: Reworked Mission Control around an operator brief, decision-weighted timeline rows, governance/intervention/outcome categorization, and collapsed routine telemetry so meaningful events stand out by default.
- **Timeline Navigation**: Decision Timeline now supports scrolling and keeps category filters available even when the selected category is empty.
- **Active Work Summary**: Expanded the "Currently Running" brief to include governed work that is pending or awaiting approval, which better matches real operator workflow.

### Fixed
- **Prompt Analytics Fallback**: `/api/prompts/stats` no longer returns 500 on installs missing the optional `prompt_runs` table; it now returns a setup hint and degrades cleanly in the UI.
- **Prompt Render Resilience**: Prompt rendering with usage recording enabled no longer fails when `prompt_runs` is unavailable; analytics are skipped while prompt execution still succeeds.

## [2.3.2] - 2026-02-25

### Changed
- **Self-Host Primary CTA**: Updated `/self-host` so `Download Skill` appears first in the top "Get started" action row and is styled as the primary call-to-action.
- **Action Priority**: Demoted `Open Source Repo` to a secondary button style to keep focus on agent-driven setup via the downloadable skill.

## [2.3.1] - 2026-02-25

### Changed
- **Fleet Presence Sizing**: Updated the default dashboard layout to render `Agent Fleet Presence` as a taller 2x4 tile (`w:2, h:4`) for better list visibility and scrolling.
- **Preset Layout Alignment**: Updated `Operations Focus`, `Analytics Focus`, and `Compact Overview` presets to use the same `fleet-presence` 2x4 size and adjusted neighboring tile coordinates to prevent overlap.
- **Layout Versioning**: Incremented dashboard layout state version to `v8` so clients refresh to the new default geometry.

## [2.3.0] - 2026-02-19

### Added
- **Local Admin Password Authentication**: Implemented a local password login mode controlled by the `DASHCLAW_LOCAL_ADMIN_PASSWORD` environment variable, providing a full alternative to OAuth for self-hosted deployments.
- **Local Session Management**: Added a secure, JWT-backed local session system that integrates with the existing middleware and sign-out logic.

## [2.2.2] - 2026-02-19

### Fixed
- **Fleet Presence Merge**: Resolved an issue where agents with heartbeats but no action records were excluded from the dashboard fleet list.
- **Online Detection Fallback**: Improved `isOnline` logic to use `last_active` and `status` as a fallback when `last_heartbeat_at` is missing.
- **Layout Versioning**: Incremented layout state version (v5) to ensure all users receive the updated newspaper-style hierarchy.

## [2.2.1] - 2026-02-19

### Fixed
- **ScoringProfileCard Layout**: Fixed a bug where the card collapsed during loading (rendering null) and failed to fill its grid cell. Now uses `CardSkeleton` and `h-full` for consistent grid alignment.
- **Preset Layout Refinement**: Refined the distribution of newer tiles (Evaluation, Feedback, Drift, Scoring) in the default preset and updated md/sm breakpoints for better density.
- **Layout Versioning**: Incremented layout state version (v4) to trigger a fresh layout load for all users.

## [2.2.0] - 2026-02-19

### Added
- **Dashboard Redesign**: Full layout overhaul of the main dashboard with a new "Newspaper" visual hierarchy across all breakpoints (lg, md, sm).
- **Tile Visibility Toggle**: New "Customize" dashboard modal allowing users to show/hide individual tiles.
- **Persistent Visibility State**: User-level dashboard customization saved to `localStorage`, allowing for a decluttered operational view.
- **Layout Versioning**: Incremented layout state version (v3) to ensure a seamless migration to the redesigned grid for all users.

### Changed
- **Information Hierarchy**: Prioritized fleet status and high-frequency operational cards at the top of the dashboard for better at-a-glance visibility.

## [2.1.0] - 2026-02-19

### Added
- **Link Inspector (Swarm Intelligence)**: New capability to inspect communication bridges between agents in the neural web.
- **Thick, Hoverable Links**: Enhanced swarm visualization with thicker links (3px) and interactive hover/selected states (4px with glow).
- **Link Interaction Logic**: High-performance point-to-line-segment distance detection for O(1) link selection in the canvas rendering loop.
- **Link Context API**: New endpoint `/api/swarm/link` that aggregates shared actions (within 10-minute windows) and direct messages between agent pairs.
- **Link Inspector Side Panel**: Interactive sidebar for selected links featuring "Shared Activity" and "Messages" tabs with real-time sync.

## [2.0.0] - 2026-02-19

### Added
- **Major SDK Expansion**: Added 82 additional methods across 8 new categories to both Node.js and Python SDKs.
- **Unified 2.0.0 Baseline**: Synchronized versioning across the core platform and all official SDKs.
- **Enhanced Category Coverage**: New methods covering advanced agent orchestration, swarm intelligence, and deep observability patterns.

## [1.10.1] - 2026-02-19

### Added
- **Comprehensive Test Suite (Phases 0-7)**: Added 12 new unit test files and expanded the integration test suite to cover Evaluations, Prompts, Feedback, Compliance, Drift, Learning Analytics, and Scoring Profiles.
- **Unit Tests**: Coverage for all 5 scorer types (regex, contains, numeric_range, custom_function, llm_judge), Mustache template rendering, rule-based sentiment/tagging, statistical utilities, maturity model logic, and rule-based multi-dimensional scoring (Phase 7).
- **Integration Tests**: Full API CRUD validation for all feature phases (including Phase 7: Scoring Profiles) added to `scripts/test-full-api.mjs`, ensuring end-to-end reliability.

### Fixed
- **Prompt Rendering**: Fixed a regex bug in `app/lib/prompt.js` where backslashes were not properly escaped in the `RegExp` constructor, causing it to fail on variables with surrounding whitespace (e.g., `{{ name }}`).

## [1.10.0] - 2026-02-19

### Added
- **Scoring Profiles (Phase 7)**: Weighted multi-dimensional quality scoring system for evaluating agent actions without LLM dependencies.
- **Profile Builder**: New interface at `/scoring` for defining scoring profiles with weighted dimensions (speed, cost, risk, reliability, etc.).
- **Scoring Engine**: Rule-based math engine supporting Weighted Average, Minimum, and Geometric Mean composite scoring methods.
- **Auto-Calibration**: Statistical analysis engine that uses percentile-based distribution of historical action data to suggest optimal scoring thresholds.
- **Risk Templates**: Rule-based automatic risk scoring system that replaces hardcoded agent risk numbers with dynamic evaluation.
- **Scoring SDKs**: Added 17 new methods to both Node.js and Python SDKs for profile management, batch scoring, and auto-calibration.
- **Scoring Widget**: New dashboard card showing active profiles, dimension counts, and quick access to score management.
- **Score Explorer**: Real-time breakdown of action quality across all configured dimensions with visual distribution charts.

## [1.9.9] - 2026-02-19

### Added
- **Learning Analytics (Phase 6)**: Agent learning velocity and maturity tracking, providing first-class metrics for agent improvement over time.
- **Velocity Engine**: Statistical computation of learning velocity using linear regression slope and acceleration (second derivative) tracking.
- **Maturity Model**: A 6-level classification system (Novice to Master) based on episode volume, success rate, and average scores.
- **Learning Curves**: Per-agent and per-action-type time-series analysis showing performance evolution across specific skill areas.
- **Analytics Dashboard**: New dedicated interface at `/learning/analytics` with Overview, Velocity, Curves, and Maturity tabs.
- **Analytics SDKs**: Added 6 new methods to both Node.js and Python SDKs for computing velocity, generating curves, and retrieving analytics summaries.
- **Velocity KPI Card**: New dashboard widget showing real-time improvement trends and maturity levels for the agent fleet.
- **Demo Integration**: Rich synthetic fixtures and demo API handlers for learning analytics, velocity, and maturity tracking.

## [1.9.8] - 2026-02-19

### Added
- **Drift Detection (Phase 5)**: Statistical behavioral drift analysis detecting when agent metrics deviate significantly from established baselines using z-score analysis.
- **Automated Baselines**: Dynamic computation of statistical profiles (mean, stddev, percentiles) for risk, confidence, duration, cost, and tokens.
- **Drift Alerts**: Real-time generation of info, warning, and critical alerts when behavioral shifts exceed statistical thresholds (1.5σ, 2.0σ, 3.0σ).
- **Metric Snapshots**: Daily capture of agent metric snapshots for long-term trend visualization and behavioral forensics.
- **Drift Management Dashboard**: New interface at `/drift` with tabs for Alerts, Baselines, and Trends.
- **Drift SDKs**: 9 new Node.js methods and 10 new Python methods for computing baselines, detecting drift, and managing alerts.
- **Drift Widget**: New "Drift" dashboard card providing an at-a-glance view of critical/warning alerts and agent-specific drift status.

## [1.9.7] - 2026-02-19

### Added
- **Compliance Export (Phase 4)**: Bundled audit-ready report generation across multiple frameworks (SOC 2, ISO 27001, NIST AI RMF, EU AI Act, GDPR).
- **Scheduled Exports**: Cron-based recurring export generation (weekly, monthly, quarterly) with email-ready markdown or JSON payloads.
- **Evidence Packaging**: Automatic attachment of guard decision logs and action record history to compliance reports for a complete audit trail.
- **Remediation Priority Matrix**: Intelligent sorting of compliance gaps by priority, agent relevance, and estimated effort.
- **Coverage Trend Tracking**: Visualized history of compliance posture over time with improvement/decline detection.
- **Export SDKs**: Added 11 new methods to both Node.js and Python SDKs for managing exports, schedules, and trends.
- **Export Management Dashboard**: New interface at `/compliance/exports` for on-demand generation, scheduling, inline report viewing, and downloads.

## [1.9.6] - 2026-02-19

### Added
- **User Feedback Loop (Phase 3)**: Structured feedback system for measuring human satisfaction with agent actions.
- **Feedback Management Dashboard**: New interface at `/feedback` for tracking user ratings, comments, and triage status.
- **Rule-based Sentiment & Tagging**: Automated sentiment detection (Positive/Negative/Neutral) and categorical tagging (performance, accuracy, UX, etc.) without LLM overhead.
- **Feedback Analytics**: Real-time distribution charts, sentiment trends, and agent-specific quality breakdowns.
- **Feedback SDKs**: Added `submitFeedback()`, `listFeedback()`, and `getFeedbackStats()` to both Node.js and Python SDKs.
- **Dashboard Feedback Widget**: Draggable card for the main dashboard showing aggregated sentiment bars and top agent ratings.

## [1.9.5] - 2026-02-19

### Added
- **Evaluation Framework (Phase 1A & 1B)**: A complete system for measuring and scoring agent decision quality.
- **Evaluations Dashboard**: New full-page interface for managing evaluation scores, scorers, and batch runs.
- **Scoring Engine**: Support for Regex, Keyword, Numeric Range, Custom Expression, and LLM-as-judge (AI) scorers.
- **Evaluations Widget**: Draggable dashboard widget with score distribution charts and average quality metrics.
- **Evaluation SDKs**: Added `evaluate()`, `createScorer()`, and `runEval()` to both Node.js and Python SDKs.
- **Batch Eval Runs**: Capability to run batch evaluations against historical agent actions.
- **Demo Integration**: Comprehensive evaluation fixtures and demo routes for testing the framework without a live backend.

## [1.9.4] - 2026-02-19

### Added
- **Swarm Pulse (Distribute/Expand)**: New "Expand Swarm" button in the Swarm Intelligence dashboard. Trigger a physical pulse that temporarily spreads agents apart, improving visibility into complex neural webs.
- **High-Performance Swarm Rendering**: Completely refactored the `/swarm` canvas rendering loop to support 50+ agents with minimal CPU/GPU overhead. 
- **Optimized Physics Sync**: Decoupled visual state (packets/particles) from the React state tree, eliminating re-render thrashing and ensuring smooth 60fps performance on high-density agent fleets.
- **Zero-Latency Panning & Dragging**: Restored manual agent rearrangement and viewport panning with optimized coordinate mapping and O(1) node lookups.

## [1.9.3] - 2026-02-18

### Added
- **Visual Action Tracing**: Interactive, node-based decision trees in the Action Post-Mortem view. Visualize parent chains, sub-actions (spawned decisions), assumptions, and open loops in a unified branching graph.
- **Policy Simulation (Dry Run)**: Test proposed guard policies against historical agent activity. See exactly what would have been blocked, warned, or gated over the last 1-30 days before enabling a rule.
- **Agent Heartbeat & Presence**: Real-time fleet monitoring. Agents can now report status ("online", "busy", "error") and active task IDs via the new SDK `heartbeat()` method.
- **Fleet Presence Dashboard**: New "Agent Fleet Presence" card on the main dashboard showing real-time uptime and activity status for the entire agent fleet.
- **Lost Heartbeat Signal**: New automated risk signal (`agent_silent`) that fires when an agent with an active task hasn't reported in for over 10 minutes.
- **SDK v1.9.3**: Added `heartbeat()`, `startHeartbeat()`, and `stopHeartbeat()` to both Node and Python SDKs.

## [1.9.2] - 2026-02-18

### Added
- **Redis Real-time Backend**: Support for Upstash Redis as an event broker to enable live dashboard updates on serverless hosts like Vercel.
- **Self-Host Guide Updates**: Explicit instructions for Redis-backed live events in the cloud deployment path.

## [1.9.1] - 2026-02-17

### Added
- **Full Dashboard Real-Time Streaming**: Extended SSE events to include `DECISION_CREATED`, `GUARD_DECISION_CREATED`, `SIGNAL_DETECTED`, and `TOKEN_USAGE`.
- **Reactive UI Components**: Updated Decision Timeline, Recent Actions, Risk Signals, Learning Stats, and Token Budget cards to update instantly via `useRealtime`.
- **Mission Control Split-View**: Redesigned Mission Control bottom section with a side-by-side view of the Decision Timeline and a new **Live Swarm Log** (real-time terminal-style feed).
- **Backend Event Integration**: Integrated `publishOrgEvent` into guard evaluation, learning records, and token usage snapshots.
- **SDK v1.9.1**: Bumped all SDK versions to match platform capabilities.

### Fixed
- **Timeline Payload Bug**: Fixed a bug in `ActivityTimeline` where real-time event payloads were not being parsed correctly.
- **Polling Reduction**: Removed legacy `setInterval` polling from Learning and Token cards in favor of lightweight SSE pushes.

## [1.8.1] - 2026-02-15

### Added
- **Real-Time SSE Events**: New `POLICY_UPDATED`, `TASK_ASSIGNED`, `TASK_COMPLETED` event types emitted from policy CRUD and task routing routes.
- **SDK `events()` method**: SSE client for agents to subscribe to real-time events (Node SDK only, zero dependencies).
- **SSE-based `waitForApproval()`**: New `useEvents: true` option for instant approval resolution instead of polling.
- **Client-side SSE listeners**: `useRealtime` hook now handles `policy.updated`, `task.assigned`, `task.completed` events.
- **Digest repository**: Extracted digest queries from route into `digest.repository.js`.

## [1.8.0] - 2026-02-15

### Security
- **Deep Security Audit**: Comprehensive 5-agent parallel audit across auth, input validation, secrets, network surface, and AI governance risks. Resolved 4 CRITICAL, 9 HIGH, and 8 MEDIUM severity findings.
- **SSRF Protection for Task Routing**: `dispatchToAgent()` and `fireCallback()` now validate URLs with DNS resolution, private IP blocking, HTTPS enforcement, and redirect prevention — matching the existing webhook SSRF protections.
- **Agent Signature Enforcement**: Signatures are now enforced by default in production (`ENFORCE_AGENT_SIGNATURES`). Opt out explicitly with `=false`.
- **Closed Agent Enrollment**: New `DASHCLAW_CLOSED_ENROLLMENT=true` mode requires agents to be pre-registered before submitting actions.
- **Timing-Safe Secret Comparison**: All 5 cron routes now use a shared `timingSafeCompare` utility. Middleware timing-safe function improved to prevent length leaks.
- **Cron Auth Fix**: `/api/cron/routing-maintenance` was missing `CRON_SECRET` validation while being publicly routable — now secured consistently with all other cron endpoints.
- **Rate Limit Bypass Fix**: `x-real-ip` header is no longer trusted unless `TRUST_PROXY=true`, preventing attackers from spoofing IPs to bypass rate limits.
- **Request Body Size Limit**: 2 MB maximum enforced in middleware for all POST/PUT/PATCH requests.
- **SDK HTTPS Warnings**: Both Node and Python SDKs now warn when `baseUrl` does not use HTTPS, preventing plaintext API key transmission.
- **Markdown XSS Prevention**: Agent messages rendered via `ReactMarkdown` now block `javascript:` and other unsafe URL schemes in links.
- **Demo Cookie Bypass Fix**: The `dashclaw_demo` cookie no longer activates demo mode on self-hosted deployments — only honored when `DASHCLAW_MODE=demo`.
- **Invite URL Hardening**: Invite link generation now uses `NEXTAUTH_URL` as the canonical origin instead of trusting `x-forwarded-host`.
- **Input Validation Hardening**: Agent-reported `risk_score` clamped to 0-100, cost/token values bounded to safe maximums, routing agent registration validates endpoint URLs and input ranges.
- **Leaked Key Cleanup**: Removed accidental API key from `.next/standalone/.env` build artifact. Added `.dockerignore` to prevent future leaks.

### Added
- **Startup Environment Validation**: New `validateEnv.js` module warns on missing configuration and errors on critical production misconfigurations (OAuth, API key, encryption key).
- **Guard Fallback Control**: New `DASHCLAW_GUARD_FALLBACK` env var to globally configure semantic guard behavior when LLM is unavailable (`allow` or `block`).
- **SSE Connection Limits**: Server-side 30-minute max duration for SSE streams with bounded deduplication set (10,000 entries max).

### Changed
- **OAuth Provider Registration**: Providers are now conditionally registered based on available credentials. Production deployments without any OAuth configuration log an error at startup instead of silently using mock values.
- **HSTS Header**: Upgraded to `max-age=63072000; includeSubDomains; preload` (2-year max-age with preload).
- **Source Maps**: Explicitly disabled browser source maps in production builds.
- **Sync Validation**: All Zod array validators in the bulk sync schema now enforce `.max()` bounds matching the runtime `LIMITS` constants, rejecting oversized payloads at parse time.

## [1.7.0] - 2026-02-14

### Added
- **One-click Agent Pairing**: New pairing flow for verified agents (agents request enrollment, admins approve via a click link or `/pairings` inbox).
- **Pairing APIs**: `/api/pairings` endpoints to create, list, fetch, and approve pairing requests.
- **Pairings UI**: `/pair/:pairingId` approval page and `/pairings` inbox (includes Approve All for 50+ agents).

### Changed
- **Canonical Signing**: Agent action signatures now use canonical JSON (stable key ordering / no whitespace) to prevent flaky signature failures.
- **Signature Enforcement Control**: Signature enforcement is now controlled via `ENFORCE_AGENT_SIGNATURES=true` (instead of implicitly depending on `NODE_ENV`).

## [1.6.2] - 2026-02-14

### Added
- **Adaptive Learning Loop MVP**: Added episode scoring and recommendation synthesis for agent performance improvement over time.
- **Learning Recommendations API**: New endpoint `/api/learning/recommendations` with role-gated rebuild support (`POST`) and recommendation retrieval (`GET`).
- **Learning Loop Cron Jobs**: Added scheduled endpoints for automated learning maintenance:
  - `/api/cron/learning-episodes-backfill`
  - `/api/cron/learning-recommendations`
- **SDK Recommendation Methods**:
  - Node SDK: `getRecommendations()`, `rebuildRecommendations()`, `recommendAction()`
  - Python SDK: `get_recommendations()`, `rebuild_recommendations()`, `recommend_action()`

### Changed
- **Action Outcome Pipeline**: `PATCH /api/actions/[actionId]` now best-effort scores learning episodes for adaptive recommendation generation.
- **Operational Scripts**: Added learning-loop migration/backfill/rebuild scripts and npm commands for repeatable operations.

## [1.5.0] - 2026-02-13

### Added
- **Human-in-the-Loop (HITL) Governance**: New "Approval Queue" dashboard at `/approvals` for real-time human intervention in agent workflows.
- **Pending Approval State**: Actions triggered by `require_approval` policies now pause in a dedicated state until an administrator approves or denies them.
- **SDK Blocking & Polling**: Node.js and Python SDKs now support `hitlMode: 'wait'`, allowing agents to automatically pause and wait for human decisions.
- **Approval API**: New endpoint `POST /api/actions/[actionId]/approve` for centralized decision management.

## [1.4.0] - 2026-02-13

### Added
- **Swarm Intelligence**: New visual dashboard at `/swarm` for decision visibility across multi-agent communication maps and operational risk.
- **Swarm Graph API**: New endpoint `/api/swarm/graph` providing node-link data for large agent swarms (up to 50+ agents).
- **Communication Topology**: Visual mapping of agent-to-agent message flow with risk-based node highlighting.

## [1.3.2] - 2026-02-13

### Added
- **Proactive Memory Maintenance**: New server-side cron job that identifies stale assumptions and conflicting decisions.
- **Memory Correction Messages**: System-to-agent messaging that suggests specific memory pruning and verification tasks.

## [1.3.1] - 2026-02-13

### Added
- **CrewAI Integration**: New adapter for CrewAI agents and tasks to track multi-agent research.
- **AutoGen Integration**: Hook-based integration for AutoGen to monitor conversational agent turns.
- **Node SDK v1.3.1**: Synced version with platform.
- **Python SDK v1.3.1**: New integrations and RSA signing support.

## [1.3.0] - 2026-02-13

### Added
- **Data Loss Prevention (DLP)**: Automated regex-based redaction for sensitive keys (OpenAI, AWS, GitHub, etc.) in agent messages and handoffs.
- **Strict Sync Validation**: Implemented Zod-based schema validation for the Bulk Sync API to prevent malformed data injection.
- **Agent Identity Enforcement**: Made agent signatures mandatory in production for all Action Record creations.

### Security
- **Auth Hardening**: Refactored middleware to "fail closed" in production if security keys are missing.
- **HSTS Enforcement**: Added `Strict-Transport-Security` headers to all API routes.
- **Audit Log Redaction**: Added local redaction engine to the Python Audit Logger to prevent secret leakage in local SQLite databases.
- **Dependency Patching**: Upgraded Next.js to stable v15.1.12 and esbuild to v0.25.0 to resolve known vulnerabilities while maintaining CI stability.
- **Standardized DB Layer**: Centralized all database connection logic into a shared utility with strict production safety checks.

## [1.2.4] - 2026-02-13

### Added
- **Security Health UI**: Added a real-time "Security Score" and system health checklist to the Security dashboard.
- **Security Tests**: Added unit tests for SSRF protection and webhook validation.

### Changed
- **Environment Template**: Updated `.env.example` with `ENCRYPTION_KEY` and `WEBHOOK_ALLOWED_DOMAINS`.

## [1.2.3] - 2026-02-13

### Added
- **Security Dashboard API**: New endpoint `/api/security/status` for verifying encryption health and system security score.

### Security
- **Comprehensive Audit**: Full IDOR (Insecure Direct Object Reference) audit of all resource endpoints to ensure strict multi-tenant isolation.
- **Plan Escalation Fix**: Restricted organization creation to the 'free' plan by default, ignoring unauthorized user-provided plan overrides.
- **Auto-Encryption**: Added server-side enforcement for sensitive keys (API_KEY, DATABASE_URL, etc.) to ensure they are always encrypted before storage.
- **Hardened Error Handling**: Standardized generic error responses across the API to prevent information leakage.

## [1.2.2] - 2026-02-13

### Fixed
- **Build Failure**: Resolved "Invalid project directory" error in CI by adjusting Next.js version to a stable security-patched release (15.5.10).

## [1.2.1] - 2026-02-13

### Security
- **SSRF Hardening**: Enhanced webhook URL validation with stricter blocked patterns and optional domain allowlist support.
- **Dependency Updates**: Resolved vulnerabilities in `next` and `esbuild` through security patches.
- **Scanner Integrity**: Updated internal security scanner to ensure comprehensive directory coverage.
- **Cleanup**: Removed unverified third-party agent skills and scripts from the repository.

## [1.2.0] - 2026-02-12

### Added
- **Self-Hosting Support**: Added production-optimized `Dockerfile` and `docker-compose.yml`.
- **Operational Maturity**: Added `CONTRIBUTING.md` for community participation.
- Enabled `standalone` output in Next.js configuration for leaner container images.

## [1.1.0] - 2026-02-12

### Added
- **Identity Binding**: Cryptographic agent verification using RSA-PSS signatures (Sign-on-Source, Verify-on-Sink).
- New admin endpoint `/api/identities` for agent public key management.
- Verified "Trust Badge" (green shield) in the dashboard UI for cryptographically signed actions.
- `scripts/generate-agent-keys.mjs` helper for agent keypair generation.
- `scripts/migrate-identity-binding.mjs` for database schema updates.

### Changed
- Updated DashClaw SDK to support automatic payload signing with JWK or CryptoKey.

## [1.0.0] - 2026-02-12

### Added
- Initial public release of DashClaw.
- AI Agent Dashboard built with Next.js 14 (App Router).
- Suite of Python CLI tools for agent memory, context, and goal tracking.
- ActionRecord control plane for full action lifecycle tracking.
- Behavior Guard system with policy evaluation (risk, approval, rate-limiting).
- Multi-tenant organization support with API key authentication.
- Real-time decision integrity signals and security enforcement.
- Agent-to-agent messaging hub and collaborative shared docs.

### Security
- SHA-256 API key hashing for secure organization access.
- AES-256 encryption for integration credentials and sensitive settings.
- Native Content Security Policy (CSP) and security headers configuration.
