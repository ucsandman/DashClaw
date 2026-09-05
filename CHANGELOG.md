# DashClaw Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning

As of **4.0.0**, DashClaw uses **one version across the platform and both SDKs**. The Next.js app (`package.json`), the npm SDK (`sdk/package.json`), and the PyPI SDK (`sdk-python/pyproject.toml`) always share the same version — enforced by `npm run version:sync:check` in CI and the pre-commit hook. Bump with `npm run release:prep -- <x.y.z>`, which runs the whole recipe: the three manifests plus `contracts/sdk/release-plan.json` (`version:set`), package-lock sync, a build, the platform-guide liveExamples regen against a local instance, and the four version/contract/drift gates. (`npm run version:set -- <x.y.z>` alone still works but leaves the guide regen to you.) Every release ships the platform deploy and advances the shared version. Both SDK packages are (re)published at that number **only when the SDK source actually changed** — a platform-only release bumps the number but leaves npm/PyPI at the last SDK release (non-contiguous versions are expected).

Through 3.x the platform and the SDKs versioned independently, which is why older entries below carry separate platform `[2.x]` numbers and `### SDK [3.0.0]`-style numbers, listed newest-first by release date. The `dashclaw` plugin bundle and CLI keep their own manifest versions and are prefixed with the package name.

## [Unreleased]

## [5.33.10] - 2026-09-05

### Removed

- Removed a net 6,312 lines in the 65-path cleanup batch before release metadata: 969 additions, including relocated docs and focused tests, against 7,281 deletions.
- Removed dead AgentLens hooks, duplicate local GitNexus skill copies, a retired command and workflow, obsolete one-off scripts, an unused component and hook, an old migration, and unreferenced MCP resolver and outcome helpers.
- Removed 21 demo handlers for routes that no longer exist in the production API, plus stale fixture data, 19 feature tutorial agents, 3 journey tutorial agents, and retired persona actions.
- Moved four superseded documents into `docs/archive/` and updated current documentation to point at the canonical v5 model.

### Fixed

- Corrected the Hermes guide to the six configured event types and the current session-start liveness probe. Removed claims about uninstalled post-LLM and session-end live-ingest hooks.
- Simplified capability-health internals and removed legacy approval bookkeeping that current repositories no longer call.
- Changed `dashclaw-demo` to print the Decision Replay URL without launching a browser from container output. Its package now ships only `bin/` and runs a real launcher test.

### Release notes

- This is a platform-only shared-version bump to 5.33.10. Node and Python SDK source is unchanged, so `dashclaw` is intentionally not republished to npm or PyPI.
- `@dashclaw/mcp-server` advances to 3.1.7 and `dashclaw-demo` advances to 1.3.1 because both package sources changed. Their registry publication is tracked separately from the platform release.
- Use the GitHub release tag `platform-v5.33.10`. The existing `v*` workflow publishes both SDKs unconditionally, so the conventional tag would cut empty SDK releases.

## [5.33.9] - 2026-09-05

### Security and enforcement

- Added atomic protocol-1 execution claims bound to the organization, credential principal, agent, exact act, and a fresh policy decision. Operator and plan authority is consumed at execution claim time rather than during guard evaluation. Concurrent or repeated attempts cannot reuse the same claim.
- Hardened operator authorization, tenant isolation, OAuth scopes and lifecycle, approval expiry and separation of duties, capability invocation, and server-held secret handling. Capability credentials are masked before policy-provider and audit egress while digests bind the actual request.
- Hardened hook and OpenClaw failure handling, timeouts, replay negotiation, and exact action binding. Older servers with no claim advertisement retain the earlier hook flow; malformed or unsupported advertisements fail closed. Strict claim enforcement can be enabled after the server upgrade.
- Added authenticated encryption for newly stored signing keys and webhook secrets, signing-key lifecycle controls, structured redaction, and explicit legacy-custody migration guidance. Existing secret rows are not silently rewritten.

### Reliability and tooling

- Governed Node and Python helpers require confirmed execution claims and distinguish callback failure from lost outcome acknowledgement. They do not automatically retry external effects. Fixed SDK exports, declarations, onboarding, and error consistency.
- Added migration checksums, transaction-scoped locking, conflict preflight, required-schema verification, and a disposable recovery drill. Migration adoption and rollback limits are documented.
- Corrected liveness JSONB persistence and legacy reads. Setup reports measured runtime and hook metadata without inventing missing evidence. Approval previews, partial release failures, zero confidence, and unavailable evidence remain visible in the UI.
- Hardened CLI process ownership and runtime installation; expanded CI to cover package tests, typechecking, PostgreSQL claim concurrency, liveness persistence, and hosted behavior.

### Documentation and upgrade order

- Aligned the README, thesis, architecture and operations references, SDK/runtime guides, marketing pages, search metadata, and package descriptions with the actual enforcement boundaries. Replaced obsolete workflow guidance and retired misleading launch-film promotion.
- Deploy the matching server and schema before upgrading the Node/Python governed helpers. A claimed attempt is not exactly-once external execution; uncertain effects require reconciliation.
- Release includes both SDKs, CLI 0.13.1, MCP server 3.1.6, OpenClaw plugin 1.6.4, and the Claude/Codex/Hermes bundle 3.2.1. Publication and deployment are verified separately from local tests.

The [remediation record](docs/audit-remediation-2026-09-05.md) records the findings, fixes, executable evidence, and remaining deployment-specific checks.

## [5.33.8] - 2026-09-05

### Fixed

- Guard idempotency now enforces current JWT replay-protection and action-binding restrictions before returning a cached decision. Rejected retries retain mandatory audit persistence and fail closed if the audit write fails.
- A fresh valid JWT no longer inherits a prior token-replay rejection. Valid fresh-token retries, non-JWT retries, and explicit replay-protection-off behavior remain supported.
- Added 12 route-level regression tests using real Ed25519 JWT verification, including enforcement-mode changes, required replay-store failure, and recovery after a rejected retry.

This is a platform-only release. SDK source is unchanged; SDK packages are not republished.

## [5.33.7] - 2026-09-05

### Fixed

- Governed SDK execution respects pending approval returned by fallback action creation. Rich action metadata and Python signing/configured governance retain canonical action creation.
- Recorded guard requests automatically derive the same hourly idempotency key as action creation. Explicit caller keys still take precedence. This deduplicates ledger rows, not callback execution.
- Decision replay renders its primary record without waiting for graph, trace, or optional evidence. Superseded requests cannot replace the current decision, and missing guard evidence no longer displays an assumed ALLOW.
- Demo decision replay serves execution graphs from its existing action fixtures.
- Batched plan reads retain the 200-deviations-per-plan bound. Credential scanning catches URL passwords containing comma, semicolon or ampersand and credentials on single-label hosts.
- SDK parity documentation reports 40 Node and 60 Python methods, with all four claims checked against source.

### Added

- **URL-credential patterns in the redactor** (`app/lib/security.ts`): `url_userinfo` (`https://user:pass@host`), `bare_userinfo` (`user:token@host`) and `url_query_secret` (`?api_key=` / `?token=` style) join the rule list, so all 22 `redactAny` callers inherit them. Tuned against real prose: comma/semicolon/hash-delimited addresses, `09:30@zoom.us` meeting times and bare `key=`/`sig=` query params do not fire. Overlapping matches of different rules now both count as findings (only a match fully inside an already-redacted span is dropped).

### Fixed

- **Windows bundle corruption at the source** (`scripts/refresh-bundles.mjs`): the `Compress-Archive` spawn is replaced with `tar.exe -a -cf` (the approach `build-desktop-plugin.mjs` already used), `__pycache__` is excluded from the plugin bundle, and a post-build assertion checks entry count against the source file count and rejects any backslash entry name, printing both counts. Closes the ERRORS.md item open since v5.28.0.

## [5.33.6] — 2026-09-05

### Added

- **`guard_policies (org_id, active, created_at DESC)` index** (drizzle/0076): the hottest read in the runtime was a sequential scan. Applied by the auto-migrate step every deploy already runs.

## [5.33.5] — 2026-09-04

### Changed

- **SDK `runGoverned`/`run_governed` now records in the same guard call** (`POST /api/guard?record=true`) instead of a separate `createAction` request — one HTTP round trip instead of two per governed action. Falls back to the previous `createAction` call when the server doesn't record (older self-hosted servers that ignore the `record` param, or a recording failure).
- **`/approvals` stops fetching every plan one by one.** `GET /api/plans?expand=details` returns each plan with its steps and deviations in two batched queries, so the page's 10-second poll is five requests instead of up to a hundred.
- **`/decisions/[actionId]` loads its optional detail (graph, trace, containment patch, guard correlation) in parallel** instead of a five-deep sequential waterfall.
- **Distributed rate limiter is one bounded round trip.** The Upstash path runs a single atomic `EVAL` (INCR + PEXPIRE) with a hard timeout (`DASHCLAW_RATE_LIMIT_UPSTASH_TIMEOUT_MS`, default 500 ms) instead of two unbounded sequential calls on every `/api/*` request; on timeout it falls back to the per-instance limiter instead of stalling.
- **Monthly action-ceiling read is cached** (30 s per org) while the org sits below 90% of its ceiling, and skipped entirely for plans with no ceiling; the live read resumes for any org within 10% of the line.
- **Hook launcher probes the Python interpreter once a day, not on every tool call** (`hooks/run_hook.cjs`): the cached answer is re-probed on the spot if the interpreter disappears.
- **Test suite runs on node by default** (jsdom only for `.jsx`/`.tsx` tests and the DOM-touching files listed in `vitest.config.js`): the full suite drops from ~511 s to ~161 s on the same machine.

## [5.33.4] — 2026-09-04

### Removed

- **Simplification round 3 (zero behavior change).** 64 exported symbols that nothing in the code or test trees referenced, with the private helpers and imports they orphaned: the dead `/posture` payload builder and the feedback CRUD in `app/lib`, unused domain types in `app/lib/types/*`, unreferenced repository helpers (`getCapabilityBySlug`, `deleteCapability`, `getIdentity`, `listTestRuns`, capability access rules), unused UI skeletons, a CLI render helper, and a handful of unused constants. 28 files, +5/-1,060 lines; per-symbol grep transcript in `docs/simplify/round-3-grep-transcript.txt`. No route, SDK method, MCP tool, CLI command, hook or contract changed; the full invariant snapshot is identical to 5.33.3 (`docs/simplify/round-3.md`). The dispatch-table pass found no keyed if/else chains to convert.
- **Program totals** (`docs/simplify/`): three rounds, three releases (5.33.2, 5.33.3, 5.33.4); files over 1,500 lines 9 → 5 (the rest are scripts, the single-file hook and the schema by design); 13 fewer duplicate helper clusters; net -941 source lines excluding the measurement tooling; every public surface byte-identical throughout.

## [5.33.3] — 2026-09-04

### Changed

- **Simplification round 2 (zero behavior change).** The five largest product files are now facades over topic siblings, every function body byte-identical: `app/lib/repositories/actions.repository.ts` (2,601 lines → 63 + eight `actions.repository.<topic>.ts`), `app/lib/guard/evaluate.ts` (1,804 → 416 + six `evaluate.<topic>.ts`), `app/lib/demo/demoMiddleware.ts` (1,700 → 58 + four), `middleware.js` (2,096 → 1,258 + `middleware.demo.js`, `middleware.shared.js`) and `app/api/guard/route.ts` (702 → 299; helpers in `app/lib/guard/route-record.ts` and `route-replay.ts`). Facade export names, OpenAPI, MCP tool schemas, SDK exports, CLI help, guard calibration, hook output and the policy smoke harness are identical to 5.33.2 (`docs/simplify/round-2.md`). Files over 1,500 lines: 9 → 5, the rest being scripts, the single-file hook and the schema by design.

## [5.33.2] — 2026-09-04

### Changed

- **Simplification round 1 (zero behavior change).** One implementation per behavior for ten duplicated helpers: api-key mint/hash (`app/lib/api-keys.ts`), `parseRules` outside the guard chain, `errorFrom` for the policy clients, the redundant memoized `getSql` wrapper in two routes, the Redis command-timeout trio (`app/lib/redis-command.ts`), the outcome-timeout resolver (`app/lib/outcome-timeout.ts`), the stale-Stripe-customer check, `buildPinnedDispatcher` (canonical in `url-safety`, re-exported by `webhooks`), the Python interpreter candidates and the inventory path helpers. 27 files, +82/-355 lines, five new modules. Public routes, OpenAPI, MCP tool schemas, SDK exports, CLI help, guard calibration and hook output are byte-identical to 5.33.1 (`docs/simplify/round-1.md`).
- **Measurement tooling.** `scripts/loc-report.mjs` (LOC, god files, long functions, fan-in, duplicate clusters) and `scripts/simplify-invariants.mjs` (contract, MCP, SDK, CLI, guard, hook and doc-count snapshot for byte-for-byte diffs). Baseline and plan under `docs/simplify/`.

## [5.33.1] — 2026-09-04 — A capability's declared settings are writable

### Fixed

- **Capability custody settings were unwritable.** Wiring the v5.33.0 `buy-domain` capability into a live org failed at the first step: `POST /api/settings` refused `VERCEL_REGISTRAR_TOKEN` and `REGISTRANT_CONTACT` with `Invalid setting key`, because the settings allowlist names known vendor keys and nothing else. The allowlist cannot enumerate every credential a capability might custody, and the seam exists so the credential lives in DashClaw and never with the agent. A setting a registered `http_api` capability declares, its `auth.token_setting` or any `$settings.<KEY>` in its request mapping, is now writable for that org; keys stay `[A-Z0-9_]`, and a key no capability declares is still refused. New unit test.
- **Platform guide drift.** `POST /api/capabilities` joins the guide dataset and coverage table, and the live examples are recaptured against this version, so the CI-only drift check passes again (it failed on the v5.33.0 commit).

No Node/Python SDK source change: npm and PyPI stay at 5.32.0.

## [5.33.0] — 2026-09-04 — Real money is evidence: a purchase holds, whatever names it

### Added

- **Real money is now a graded evidence class.** On 2026-09-04 an agent governed by the Claude Code hook bought two domains, truckside.io at USD 30 and gettruckside.com at USD 11.25, by running `cd ~/clawd && node tmp/tradesdesk-launch/domain-buy.mjs <name>` in a governed Bash call. Guard decisions `act_gd_4ff2312b986b4e88` and `act_gd_1309e9ca56e9457b` both answered allow, `other` at 30 and 75, with no evidence flags: the command text carried no money signal, so the org's spend line never saw a spend and the only gate that existed was a chat approval. The same path bought declick.dev on 2026-09-02. The retroactive records `act_acad2d21…` and `act_a96ccd9c…` are audit, not governance. The evidence classifier (`app/lib/guard/evidence.ts`) now grades a shell act as `spend` at 75, irreversible, flag `spend`, when it writes to a registrar, card, checkout or credit top-up endpoint (`/registrar/…/buy`, Stripe `/v1/charges|payment_intents|checkout/sessions|subscriptions`, PayPal `/v2/checkout/orders`, generic `/purchase|/checkout|/top-up|/buy-credits`) or runs a purchase CLI (`vercel domains buy`, `stripe … create`, `agentcash pay`, `gcloud billing`, `aws … purchase-*`). Lookups stay out: `/price` and `/availability` never carry the flag, and a URL printed by `cat`, `echo` or `grep` is data, not an act. On `http` acts a non-GET to a purchase endpoint grades `spend`, and the sensitive-host bump is unchanged, so a purchase on vercel.com or stripe.com still lands at 95.
- **The body of a script is evidence.** A shell act may now carry `act.script { path ≤1024, content_excerpt ≤6144 }` (`app/lib/validate.js`). The server grades the excerpt with the same classifier it runs on the inline command, catching spend endpoints, interpreter deletes, database URL literals and secret-file reads inside the file, and folds the two by the same max rule that governs every other piece of evidence. `node buy.mjs` is `other` at 30 by its command line and `spend` at 90 by what it runs. `hooks/dashclaw_pretool.py` attaches it for any local script the command executes, resolving the path against the hook's working directory and reading at most 64 KB; a script on a sensitive path attaches its path and never its contents; any failure yields no `script` key rather than a broken act. The OpenClaw plugin does the same.
- **A fifth line in the catastrophe pack: "Catastrophe Pack — Hold Real-Money Spend for Approval".** `risk_threshold` 70, `only_evidence_flags: [spend]`, `require_approval`, on the Short List, and **ungrantable**: every purchase is its own exact-amount approval, because a standing grant over spend is precisely what an unattended agent must not hold. `spend` joins `NEVER_PRECEDENTED`, so the loosening engine can never mint a precedent for it either. The line is seeded at org birth and, on the next deploy, into every existing org that already carries the pack (`seedLateAddedPackLines`, `scripts/auto-migrate.mjs` step 2d), so an org that installed the pack in July gets the spend hold without reinstalling anything. A fresh org's Short List now reads four holds instead of three.
- **The hook grades spend locally too.** `bash_classifier.py` gains a `spend` intent at risk 75, irreversible, mapping to action type `spend`, and `grade_script_content` floors a purchasing script at 75 with a `spend_endpoint` warning. The client grade and the server grade are independent readings of the same act, and the decision takes the higher one.
- **Credential custody through the capability seam.** An `http_api` capability now resolves `${input.<field>}` path parameters from the invocation body, URL-encoded, and `$settings.<KEY>` request-mapping values from server-held settings, JSON-parsed when the value parses. The invoke guard attaches the outgoing HTTP request as `act` evidence, so a capability invocation is graded on what it actually sends. This is the shape that makes a purchase safe to delegate: DashClaw holds the registrar token, the agent names the domain, and the operator approves the exact amount.
- **`POST /api/capabilities` is back**, admin-only, `201`/`400`/`409`, activity-logged. The v5 cull note said operators seed capability rows via direct SQL; credential custody needs a registration path that is not raw SQL. Create only: no pages, no update, no delete, no health. Recorded decision: capability registration stays API-only because it is a developer act performed once per integration, while the human's recurring role, approving the exact purchase, is a click on `/approvals` and on the Telegram approval card.
- **`@dashclaw/openclaw-plugin` 1.6.3** carries the script-excerpt evidence and is installed into `~/.openclaw/extensions/dashclaw-governance`.

### Fixed

- **The capability runtime sent ciphertext as a bearer token.** A setting whose key ends in `_TOKEN` is auto-encrypted at rest, but the runtime read the stored value and put it on the wire verbatim, so every capability holding an encrypted credential authenticated with the ciphertext and failed. The runtime now decrypts before substituting.
- **A `requires_approval` capability could never execute.** The invoke path held the call for approval and then had no way to run it, so an approved capability sat pending forever. The approved retry now executes under the `builtin:operator_approval` grant.

### Notes

- Node and Python SDK source is unchanged, so neither package is republished at this version. npm `dashclaw` and PyPI `dashclaw` stay at **5.32.0**, their last release; the shared version number still advances to 5.33.0 across `package.json`, `sdk/package.json` and `sdk-python/pyproject.toml`, and non-contiguous published versions are expected. Both SDK READMEs gained one paragraph documenting the optional `act.script` field, which is prose only.
- `@dashclaw/openclaw-plugin` 1.6.3 is built and installed locally; publishing is pending.
- One new API method, `POST` on the existing `/api/capabilities` path. The route total is unchanged at 134 because the path already existed. No new page, MCP tool, SDK method, CLI command or policy type, and no migration.
- Residual gap, stated rather than papered over: a client that does not attach `act.script` still gets `allow` on `node script.mjs`, because the command text is all the server can see. The Claude Code hook and the OpenClaw plugin attach it; the SDKs and the MCP server do not derive it for you.
- Maintainer log: `docs/maintainer-log.md`, 2026-09-04.

## [5.32.0] — 2026-09-04 — Containment reaches the database: a Postgres statement stages on a Neon branch

### Added

- **A database statement can now run contained instead of freezing.** The containment verdict has applied only to file mutations since 5.0.0: the act ran in a git worktree, the operator reviewed the diff once, and Promote raised a single-use grant for the merge. The same shape now covers Postgres on Neon. When a `Bash` act targets a Neon database through `psql`, `pg_restore`, `prisma` or `drizzle-kit` and the guard answers `allow_contained` with basis `db_branch`, the Claude Code / Codex / Hermes hook creates one ephemeral Neon branch for the session (parent = the branch the target endpoint belongs to, self-deleting after `DASHCLAW_DB_CONTAINMENT_TTL_HOURS`, default 72), rewrites the command to run against it, and after the run posts the statement, Neon's schema diff and the output tail as the evidence artifact. The card on `/approvals` reads "Database branch", and its button reads "Promote — replay on production": Promote mints a single-use, act-hash-bound `containment_promote` grant for the **original** statement, which `dashclaw contained apply` then runs against the real database. Discard leaves the branch to expire. RFC: `docs/rfcs/2026-09-04-database-containment.md`; THESIS.md carries the 2026-09-04 owner amendment that names containment beyond files as the next bet.
- **Inert unless you opt in.** The hook advertises the new capability string `allow_contained:db` only when `NEON_API_KEY` is in its environment, `DASHCLAW_DB_CONTAINMENT` is not `0`, the command is a database command and the target host is `*.neon.tech`. Without that, and for every non-Neon database, the verdict lands as `require_approval` exactly as before. Version skew only tightens: an old hook never receives a `db_branch` verdict, and an old server never emits one. A session stages against one database; a second endpoint in the same session interrupts instead of staging on the wrong branch.
- **Database shell commands are now graded.** The evidence classifier used to see `psql -c "DROP TABLE users"` as an unflagged `other` at 30. It now tags database commands with the `database` flag and grades inline SQL with the SQL classifier (`psql -c "drop table users"` scores 75 with `database` + `ddl`; `npx prisma migrate deploy` scores 60; `psql -c "select 1"` stays at 10). The default catastrophe pack keys on `protected_target`, which this never sets, so a fresh install's behavior on `psql` does not change. **An org with a custom `risk_threshold` hold at or below 85 will start holding destructive `psql` calls that previously ran unheld.** That is the honest grade, and the containment band is the relief valve.
- **CLI.** `dashclaw contained diff` prints database evidence; `dashclaw contained apply` on a database ref guards the original statement and runs it from the repo root with the operator's own environment. `@dashclaw/cli` 0.13.0.

### Changed

- A command that carries an inline `postgres://user:pass@host` literal stays on the approval rail: the ledger's sensitive-data scan redacts the credential inside the recorded act, so a replay could never be byte-exact, and the hook declines the capability rather than offering a card nobody can promote.
- The minted database promotion grant records the original action's `risk_score` and `reversible: false`; the file path keeps its constant 20 / reversible.
- Every artifact and log line the hooks write now has the password component of any Postgres URL redacted (file containment included).

### Notes

- Zero new API routes, pages, MCP tools, SDK methods, CLI commands or policy types; surface budget untouched; no migration. Node and Python SDK source unchanged (republished at 5.32.0 by the tag with identical source). Plugin bundle 3.2.0 carries the new `dashclaw_db_containment.py` hook module; `scripts/install-hooks.mjs` copies it.
- Not in v1, recorded in the RFC: SDK/MCP callers staging their own branch, data diffs (Neon has none; statement + schema diff + output are the evidence), non-Neon providers, early branch deletion on Discard.

## [5.31.1] — 2026-09-03 — An inherited confidence names the decision it came from

### Fixed

- **A record that inherits its confidence now links to the guard decision it inherited from.** 5.31.0 copied a guard-stated confidence onto a later `POST /api/actions` record when the record stated none, but the row carried only the number; which decision it came from was an inference over the same 24-hour window. The lookup now returns the matched decision's id alongside its confidence, and the route stamps it as `guard_decision_id` when the client sent none, so the audit link from the scored row to the prediction is explicit. Every consumer of that column benefits without changes: plain-language enrichment on `/approvals` and `/decisions`, the policy-tuning and loosening engines, and the calibration stream. A client-supplied `guard_decision_id` is kept as-is, and the existing same-org validation of client-supplied ids is unchanged because the server-found id is stamped after that gate and is same-org by query. A matching decision with no id is skipped rather than half-linked. No new route, page, MCP tool, SDK method or CLI command; no migration.

## [5.31.0] — 2026-09-03 — Confidence reaches the record on every transport; routines score as their own agent

### Added

- **A confidence stated at guard time now reaches the record on every transport, server-side.** 5.30.0 carried a `dashclaw_guard` confidence onto the following `dashclaw_record` only inside the stdio MCP process; the hosted HTTP connector is stateless, and the SDK `guard()` then `createAction()` flow never had a carry at all, so on both the prediction stopped in `guard_decisions.context` and the row scored as unstated. `POST /api/actions` now inherits it: when the record states no confidence, the route looks up the most recent guard decision for the same org, agent, action type and declared goal within 24 hours (the same window as the MCP carry) and copies its stated confidence onto the record and onto the decision row the POST itself writes. Served by the existing `(org_id, agent_id, created_at)` index, no migration. An explicitly stated value is never overridden, including an explicit 50, and the lookup fails open: an error leaves the record unstated exactly as before. No new route, page, MCP tool, SDK method or CLI command.
- **A routine behind a shared MCP connector can score as its own agent.** The server-configured identity still wins over anything the model passes as `agent_id` (a prompt must not be able to impersonate another agent), but a caller may now name a sub-agent under that identity as `<configured id>/<name>`, for example `claude-desktop/nightly-seo`. The hosted claude.ai connector is always `claude-desktop`, so before this every routine using it was one row on `/decisions` and the Predicted vs actual verdict could not tell them apart. The label must be 1-64 characters of letters, digits, `.`, `_` or `-`, starting alphanumeric, with exactly one separator; anything else falls back to the configured id silently. The governance skill tells agents when to use it. `@dashclaw/mcp-server` 3.1.5.

## [5.30.0] — 2026-09-03 — Confidence at guard time: the prediction is stated before the act

### Added

- **Stated confidence moves to guard time, where it is still a prediction.** `POST /api/guard`, MCP `dashclaw_guard` and both SDKs' `guard()` now accept `confidence` (0-100) and thread it onto the `action_records` row the guard creates with `?record=true` — including the blocked-action row. 5.29.0 shipped the Predicted vs actual panel on `/decisions`, but the only ways to state a confidence were `dashclaw_record` and SDK `createAction`, and a number written after the act is a postscript, not a prediction. The agent-facing instructions (governance skill, managed Codex AGENTS block) now tell agents to state it on the guard call and never restate it afterwards. Over MCP on the stdio transport (the `@dashclaw/mcp-server` process), a confidence stated on `dashclaw_guard` is carried onto the following `dashclaw_record` for the same agent, action type and declared goal automatically, one use, 24 hour window, so it is scored without being restated. The hosted HTTP connector is stateless and cannot carry it; there, state it on the `dashclaw_record` you open before acting.
- **Validation cannot fail the guard hot path.** `confidence` is deliberately absent from the guard input schema: the route coerces it server-side and accepts only an integer 0-100 (a numeric string like `"80"` is coerced), dropping anything else — out of range, fractional, non-numeric — rather than answering `400`. An omitted or dropped value leaves the column default of 50, which `/decisions` already reads as "unstated" and does not score. An optional advisory field never gains the power to refuse a governed action.
- **Stored, never decided on.** `confidence` does not reach guard evaluation, `risk_score`, containment, the replay binding (`buildReplayBinding` is a field allowlist and excludes it, so two honest retries stating different confidence still dedupe) or any idempotency-key derivation (every one of them hashes an explicit named field list). Pinned by unit tests on both the replay path and the record path.
- **Hooks intentionally send no confidence.** A `PreToolUse` event carries no prediction from the model, so any value the hook sent would be fabricated. `hooks/dashclaw_pretool.py` says so in a comment at the payload it builds, and keeps leaving the field unstated.
- No new route, page, MCP tool, SDK method or CLI command. `@dashclaw/mcp-server` 3.1.4.

### Fixed

- **`dashclaw_record` can now close the record it opened.** Pass the `action_id` returned by an earlier `dashclaw_record` (status `running`) or `dashclaw_guard` together with the final `status` and `output_summary`, and the MCP server PATCHes that record instead of inserting a second row. The managed AGENTS block has told agents to do exactly this since the governance protocol shipped, but the tool only ever POSTed, so every MCP-opened action stayed `outcome_status = pending` until the lost-confirmation sweep took it. Stated confidence on those records could never be scored. `@dashclaw/mcp-server` 3.1.3; no new tools.

## [5.29.0] — 2026-09-03 — Predicted vs actual: the ledger scores the agent's stated confidence

### Added

- **Predicted vs actual: the ledger now scores the agent's own stated confidence against what actually completed.** Every governed action already carried the prediction (`action_records.confidence`, 0-100) and the actual (`action_records.outcome_status`); nothing joined them. `GET /api/actions/stats` gains an additive `confidence` block — per agent, over a rolling 30 days: scored volume, weighted mean stated confidence, observed completion rate, the gap between them, and a verdict of `overconfident | underconfident | calibrated | insufficient` (overconfident at a gap of +20 or more, and only above 10 scored actions).
- **A `Predicted vs actual` panel on `/decisions`**, directly under the stats rail. Row per agent plus an All agents row, each agent linking to its own filtered ledger. The verdict is always spelled out in words, never carried by colour alone.
- **The default confidence of 50 is treated as unstated, and reported as coverage rather than silently scored.** 50 is the column default and hooks never send a confidence — only MCP `dashclaw_record` and SDK callers do — so scoring a defaulted row would invent a prediction no agent made. Rows at exactly 50 are excluded from the verdict and counted instead: every view leads with `N of M closed actions in the last 30 days carried a stated confidence.` Below 10 scored actions the panel gives no verdict at all, just that line and one sentence on how to start stating confidence.
- **Zero new surface.** No new API route, page, MCP tool, SDK method or CLI command: the calibration rides the stats endpoint `/decisions` already fetches, and is wrapped in its own try/catch so a calibration failure degrades to `confidence: null` instead of taking the throughput stats down.

## [5.28.0] — 2026-09-01 — Plan Attestation: pinned authority for unattended runs

### Added

- **Plans are now pinned by a whole-plan hash, and a runner can prove that pin is still good before it does anything.** Preflight Plan Authorization bound each *step* to its `act_content_hash`, but nothing bound the plan as a unit and nothing gave an unattended agent a place to ask, at wake, whether the authority it is about to spend is still approved. `plan_authorizations.plan_hash` is that pin — `sha256` over the canonical JSON `{ agent_id, declared_goal, steps: [{ seq, action_type, act_content_hash }] }`, computed at submission (where every input is final: nothing later rewrites a step's act hash) and returned from `POST /api/plans`, `GET /api/plans` and `GET /api/plans/[planId]`.
- **`POST /api/plans/[planId]/attest` — the run-start seam.** Agent-facing (the same org-scoped credential the plan detail GET takes, not the operator verdict's admin auth). Body `{ plan_hash }`; returns `{ ok: true, plan_id, plan_hash, expires_at, steps_remaining }` on success, or `{ ok: false, reason }` with `reason` one of `not_found | not_approved | expired | revoked | hash_mismatch`. `200` for ok, `404` for `not_found`, `403` for every other refusal.
- **The contract is fail closed.** A runner attests at run start and makes no model call until it gets `ok: true`. Every ambiguity resolves to a refusal: a `NULL` stored hash (a row predating the migration) is a mismatch, an approved plan with no `expires_at` is expired, and any status outside `approved`/`partially_approved` is `not_approved` rather than interpreted. An explicit operator "no" (`revoked`/`denied`) is reported ahead of liveness and content, so a stopped runner learns it was stopped rather than merely stale. The stored hash is never echoed on a mismatch — handing it back would give a caller holding a drifted plan the exact digest needed to forge a passing attestation.
- **Every attestation is journaled.** Pass or fail, a call that finds the plan in the org bumps `attest_count`, stamps `attested_at`/`last_attest_result` and writes a `plan.attested` activity row — a runner hammering a revoked plan is the signal, not noise. `/approvals` shows the short hash and an "Attested N× · last … · result" line on both the review card and the live-plans row.
- **SDK parity:** `attestPlan(planId, planHash)` (Node) and `attest_plan(plan_id, plan_hash)` (Python), each documented with a five-line fail-closed example.

### Changed

- **Surface budget amended (`contracts/surface-budget.json` + `THESIS.md`, same commit, as the brake requires):** API routes 133 → 134, Node SDK methods 39 → 40, Python SDK methods 59 → 60. The seam could not fold into the existing `POST /api/plans/[planId]` — that is the operator verdict behind admin plus attributable-principal auth, and this is the constrained agent asking about its own authority; merging them would put an agent-facing call behind an admin credential or an admin verb behind an agent one. Zero new tables (four additive columns in `drizzle/0075_plan_attestation.sql`), zero new policy types, no change to guard evaluation. Adapted from memcode's autonomous-agent wake design.

## [5.27.8] — 2026-09-01

### Fixed

- **The sidebar Tuning link now works when you're already on `/policies#calibration`.** Tuning is a same-page hash link, and the browser only scrolls on a hash *change* — with `#calibration` already in the URL a click was a genuine no-op (the calibration section's own scroll effect fires once at first data load, never on click). The nav click handler now detects a same-page hash link and scrolls the target section into view itself; cross-page navigation is unchanged.
- **Self-host consoles no longer show a red 404 on every dashboard page.** `GET /api/hosted/claim` returned 404 when `DASHCLAW_HOSTED` is off, but `ClaimWorkspaceBanner` probes it on every page; GET now returns the same calm 200 non-claimable preview used for the no-cookie case (`{claimable: false, reason: 'not_hosted'}`). `POST` stays 404 off-hosted.

## [5.27.7] — 2026-08-28

### Fixed

- **Production deploys were silently broken since the Next 16.3.2 bump (#227).** Next 16.3.x with `output: 'standalone'` skips emitting `next-server.js.nft.json` when Vercel's adapter is in play (vercel/next.js#96646; the fix lives only in 16.4 canaries), so every Vercel deploy from 31c407cb through 6609ac35 died in `onBuildComplete` with ENOENT while GitHub CI stayed green — production kept serving the pre-bump build. `output: 'standalone'` is now conditional: off on Vercel (which never used the standalone output), kept for the Docker/self-host path.

### Security

- **Next.js 16.3.2 → 16.3.3**, which patches two critical advisories: unauthenticated RCE on Windows-hosted servers (GHSA-p293-qw3h-jr36) and unauthenticated RCE in the Image Optimization API via AVIF (GHSA-2xp9-vwfh-vxw4).

## [5.27.6] — 2026-08-28

### Security

- **Cleared every open GitHub security alert fixable from this repo.** CodeQL: the guard's inert-git-message regex (`GIT_MESSAGE_VERB_RE`) is rewritten backtracking-safe — the `/i` flag already folds `-C` into `-c` and `--\S+` already matches `--opt=value`, so the ambiguous alternatives that made `git --aaa…` input superlinear are gone (4 alerts; a 14-case equivalence check and a hostile 55KB input at 0ms pin the rewrite). Invite email validation drops the classic `[^\s@]+@[^\s@]+\.[^\s@]+` regex for linear string ops (1 alert), and the tailwind-token test's selector escaper now escapes backslashes (1 alert). Dependabot: `nanoid` patched to 3.3.18 in the root and `media/remotion` lockfiles.
- **The four hono alerts in `packages/openclaw-plugin` remain upstream-blocked, on the record:** openclaw's bundled `npm-shrinkwrap.json` (verified through 2026.7.1-2) still pins hono 4.12.25, which outranks consumer overrides. Ours are staged at the patched versions (`hono ^4.12.34`, `@hono/node-server ^1.19.15`) so the fix lands with the next openclaw shrinkwrap refresh.

## [5.27.5] — 2026-08-28

### Fixed

- **`GET /api/guard/decisions` responses are self-describing about scope.** The listing obeys the caller's filters while `stats` has always been org-wide over the last 7 days — and nothing said so, so a filtered caller (the MCP client pins its configured agent id onto every listing) got an apparent contradiction: 9 rows beside 997 warns in one envelope. The response now echoes the applied `filters` and carries `stats_scope: "org-wide, last 7 days, unfiltered"`. Additive fields only; no consumer contract changes.

## [5.27.4] — 2026-08-28

### Fixed

- **`GET /api/guard/decisions` now honors the `since` and `action_type` filters it has always advertised.** The `dashclaw_decisions_recent` MCP tool documents both filters and forwards them, but the route read neither — so an agent asking "what have I done recently?" got unfiltered history back while believing the time bound was applied (the maintainer found it by steering off exactly such a read). Both filters now reach the repository (`created_at` lower bound, exact `action_type` match) and apply to the `total` count as well; an unparseable `since` answers 400 instead of silently returning full history. `/decisions` had this same silently-ignored-params class of bug fixed once before — this closes the API sibling and pins the contract with tests on both the route params and the SQL conditions. No new routes, pages, or SDK methods.

### Changed

- **Roadmap: the 2026-08-28 post-calibration steering decision is on record** (`docs/plans/owner-roadmap.md`): the 7-day live-org read (22 approvals / 0 blocks / 997 warns against the 1,759-approvals baseline of 2026-08-16) plus three dated obligations — R1 durability re-read (2026-09-15), R2 secret-file-hold re-arm proposed for the owner's ratification, R3 next activation-funnel read (2026-09-30).

## [5.27.3] — 2026-08-21

### Fixed

- **`mkfs` grades as a raw device write.** The 5.27.2 live proof ran three
  shapes through the deployed guard: `rm -rf ~` held, `rm -rf ./dist`
  ran, and `mkfs.ext4 /dev/sdb1` **ran** — it carried the `protected_target`
  flag the gated line keys on but totalled 90, below the line's threshold,
  because it had the flag without the device-write modifier. `mkfs` now
  rides the same branch as `dd of=/dev/sda` (+20, flags `device_write` +
  `protected_target`, evidence total 100) and holds.

## [5.27.2] — 2026-08-21

### Fixed

- **The default packs' mass-destructive line now keys on evidence, not on
  the score.** `risk_threshold` rules accept `only_evidence_flags: [...]`:
  the line fires only when the server-side classifier tagged the act with
  one of the listed flags (`context.evidence_flags` is server-set; a client
  copy is stripped by validate). The catastrophe-only and claude-code-starter
  "Hold Mass-Destructive Operations for Approval" lines pin
  `only_evidence_flags: [protected_target]` — rm/`find -delete` on a
  filesystem root, drive, home or system tree, a raw block-device write,
  `mkfs` (which now carries the flag). The bare `threshold: 100` was the
  wrong key: the score saturates at 100 for `cat -n site/.env.example`
  (secret_exposure), for a heredoc whose prose contains `dd now …` or
  `truncate`, for any `security`-typed shell call — five hand-approvals in
  one morning, none a catastrophe. Everything outside the flagged class now
  runs and is logged; `rm -rf` on a project path keeps its security/100
  grade in the ledger without interrupting.
- **Already-seeded orgs are upgraded in place.** `gateMassDestructiveOnEvidence(sql)`
  (`app/lib/setup/catastrophe-pack.mjs`), called from `scripts/auto-migrate.mjs`
  on every deploy, merges the flag gate into both seeded line names wherever
  the key is absent — same policy id, grants and decisions stay attached;
  rows an operator already tuned are untouched.
- `/policies` Ledger describes a gated line ("… whose evidence is tagged
  `protected_target`") so the human can read what the rule actually keys on.

## [5.27.1] — 2026-08-21

### Changed

- **Nothing in the default packs refuses outright any more.** The risk-100
  line of the catastrophe-only pack (seeded into every new org) and of the
  claude-code-starter pack was `action: block`. At score 100 the runtime
  cannot tell "wipe the disk" from "ship the site" — an irreversible
  `deploy` stacks to exactly 100 (deploy 75 + deployment-pattern 10 +
  irreversible 15) — and it was refusing a Vercel deploy with no approval
  card and no way for a human to say yes. Both lines are now
  `require_approval`: the hold lands on `/approvals` with one-click
  approve/deny, and the human decides. Renamed to "Hold Mass-Destructive
  Operations for Approval"; the policy ids are unchanged.
- **Already-seeded orgs are migrated in place.** `scripts/auto-migrate.mjs`
  now flips any seeded "Block Mass-Destructive Operations" row (any org) to
  the hold shape on every deploy — matches the old name only, so it is a
  no-op once flipped. The `/connect` receipt sentence follows the new
  shape ("Three of these hold for your approval").

## [5.27.0] — 2026-08-20

### Added

- **The Short List.** The catastrophe-only pack DashClaw already shipped and
  already declared the default (THESIS.md) is now a named, human-visible
  object on `/policies`: at most ten hard-capped lines, the only rules
  permitted to interrupt an unattended run, each showing a BLOCK / HOLD /
  WATCH chip (word, never colour alone), a 30-day hit count, and per-line
  Details / Off controls. A brand-new self-hosted or hosted org is governed
  with zero clicks; a Watch tier holds everything else at a forced `warn` so
  it feeds calibration without ever interrupting.
- **Force-push over a protected branch is a HOLD, not a dead-letter BLOCK.**
  A branch-aware predicate (`rules.git_push` / `except_git_push`) excludes a
  pure force-push to `main`/`master`/a release branch from the risk-100 BLOCK
  line and routes it to an approval card instead; a force-push to a feature
  branch is untouched. `block` still always wins the severity merge — the
  exclusion is a predicate on the BLOCK rule's own match, never a HOLD
  out-voting it.
- **Retrospective warn-review verdicts.** Every warn-group row in "Needs your
  call" gains a Yes/No pair ("Would you have wanted this stopped?"), writing
  a `warn_review`-sourced adjudication through `POST /api/policies/review/verdict`
  (`retro_fine` / `retro_stop`). This is the calibration controller's primary
  feedstock under a catastrophe-only posture, where live approve/deny
  verdicts alone would take weeks to accumulate. Weighted 0.5 of a live
  verdict and structurally unable to move the threshold in the tightening
  direction; Relief requires 10 weighted verdicts **and** at least 3 live
  ones.
- **Misfire card.** When one command shape is held three times in 24 hours by
  a Short List line, a pinned MISFIRE row in "Needs your call" offers a
  two-click, shape-scoped exception (`rules.shape_exceptions`) that keeps the
  line enforcing everything else. Caps a scorer misclassification at three
  interruptions instead of the 1,759 the org saw on 2026-08-16 — from a
  read-only `git log` scoring 100 — and works even on ungrantable lines
  because it is a human click, not an auto-demotion.
- Watch-tier (non-Short-List) installs of `role_constraint`, `delegation_constraint`,
  `non_fabrication`, and `webhook_check` — policy types with no Watch-tier
  semantics of their own — land dormant rather than partially enforcing.

### Changed

- `/calibration` is deleted as a standalone page and folded into `/policies`
  as a collapsible Calibration section (anchor `/policies#calibration`); the
  sidebar entry is relabelled **Tuning**. `next.config.js` carries a
  permanent redirect from the old URL. App page ceiling: 54 → 53 (see
  `THESIS.md` amendment log and `contracts/surface-budget.json`). Zero routes
  changed — the section runs on the same `/api/calibration/controller` pair.
- Every rule created outside the Short List (pack install, template, AI
  generator, manual create, shield template) is now forced into the Watch
  tier — `action: warn`, no `short_list` flag — regardless of what it asked
  for. Promotion to the Short List is a one-click, evidence-backed act in
  "Needs your call," never automatic and never on install.
- The calibration controller now defaults to **shadow ("Preview")** for any
  org with no explicit setting, instead of off, so a fresh org starts
  learning from its first decision. Existing orgs with an explicit `off`
  setting are unaffected.
- Hosted trial orgs are now seeded with the Short List pack at provisioning,
  same as self-hosted orgs at birth; previously only self-host got a seed.
- Calibration's Greek-letter and raw-field vocabulary (θ, α, "adjudications",
  "Reset state", "Shadow / Relief / Active", …) is replaced everywhere in the
  product by plain-English labels ("Pausing above risk," "Acceptable false
  interruptions," "Verdict from you," "Preview / Fewer interruptions / Fewer
  and more interruptions," …). The symbols survive only in
  `docs/architecture/governance-core-theory.md`, which gains a UI label ↔
  symbol table. Machine ids on `/api/calibration/controller` are unchanged —
  this is a label layer, not a schema change.

  **Release note:** the controller's `GET` snapshot now splits labeled
  adjudications into live and retrospective counts and reports `labeled_live`.
  An org that has already accumulated 10+ weighted labels but fewer than 3
  live approve/deny verdicts will see Relief pause until 3 live verdicts
  land — a one-time transition, not a regression.

### Removed

- The Policy Modes "Active mode" card and the ten-shield toggle grid
  (`PresetsShields.tsx`). The ten SHIELDS definitions survive as templates
  inside "Add a rule," where new rules from them land in the Watch tier like
  any other non-Short-List rule.
- The Modes drawer authoring UI (`ModeDrawer.tsx`) and the calibration
  glossary strip (`GlossaryStrip.tsx`) — three terms now do the work six
  used to. The `importMode` server path is unchanged, so mode-tagged rows in
  existing orgs keep working and keep rendering in the ledger.

## [5.26.0] — 2026-08-20

### Changed

- **Team Tasks accept any agent id, not just `claude|openclaw|wes`.** The
  `/api/team-tasks` routes validated `from_agent`, `to_agent` and `lead_agent`
  against a two-name enum that mirrored the original `/team` ledger client, so a
  second multi-agent system could not post to the same ledger: the Practical
  Systems company loop - MoltFire (CEO), Forge (assurance), Cinder
  (communications), the `ps-*` specialists and Mission Control itself - was
  rejected with 400 on every event. Participants are now any lowercase slug
  (`^[a-z][a-z0-9_-]{0,39}$`, `isTeamAgentId` in the repository); the closed list
  was never the trust-boundary check, the shape is. `origin` gains
  `company-loop`. Statuses and event types are unchanged, so the existing ledger
  client syncs exactly as before. MCP tool descriptions and the platform guide
  describe the id as a slug instead of an enum.

- **The calibration controller now loosens as well as tightens.** It had one arm:
  above the calibrated threshold θ it could raise `allow`/`warn` to
  `require_approval`, and below θ it could do nothing at all. That made the
  controller's own target unreachable — θ rose on every approval, but the policy
  interruptions underneath it stood regardless, so the engine could only ever add
  interruptions to an operator's day and never remove one. The new demote arm
  downgrades a policy's `require_approval` to `warn` below θ, which is what makes
  the interruption set it controls actually `{score ≥ θ}`.

  Bounded four ways, each closing a different way relief could be unearned: it
  waits for 10 adjudications; it never reaches past `reliefCeiling` — the highest
  risk score the operator personally approved and has not since denied at or above,
  which starts at −1 so switching the mode on can never relieve a band nobody has
  ruled on, and which one deny at score *s* retracts above *s* on the next call; it
  never touches an `ungrantable` rule or an agent under a standing denial alarm;
  and it demotes to `warn`, never `allow`, so the action stays on `/decisions` with
  the gating reasons preserved. Blocks remain absolute, and no policy row is ever
  edited — standing policy changes still route through the human-ratified `/policies`
  rails.

  New mode `relief` on `/calibration` runs the demote arm alone, for an operator who
  wants interruptions removed without any added; `active` now runs both arms. Relief
  is one click (it only reduces enforcement); `active` keeps its two-step confirm.
  The loosening evidence queries count a relieved decision as an interruption that
  still happened, so demoting cannot erase the signal that justified it.

### Fixed

- **Read-only `git log` no longer scores as `rm -rf /`.** `DESTRUCTIVE_GOAL_PATTERNS`
  now requires `format` to take a device object (`format c:`, `format /dev/sda`,
  `format the disk`) instead of rejecting one flag spelling. The 2026-07-01
  `(?<!-)\bformat\b` fix rejected `--format=` but not `--date=format:` (the preceding
  character is `=`, not `-`), so every git-log command carrying `--date=format:` took
  +20 destructive and hit the 100 clamp — 1,759 approval interruptions in seven days
  in one org. `npm run format` was affected the same way. Pinned by three new golden
  vectors; server-side only (the Python client classifier already graded `format` as a
  readonly verb).
- **A `risk_threshold` policy at or above tuning's cap is no longer unreachable by both
  engines.** Loosening used to skip every `risk_threshold` policy on the grounds that
  the tuning engine owned them, but tuning's only relaxation computes
  `min(threshold + 10, 95)` and requires that to exceed the current threshold — so a
  policy at 100 got nothing from either side. `tuningCanMove()` now decides the handoff.

### Added

- **Interruption budget** — the first relaxation path that fires without the operator
  adjudicating anything. Every previous mechanism (`allow_grant`, precedent, approval
  pause, scope relax, deactivate, threshold raise) gates on resolved approvals, but
  interruption volume is exactly what stops a human resolving them. This one reads
  volume only.
  - *Policy grain*: past `DASHCLAW_INTERRUPTION_BUDGET` interruptions per 24h (default
    50), a rule is reported on `/policies` as a defect and its `require_approval`
    verdicts are downgraded to `warn`.
  - *Command-shape grain*: past 10 interruptions per 24h for one command shape
    (`git log`, `npm run`, `biome check` — normalized across wrappers, flags and paths),
    that shape stops interrupting while its policy keeps enforcing everything else.
  - Never reaches `allow`, never touches `block`, never relaxes a rule marked
    `ungrantable` (those get a one-click deactivate card instead), and never demotes when
    any co-gating rule is under budget. No migration, no new route, no new page.
  - Set `DASHCLAW_INTERRUPTION_BUDGET` to `0` to disable both grains.

## [5.25.0] — 2026-08-14

The Policy Pack Gallery. Platform-only ship — neither SDK's source changed, so
npm/PyPI stay at the last SDK release.

### Added

- **Policy Pack Gallery at `/policies/packs`.** The pack catalog — previously
  buried inside the Import modal — is now a browsable surface: 18 curated packs
  filterable by audience (coding agents, money, comms, infra, data, fleets,
  support, unattended) and strictness, each card opening a drawer with the
  pack's rules, a **"preview against my history"** dry run (what the pack would
  have blocked / held / warned on over the org's last 30 days), and a one-click
  install. Entry points: a "Browse packs" button on the `/policies` Ledger
  toolbar, a "Pick your rules" card on `/connect`, and a link on `/setup`.
  Spec: `docs/rfcs/2026-08-14-policy-pack-gallery.md`.
- **11 new policy packs**, all new-format (explicit `policy_type` + `rules`)
  with embedded test recipes proven against the real evaluator:
  `spend-lockdown` (every real-money action held for approval of the exact
  amount), `outbound-comms-guard` (external sends held + non-fabrication
  verification), `night-shift` (the unattended-run posture — everything
  external pauses in the approval queue, deviations pause too, runaway loops
  block), `prod-infra-shield`, `data-protection`, `fleet-control`,
  `support-agent`, `ci-release-bot`, `evidence-first`, `read-only-analyst`,
  and `browser-operator-guard`. No pack claims a compliance framework.
- **Pack-mode simulate.** `POST /api/policies/simulate` accepts
  `{ pack, days? }`: every policy in the pack is dry-run against the same
  historical window; the aggregate counts each action once at its most severe
  outcome (block > require_approval > warn) and `per_policy` reports each
  rule's own matches. Existing single-policy mode unchanged.
- **Gallery metadata on the catalog.** `GET /api/policies/templates` now
  carries per-pack `audience`, `strictness`, `stack_after`, an org-scoped
  `installed` flag, and a per-policy decision `bucket`. Zero new API routes —
  the gallery rides templates/simulate/import. Surface budget amended:
  app pages 53 → 54 (`contracts/surface-budget.json`, THESIS amendment log).

### Security

- **Demo passthrough no longer forwards caller-supplied org identity.** The
  demo-mode middleware passthrough forwarded inbound headers unchanged, so an
  unauthenticated caller on a demo host could set `x-org-id` and probe an
  arbitrary org's data on passthrough routes (e.g. which policy packs an org
  has installed). The passthrough now strips `x-org-id` / `x-org-role` /
  `x-user-id` and marks the request `x-dashclaw-demo: 1`; the templates route
  skips its org-scoped read entirely on that marker.

### Fixed

- **`summarizeRules` reads new-format packs.** Pack policies authored with the
  `rules:` key (claude-code-starter and all gallery packs) summarized as
  "custom" everywhere the catalog renders; the summary now derives from either
  format and covers rate-limit, protected-path, evidence, green-contract, and
  delegation fields.
- **`@dashclaw/mcp-server` 3.1.2: Codex CLI v0.147+ startup no longer fails.**
  Codex probes `prompts/list` during its MCP handshake regardless of advertised
  capabilities and treats the SDK's default `-32601 Method not found` reply as
  a fatal client startup failure ("MCP client for `dashclaw` failed to
  start"). The server ships zero prompts; it now advertises the (empty)
  prompts capability and answers the probe with an empty list.

## [5.24.2] — 2026-08-14

Documentation-accuracy patch from the launch preflight sweep. No app code, no
SDK source change.

### Fixed

- **`.env.example` documents 11 previously code-only operational env names**:
  `REALTIME_REDIS_URL` (fallback alias for `REDIS_URL`),
  `DASHCLAW_WITNESS_WINDOW_MINUTES` (silent-lane witness window), the six
  `STARTUP_SMOKE_*` knobs for `npm run startup:smoke`, the two `LIVE_CANARY_*`
  origin overrides for `scripts/live-canary.mjs`, and `HOSTED_ADMIN_API_KEY`
  for the hosted stranger drill. The live-canary section also clarifies that
  `LIVE_CANARY_REPORT_URL` / `LIVE_CANARY_REPORT_KEY` are GitHub Actions
  repository secrets, not `.env` vars.
- **Platform guide: retired Stripe env names corrected.** The setup inventory
  in `public/guides/platform-guide-data.json` (and its provenance record
  `docs/platform-guide-coverage.json`) still listed `STRIPE_PRICE_PRO` /
  `STRIPE_PRICE_BUSINESS`; corrected to the shipped `STRIPE_PRICE_INDIE` /
  `STRIPE_PRICE_TEAM`.

## [5.24.1] — 2026-08-14

Spend-governance follow-up to a live incident: on 2026-08-14 a governed agent,
told to "fix the billing items," bought $25 of API prepay credits on a stored
card — stating the amount but clicking before the human confirmed it. The
governance skill's risk taxonomy never named spending money, so the agent had
no instruction to route the spend through guard, and no policy class held it.

### Added

- **Governance skill: real-money spend is now a named High-risk class.** The
  `dashclaw-governance` skill (download bundle + Claude Code/Codex/Hermes plugin
  mirrors) adds a "Real-Money Spend" section: any action that moves real money
  is High risk regardless of amount, must be declared with a spend-class
  `action_type` (`purchase`, `payment`, `spend`, `prepay`, `buy_credits`,
  `top_up`, `subscription_create`, `subscription_change`, `billing_change`,
  `domain_purchase`, `card_charge`) rather than laundered through a generic
  type, and the `declared_goal` must state the exact amount and currency — an
  approval binds to that exact goal, so a different amount needs its own
  approval. Standing instructions ("fix the billing") are never spend
  authorization. Pair it with a `require_approval` policy listing those action
  types to hold every spend for a human.

## [5.24.0] — 2026-08-14

The first real external-verdict adapter build (Agent Memory/PAMA, #219) hit a
contract gap within a day of the seam shipping: a domain-specific provider was
being consulted on every guard evaluation, including acts far outside its
authority, and the frozen v1 vocabulary has no `abstain`. Resolution: scope is
a host configuration concern, not a wire verdict.

### Added

- **External-verdict applicability scope.** The `/policies` provider panel
  gains "Action types it governs" (`EXTERNAL_VERDICT_ACTION_TYPES`, exact
  comma-separated allowlist; empty = every act, the original behavior). With a
  scope set, out-of-scope acts never call the provider, spend no hot-path
  latency, and take **no** unavailability posture — there is nothing to be
  unavailable for — while the decision evidence records `status: "skipped"` /
  `regime: "not_applicable"` honestly: `External: out of scope` on decision
  detail, deliberately unlabeled on `/approvals` (a never-consulted provider
  never caused an ask). The scope key is plain-text on purpose so it survives
  an undecryptable URL after a key rotation: an out-of-scope act never takes a
  `fail_closed` escalation from a provider that was never going to be asked.
  The frozen four-verdict wire contract is unchanged (RFC addendum recorded);
  the conformance suite grows six scope cases. Zero new routes, SDK methods,
  MCP tools, or policy types.

### Fixed

- **Governance-signal dismissals hardened** (adversarial review of the v5.23.4
  arc, 13 confirmed findings). Dismissed signals now actually stay dismissed on
  both key shapes; the durable `mcp_degraded` mute keys per MCP *server* (the
  granularity the signal is minted at) instead of muting every server's alert
  at once; the muted list no longer leaks other agents' dismissals into
  agent-filtered views; `dismissed_by` is recorded; and muting a signal is now
  an **admin** act (`POST`/`DELETE /api/signals` gated) — it hides a live risk
  condition from the whole org, mirroring the approval-pause gate.
- **Redis event publishes after a timeout use a live client.** `events.ts`
  `publish()` no longer reuses a connection its own timeout handler had just
  destroyed.
- **CI cron sweeps cover every instance** — per-target cron secrets instead of
  sweeping only the first configured instance.
- **Copy Agent Prompt survives uBlock Origin's ClickFix defense.** The agent
  setup prompt is shell-command-laden, which is exactly what uBlock 1.72+'s
  clipboard defuser intercepts on programmatic writes — undetectably, so the
  button could show "Copied!" over an empty clipboard, and a failure was
  silently swallowed. The button now always opens a dialog with the prompt
  pre-selected (a native Ctrl+C is a user copy no extension blocks), states
  honestly whether the programmatic copy happened, and explains the blocker
  when it didn't. Also shows the operator exactly what they're handing their
  agent before they paste it.

## [5.23.4] — 2026-08-14

One command from a bare machine to a governed OpenClaw agent. Platform-side
this is docs/marketing accuracy plus a drill-hygiene fix; the feature ships in
`@dashclaw/cli` **0.12.0** (independent track, published by this release's tag).
No SDK source change, so the Node/Python SDKs are not republished by intent —
`release.yml` skips registry-matching versions only, and the unified number
advances regardless.

### Added

- **`dashclaw install openclaw` interactive onboarding wizard** (`@dashclaw/cli`
  0.12.0). A bare invocation in a terminal now fills every gap conversationally
  instead of dying with "baseUrl is required": no DashClaw instance? it offers
  the **hosted trial** (signup page + pasted key — Turnstile can't be driven
  headlessly) or a **local install on the same machine** by running the
  `dashclaw up` pipeline inline, reading the minted key from instance state and
  staying attached to the server afterwards exactly like `up` does. No API key?
  It collects one (trial paste flow, or a pointer to `<instance>/connect`). No
  `--agent-id`? It prompts with a per-machine default (`<hostname>-openclaw`) so
  fleets stop sharing the silent `openclaw` id. It then offers to save URL+key
  to `~/.dashclaw/config.json` (merge, mode 600). Non-TTY invocations are
  untouched — the installer's hard errors still fail loudly, nothing hangs on a
  prompt. `DASHCLAW_AGENT_ID` env skips the agent-id prompt; the saved-config
  `agentId` is deliberately ignored there (it defaults to `cli-operator`, a
  human identity that must never become an agent's ledger id). The hosted-trial
  flow is now shared code (`cli/lib/trial.js`) between `install claude --trial`
  and the wizard.

### Fixed

- **Docs/marketing said the raw plugin install was self-sufficient.** The
  npm-facing `@dashclaw/openclaw-plugin` README now leads with the CLI installer
  and states what `openclaw plugins install` alone does NOT do (no enable, no
  key, no config — and fail-closed refuses every tool call if enabled keyless);
  `/guides/openclaw` prerequisites drop the pre-provisioned instance+key
  requirement; `/connect` no longer describes the OpenClaw plugin with Claude
  Code hook vocabulary (`before_tool_call`/`after_tool_call`, not
  PreToolUse/PostToolUse); `llms.txt` documents the headless contract for
  agents.
- **Fresh-Windows drill staged over stale artifacts.** The launcher now clears
  `drill.log`/`up.log`/`install-claude.log` from the sandbox share at stage
  time, not just `drill-result.json` — a previous run's logs read exactly like
  live progress and misled a maintainer watching the share mid-drill.

## [5.23.3] — 2026-08-14

Follow-up hardening to the v5.23.2 bounded Redis connect (#222), closing the
same production incident: OpenClaw agents fail-closed on `POST /api/guard` /
`POST /api/actions` 30s timeouts. Platform-only; no SDK source change, so the
Node/Python SDKs are not republished.

### Fixed

- **Org rate limiting: Redis commands are now bounded too, and a stalled
  client is discarded.** #222 bounded `connect()`, but on a warm serverless
  instance an established connection can go half-open (NAT idle-drop emits no
  error event, so node-redis v4 never reconnects and has no command timeout) —
  `INCR`/`PEXPIRE` then pended forever and held the governance write path until
  the caller's 30s watchdog. Commands now race a 2s timer and degrade to the
  bounded in-memory limiter (never unlimited); a command timeout also destroys
  the cached client and clears the client promise so the post-cooldown retry
  builds a fresh connection instead of reusing the dead socket every window.
  Verified live: post-deploy canaries (guard → action record → outcome) warm
  109–494ms and cold ≤4.2s, plus a real governed OpenClaw agent-to-Telegram
  delivery. (#223)

## [5.23.2] — 2026-08-14

Hardening release from a whole-codebase adversarial review (five finder
dimensions, an independent skeptic per finding; 10 findings confirmed, 2
refuted, 1 downgraded on spot-check). No new public surface; no SDK source
change, so the Node/Python SDKs are not republished.

### Fixed

- **External-verdict `fail_closed` posture now applies when the saved provider
  config can't be read.** An undecryptable provider URL (e.g. after an
  `ENCRYPTION_KEY` rotation) used to collapse into "not configured" — the guard
  silently proceeded local-only with no evidence. It now takes the org's
  posture with a distinct `config_unreadable` failure code, and an unexpected
  throw after the config loaded takes it as `internal_error`. The `/policies`
  Test provider probe distinguishes "never configured" from "saved but
  undecryptable."
- **Org halt (and approval-pause) can no longer be un-enforced by a cache
  race.** A settings read in flight when `POST /api/halt` invalidated the guard
  caches could refill them with pre-halt state for up to 3s; a per-org
  generation counter now discards those stale refills.
- **`GET /api/cron/signals` no longer double-fires operator alerts when runs
  overlap.** New-signal detection is now an atomic `ON CONFLICT DO NOTHING
  RETURNING` claim, and webhooks/emails/native/SSE notifications fire only for
  signals the run actually claimed.
- **Guard `?record=true` returns the DLP `security` summary** (parity with
  `POST /api/actions`) instead of silently dropping redaction findings, and a
  lost idempotency-key insert race now recovers the winner's `action_id`
  instead of reporting a false `recorded: false`.
- **Org rate limiting: the Redis connection attempt is now explicitly bounded**
  so a dead endpoint can't stall the guard hot path while the client falls back
  to the in-memory limiter. (#222)

### Performance

- `webhook_check` policies evaluate their outbound calls concurrently (was
  serial inside the shared 3500ms guard deadline).
- New `(org_id, agent_id, action_type)` index (migration 0074) for the
  predictive-risk 30-day history query, which previously scanned an agent's
  entire action history per guard call.
- The guard decisions list no longer probes `information_schema` on every
  request (memoized), and the guard-path idempotency lookup selects two columns
  instead of the full row.
- `webhook_deliveries` gets 30-day ride-along retention — it was the one
  delivery-log table with no reaper and grew without bound.

## [5.23.1] — 2026-08-14

### Added

- **Test provider button on the `/policies` external-verdict panel (#219
  follow-up).** One click fires a clearly-synthetic act (`action_type:
  "dashclaw.connection_test"`, `act: {"synthetic": true}`) at the **saved**
  provider config through the exact production wire client, and renders a
  five-stage contract checklist — endpoint reachable, provider responded,
  response shape, verdict mapping, `input_identity` echo — with the failing
  stage marked and explained in plain language. Operators learn a provider is
  misconfigured from a button, not from real actions silently taking the
  unavailability posture; provider implementers (Agent Memory first) get
  self-serve validation while standing up their endpoint. Server side is an
  admin-gated `external_verdict` integration on the existing
  `POST /api/settings/test` connection-test route — zero new routes, per the
  surface budget. Nothing is recorded as a guard decision. Documented in
  `docs/external-verdict-provider.md`.

### Fixed

- **External-verdict config now carries the URL/token while the provider
  toggle is off.** `parseExternalVerdictConfig` gated decryption on
  `EXTERNAL_VERDICT_ENABLED`, so a saved-but-not-yet-enabled provider probed
  as "No provider URL saved" (found via rendered proof, pinned by a
  regression test in the conformance suite). Decryption is now unconditional;
  the guard itself still requires `enabled && url` before calling a provider,
  so a disabled org's config never reaches a decision.

## [5.23.0] — 2026-08-13

### Added

- **External decision provider (the #219 seam, DashClaw side).** An org can
  configure one external decision engine (URL, optional bearer token, timeout,
  unavailability posture) in the `/policies` workbench; the guard calls it
  during every evaluation and joins its verdict **stricter-wins** into the
  decision (`allow/warn/escalate/deny` → the local lattice, external `deny`
  absolute, no loosening in either direction, identity-bound via an echoed
  `input_identity` digest). Unavailability takes an explicit posture —
  `fail_closed` (default, joins as `require_approval`) or `fail_open` — and is
  always recorded as `external unavailable`, never as successful external
  governance. Evidence lands as a `_external_verdict` sibling in
  `guard_decisions` breakdown; operators see the regime (`External: <verdict>`
  / `External unavailable`) on decision detail and `/approvals` cards. Config
  rides the existing org-settings path (six `EXTERNAL_VERDICT_*` keys, URL and
  token encrypted at rest): zero new routes, SDK methods, MCP tools, or policy
  types. The ten adversarial cases from #220 ship as the mock-provider
  conformance suite; provider implementers build against
  `docs/external-verdict-provider.md`. First committed integrator: Agent
  Memory / PAMA (#219).

## [5.22.2] — 2026-08-13

Production bugfix for the approval pause shipped in v5.22.0's era (2026-08-12):
the pause buttons on /policies and /approvals returned "Internal server error"
for every operator. Platform-only; no SDK or API surface change.

### Fixed

- **`POST`/`DELETE /api/approval-pause` 500'd on every call** — the route
  persists pause state via `upsertSetting`, whose key allowlist
  (`VALID_SETTING_KEYS`) never had `DASHCLAW_APPROVAL_PAUSE` added, so the
  repository rejected the write with `Invalid setting key`. The feature shipped
  broken because every existing test mocked `settings.repository`, so the
  allowlist check never executed. Fixed by allowlisting the key, and covered by
  a new regression suite (`__tests__/unit/approval-pause.route.test.js`) that
  drives the route through the **real** settings repository — the exact layer
  that failed.

## [5.22.1] — 2026-08-13

Hosted-buyer money-path drill — maintainer tooling; no SDK or runtime surface
change. First live run against hosted.dashclaw.io surfaced and fixed three
production billing faults (details in the maintainer log).

### Added

- **`scripts/drills/hosted-buyer.mjs`** — a 19-step scripted buyer that proves
  the hosted billing path end to end against a running hosted-mode instance:
  mint → key works → first governed action → claim (seeded user + forged
  NextAuth session) → Stripe checkout (real customer, created by the checkout
  route) → signed synthetic `checkout.session.completed` webhook → idempotency
  replay → plan flip to indie → seat-cap 409 → action-ceiling 403 → billing
  portal → signed `customer.subscription.deleted` webhook → free-plan restore →
  ceiling gone → workspace export. Every webhook step asserts database truth,
  teardown unwinds all created state (Stripe customer included), and
  `--sabotage` deliberately breaks the seat-cap assertion so the drill can be
  proven able to fail. Documented in `scripts/drills/README.md`.

### Fixed (production ops, found by the drill's first run)

- Replaced the **expired live `STRIPE_SECRET_KEY`** on the hosted instance —
  real checkout had been failing since the key expired.
- Created the missing **default Customer Portal configuration** on the live
  Stripe account (portal sessions previously had no configuration to use).
- Rotated the hosted instance's **`NEXTAUTH_SECRET`** (previous value
  unrecoverable) and **`HOSTED_DRILL_TOKEN`** (post-run hygiene per the
  drill-mint spec).

## [5.22.0] — 2026-08-13

Plan Deviation Events — the follow-on the preflight-plan RFC explicitly
deferred (docs/rfcs/2026-08-11-plan-deviation-events.md). The runtime has
always computed the plan-vs-actual diff — `consumePlanStepGrant` matches every
live action against the approved steps — and threw the no-match branch away.
This release makes that else-branch durable, classified, and policy-visible.

### Added

- **Plan deviations are recorded on every governed action, for all four
  decisions.** While an agent has a live approved plan, a new fail-soft guard
  phase classifies each action against the plan's steps: `act_substitution`
  (same declared intent, different actual payload — the case a path gate
  cannot express), `scope_escape` (outside a step's optional `declared_paths`
  / `declared_systems`), `goal_drift`, `unplanned_action`, `budget_overrun`,
  and `step_abandoned` (swept when a plan terminalises with approved steps
  never consumed). Recording is unconditional and policy-free; the detector
  failing soft can never block, delay, or fail a guard call; a plan's own
  dry-run preview never deviates against itself. Rows land in a new
  `plan_deviations` table (the attached-fact triad sibling of `assumptions`
  and `guard_decisions`), echo into the decision's `context._plan_deviation`,
  and publish `plan.deviation.detected` on the SSE bus.
- **`deviation_response` — guard policy type 16 → 17** (THESIS anti-regrowth
  amendment in the same commit, the recorded deliberate act). Maps each
  deviation kind to warn / require_approval / block, tighten-only, with
  `min_severity` and an explicit `escalate_action` ceiling so blocking is an
  operator's opt-in. **No default row ships** — a fresh install records and
  renders deviations with zero behavior change.
- **Operator surfaces, zero new pages.** `/approvals` Live plans rows carry a
  deviation strip (brand orange only when an open high-severity deviation
  needs a human) expanding to a declared-vs-observed table with one-click
  Acknowledge / Accept / Reject — plus **Accept & amend plan**, which appends
  the observed action as a new approved step so acceptance is a recorded
  amendment, never a silent dismissal (future matches only; resolving never
  releases a pending approval). `/decisions/[actionId]` shows the deviation
  beside the plan-grant badge; the session retro consumes derived deviations
  as findings and suppresses its own goal-drift heuristic only where a
  plan-anchored row already covers the action. `/policies` New rule gains the
  Deviation Response form.
- **Additive wire surface, zero budget elsewhere.** `GET /api/plans/:id` and
  `GET /api/actions/:id` gain `deviations[]`; `POST /api/plans/:id` gains the
  `resolve_deviation` verdict (plan-scoped, separation-of-duties on the amend
  path); plan-submit steps accept optional `declared_paths` /
  `declared_systems`; `dashclaw_record` accepts `plan_step_id` /
  `deviation_note` self-reports — recorded as agent-reported claims capped at
  low severity, never able to suppress or downgrade server-derived detection.
  No new routes, pages, MCP tools, or SDK methods.

### Changed

- Guard cold-path DB round-trip budget 5 → 6 (one cached `hasLivePlan`
  EXISTS probe per org:agent per 30s; warm path unchanged — measured ~2ms
  marginal inside a plan window, ~0 for planless agents).
- THESIS.md's anti-regrowth ceilings table re-synced to
  `contracts/surface-budget.json` — it had silently drifted across several
  amendments; the JSON stays the machine source of truth.

## [5.21.0] — 2026-08-12

### Changed

- **`allow_grant` policies now have a risk ceiling, and it applies to grants that already exist.** Until now a matching grant downgraded `require_approval` to `allow` at *any* risk score, so a grant minted on a routine act kept clearing the approval gate for a matching act at score 95 for the rest of its lease. Grants are now stamped `max_risk: 70` at creation by both minting surfaces, and `applyAllowGrants` skips a grant the action exceeds — announcing the skip in the decision warnings rather than going quiet, so an operator never sees a grant "stop working" with no explanation. **A grant with no `max_risk` now defaults to 70, not unlimited**, which tightens every grant created before this release: an action scoring 70 or above that a grant previously covered will interrupt a human again. That is the intended direction, and the exposure is bounded — grants stay target-scoped and every legacy one ages out within 30 days of its `created_at`. Blocks remain absolute, and a rule marked `ungrantable` is still never cleared by a grant.

### Added

- **"Allow, don't ask again" on the approval queue.** Every pending card below risk 70 gets a third button. It approves the action, writes a target-scoped grant with a lease you choose (1h / 24h / 7d / 30d, default 24h), and releases the pending approvals that same grant covers — the confirm button names the number before you click it (`Allow all 2`). Scope is the exact target the server derives, never a folder: prefix-widening on file paths is a bug this codebase already fixed once, and the panel says so in plain words. At or above risk 70 the button is replaced by "needs a human every time", which is honest rather than decorative — a grant minted there could not cover the action anyway.
- **An undo surface for those mutes.** Active grants are listed at the top of `/approvals` — "3 things you told me to stop asking about" — each with a live countdown and a one-click **Revoke**. A mute you can create in one click but need a different page to undo is not a finished feature.
- `POST /api/approvals/[actionId]/grant` mints the grant and reports the pending approvals it covers. It deliberately does not approve anything: the caller fans those ids out over the existing per-item approval route, the way bulk approve already does, so there is one audit / webhook / calibration chain instead of a second copy that would drift.

### Documentation

- **The v5.20.0 scope-narrowing guarantee now exists outside the ADR.** `ungoverned_scope` shipped documented only in `docs/architecture/enforcement-boundary.md`, `hooks/README.md` and `.env.example` — none of which an operator reads before they hit the symptom. It is now on the surfaces where the question actually gets asked: the README's observe-mode "loud, never silent" paragraph, the landing page's enforcement-boundary section, `PROJECT_DETAILS.md` (as the third member of the enforcement-visibility set), and a new `docs/troubleshooting.md` entry keyed to the real symptom — *some* tool calls land in `/decisions` while whole categories are missing.
- **Signal-type counts were wrong in three places and none agreed.** `computeSignals` claimed 19, the troubleshoot skill claimed 18, and the agent skill's API reference listed 17 names of which three (`stale_loop`, `drift_alert`, `coverage_drop`) are not signal types at all while three real ones (`observe_mode`, `executed_despite_block`, `ungoverned_scope`) were missing. The live count is **17**; all three now say so and the enumeration matches `app/lib/signals.ts`.
- **`DASHCLAW_GOVERNED_CATEGORIES` was published as `experimental` / "documented-not-traced"** in the platform guide, which stopped being true when v5.20.0 wired it into `ungoverned_default_categories()`. Promoted to `stable`/verified in both `public/guides/platform-guide-data.json` and `docs/platform-guide-coverage.json` (guide status counts adjusted 304→305 stable, 103→102 experimental), with the scope-vs-mode distinction and the typo failure mode recorded as gotchas.

Three neighbouring statements were wrong and are corrected in the same pass: `hooks/README.md` credited the feature to v5.19 (it shipped in v5.20); `docs/troubleshooting.md` still said observe mode is the default (fresh installs have defaulted to **enforce** since v5.2.0 / CLI 0.9.0); and the setup skill said hooks "exit 0 and allow tool execution" when DashClaw is unreachable, which is only true for an *unconfigured* hook — a server or network failure in enforce mode fails **closed** per `DASHCLAW_GUARD_UNAVAILABLE_POLICY=block`. That same skill filed `permission_escalation`, `green_contract` and `branch_freshness` under "New Signal Types"; they are guard **policy** types.

## [5.20.0] — 2026-08-11

A whole-codebase adversarial review — eight parallel finders, then an independent
skeptic per finding that defaulted to *refuted* unless it could name a reachable
failure — surfaced 24 defects. All 24 are fixed here, along with two dead-ends
reported from the live instance and the client-side blind spots a completeness
pass found afterward.

### Security

- **Two ways to make the evidence classifier grade a catastrophe as routine.** A newline was not treated as a command separator, so anything chained after a git-message verb was graded as inert message text: `git commit -m "wip"⏎rm -rf ~` scored **35** where the `&&` form scored 100, with `destructive` and `protected_target` both erased. The client-side parser had split on newline since the round-2 evasion audit; the server half never did. Separately, `codeSkeleton` blanked a quoted **command word**, so `"rm" -rf /` never reached the pattern families and fell through to `other`/**30**. Both now score 100. The fix is deliberately narrow — only quotes in command-word position are treated as code, so the false-positive class the quoted-data relaxation exists for still holds: `git commit -m "rm -rf /"` stays inert at 35 and `git commit -m "$(rm -rf /)"` is still caught.
- **Idempotent replay was keyed on the client's key alone.** `idempotency_key` is ordinary client input, and the lookup filtered on org + key + a 10-minute window and nothing else. An `allow` minted for `ls` was served back to `rm -rf /` under the same key — `evaluateGuard` never ran, so the evidence classifier, every org policy and every rail were skipped, and no decision row was written for the second act. Replay is now bound to a digest of the act the decision was made about; a mismatch re-evaluates rather than erroring.
- **`require_approval` failed open in the hook.** When no `action_id` could be obtained — any transient 5xx, since the request helper swallows to `None` — the hook logged "proceeding" and exited 0, running the gated tool with no approval and no ledger row. Two neighbouring handlers in the same file deliberately fail closed. It now matches them. An unrecognised verdict is also no longer routed to `handle_allow`.
- **Protected-path globs matched case-sensitively** on the two case-insensitive filesystems the hook actually runs on, so `.ENV` and `app/api/Auth/` addressed guarded files while matching nothing.
- **A JWT bearer 401'd before the API key was read**, breaking the documented agent-identity setup for both SDKs; a **revoked API key stayed live for five minutes** (the positive cache TTL is now 10s, the only bound that holds across instances); and outbound webhook HMACs covered only the body, making a captured delivery replayable forever.

### Added

- **`ungoverned_scope` — the third enforcement-visibility guarantee.** `DASHCLAW_GOVERNED_CATEGORIES` narrows governance on the agent's own machine and the hook exits before the network call for an excluded category, so those tool calls produced no row, no witness and no signal: the dashboard read green while shell commands and file writes ran unwatched. Where observe mode makes a wrong verdict *visible*, this made whole classes of action *absent*, and absence renders identically to "that agent did nothing." The hook now declares the categories it is not governing — measured against the default set, so a healthy install reports nothing and costs no bytes — and any gap raises a red **Governance scope narrowed** signal naming what is unwatched in operator language. A visibility guarantee, not an enforcement one: the variable lives on the agent's machine, so a client that narrows its scope can also lie about the declaration. It closes the case that actually occurs — an honest agent misconfigured, or a typo silently dropping a real category. See `docs/architecture/enforcement-boundary.md`.
- **`dashclaw backfill`.** The hook has always written ungoverned actions to `~/.dashclaw/orphan-actions.jsonl` and told the operator they were "logged for backfill on guard recovery" in four separate messages. Nothing in the repo ever read that file. This is the reader that makes the promise true. CLI-only by design and recorded as such: the orphan file lives on the operator's own machine, so a server-side button cannot reach it.

### Changed

- **`--color-error` and `--color-info` moved one step lighter.** `#ef4444` and `#3b82f6` do not clear WCAG 1.4.3 as text on our darkest surfaces — 3.78:1 and 3.86:1 on `--color-bg-elevated`, under the 4.5:1 floor. They are now `#f87171` and `#60a5fa`, whose worst case across the whole surface palette is 5.14:1 and 5.59:1. `--color-success` (6.24:1) and `--color-warning` (7.41:1) already cleared it and stay on -500. The **subtle background tints deliberately keep the -500 rgb**: they sit *behind* the text, so re-tinting them to match would have pushed error text on `bg-elevated` down to 4.32:1 and reintroduced the failure the change exists to remove. The mismatch is intentional, imperceptible at 12% alpha, and commented in `globals.css` so nobody tidies it.

### Fixed

- **Two human dead-ends, both the same shape:** a control offered for something the server rejects, with the error arriving only *after* the click. `/policies` offered **Always allow** on every warn group, but the server refuses a grant with no target scope because an unscoped grant silently nullifies every approval rule for that action type — and most Bash groups have no target, so the default click on a group that had already fired 236 times was a guaranteed 400 and the row stayed in the inbox. Unscoped groups now lead with the verb that works and state the constraint before the click, with one shared predicate backing both the route's rejection and the button so they cannot drift. `/approvals` offered flood resolution for every policy but found its targets through `rules.action_types`, which a `rate_limit` policy (matching on frequency) and a `protected_path` policy (carrying `paths`) simply do not have — so the only button on the flood banner returned "Policy has no action_types to match" and the flood it existed to clear could not be cleared. Matching now runs through the guard decision that actually held each approval, which also fixes an over-broad case the proxy had: bulk-approving a policy scoped to `api` used to resolve every pending `api` approval in the window, including ones a different policy was holding.
- **`2>&1` parsed as a redirection to a file literally named `&1`.** File-descriptor duplication is not a file write, but the parser read it as one, which floored the most common shell idiom in the corpus at risk 35 as though it wrote a file — a real contributor to those warn groups firing hundreds of times — and surfaced the shape `other → &1`, which an operator could then grant: a 30-day `allow_grant` scoped to a filename that can never exist, reading as a resolved item while doing nothing.
- **A cluster of one shape: a value that encodes a failure, computed and then discarded.** The guard's blocked-action `after()` callback `void`-discarded both promises, so it returned `undefined` and resolved instantly — exactly the failure the comment beside it says `after()` was added to prevent. `fireWebhooksForApproval` never collected its per-webhook promises, so it resolved before any POST settled and the `after()` wrapping it awaited nothing. The approval-decision webhook and the capability `health_status` write were bare fire-and-forget calls in functions already using `after()` correctly on neighbouring lines — and the health one is load-bearing: its own comment notes the circuit breaker can never open without it. Bulk actions computed `BulkResult.failed` and rendered it nowhere, so a partial bulk deny looked identical to a complete one on the hero surface.
- **Four non-atomic writes.** The login-lockout counter was a JS read-then-write, so a concurrent burst walked past `LOGIN_GUARD_MAX_FAILS`; webhook `failure_count` likewise, so the disable-at-10 breaker could never trip under load; calibration θ was a full-document overwrite that silently lost concurrent adjudications; and the filtered bulk delete was three unguarded DELETEs across parent and children, so a mid-sequence failure tore the audit trail.
- **Signed evidence bundles failed their own re-verification.** `Date` values canonicalized to `{}` at sign time (an empty `Object.keys`) and to ISO strings at verify time, so a bundle signed today could not validate against itself. Also: the abort timer was cleared before the response body was read, so a host that answered 200 and then trickled bytes forever held a guard evaluation open; the Discord and Slack adapters passed an undici `Agent` to the global `fetch`, the same instance mismatch commit `a52d4478` had already fixed in two other files; `safeFetch` re-resolved the hostname at connect time, so its documented DNS-rebinding defence did not hold; and `validate.js` accepted `Infinity` as a finite `cost_estimate` (`1e400` is legal JSON number syntax).
- **A raw hex was doing a token's job in the breadcrumb.** The separator hardcoded `text-zinc-700` (`#3f3f46`), which is 1.36:1 at its worst and a literal hex in a codebase whose design context says tokens only. The colour override is simply gone — the separator inherits the nav's `text-tertiary`, which is what it should have done from the start. The same raw hex was doing the same job in the replay page's meta label and in three settings input placeholders; all now use the token. Remaining `zinc-700` uses are borders and one SVG connector stroke, which are non-text and out of scope. After this, a compositing contrast sweep of all 14 dashboard routes reports zero WCAG 1.4.3 failures.

- **Live text was painted with the disabled-state colour.** An external audit of www.dashclaw.io flagged `span.st` and `kbd` at 2.47:1 and `span.firedWhen` and `span.thNone` at 2.71:1, against the 4.5:1 that WCAG 1.4.3 requires. All four traced to one mistake: they coloured informational text with `--color-text-disabled` (`#5c5c66`), a token whose whole purpose is genuinely disabled controls — which 1.4.3 exempts, which is why the token itself is fine and stays as it is. Reproduced exactly before changing anything: `#5c5c66` measures 2.47:1 on `bg-tertiary` and 2.71:1 on `bg-secondary`, matching the audit to the hundredth. They now use `--color-text-tertiary` (`#9b9ba8`), which clears 4.5:1 on every surface in the palette and is the established meta tier, so nothing looks different in kind — just legible. Measured in the browser after the change: 5.94:1 and 6.53:1. Three unreported siblings with the identical defect went with them (`.sentence .bull`, `.sentence .fired`, and the search placeholder) rather than waiting to be found by the next scan. The two remaining `--color-text-disabled` uses are toggle-knob backgrounds, which are non-text and deliberately left alone.
- **The rule switch was a 30x17 target.** WCAG 2.5.8 wants 24x24, and growing the pill would cost the ledger table its density. A transparent `::before` lifts the hit area to 30x25 with the pill unchanged. The inset is `-5px`, not `-4px`: an absolutely positioned pseudo-element resolves offsets against the *padding* box and the button carries a 1px border, so `-4px` reached only 3px past the visual edge and left the true target at 23px — still failing, and invisible to arithmetic that forgets the border. Verified by scanning outward from the element in half-pixel steps for the real clickable extent: 30.5x25.

- **A server-side risk modifier was dead on every Claude Code tool call.** The hook forwarded its own internal tool category as `systems_touched` — `execution`, `file_io`, `orchestration`, `interactive`, `mcp`, `unknown` — while the scorer matches a declared-system vocabulary: `filesystem`/`shell` for +5, `database`/`production`/`postgres`/`neon`/`redis` for +10. The two share no word, so `systemsTouchedFactors()` returned an empty list every single time and the server risk **floor** was thinner than the trust model claims. `file_io` now declares `filesystem` and `execution` declares `shell`; categories with no system of their own declare nothing, because inflating the floor on nothing is its own bug. Band-neutral by construction: `apply` moves 60→65 and `security` 80→85, crossing neither 40 nor 70, so no governance decision changes today — what changes is that the breakdown an operator reads is no longer missing a term the design says is there. The internal category is still reported under `context.tool`. The sibling finding, that `reversible` is hardcoded true so the +15 irreversible modifier can never fire for a Write or Edit, is recorded in `docs/DECISIONS.md` and deliberately left alone: the honest value crosses a band and would reintroduce approval spam.

- **Two calibration proposals for one shape rendered as identical rows.** One shape can mine under more than one rule at the same time: `rm -rf node_modules/.cache` scored 45 and approved six times mines both `over_scored_benign` (the scorer over-rates a benign shape) and `repeated_approvals` (the human keeps approving it). Those are different findings that want different fixes, and `candidateId(rule, key)` correctly keys them apart — but the triage card rendered only the shape name, the event count and the risk band, all three of which match. Verified against the live route: the two candidates agreed on `suggested_name`, `count`, `risk_min/max` **and** `evidence_tier`, so `rule` was the only field separating them and it was the one field the card never showed. The operator got two visually identical rows, a "Dismiss all 2", and no way to tell which finding they were judging. The card now leads its evidence line with the rule in plain English. This is deliberately not a de-duplication: collapsing the rows would delete a real signal.

## [5.19.0] — 2026-08-11

**Amber should mean look.** Two sentences on the approvals card were dressed as something they are not: a reassurance wore the warning colour, and the one sentence that matters most was printed twice.

### Added

- **`PlainDescription.reassurance`.** "Reads only, changes nothing." used to travel in the same `warnings` array as "Work other people pushed can be lost.", so the safest possible action on the queue rendered in amber behind a warning triangle. On a surface whose entire job is to make attention scarce that is backwards, and `.impeccable.md` reserves the attention colour for when attention is actually required. It now has its own field and renders muted, behind a check. The field is populated **last**, in `describeAction`, so `describeBash`'s calm-eligibility filter still decides whether the phrase survives at all — a reassurance suppressed as unsupportable (a mixed chain like `ls -la && rm -rf ./dist`) can never be resurrected by the split.

### Fixed

- **The irreversibility sentence was printed twice.** `bash.sql.drop` and `bash.sql.delete` emit "This cannot be undone." as a warning so the fact survives when the classifier sends no reversibility at all. When it *did* send `reversible: false`, the card already rendered that exact sentence as its red band, and the operator read it twice in two different colours. It is now dropped from the warning list only in that case, so the no-intel path keeps its only signal.
- **Two surfaces have no red band, and were about to lose the fact entirely.** The decision detail page and the Telegram/Discord approval cards render no band, so the de-duplication above would have silently deleted the sentence there. Both now state irreversibility in words. That also closes a pre-existing gap: an `rm -rf` notification warns about the Recycle Bin but never said "This cannot be undone.", because on the card that was always the band's job.
- **A demo fixture demonstrated nothing.** The demo's `DROP TABLE` card used `psql "$DATABASE_URL" -c …`; a command the shell could expand is refused a confident reading by design, so the card exercised the refusal path rather than the SQL rule it existed to show.

Nine tests were added for the split, the de-duplication, and both notification paths — none of this behaviour had any coverage, which is how it shipped wrong.

## [5.18.1] — 2026-08-11

**The demo agreed with the marketing again.** 5.18.0 taught the landing page and `/self-host` to advertise that every pending approval leads with a plain-English sentence. The demo sandbox did not do that, so a prospect who clicked through to see the feature saw the claim contradicted by the product.

### Fixed

- **Demo mode never ran the plain-language enrichment.** `demoListActions` returned rows straight from the fixtures, so `/approvals` in the demo rendered raw `declared_goal` text. It now applies `describeAction` to the pending-approval queue on exactly the same condition as the real route (`status === 'pending_approval'`), reading intel off the fixture row since demo mode has no guard-decision contexts. The card already degraded safely without it, so this was a missing surface rather than a crash.
- **The demo's pending fixtures were not commands.** They carried abstract pseudo-goals — `REVIEW: data alerting`, `DEPLOY: api stability` — that no agent ever sends. Turning enrichment on therefore produced 14 consecutive "I can't tell you what this one does" cards: the translator behaving correctly on input that was never realistic, and a worse demo than the raw text it replaced. Pending fixtures now draw from a pool of real labelled tool calls, so the queue shows the whole range: an irreversible force-push and `DROP TABLE` with the red band, a `Write: .env` credential warning, routine reads, and two entries left deliberately unreadable so the demo still shows the translator declining to guess rather than pretending it can read everything.

No production code path changed — demo fixtures and the demo middleware only.

## [5.18.0] — 2026-08-11

**You can now read the approvals queue without reading shell.** An approval you do not understand is an approval you rubber-stamp, and the queue previously showed the raw `declared_goal` and nothing else. Every pending item now leads with one plain-English sentence for what the command actually does, and the exact command is still printed directly underneath it — never hidden, never replaced.

### Added

- **Plain-language translation of governed actions** (`app/lib/plain-language/`). A deterministic read-time translator: pure, synchronous, no LLM and no network. Because it runs at read time, improving a phrase re-reads all existing history correctly with no backfill and no migration. It covers shell commands (via a shallow parser and a rule table), file tools, MCP calls, and generic tools; anything else renders as an explicit non-answer.
- **The irreversibility band.** When the hook's classifier reports the act cannot be undone, the card leads with a red "This cannot be undone." band above the sentence. `reversible` is read from the classifier's intel and never inferred by the translator.
- **Plain-English warnings, worst first.** Drawn only from fixed phrases, so the queue cannot be used to render attacker-supplied text: "Work other people pushed can be lost.", "This file holds credentials or configuration.", and the rest.
- **The same sentence on every approval surface.** `/approvals` cards, the decision detail page, and the Telegram and Discord approval notifications all render through one function, so the four cannot drift and none of them can rediscover the same bug independently.
- **`@dashclaw/cli` 0.10.0**, carrying the `dashclaw install openclaw` target described under 5.17.6 (that version was written up but never published, so its contents ship here). The CLI versions independently of the platform, and the release workflow skips any version already on the registry — at the unbumped 0.9.3 the new subcommand would have been published never, so the bump is the thing that actually ships it.

### Security

- **A calm sentence can never contradict a dangerous score.** When a rule reads an action as routine but the classifier scored it high risk, or the act is irreversible, the sentence is withdrawn rather than shown next to a red score. "Lists the files in a folder" beside a red 85 teaches an operator to stop reading the sentence at all, so the rule is treated as the thing that is wrong.
- **Refusal beats a guess.** A command the parser cannot read with confidence renders "I can't tell you what this one does in plain English." with a "Not translated" badge, rather than a confident sentence about a string nothing parsed. Shell input that can expand into other code (command substitution, `eval`) is denied a calm reading for the same reason.
- **Headlines are capped at 400 characters.** A 120-stage pipeline composed a 5034-character headline that 400ed both Telegram and Discord, so the operator received no approval notification at all for exactly the class of command most worth one. The cap is applied last, after every rule and the safety floor, so nothing downstream can widen it.

## [5.17.6] — 2026-08-11

**Fail-closed on governance that was already working.** An OpenClaw workspace provisioned by `dashclaw install codex` inherited a governance block written for the wrong runtime: it told the agent to call `dashclaw_session_start` and `dashclaw_guard` through a `dashclaw` MCP server, and OpenClaw never exposes one. An agent that follows its own instructions refuses to act — correctly fail-closed on a missing tool — while the DashClaw plugin was enforcing governance normally the entire time by intercepting every tool call at the gateway. The outage was in the paperwork, not the governance.

### Added

- **`dashclaw install openclaw` provisions DashClaw governance into an OpenClaw agent in one command.** The instance comes from `--base-url`, `DASHCLAW_BASE_URL`, or the saved config, and nothing is written until DashClaw reachability and the key are both confirmed. It then installs `@dashclaw/openclaw-plugin`, writes the agent id, the DashClaw URL and `failClosed: true` through one validated `openclaw config patch`, enables the plugin as a separate step, and merges an OpenClaw-correct governance block into the workspace's `AGENTS.md`. `failClosed` is set by the installer itself and there is no flag to turn it off. Enabling is separate because `config patch` replaces arrays wholesale, so patching `plugins.allow` directly would silently drop every other plugin already enabled — `openclaw plugins enable` owns that array instead. Every path is read from OpenClaw rather than assumed: the workspace comes from `agents.defaults.workspace`, never the process's working directory, and the `.env` is resolved from the directory `openclaw config file` reports, so both follow `openclaw --profile` instead of landing in the default profile.
- **The API key never reaches argv, and the write order is chosen so no failure can brick the agent.** The key goes to the `.env` beside `openclaw.json` first — inert until a plugin exists to read it, and idempotent, so writing it early costs nothing. Writing it last is what bricks: the plugin refuses every tool call when `failClosed` is on and no key is present, so an EPERM on a trailing `.env` write, or a Ctrl-C during the seconds those subprocesses take, would leave a live plugin with the key in neither place. The config patch then lands *before* `plugins enable`, because the reverse order leaves a live plugin with no URL, and the payload travels over stdin — `openclaw config patch` takes no positional argument, and stdin also keeps the credential out of the process table and out of every error message. `openclaw.json` is backed up to `.dashclaw-bak` first, with any plaintext `dashclawApiKey` emptied out of the copy so the backup is not a second home for the secret.
- **The key is resolved through a documented chain, and a plaintext one is moved out.** `--api-key`, then `DASHCLAW_API_KEY` or the saved config, then `DASHCLAW_API_KEY` in the profile's `.env`, then a plaintext `dashclawApiKey` left in `openclaw.json` — that last one is rewritten to `.env` and cleared from the config by the patch, so a re-install migrates a stored secret out instead of preserving it. `--write-config` forces the opposite for anyone who wants it, and every run without it sends `null` for that field, so a key stored by an earlier `--write-config` run is actively cleared rather than left behind.
- **Re-running is the documented remedy for a broken agent, so it never downgrades one.** The plugin install is skipped when an equal-or-newer build is already present, which makes `--plugin-version` a *minimum* rather than a pin. The command closes with `openclaw config validate`, `openclaw plugins doctor`, and a read-back of `plugins.entries.dashclaw-governance.enabled` — read back, not inferred from `plugins enable` exiting 0 (skip all three with `--no-verify`). A failed check leaves the install in place but sets a non-zero exit, because a governance block that looks installed while silently not enforcing is the exact failure this command exists to prevent.

### Fixed

- **`dashclaw install openclaw` finds and replaces a codex-authored block instead of leaving it live.** Detection requires the block to contain both `dashclaw_session_start` and the literal string `install codex`, so an AGENTS.md that merely mentions Codex in prose is never touched. Whenever AGENTS.md already exists the installer takes a `.dashclaw-bak` copy before writing — the first backup wins if one is already there, so re-running the installer never overwrites the original snapshot — and when the block it replaced was codex-authored, it says so on the console instead of rewriting the file silently.


## [5.17.5] — 2026-08-11

**Both running and completed.** A decision that reported its outcome through the durable-finality endpoint stayed `running` in the ledger forever, so Decision Replay rendered a red **RUNNING** beside a green **Completed** badge on the same line. Reported by the maintainer reading a decision detail page.

### Fixed

- **The outcome POST never closed the lifecycle.** `action_records` carries two columns — `status` (lifecycle) and `outcome_status` (durable finality) — closed by two different paths, and the reconciliation only ran one way. A terminal `PATCH /api/actions/:id` implicitly advances `outcome_status`, but `POST /api/actions/:id/outcome` wrote only the `outcome_*` columns and left `status='running'`. `setActionOutcome` now closes the lifecycle in the same UPDATE (`completed`→`completed`, `partial`/`failed`→`failed`, `lost_confirmation`→`unknown`) and stamps `timestamp_end` through `COALESCE`, so a caller-supplied end time still wins. Only a still-open lifecycle (`running` / `pending` / NULL) flips: an already-terminal status is preserved, and `pending_approval` is left to the approvals expiry sweep. No new lifecycle value is introduced — all three targets were already written by the stale-outcome sweep.
- **Nothing could heal an affected row.** Both of the sweep's UPDATEs gate on `outcome_status` (the primary on `'pending'`, the backfill on `'lost_confirmation'`), so a row that reported `completed` was unreachable by either and stuck at `running` permanently. It also counted as in-flight in the operations stats and tripped the doctor's "Zombie running actions" check, whose fix hint — opening `/decisions` triggers the reconciliation sweep — could never work for that row. The backfill now covers every terminal `outcome_status` and maps each to the same lifecycle value as the write path, so rows already stuck reconcile on the next sweep: cron, or the lazy trigger on the actions list. No migration.

## [5.17.4] — 2026-08-10

**Checks that were not checking.** Three more instances of the 5.17.3 failure mode — something reporting OK while it silently wasn't working — found by going looking rather than waiting to be told.

### Fixed

- **The doc-count gate had a dead assertion.** `check-doc-counts.mjs` matched `"method_count":(\d+)` against guide JSON that is pretty-printed as `"method_count": 59`. One space, no match — and on a miss the script downgrades to a tolerant `warn` and still prints "all gated counts match source-of-truth", so that count sat unguarded behind a green check. The pattern now allows the space, and the four **never-ran** conditions (pattern matched nothing, section matched nothing, file absent, SDK counter unavailable) are **fatal under `--strict`** rather than advisory: a check that never ran is not a passing check. `.claude/CODEBASE_MAP.md` is marked `optional` — it is generated by a local skill and gitignored, so its absence on a runner is expected, not a dead guard; `git ls-files` over all 22 referenced paths confirms it is the only untracked one.
- **The demo deployment hid the interruption budget entirely.** `/api/approvals/floods` had no demo dispatch entry, so it fell through to the write-block path and 403'd. `ApprovalFloodBanner` treats any non-OK response as "no flood" and renders `null`, so the capability was absent from the demo with no error to notice. The fixture trips the real `require_approval` fixture rule rather than an invented id, because the banner names the rule and its Pause button PATCHes that id — a visitor clicking through to `/policies` has to find it there. The three actions remain honest 403s via the existing write block.
- **`/assumptions` — the link to a row's decision had no accessible name.** Its visible label is a truncated action id, so a screen reader got an opaque string with no indication it navigates. It now carries a `title` and `aria-label`. The row itself is deliberately still not a click target: it already holds a checkbox, this link, and two verdict buttons, and wrapping that in one would nest interactive elements and fight all four.

## [5.17.3] — 2026-08-10

**96 CSS rules that were never there.** Every theme-token class written with an opacity modifier compiled to nothing, so the tint simply didn't render and the element inherited whatever was underneath. Nothing failed: lint, typecheck, the build and all 4108 tests pass on a class that emits no rule. Found by the maintainer looking at a button.

### Fixed

- **Theme tokens honour opacity modifiers** (`tailwind.config.js`). Token colours resolved to plain `var(--color-*)` strings, and Tailwind drops a colour utility entirely when it cannot parse the value into channels — it does not warn. `bg-brand/10`, `border-status-success/20`, `text-brand/70`, `bg-surface-primary/90` and 92 more across 85 files emitted **zero CSS**. The token colours are now function-valued, the one form Tailwind hands the modifier to, composing `color-mix()`. Fixed entirely in config: **no callsite changed**, so every opacity is the one its author wrote. Stripping the modifiers instead — the obvious reading — would have rendered `bg-brand/10` as solid `#f97316`, because `--color-brand-subtle` is `rgba(249,115,22,0.12)`; 85 files of 12% washes would have become solid orange.
- **Keyboard focus rings were Tailwind's default blue.** `focus-visible:ring-brand/40` emitted nothing, so the ring fell through to the stock `rgba(59,130,246,0.5)` — the "flat blue accent" that `.impeccable.md` names as the first tell of the generic-SaaS anti-reference. Focus now renders brand orange as designed.
- **Semantic status borders were all identical.** `border-success/20` (×58), `border-warning/20` (×24) and `border-error/20` (×16) every one rendered the same generic `rgba(255,255,255,0.08)`, so a PASS card, a warning and an error were indistinguishable at the border. `DESIGN.md` had specified the `/20` border for badges all along; the components now match their own spec.
- **Scrims and sticky headers had no backdrop.** `bg-surface-tertiary/50`, `bg-primary/40` and `bg-surface-primary/80` all resolved to `rgba(0,0,0,0)`, so content scrolled through sticky headers instead of behind them.

### Added

- **`border-success` / `bg-error` and siblings resolve at all.** `borderColor` and `backgroundColor` gained the single-prefix status aliases `textColor` already had. Those classes were never in either scale — dead *with or without* a modifier — and only the longer `border-status-success` / `bg-success-subtle` forms worked.
- `__tests__/unit/tailwind-token-alpha.test.js` — pins the modifier behaviour, the aliases, and that modifier-free utilities are unchanged. Confirmed to fail against the old config before being kept.

## [5.17.2] — 2026-08-10

**Both halves of an operator's judgment get a button.** Two surfaces asked the human to decide something and then gave them no way to say yes — one because the control pointed at nothing, one because the positive verdict lived in a right-click menu. Both found by the maintainer using his own instance.

### Fixed

- **`/policies` — "Review suppressed patterns" now goes somewhere.** The inert-rule banner (F1) names every gating rule an active allow-grant nullifies, then offered `<Link href="#suppressed">`. Nothing in the app carried `id="suppressed"`, and the grants it means ("Never bother me about…") render only in the ledger's **Sentences** lens, which the Table default never mounts, inside a section the operator may have collapsed — so the click set a URL hash and did nothing visible. It is now a button that drives the ledger: force the section open, switch to the Sentences lens, scroll the grants group into view, and flag the exact rows whose ids appear in `suppressed_by`, so the grant that broke the rule is the one under the cursor with its **Remove** button in reach (`PostureHero.tsx` → `PolicyWorkbench.tsx` → `LedgerActions.revealSuppressed`).

### Added

- **`/assumptions` — Validate is a visible control, per row and in bulk.** `PATCH /api/assumptions/:id` has accepted `{validated: true}` since the route was written, and the right-click menu called it — but the page rendered only "Invalidate…". Facing 42 pending beliefs, an operator could reject any of them and confirm none unless they guessed that right-click did something. The page's own comment already said the rule ("operator judgment = a visible control, not right-click-only"); it had been applied to one verdict out of two. A green **Validate** button now sits on every pending row, and the selection bar — whose only action was **Copy IDs** — gains a bulk **Validate** that fans out one PATCH per selected pending row. Bulk *invalidate* is deliberately absent: the API requires a reason, and a reason is per-belief judgment, not something to fan out.

## [5.17.1] — 2026-08-10

**The OAuth lane stops being recorded as a failed identity check.** Found in DashClaw's own live ledger: every decision made through the Claude consumer-app connector carried `verification_status: 'failed'` — the label that means an agent presented a cryptographic identity claim and it was rejected.

### Fixed

- **Only a JWT-shaped Bearer counts as an identity claim** (`looksLikeJwt` in `app/lib/jwks-verifier.ts`, applied in `app/lib/identity-resolution.ts` and `app/lib/guard-identity.ts`). The `Authorization` header carries two different things: an identity JWT (`DashClawClient.authToken`) and a plain credential — the built-in OAuth AS issues **opaque `oat_` access tokens**, which `/api/mcp` forwards for the Claude consumer-app connector. Running an opaque credential through `verifyJwt` can only ever return `failed`, so the OAuth lane was permanently stamped with the label reserved for a rejected claim, and the one genuinely security-interesting identity state was diluted to noise. A credential now takes the same path as no token at all → `unverified` (self-asserted); a JWT-shaped token that does not verify is still `failed`. No privilege change: both states are `verified: false`, neither applies token claims, and `require_verified_parent` already escalated on both. Also drops a per-request `console.warn` and a wasted JWT parse from the guard hot path.
- Ledger history is **not** rewritten — decisions recorded before this fix keep `failed`. The ledger is append-only; `docs/agent-identity.md` documents the cutover instead.
- **`release:prep` no longer fails opaquely on a busy port** (`scripts/release-prep.mjs`). Its pre-flight only noticed a squatter that *answers* `/api/health` with a version; any other app on 3001 404s, so the check passed, `next start` could not bind, and the real cause surfaced two minutes later as "instance never reported version". It now probes the port over raw TCP and, when 3001 is taken, serves the release check on the next free port (3002-3021) instead of asking you to kill someone else's dev server. `--port=<n>` pins it explicitly and fails loudly if that one is busy.

### Changed

- `__tests__/unit/identity-resolution.test.js` and `guard-identity.test.js` now mock only `verifyJwt` (via `importOriginal`) instead of hand-rolling the module, so "is this bearer an identity claim at all?" is exercised against the real implementation rather than a stub, and their bearer fixtures are JWT-shaped instead of the placeholder `tok`.

## [5.17.0] — 2026-08-10

**Role constraints ("workbenches"): a named authority bundle per agent role, enforced on every guard call.** Guard policy types 15 → 16 (THESIS amendment recorded in the same commit). The concept comes from per-work-type tool bundles in agent platforms; DashClaw ships the governance half only — the credentials half stays dead per the v5.0.0 kill list.

### Added

- **`role_constraint` guard policy type** (`app/lib/guard/policy.ts`): the policy row is the role (its name = the role name), the existing `agent_ids` scoping is the membership, and the rules are the workbench — `allowed_action_types`, `blocked_action_types`, `max_risk_score` (checked against the post-predictive effective score), `blocked_path_globs` (protected-path semantics over `target` + `write_paths`), `escalate_action` (`require_approval` default, `block` optional). Tighten-only: it escalates, never grants — an out-of-role attempt lands in the Approvals inbox showing what the agent reached for. Structurally `delegation_constraint` without the composed-id gate, so it governs top-level agents; composed `parent:child` callers inherit their parent's role via the existing targeted-policy scoping. No new tables, routes, pages, MCP tools, or SDK methods.
- **`/policies` authoring + rendering**: "Role Constraint" in the New-rule type picker with its own form section (action-type lists, risk ceiling, path globs, violation choice), ledger summary line, policy-modes contract sentence, and a demo-mode "Reviewer" fixture. Validation in `validatePolicy` mirrors the delegation-constraint bounds (≤50 entries per list, 0–100 ceiling, tighten-only escalation).
- Spec: `docs/superpowers/specs/2026-08-10-role-constraints-design.md`; unit coverage in `__tests__/unit/guard-role-constraint.test.js` plus the policy-type coverage/validation suites.
- **`npm run release:prep -- <x.y.z>`** (`scripts/release-prep.mjs`): the whole version-bump recipe in one command — `version:set`, package-lock sync, build, platform-guide liveExamples regen against a local instance (started and torn down for you), and the four version/contract/drift gates. Both v5.15.0 and v5.16.0 shipped green locally and then failed CI twice each on the two artifacts a bare `version:set` does not touch; this closes that class. `version:set` itself now also advances `contracts/sdk/release-plan.json` (`scripts/lib/bump-release-plan.mjs`), so the contract convergence gate can no longer be missed by hand.

## [5.16.0] — 2026-08-09

**Entitlement enforcement at the capacity seams, the public `/pricing` page, and a self-healing checkout.** This completes the build order the packaging decision mandated (accounts → metering → entitlements → checkout): entitlements was the one step still missing after v5.12.0–v5.14.0. The gating rule is enforced exactly as written — capacity and operations, never safety. No tier, free or paid, lacks a governance capability, and self-hosted DashClaw enforces nothing at all.

### Added

- **`app/lib/entitlements.ts`**: the pure plan table — hosted Indie: 2 seats + 50k governed actions/month, hosted Team: 10 seats + 250k/month, free hosted: 2 seats with the existing lifetime trial cap. Ceilings are explicitly PROVISIONAL per `docs/decisions/2026-08-09-hosted-paid-tier.md` (final numbers wait on real hosted usage). Enforcement applies only when `hosted_mode` is true.
- **Seat cap at the invite seam**: `POST /api/team/invites` on a hosted org now counts members + pending invites against the plan's seat cap and returns `409 SEAT_CAP_REACHED` (with the cap and an upgrade hint) before creating the invite. Existing members are never removed by a downgrade — the cap only blocks new invites.
- **Monthly governed-action ceiling**: hosted orgs on paid plans are checked against the current UTC period in `usage_rollups` at the same middleware seam that already enforces the hosted trial cap (`POST /api/actions` and `POST /api/guard?record=true` on the API-key path), returning the trial cap's exact response shape with `code: ACTION_CEILING_REACHED`. Fails open if the metering read errors — metering is documented best-effort and a billing counter must never block governance on its own failure.
- **`/pricing`** (public, on www): three honest columns — self-hosted free forever (complete plane, MIT), Hosted Indie $49/mo, Hosted Team $199/mo — plus what paying actually buys (we run it for you), the no-safety-gating guarantee stated outright, the free 30-day trial CTA, and the export-and-self-host-anytime path. Nav + footer links and sitemap entry restored — the exact surfaces the 2.18.0 retraction removed, reinstated on the record via the hosted-paid-tier decision.
- **Checkout self-heals a stale Stripe customer** (the proven test→live landmine): `resource_missing` on a stored `stripe_customer_id` now clears the stale link (guarded against concurrent fresh ids), mints a fresh customer, and retries once. The portal route returns a structured `409 NO_STRIPE_CUSTOMER` instead of a 500 in the same case.

### Fixed

- **Deleted the dead `requireTier()` shim** from `app/lib/org.ts` along with its false doc comment claiming seven routes call it — git archaeology shows the only caller that ever existed was a test-only fixture removed in 2.18.0. The claim had propagated unverified through the changelog and cleanup reports since.

### Notes

- Surface-budget ceiling amended in the same ship: app pages 52 → 53 (`THESIS.md` amendment log + `contracts/surface-budget.json`). Active API routes unchanged at 131 — enforcement lives at existing seams, not new routes.
- No Node/Python SDK source change; the shared version advances to 5.16.0.

## [5.15.0] — 2026-08-09

**DashClaw Pulse: an always-on-top ambient posture window (`/widget`) for the operator who is deliberately NOT watching.** One glyph answers "is any of this mine?" from across the room — a dim dash when nothing is owed, the pending-approval count when something is. Design chosen by a 9-agent tournament (5 divergent concepts, 3-lens judge panel); full spec and precedence rules in `docs/decisions/2026-08-09-widget-pulse.md`. Not a revival of the culled status-widget PWA: no PWA manifest, no prefs, no stat tiles, no action log, read-only slice 1.

### Added

- **`/widget` page**: frameless dark field sized for a 300–400px always-on-top browser window. The window perimeter is the alert channel (luminance + shape, never hue alone); approval always outranks signals (a red signal demotes to a 2px left rail with an `!N` head, never silently dropped); activity moves only a 3px baseline strip; zero chroma at rest. Reveal layer on hover/focus lists the pending rows (type, agent, risk, age — no goals, no output, no secrets). The whole field is one button → `/approvals`.
- **`GET /api/widget/pulse`**: the snapshot behind the surface — whitelisted fields only, composed from existing repositories (no new ingestion, no direct SQL). Each sub-query is independently failure-wrapped: a failed query lands in `queriesDegraded` and renders as the DEGRADED posture, never as a zero (honesty rule H5).
- **Honesty rules as invariants, not polish**: calm requires positive heartbeat evidence; no present-tense claim survives 90s of silence (graded FRESH → DRIFTING → STALE off the SSE heartbeat); reconnect refetches before repainting so a stale calm never flashes; a dwell budget scaled by risk (5m/20m/60m) escalates an overdue approval to the breathing error ring — the product's only loop, with a mandatory static double-ring tell under `prefers-reduced-motion`. Pinned by the `widget-pulse` unit suites (posture × freshness × boundary fixture matrix).
- **Desktop-presence reader** (`app/lib/widget/presence.ts`): best-effort read of the machine-local OpenClaw presence store (`OPENCLAW_DESKTOP_PRESENCE_DIR`); absence of a verdict renders `unknown`, never `live`, and presence never drives the ring.
- **Pulse button on `/approvals`**: opens the widget as a small popup window — the surface's one discovery path (deliberately no nav entry).
- **SSE heartbeat is now a named event**: `app/api/stream/route.ts` previously emitted the keepalive as an SSE comment, invisible to `EventSource`; it is now a named `heartbeat` event and `useRealtime` exposes `lastEventAt`/connection state — without this, "no message in 90s = stale" would false-fire on every quiet fleet.
- **Demo fixtures** for `/widget` and `/api/widget/pulse`, so the marketing demo renders the owed posture honestly (presence stays `unknown` — the demo host has no presence store).

### Notes

- Surface-budget ceilings amended in the same ship: active API routes 130 → 131, app pages 51 → 52 (`THESIS.md` amendment log + `contracts/surface-budget.json`).
- No Node/Python SDK source change. The tag-triggered release workflow republishes the unchanged SDK content at 5.15.0 so registries stay aligned.

## [5.14.0] — 2026-08-09

**The hosted paid tier takes money: Stripe Checkout, customer portal, and a signature-verified, replay-proof webhook.** The decision record ordered checkout last, after accounts and metering became true — both shipped earlier the same day (v5.13.0, v5.12.0), so this is that final step. Entitlement enforcement (ceilings, seat limits) is still deliberately absent: nothing reads `plan` to gate a governance capability.

### Added

- **`POST /api/billing/checkout`**: starts a subscription Checkout Session for the caller's org. Human org admins only, and on hosted the org must be CLAIMED first ("you cannot bill an anonymous trial cookie" — 409 `claim_required` otherwise). Creates and stores the Stripe customer on first use (first-writer-wins). 501 `BILLING_NOT_CONFIGURED` when Stripe env is absent, so self-host instances answer honestly.
- **`GET /api/billing/portal`**: Stripe customer portal session for the org's stored customer.
- **`POST /api/webhooks/stripe`** (public, self-verifying — the Telegram-webhook pattern): signature verified over the raw body; every event id claimed exactly once through the new `stripe_webhook_events` ledger (`drizzle/0070`) before its handler runs, so Stripe retries and operator replays acknowledge without re-applying — the idempotency the culled 2026 webhook never had. Handles `checkout.session.completed`, `customer.subscription.updated` (price→plan mapping, unknown prices keep the stored plan), `customer.subscription.deleted`, `invoice.payment_failed`.
- **Plans `indie` ($49/mo, `STRIPE_PRICE_INDIE`) and `team` ($199/mo, `STRIPE_PRICE_TEAM`)** per the decision record; the stale `STRIPE_PRICE_PRO`/`STRIPE_PRICE_BUSINESS` names in `.env.example` are replaced. Paying clears the trial action cap (a customer is never throttled at trial levels); cancellation restores the free-tier cap on hosted orgs.
- **Billing tab on `/settings` + Plan tile on `/usage`**: current plan, upgrade cards, manage-billing portal link, checkout success/canceled banners, and the standing honesty line — self-hosted DashClaw stays free forever under MIT.
- **`billing.repository.ts`**: every Stripe-driven state transition behind the route-SQL ratchet (the culled routes wrote raw SQL inline; these cannot).
- **`npm run hosted:check-ready`** now warns on PARTIAL Stripe configuration, naming each missing var — the checkout equivalent of the deleted-OAuth-client incident is env-present-flow-dead, and this check refuses to let that state look healthy.

### Fixed

- **`GET /api/hosted/claim` without a trial cookie is a calm 200 preview** (`claimable: false, reason: no_trial_session`) instead of a 400 — the claim banner probes it on every signed-in dashboard page, and normal state must not put red noise in every user's console. POST keeps the 400.

### Notes

- No Node/Python SDK source change. The tag-triggered release workflow republishes the unchanged SDK content at 5.14.0.

## [5.13.0] — 2026-08-09

**The hosted paid tier's account layer (G2 product half): claim-your-workspace and email-matched seat invites.** The 2026-08-09 decision record ruled "accounts before billing — you cannot bill an anonymous trial cookie." This release builds the account: an anonymous hosted trial binds to an authenticated owner without losing its history, and seats become a real, countable thing. Still no checkout, no plan gating, no entitlement enforcement.

### Added

- **Claim-your-workspace** (`drizzle/0069`: `organizations.claimed_at` + `claimed_by_user_id`): `POST /api/hosted/claim` atomically claims the browser's anonymous trial org for the signed-in user — stamps the owner, clears `trial_ends_at` (the org stops expiring and the cleanup sweep can never collect it), renames the org after the owner, rebinds the user as admin, discards the empty auto-minted personal org behind hard emptiness guards, and clears the trial cookie. A concurrent second claim loses the conditional UPDATE and gets a truthful 409; a claim that crashes between the org stamp and the user rebind is finished idempotently on retry. `GET /api/hosted/claim` is the claimability preview.
- **`/claim` page + unclaimed-trial banner**: the confirmation surface (sign in with Google → one button), plus a quiet banner on every dashboard page of an unclaimed trial linking to it. After a claim the session refreshes immediately (`useSession().update()` now bypasses the jwt callback's 5-minute org-refresh window via the `update` trigger).
- **Email-matched invites** (`seat_invites` table, `drizzle/0069` — a new table, because the legacy pre-v5 token-based `invites` table still exists retired-in-place on long-lived databases and adopting its shape broke the first deploy of this release): an org admin records a teammate's address; the teammate's FIRST sign-in with that verified OAuth email lands them in the inviting org with the invited role instead of minting a personal workspace — no invite emails, no join links. One live invite per (org, address) via a partial unique index; accepted rows remain as audit history; returning users are never moved by an invite.
- **`/api/team/invites` (GET/POST/DELETE) + `/team` page**: seats made visible — members list (wiring the previously dead `getTeamOrgAndMembers`), pending invites, invite form, revoke. Human org admins only; agent keys, the operator sentinel, and anonymous trial cookies are refused. Demo-mode fixture included.
- **/connect claim funnel + trial sign-out** (same-day follow-up from live operator testing): the trial workspace card on `/connect` now leads with "Claim workspace" (the page a returning trial actually lives on had no path to /claim), and gains a "Leave workspace" control with an inline warning — for an unclaimed trial the browser session is the only credential, so leaving is confirmed, same-origin-only (`/connect?leave=trial`, handled in middleware next to the rest of the trial-cookie lifecycle), and never reachable from a cross-site link.
- **`scripts/drills/claim-flow.mjs`**: the claim path drilled end to end over live HTTP — mint → preview → claim → DB-verified ownership/rebind/discard → trial-cookie revocation — substituting only the two artifacts a script cannot produce (the OAuth-created `users` row and the NextAuth session JWT, encoded with the same library + secret the middleware verifies). Self-cleaning teardown.

### Security

- **Hosted founder bootstrap disabled.** On a hosted instance the first-ever Google sign-in was promoted to admin of `org_default` — an uncapped, non-trial org — purely for arriving first. The founder bootstrap now runs only off-hosted (the hosted operator does not arrive via public sign-in); every hosted sign-up gets a capped personal trial org.
- **Claimed orgs revoke their anonymous credentials.** `resolveTrialOrg` treats a claimed org as no-longer-trial, so outstanding trial cookies (including copied ones) stop resolving within the middleware's 60s org cache. `deleteHostedWorkspace` refuses claimed orgs outright, and the expiry sweep excludes them (`claimed_at IS NULL`) as defense in depth.

### Notes

- The claimed org keeps its trial action cap on the free plan — clearing it is entitlement work (week 5), and until then a claimed org must not become the only uncapped tenant.
- No Node/Python SDK source change. The tag-triggered release workflow republishes the unchanged SDK content at 5.13.0 so registries stay aligned.

## [5.12.0] — 2026-08-09

**The hosted paid tier's measurement layer: a per-org monthly metering rollup (G4) and org-keyed rate limits on the guard and record paths (G5).** The 2026-08-09 decision record set the rule that pricing comes only after measuring; this release builds the measuring. Read-only throughout: no entitlement enforcement, no checkout, no plan gating.

### Added

- **`usage_rollups` table (drizzle/0068)**: per-org, per-month counters of governed and blocked actions. Maintained inline by `createActionRecord`, the single funnel both creation paths share, so `POST /api/actions` and guard `?record=true` cannot drift apart. Exactly rebuildable from `action_records` via `scripts/backfill-usage-rollups.mjs` (idempotent recount; also seeds history from before the table existed). Period-keyed (`YYYY-MM` UTC), so rows roll over naturally at month boundaries and never need the reset cron the retired `usage_meters` design required.
- **`GET /api/usage`**: caller-org-scoped and read-only. Current-period governed/blocked counts, seats (human users plus active API keys), trial cap state, and up to 12 months of history. Every query is org-scoped server-side; all SQL lives in `app/lib/repositories/usage.repository.ts`.
- **`/usage` dashboard page**: read-only metering panel, reachable from the sidebar (Configure group). Current-period tiles, trial cap line, monthly history table. Demo-mode fixture included so the marketing sandbox renders it populated.
- **Org-keyed rate limiting on `POST /api/guard` and `POST /api/actions`** (`app/lib/org-rate-limit.ts`): fixed-window limit keyed by org id, not IP. A tenant behind corporate NAT is never throttled by neighbors, and a fleet spread across many IPs is bounded as one org. Redis-backed via `REDIS_URL` so counts survive serverless cold starts, with a per-instance in-memory fallback that degrades rather than disables. Limited requests get a structured 429 (`code: ORG_RATE_LIMITED`, `Retry-After` header, `retry_after_ms`) before any evaluation or write. Default 600 requests/minute per org; tune with `DASHCLAW_ORG_RATE_LIMIT_MAX` / `DASHCLAW_ORG_RATE_LIMIT_WINDOW_MS`. The per-IP middleware limiter is unchanged and remains the pre-auth fallback.

### Removed

- **`.github/workflows/reset-meters.yml`**: it had been calling `/api/cron/reset-meters`, a route deleted in the v5 cull on 2026-07-07, on the 1st of every month since. The new rollup is period-keyed and needs no reset.

### Notes

- Metering is measurement only in this release. Ceiling and price decisions follow from running the rollup against the live hosted cohort, not the other way around.
- No Node/Python SDK source change. The tag-triggered release workflow (G7, v5.11.10) republishes the unchanged SDK content at 5.12.0 so registries stay aligned with the platform version.

## [5.11.10] — 2026-08-08

**Second evasion-audit round on the client bash classifier: four more obfuscation holes closed.** A follow-up probe of the 5.11.9 fix put obfuscated twins of already-blocked commands through the guard and found the fix only covered `;`/`&&` chains and only blocked `eval` + decoder-to-shell pipes. Four evasions still slipped below the server's risk threshold; each now matches the coverage of its already-closed twin.

### Security

- **Newline and `||` are now chain separators.** `F="-rf"` on one line and `rm $F path` on the next bypassed the static var-resolver entirely, because `split_chain_texts` only split on `;` and `&&` — so the exact flag-in-a-variable evasion 5.11.9 fixed reopened with a newline. Sequential segments split by a newline or `||` are now graded individually (the worst wins) and feed the resolver, so `F=-rf⏎rm $F x` grades as `rm -rf x` (risk 100). `||` matters because the right side runs when the left fails.
- **`export`/`declare`/`local`/`readonly`-prefixed assignments resolve.** `export F="-rf"; rm $F x` hid the flags behind an export the resolver didn't recognize; the prefix is now stripped before the assignment match.
- **A bare pipe into a shell is blocked.** `curl … | sh`, `echo "rm -rf /" | bash`, `printf … | zsh` — the shell reads its program from stdin, so the real command is invisible regardless of the upstream producer. This generalizes the 5.11.9 decode-to-shell rule beyond the base64/xxd/openssl decoders. A named script file (`… | bash deploy.sh`) is exempted as an ordinary invocation.
- **A shell running an inline command string is blocked.** `sh -c '<cmd>'`, `bash -lc '<cmd>'` run an arbitrary string the per-token classifier never inspects — the same invisible-execution class as `eval`. Legitimate uses surface for one-click approval rather than being silently allowed.

### Notes

- Recorded conservative gaps for the next round: a flag built from a command substitution (`F=$(echo -rf); rm $F x`) still can't be resolved statically — blocking it would false-positive the common `TMPD=$(mktemp -d); rm -rf $TMPD` pattern — and a destructive command behind a non-shell pipe sink (`echo x | xargs rm -rf`) needs pipe-stage analysis. Both are documented, not fixed.
- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.9] — 2026-08-08

**Two demonstrated guard evasions closed in the client bash classifier: flags hidden in shell variables, and decode-then-eval execution.** An evasion audit showed both obfuscated forms sliding past the guard while their plain twins were blocked. The fix makes each obfuscated command classify identically to (or stricter than) its plain twin, so the server policy sees the same risk it would for the un-obfuscated form.

### Security

- **Flag-in-a-variable (`F="-rf"; rm $F path`) now grades as `rm -rf path`.** The parser saw `$F` and the path as two plain targets with no recursive flag, so the delete graded as bounded cleanup (risk 55) and the server allowed it. Chain grading now resolves earlier literal `VAR=value` assignments into later segments before classifying each one. Only static literals are substituted — a value containing `$`, a backtick, or `$(` is dynamic and left unresolved; nothing is executed or guessed, and ordinary chains are untouched.
- **`eval` and decode-to-shell pipes are classified destructive and hard-blocked.** `C=$(echo <b64> | base64 -d); eval "$C"` previously graded intent `unknown` at risk 20 because `eval` was in no command category. `eval` as a base command, and `base64 -d` / `xxd -r` / `openssl enc -d` output piped into `sh`/`bash`/`zsh`/`dash`/`ksh`/`eval`/`python`/`perl`/`ruby`/`node`, now grade destructive with a block validation: the real command is invisible to the classifier, so the effect is unverifiable. Legitimate uses (`eval "$(ssh-agent -s)"`) surface for one-click approval instead of being silently allowed — the correct posture for a control plane.

### Notes

- Known conservative gaps, recorded for the next audit: `export VAR=value` assignments are not resolved (only bare `VAR=value` segments), and a variable built from a command substitution cannot be statically resolved — it is caught by the eval/decode block, not by resolution.
- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.8] — 2026-08-08

**Route-SQL guardrail compliance for the 5.11.7 cron fix — no behavior change.** CI's WS1 M4 guardrail correctly rejected 5.11.7's org-listing ternary (it turned one inline `sql` template into two per cron route). The org listing now goes through `listOrganizations()` in the orgs repository — which also gains the `name` column — and both cron routes carry one fewer inline query than before. Same queries, same results.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.7] — 2026-08-08

**The technical-debt sweep: quoted data is inert, and `signals.detected` actually fires on self-hosted deploys.** Closes both known limitations left open by 5.11.5/5.11.6, and fixes two structural reasons the `signals.detected` webhook event had never been observed live.

### Fixed

- **The evidence classifier is now quote-aware for every command, not just git messages.** When a command's executable skeleton (quoted data blanked, `$(…)`/backtick substitution preserved) contains **no exec sink** — no shell word (`sh`/`bash`/`zsh`/`pwsh`/`powershell`/…), no interpreter (`python`/`node`/…), no `eval`/`exec`/`ssh`/`su`, no command substitution — quoted string arguments are provably inert data, and the destructive / pipe-to-shell / vcs-dangerous / deploy pattern families scan the skeleton instead of the raw string. So `gh release create --notes "…rm -rf…"`, `echo "curl … | sh" > notes.txt`, PR bodies, and a `curl | sh` mention inside a commit message in a `cd &&` chain (the 5.11.6 residual warn) all grade on their real, benign shape. Any sink present → raw scanning, byte-for-byte the old behavior: `sh -c "rm -rf /"`, `bash -c "curl … | sh"`, `echo "rm -rf /" | sh`, `eval`/`ssh`/`powershell -Command` payloads, and `$(…)` inside quoted notes all keep their destructive/remote-exec grades (13 hole tests pin them; the 63-vector calibration golden set stays green).
- **The signals and memory-maintenance crons no longer skip `org_default` on self-hosted deploys.** Both crons excluded `org_default` unconditionally — correct on the hosted deployment (where it is the shared legacy bucket), but on a self-hosted instance the operator's org IS `org_default` (auth promotes the first user into it), so signal webhooks and email alerts could structurally never fire for self-hosted operators. The exclusion is now gated on `DASHCLAW_HOSTED=true`.
- **`signal_snapshots` is now in the canonical schema** (`schema/schema.js` + `drizzle/0067_signal_snapshots.sql`). It was only ever created by the legacy `migrate-multi-tenant.mjs`, so a fresh deploy's `db:migrate` never created it — the signals cron threw per-org, the per-org catch swallowed it, and `signals.detected` silently never fired on fresh instances. DDL mirrors the legacy script exactly; `IF NOT EXISTS` makes it a no-op where the legacy script already ran.

### Verified live

- **`signals.detected` observed end-to-end from the cron for the first time**: seeded stale pending approval → `GET /api/cron/signals` → `approval_backlog` detected for `org_default` → webhook delivered to an external receiver with the HMAC signature verified byte-for-byte, `last_triggered_at` stamped (the 5.11.3 failure-state path), and a second cron run correctly deduped to zero deliveries.

### Security

- **`@dashclaw/mcp-server`: pinned transitive `nanoid` to ≥3.3.17** (GHSA-2v37-7h3g-55p8, high; dev-only via vitest→vite→postcss) with an override, unblocking the package's own `npm audit` publish gate. `server.json` synced to 3.1.1.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.
- `@dashclaw/mcp-server` 3.1.1 (the corrected `dashclaw_guard` description from 5.11.4) is verified, packed, and blocked only on the owner's npm one-time password; npm stays at 3.1.0 until that publish runs.

## [5.11.6] — 2026-08-08

**Completes the 5.11.5 git-message fix for the real-world command shape.** 5.11.5 exempted a *lone* `git commit`, but every commit the Claude Code Bash tool issues is prefixed `cd <repo> && git commit …` — and the `&&` disqualified the whole-command exemption, so the common shape still graded the message body destructive/80 and hard-blocked. (Caught by testing the actual chained command, not the bare one 5.11.5 was verified against.)

### Fixed

- **The inert-git-message exemption now applies per chain segment**, so `cd <repo> && git commit -m "…rm -rf…"` grades the git segment as `apply` (the message is inert data) while `cd <repo> && rm -rf …` still grades the rm segment destructive/80 and `cd <repo> && git commit -m "$(rm -rf …)"` still catches the command substitution. Verified against the real `cd && git commit` shape.

### Known limitation

- A `curl … | sh` string *mentioned inside a message* within a `cd && git` chain still trips the whole-command remote-exec check and **warns** (it no longer hard-blocks). Fully clearing that, and the general non-git quoted-data case (`echo`, inline `gh --notes`), needs quote-aware pipe parsing — deliberately deferred rather than rushed on a security classifier.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.5] — 2026-08-08

**A git commit whose message describes a destructive-command fix no longer blocks the commit.** The sibling of the 5.11.4 finding: the pretool hook forwards the raw command to the server as the evidence `act`, and the server's shell classifier scanned the whole string — including the quoted `git commit -m "…"` message body — with its `rm -rf` and `curl … | sh` patterns. So a commit message *describing* this very class of fix graded destructive/80 (or remote_exec/70), folded to a 100 block, and the commit had to be routed through `git commit -F` to land. The hook's own classifier was quote-aware and scored these correctly; this was purely the server evidence layer.

### Fixed

- **The evidence classifier exempts a lone `git commit` / `git tag` / `git stash` / `git notes` command**, whose message git never executes as shell. The exemption is gated on a shell-quoting-correct "code skeleton": quoted data is treated as inert, but `$(…)` / backtick command substitution (which executes even inside double quotes) and any surviving shell operator disqualify it. So `git commit … && rm -rf /`, `git commit -m "$(rm -rf /)"`, and `git commit … | sh` are all still graded on their real payload; bare `rm -rf`, `sh -c` / `python -c` payloads, and real `curl … | sh` are unchanged.

### Known limitation

- The exemption is git-specific. A dangerous-looking literal in another data argument (`echo "rm -rf /"`, an inline `gh release --notes "…"`) can still be over-graded; distinguishing inert data from an exec sink such as `echo "…" | sh` needs fuller shell parsing, tracked as a follow-up.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.4] — 2026-08-07

**A benign `curl … | python -c` read no longer hard-blocks at risk 100.** Found while dogfooding the webhook drill: the evidence classifier's pipe-to-shell detector treated *any* interpreter after a `curl`/`wget` pipe as remote code execution, so piping fetched JSON into an inline processing script (`curl … | python -c "…"`) was graded `remote_exec`/security-70 and folded to a 100 block — the same verdict as `curl evil.sh | sh`. Operators who hit this on routine reads learn to distrust or disable enforcement, which is the real cost.

### Fixed

- **Evidence classifier distinguishes stdin-as-data from stdin-as-code.** Piping into an inline interpreter script (`-c` / `-e` / `-p` / `--eval` / `--print`) is now exempt from the `remote_exec` grade and classified on its actual content. The genuinely dangerous shapes keep the 70: `| sh`/`bash`/`zsh`, a bare interpreter, `python -`, and any inline payload that re-executes stdin via `exec(`/`eval(`. A destructive inline payload (`| python -c "shutil.rmtree(…)"`) still grades 80 via the existing interpreter-destructive path, so the fix narrows the false positive without opening a hole.

### Changed

- **MCP `dashclaw_guard` tool description no longer implies it creates an approval.** It now states it only evaluates, and points to `dashclaw_record` (status `pending_approval`) + `dashclaw_wait_for_approval` for an actual Approvals-inbox entry — an evaluate-only `require_approval` never parked anything in the inbox. Ships with the next `@dashclaw/mcp-server` publish.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.3] — 2026-08-07

**Webhook health telemetry is now honest on every delivery path.** Found by a live end-to-end drill: a webhook could deliver three real events and still show "Last triggered: Never," and a webhook subscribed only to approval events could fail forever without ever tripping the 10-failure auto-disable.

### Fixed

- **Approval-event webhook deliveries (`approval_pending` / `approval_granted` / `approval_denied`) now update `last_triggered_at` and `failure_count`** — previously only the signals-cron path did, so approval-only webhooks never healed or auto-disabled and the FAILED stat stayed 0.
- **The webhook test button now updates the same failure state**, so a successful test immediately clears "Last triggered: Never" and resets the failure counter.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.2] — 2026-08-07

**Approvals are now judgeable — the operator sees the full command.** Field-found the same afternoon it shipped: a Telegram approval card showed a `Bash: grep …; node -e "import(…` goal cut mid-word at the hook's 120-char record cap. An operator cannot approve or reject what they cannot read.

### Fixed

- **Pretool hook records the full command** — `declared_goal` now carries the whole command up to the server's 2000-char validation cap (was the first 120 chars; the non-Bash tool path had the same bug). More goal text also means more signal for content-pattern policies.
- **Telegram approval card shows up to 3500 chars** (was 200) inside Telegram's 4096 limit, with an honest `… (+N more chars)` marker when a cut is unavoidable; **Discord** likewise uses its full 1024-char field with a marker.
- **/approvals pending cards** render long goals as a scrollable monospace block instead of a giant headline; **Decision Replay** renders the full goal in the causal timeline (mono, wrapped) and clamps only the page subtitle.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.

## [5.11.1] — 2026-08-07

### Fixed

- **`guide-capture-agent` joins the synthetic-agent registry** — the platform-guide example capture (`scripts/regen-platform-guide-examples.mjs`) recreates this agent on every release, and after v5.11.0's cleanup it was the one test artifact still reappearing as an unidentified agent. Now hidden from rosters by default, covered by the one-click cleanup, and purged by the daily retention sweep like the other test families.
- **`dashclaw install codex` — four defects found wiring the OpenClaw embedded-codex lane.** (1) The DashClaw MCP server (a Node entry) was registered with `command = "python"` — that spawn could never have worked. (2) The managed config block was appended after any user `[tables]`, so its top-level `approval_policy` silently bound to the preceding table's scope; root keys now live in a separate managed block inserted above the first table (legacy single-block installs migrate cleanly). (3) `--agent-id` is now threaded into the MCP args and every hook command (previously hardcoded `codex`, mis-attributing governed actions). (4) Hook timeout is written as `timeout` — codex's config.toml parser ignored the old `timeoutSec` spelling and applied its 600s default. Note: fixes 3–4 change hook command identity, so codex will ask to re-trust the hooks after a re-install. New test file covers all four plus the help guard below.
- **CLI: subcommand `--help` no longer executes the subcommand.** `dashclaw install codex --help` previously ignored the flag and ran the install (mutating `config.toml` and `AGENTS.md`); any `--help`/`-h` now prints usage and exits.
- **`@dashclaw/openclaw-plugin` 1.6.2 — manifests point at `dist/index.js`** instead of `src/index.ts`. OpenClaw 2026.7.x refuses TypeScript entries for installed packages (source checkouts excepted) — the stale entry broke the gateway's startup plugin repair. (1.6.1 was published before this fix and still carries the broken entry; install 1.6.2+ on OpenClaw 2026.7.x.)

- **`@dashclaw/openclaw-plugin` 1.6.1 — bounded approval wait.** Field-found by MoltFire: a `require_approval` decision parked the tool call in `waitForApproval` for up to 300s, but Codex's embedded dynamic-tool RPC watchdog kills the call at ~90s — so a governed Telegram `sessions_send` was silently dropped instead of delivered, even when the operator approved later. The plugin now bounds the wait with a new `approvalWaitMs` config (default 60s, under the watchdog) and on timeout blocks with an actionable reason (action id + `/approvals` link + retry hint). The server-side approval window stays 300s, so approving after the timeout and retrying the same call passes via the guard approval grant and `createAction`'s idempotent-retry dedupe. New unit test covers the never-answered operator path.

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2. `@dashclaw/openclaw-plugin` 1.6.1/1.6.2 were published independently ahead of this release.

## [5.11.0] — 2026-08-07

**Test-agent cleanup + site-wide list controls — the 729-phantom-agent problem, solved at every layer.** Smoke, load, and bench runs had accumulated ~700 synthetic agents that polluted `/identities`, the global agent dropdown, and the policy picker, and inflated the Decisions ledger. This release removes them with one click, hides them everywhere by default, auto-purges future test traffic, and gives every list page collapsible sections with sort/filter.

### Added

- **Shared synthetic-agent registry** (`app/lib/synthetic-agents.js`) — the `smoke-%`/`loadtest-%`/`ci-smoke`/… pattern list (plus the previously missing `bench-agent-%`) extracted from calibration mining into one module consumed by cleanup, roster hiding, and the retention sweep. `ps-*` fleet agents are explicitly non-synthetic.
- **One-click test-agent cleanup on `/identities`** — an admin-only "Clean up test agents (N)" button and a bulk **Delete** action on the unidentified-agents checkboxes. Backed by new `DELETE /api/actions?synthetic=true` and `?agent_ids=` modes: admin-gated, write-ahead audited, org-scoped, chunked (10k rows/statement), and they purge `agent_presence`/`goals`/`decisions` traces so roster ghosts can't survive (found live: 292 agents outlived the first pass on heartbeat rows alone). The confirm dialog states the real org-wide blast radius, including `smoke.*`/`loadtest.*`/`liveproof.*` action types on real agents.
- **Synthetic agents hidden by default** — `listAgentsForOrg` filters the merged roster (actions + goals + decisions + presence) unless `include_synthetic=true`; cleans the identities fleet, the global agent dropdown, and the policy agent picker at one choke point. A "Show test agents" toggle on `/identities` reveals them.
- **Daily retention sweep** — `GET /api/cron/synthetic-sweep` (CRON_SECRET-gated, write-ahead audited, org-scoped to `DASHCLAW_SYNTHETIC_SWEEP_ORG`, default `org_default`) deletes synthetic-agent rows older than `DASHCLAW_SYNTHETIC_RETENTION_DAYS` (default 7), scheduled by `.github/workflows/synthetic-sweep.yml`. Route count 123 → 124, amended in `THESIS.md` + `contracts/surface-budget.json` with a written reason.
- **`CollapsibleSection` + `useListControls`/`ListControlsBar` primitives** — persisted per-section collapse (localStorage), column sort, text search, and per-column value filters, rolled out across `/identities`, `/decisions`, `/approvals`, `/audit-log`, `/assumptions`, `/sessions`, `/webhooks`, `/api-keys`, `/policies` (collapse-only — the One-Ledger keeps its own filter pipeline, `keepMounted` so its action refs stay live), and `/team-tasks`. Server-paginated pages (decisions, audit-log) are sort-only over the loaded page by design.
- **Selection-visibility invariant** — every destructive/bulk handler on the rolled-out pages (delete, revoke, approve, deny) prunes its selection to currently visible rows and re-intersects at call time, so filters and toggles can never hide a row that a bulk action still targets.

### Fixed

- Decisions ledger totals now reflect real traffic (drill instance: 150,510 → 148,668 actions after synthetic purge; agent roster 797 → 89).

### Notes

- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2.
- Rendered proof: authenticated headless drill across all 10 pages, including the live destructive cleanup path.

## [5.10.1] — 2026-08-07

**OpenClaw auto-pairing — the /identities "Request pairing" click now works end to end.** Field-found by MoltFire: clicking Request pairing delivered the inbox directive but nothing agent-side acted on it, so no pending pairing ever appeared. The button's contract is now two clicks total: Request pairing → Approve.

### Added

- **`@dashclaw/openclaw-plugin` 1.6.0 — auto-pairing consumer** (`packages/openclaw-plugin/src/auto-pairing.ts`, spec `docs/superpowers/specs/2026-08-07-openclaw-auto-pairing-design.md`). On the agent's first tool call per gateway process the plugin reads its unread DashClaw inbox; when a `dashclaw.pairing_request` directive targets its agent id it generates an RSA-2048 keypair locally (private key → `~/.dashclaw/identity/<agent_id>.pem`, mode 600, never sent or logged — same custody contract as the MCP `dashclaw_pair` tool), POSTs the public PEM to `/api/pairings`, and marks the message read. The pairing lands under Pending Pairings on `/identities`; admin approval remains the only step that creates the identity (P10 invariant unchanged). Fire-and-forget: it can never block or fail a tool call. New `autoPairing` config flag, default **on** — the operator's Request-pairing click is the consent. POST-then-write key ordering so a failed submission retries cleanly at the next gateway start. 8 new unit tests.
- **OpenClaw guide + docs**: `/guides/openclaw` gains an "Automatic identity pairing" section; `docs/agent-identity.md` documents the automatic flow, the flag, and key rotation (delete the pem, click again).
- **Agent-onboarding surfaces** (landed by the parallel session and rode this release's push): host-aware `/llms.txt` route (`app/llms.txt/route.ts`) — the marketing host serves the full agent setup runbook (`npx dashclaw up --yes --no-browser`, credential locations, verify steps, runtime wiring, hosted-trial captcha warning), private hosts serve a pointer to `dashclaw.io/llms.txt`; public `/agents` page as the human-pointable twin (footer link, `/connect` routing line, README blockquote). The hosted-trial Turnstile gate stays human-gated — the agent story routes around it. `appPages` ceiling 47 → 48 amended in `THESIS.md` + `contracts/surface-budget.json` with a written reason, per the anti-regrowth contract.

### Fixed

- **v5-cull drift in `docs/agent-identity.md`** — the operator-pairing section still pointed agents at `dashclaw_inbox_list` / `claw.getInbox()` / `dashclaw_messages_mark_read`, all removed in the v5.0.0 cull; replaced with the live `GET`/`PATCH /api/messages` contract.

### Notes

- Claude Code / Codex / Hermes hooks runtimes deliberately defer the auto-consumer (recorded in the spec) — MCP-connected agents already answer the directive via `dashclaw_pair`.
- No Node/Python SDK source change — the SDKs are not republished; npm + PyPI stay at 5.6.2. The OpenClaw plugin (independently versioned) republishes at 1.6.0.

## [5.10.0] — 2026-08-06

**Silent-lane witness posture — silence is no longer indistinguishable from idleness.** The v5.9.1 incident's product lesson, shipped same-day per its spec (`docs/plans/2026-08-06-silent-lane-witness-spec.md`): MoltFire's ungoverned Codex lane was only caught because a human eyeballed the ledger. Now the server watches for the shape itself.

### Added

- **Per-agent activity/witness derivation** (`app/lib/silent-lane-witness.ts`, `app/lib/repositories/silent-lane-witness.repository.ts`) — over a trailing window (`DASHCLAW_WITNESS_WINDOW_MINUTES`, default 60), each agent's self-reported activity (`agent_turn` rows from the notify bridge) is compared against governance witness (guard decisions + hook-attributed action rows). Activity without witness derives **`recorded-ungoverned`** — a standing posture, not a transient alert: a bridged-but-unhookable lane correctly stays in it until real hooks exist.
- **`lane_without_witness` posture signal** — joins the posture findings queue with the same discipline as the v8.2 enforcement-liveness finding. Informational only (F5): it never escalates the agent's own action risk and never blocks.
- **`/setup#silent-lane-witness` panel** — per-agent rows (state badge, last activity source, last witness time) beside the enforcement-liveness card. 31 new unit tests including a MoltFire-shaped fixture and a rendered-panel test.

### Notes

- `enforcement_liveness_runs` is deliberately not counted as per-agent witness (it has no `agent_id`; org-wide joining would clear every agent's alarm whenever the synthetic probe ran). Documented in the repository header.
- Server + dashboard only; no route, SDK, or MCP surface change — SDKs are not republished.

## [5.9.2] — 2026-08-06

### Fixed

- **Fresh installs no longer depend on Google Fonts** (`app/layout.tsx`, `app/fonts/`) — `next/font/google` fetches Inter at build time, and Turbopack hard-fails the build when `fonts.googleapis.com` is unreachable, which broke `dashclaw up` on restricted networks (caught by `drill:fresh-windows`: a factory-fresh sandbox died in `health_poll` with the font fetch as the build error). Inter's latin variable font (weights 100–900, OFL-1.1) is now vendored at `app/fonts/inter-latin-var.woff2` and loaded via `next/font/local` — no network dependency, same `--font-inter` variable, no visual change.

### Notes

- Platform-only; no SDK surface change — SDKs are not republished.

## [5.9.1] — 2026-08-06

**OpenClaw embedded-codex ledger bridge + the Windows `.bat`/`.cmd` composition gap.** Field-found by MoltFire (an OpenClaw Telegram agent): its embedded Codex app-server lane never appeared in the decisions ledger, and its Windows batch-script probes never raised the v5.9.0 `script_then_execute` signal.

### Fixed

- **Windows `.bat`/`.cmd` script-then-execute detection** (`hooks/dashclaw_agent_intel/written_paths_ledger.py`) — `cmd /c x.bat`, `cmd /c .\x.bat`, and bare `x.cmd` produced no composition signal: the bash tokenizer eats backslashes (`.\x.bat` → `.x.bat`) and bare batch names carry no path marker, so no exec candidate was ever extracted. Candidacy now includes known script extensions (`.bat`/`.cmd` added to the shell set, so batch content grades line-by-line instead of via the interpreter regex), and ledger lookup matches separator-less mangles by recorded basename — gated to script extensions to keep the alias narrow (F5 lesson). 7 new regression tests pin all six probe forms plus the unwritten-file false-positive guard.
- **`dashclaw codex notify` understands kebab-case payloads** (`cli/lib/codex/notify.js`) — the codex 0.13x line (still vendored inside OpenClaw's codex runtime) emits `turn-id`/`last-assistant-message`-style keys; the recorder read snake_case only, so turn ids and summaries came through empty. Both spellings are now accepted, snake_case preferred.

### Added

- **`dashclaw codex notify --agent-id <id>`** — bake ledger identity into the notify argv (argv beats the machine-ambient `DASHCLAW_AGENT_ID`), so a gateway lane on a shared machine attributes its turns correctly. This is the bridge for OpenClaw's embedded-codex runtime, whose native tool calls cross neither the OpenClaw plugin hook bus nor (on the vendored 0.13x codex) the hook system — wiring documented in `cli/README.md`, enforcement posture recorded in `docs/architecture/enforcement-boundary.md` (cooperative/recording-only until OpenClaw vendors codex ≥ 0.142). Verified end-to-end: a live OpenClaw gateway turn landed in the hosted decisions ledger as an `agent_turn` action.

### Notes

- Platform-guide live examples regenerated at the current version (`guide:drift:check` green again).
- No route, SDK, or MCP surface change — counts unchanged; SDKs are not republished.

**Script-then-execute composition detection — the governance gap audit's last open item.** Two individually-benign tool calls compose into a destructive one: write a script whose payload would be blocked inline, then execute the script path (which grades as a routine interpreter call at the execution base). The guard graded the write and the execute but never the payload as a command — split across tool calls, no per-call classifier could see it. Closed per the accepted spec (`docs/plans/2026-08-06-script-then-execute-spec.md`); hooks + dashboard only, no server or SDK surface change.

### Added

- **Written-paths ledger** (`hooks/dashclaw_agent_intel/written_paths_ledger.py`) — PostToolUse records every path the session writes (file tools, shell redirects, `tee`, `curl -o`/`wget -O`) in a per-session, instance-suffixed temp ledger (path + timestamp only, 500-entry LRU, TTL 60 min via `DASHCLAW_SCRIPT_EXEC_TTL_MINUTES`). PreToolUse then grades the **content** of any recently-self-written script being executed (`bash x.sh`, `./x.sh`, `source`, `python`/`node`/etc., `pwsh -File`) with the same classifiers inline commands get, and folds that grade in. The composition signal itself never escalates risk (the F5 lesson): `bash cleanup.sh` deleting build artifacts keeps its calibrated low score, while the §1 repro now blocks at the inline grade — E2E-verified by live canary (block fired; canary survived). An unreadable/oversized ledger hit floors at the review band with `script_then_execute_unreadable`. Path normalization handles Git Bash drive forms, relative-vs-absolute, case-insensitivity, and the tokenizer's backslash-stripping of Windows paths.
- **Classifier Signals on `/decisions`** — the decision detail's Policies tab now renders non-allow classifier validations from the persisted guard context (they were stored but never shown, for every validation class). `script_then_execute` and its content-grade signals surface here with warn/block badges.
- **71 new hook regression tests** (`test_written_paths_ledger.py`, `test_script_then_execute.py`) pinning the escalation paths, the false-positive pins, TTL/LRU/corrupt-ledger fail-soft behavior, and the miss-path perf budget.

### Notes

- Blocked composition attempts audit-persist in `guard_decisions.context` (no action row — blocks never record one, by design).
- Documented residuals per spec §7: indirection (`eval "$(< x.sh)"`), cross-session splits, unmodeled writer flags — all inside the documented privilege boundary (seatbelt, not cage).

## [5.8.5] — 2026-08-06

**Platform guide live-examples regeneration — the scheduled follow-up from 5.8.4.** The guide's 24 captured request/response examples still dated from a 4.67.0 instance (2026-07-07 snapshot); all of them are now re-captured against a running 5.8.5-tree instance, and the gate that let that drift survive a month is closed. Platform-only release; no SDK source change.

### Added

- **`npm run guide:examples:regen`** (`scripts/regen-platform-guide-examples.mjs` + `.py`) — a reusable generator that re-captures all 24 liveExamples (11 HTTP via curl-equivalent fetches, 6 MCP by driving the repo's `mcp-server` over stdio, 4 Node SDK, 3 Python SDK) against a local instance, then sanitizes (ids → placeholders, operator-local paths and org ids scrubbed, transient `[Grant]` policy rows dropped), trims list responses to 2 items (the old snapshot shipped two 68KB `get_signals` dumps), recomputes `meta.counts`, and refuses to write on any leak-scan hit. The original generator was retired with livingcode in v5.3.0; the dataset is no longer regenerable-by-archaeology only.
- **Stale-surface gate in `guide:drift:check`** — the check now reads the version stamped in the captured `/api/health` example and fails when its major.minor falls behind `package.json` (patch drift tolerated so routine ships don't force a re-capture). This is the gate that would have caught the 4.67.0-era examples the MoltFire audit flagged.

### Fixed

- **`public/guides/platform-guide-data.json` liveExamples are current** — every example now shows 5.8.4-era responses (the health check's `realtime`/redis block instead of the retired `behavioral_ai` engine, current guard policy signals, `org_id` in write responses), `meta.generatedAt` advances 2026-07-07 → 2026-08-06, and the dataset sheds ~64KB of stale bulk. The 421 catalog entries are untouched — they remain gate-verified against `docs/api-inventory.json` (172 route+method pairs).

**Marketing site truth pass — the remaining MoltFire audit findings.** The outsider-run audit (`docs/plans/2026-08-06-marketing-site-truth-audit.md`) compared dashclaw.io against the codebase; v5.8.3 fixed the install-command drift, this release closes the rest of the fixable findings: every public claim about culled or unpublished software is now either true or removed. Platform-only release; no SDK source change.

### Fixed

- **`/guides/openclaw` no longer claims x402 spend gating** — the subsystem was culled in v5.0.0; the plugin's pitch is token-cost attribution only.
- **Plugin `HOOK.md` purged of the stale "x402 capability spend" section** (gate/record flow, `x402CommandPatterns`, `recordPurchase()`, the self-report path — none of it exists in the v5 plugin) and its frontmatter version aligned 1.3.2 → 1.5.0. Caught before the pending `@dashclaw/openclaw-plugin@1.5.0` publish, so the doc drift never ships in the npm package.
- **Platform guide dataset scrubbed of every x402 mention** (8 across five entries): the `/api/actions/:id/outcome` and `/api/approvals/:id` entries described x402 purchase-row reconciliation that no longer exists in those routes, the OpenClaw plugin entry described payment interception and a `DASHCLAW_X402_DEBUG` env var the plugin no longer has, the `/docs` page entry listed an x402 section `/docs` no longer contains, and a live-example annotation listed `x402_spend_limit` as an observed policy type.
- **`/docs` and `/downloads` stop labeling generic install commands with a version npm/PyPI don't serve** — `npm install dashclaw` / `pip install dashclaw` were labeled `v5.8.3` while both registries serve 5.6.2 (SDKs republish only on SDK source change, so the repo manifest routinely runs ahead). Install CTAs are now versionless; the registry links beside them are the live truth. The now-unused `NEXT_PUBLIC_SDK_NODE_VERSION` / `NEXT_PUBLIC_SDK_PYTHON_VERSION` wiring is removed from `next.config.js` with a comment recording why.
- **`/connect` structure comments matched to the rendered page** — five integration surfaces (not four; the OAuth custom connector was missing) and the framework-guide count no longer hardcoded (eleven cards and growing).
- **Restored the `## [5.8.2]` changelog header** that the v5.8.3 edit accidentally deleted, which had merged 5.8.2's entry into 5.8.3's section.

### Known remaining (human-gated or scheduled)

- npm/PyPI SDK republish and `@dashclaw/openclaw-plugin@1.5.0` publish remain gated on npm 2FA (human-held credential).
- The platform guide dataset's live-captured examples still date from a 4.67.0 instance (2026-07-07 snapshot); a full regeneration plus a stronger stale-surface gate is a scheduled follow-up, not attempted here.

## [5.8.3] — 2026-08-06

**OpenClaw integration drift closed — found by an OpenClaw agent following the public docs.** An outside-style setup run (MoltFire, via dashclaw.io) surfaced that the published `@dashclaw/openclaw-plugin` was two minors stale and the install instructions disagreed between surfaces. Platform-only release; no SDK source change.

### Fixed
- **`@dashclaw/openclaw-plugin` staged as 1.5.0 for republish** (publish itself is gated on npm 2FA, a human-held credential) — npm had been stuck at 1.2.5 since April while the repo advanced to 1.4.0; the 1.3.x/1.4.0 builds (session tracking, codex usage carry-forward, x402 which was later culled) were never published. 1.5.0 ships the post-cull plugin with the `dashclaw` dependency bumped `^4.2.0` → `^5.0.0` (all six SDK methods the plugin uses survive the v5 surface) and a rebuilt `dist/`.
- **`/connect` OpenClaw card taught the wrong install command** — `npm install @dashclaw/openclaw-plugin` where the guide, the package README, and OpenClaw itself use `openclaw plugins install @dashclaw/openclaw-plugin`. The hosted-onboarding OpenClaw snippet had the same drift plus a stale manual `openclaw.plugin.json` registration step; both now match the canonical CLI install.
- **Plugin README purged of culled features** — 14 x402 references (config table rows + the entire "x402 capability spend" section) described a subsystem removed from both the plugin and the server in the v5 cull, a dead `scripts/diagnose-cost-attribution.mjs` pointer, and stale example model ids. The README ships inside the npm package, so the drift was public.

## [5.8.2] — 2026-08-06

**F2 of the 2026-08-05 governance gap audit is closed — the classifier coverage backlog.** The audit's live repro: `find /c/Users/<user> -type f -delete` graded **review/5** (find is a read-only command — until it carries a delete predicate) and a canary actually deleted through the armed hook. Every listed shape is now covered on both classifiers, each pinned by a regression test. Platform + hooks; no SDK source change.

### Fixed

- **`find -delete` / `find -exec rm` grades destructive, with F5 path-awareness**: a regenerable-artifact root (`find node_modules -delete`) stays cleanup/45; a protected root (`find /c/Users/<user> -delete`) escalates to 100; plain `find` without a delete predicate stays read-only. Both classifiers (server evidence + hook intent).
- **Interpreter one-liner deletes grade security/80**: `python -c "import shutil; shutil.rmtree(…)"`, `node -e "fs.rmSync(…)"` and friends (`os.remove/unlink/rmdir`, `unlinkSync`, `rimraf`) — detected on the whole command *before* chain-splitting, because the quoted payload legitimately contains `;` and the splitter severed it from its interpreter. The hook already warned on these (inline escape hatch) and deferred escalation to the server; the server now actually escalates.
- **Raw block-device writes grade 100 and hard-block**: output redirect or `dd of=` onto `/dev/sd*`/`hd*`/`nvme*`/`mmcblk*`/`vd*`/`xvd*`/`disk*`/`\\.\PhysicalDrive*` — a disk destroyed without naming a file. New always-block validation in the hook, protected-target escalation in the server evidence classifier.
- **Already-covered audit shapes pinned so they cannot regress**: `git clean -xfd` (vcs_dangerous/70), `dd`, `mkfs`, `truncate -s 0` (destructive/80).

### Changed

- **Control-plane policy posture (instance state, operator-authorized).** The v5.8.1 `block` on `gp_c265caca34894d908c8aa384` fired on legitimate, gated hook maintenance during this release's work — the F5 lesson applies to control-plane rules too. Converted to `require_approval` keeping `ungrantable: true`: post-F1 no grant can clear it, so tampering still freezes, while hook maintenance routes through the one-click Approvals loop.
- **The script-then-execute composition case is an explicit future spec** (PostToolUse session-state correlation), the audit's one remaining item — recorded in the audit doc, not silently deferred.

## [5.8.1] — 2026-08-06

**F3 of the 2026-08-05 governance gap audit is closed — to the exact extent software can close it.** The finding: a governed agent was allowed to write over its own hook and harness settings, because any control that lives inside the blast radius of the thing it governs is advisory by construction. The software half of the fix is the control-plane hard block (converted live, verified: writes to `settings.json` and `dashclaw_pretool.py` now **block**, matched by an `ungrantable` policy). The other half is this release: the product now says the true thing everywhere it speaks, instead of implying a boundary it cannot provide. Docs + landing copy only; no SDK source change.

### Changed

- **The privilege boundary is stated plainly, product-wide.** The hook seam runs at the governed agent's own privilege level — it is a **seatbelt against accidents, not a cage against intent**. New canonical section + copy rule in `docs/architecture/enforcement-boundary.md`; README boundary note and a new "Not tamper-proof against the agent it governs" bullet; a threat-model section in `hooks/README.md` with the hardening ladder (control-plane block policy → read-only hook path → separate OS user → container); and the landing page's enforcement section drops "The agent cannot proceed past a block" for the honest line. Real isolation is a deployment property — container, separate OS user, or read-only hook path — and DashClaw's copy may no longer imply otherwise.
- **Control-plane policy converted (instance state, P1).** `gp_c265caca34894d908c8aa384` (protected_path over `**/.claude/settings.json`, `**/.claude/hooks/**`, hooks dir) is now `action: block` + `rules.ungrantable: true` — self-disable becomes a blocked, logged act that no grant can clear (v5.8.0 F1 machinery). Verified live with fresh guard probes.

## [5.8.0] — 2026-08-06

**F1 — the last critical finding of the 2026-08-05 governance gap audit — is closed.** An `allow_grant` could silently nullify a `require_approval` policy: grants had no expiry, no mandatory scope, and the evidence classifier's reclassification let a grant on one action type satisfy a policy written on another. On the audited instance every approval gate for the covered types had been inert since 2026-06-12 while `/policies` showed them active — an inert policy is worse than no policy, because it manufactures false confidence. Minor bump: the grant contract is deliberately narrower than before. Platform-only; no SDK source change.

### Added

- **Grants expire.** Every new grant is stamped with `rules.expires_at` at creation (30-day default, `GRANT_DEFAULT_TTL_DAYS`); legacy grants without one age out 30 days from their row's `created_at`. An expired grant is inert at evaluation time — no migration, no backfill, no perpetual permissions surviving from June.
- **`ungrantable` rules.** A gating policy with `rules.ungrantable: true` can never have its verdict cleared by any grant — the control-plane / catastrophe answer the audit asked for (F3's mitigation policy becomes effective the moment it carries this flag). The suppression attempt is still recorded as a warning on the decision.
- **`/policies` names its own inert rules.** A red banner above the posture cards lists every active gating rule an active grant currently nullifies, and the grant doing it (`app/lib/inert-policies.ts` → `PolicySummary.inert`). Verified rendered: it immediately surfaced a real pre-existing inert rule on the maintainer's own instance, not just the seeded test case.

### Fixed

- **No grant survives reclassification.** When the evidence fold swaps the evaluation onto a derived action type, `grantMatches` now fails closed — restrictive policies still match through the swap, permissive grants do not. This was the audit's live 3-layer repro (policy on `post`, act derived as `api`, grant on `api` → allowed); it now correctly requires approval, pinned by test.
- **Unscoped grants are rejected at creation** — both in `validatePolicy` and in the `/policies` review-feed `always_allow` verdict, which is where the audited instance's 19 blanket grants came from. A grant must name what it covers; "allow everything of this type forever" is a policy deletion wearing a grant's name.

## [5.7.4] — 2026-08-06

Third member of the post-enforce-flip false-positive family (after regenerable deletes and the `env` prefix), caught the same evening: `Start-Sleep` — a pause, the most side-effect-free command there is — classified under the PowerShell *verb* map's `start` → process management, which maps to action_type `security` (server base 80) and made a routine push-then-wait pipeline hard-block at 100. Hooks-only; no SDK source change.

### Fixed

- `Start-Sleep` joins the noun-decides cmdlet map as `readonly`; `Start-Process` / `Start-Service` keep their process-management grading. A wait can no longer be the highest-intent segment of a compound command.

## [5.7.3] — 2026-08-06

Predictive debiasing — **F6** of the 2026-08-05 governance gap audit, pulled forward after the enforce flip demonstrated the spiral live: the predictive layer scored partly from the guard's own prior verdicts, so each block raised the next evaluation's adjustment, and one false positive compounded into four within an hour. Platform-only; no SDK source change.

### Fixed

- The predictive layer's basis is now **executed behavior only**: both the statistical history query and the LLM amplifier's context exclude `blocked` / `pending_approval` / `cancelled` rows that never ran — a verdict is not conduct. Rows carrying the v5.7.0 `executed_despite` witness *did* run (past a gating verdict) and stay in the basis, explicitly labeled for the model.
- An agent whose history is verdict-only is now a cold start (`basis: no_history`, +5 prior, LLM skipped) instead of a "consistent high-risk pattern" — the exact anti-spiral property, pinned by test.
- The LLM amplifier's system prompt now states that risk numbers in the history are the governor's own prior heuristic scores, never evidence of misconduct.

## [5.7.2] — 2026-08-06

The first false positive of the enforce era, fixed the hour it fired. Minutes after this machine's observe→enforce flip, the v5.7.1 tag push hard-blocked at 100: the push used the standard credential-hygiene prefix (unsetting the token env vars so git picks the right auth), the evidence classifier graded that prefix as an environment *dump*, the declared/derived mismatch swap lifted the whole evaluation to `security`/80, the deployment goal pattern and the predictive layer (fat on this session's own canary blocks — audit F6's self-referential loop, observed live) topped it to 100. Platform-only; no SDK source change.

### Fixed

- The `env` launcher prefix is now transparent to the evidence classifier: `env -u NAME cmd` / `env VAR=x cmd` classifies as the command it runs — unsetting a credential before a push is hygiene, not exposure. A **bare** `env` / `printenv` (which dumps the environment) still grades as secret exposure, and dangerous patterns (force push, recursive deletes, protected-root targets) still catch straight through the prefix.

## [5.7.1] — 2026-08-06

Path-aware risk release — the fix for **F5** of the 2026-08-05 governance gap audit: the risk model was target-blind, so `rm -rf node_modules` scored an identical block/100 to `rm -rf /c/Users/<user>`. A safety system that hard-blocks routine artifact cleanup trains the operator to switch it off — this release removes that false-positive class *before* this machine's enforce flip, so enforcement arrives without alarm fatigue. Platform-only; no SDK source change.

### Fixed

- The server evidence classifier (`app/lib/guard/evidence.ts`) now grades recursive `rm` / `Remove-Item` by delete target, mirroring the hook classifier's conservative logic (which already existed client-side — the gap was the server re-escalating through the evidence fold): every target a bare, relative, well-known regenerable artifact name (`node_modules`, `.next`, `dist`, `coverage`, `__pycache__`, …) → `cleanup`/45; any glob, absolute path, or unknown name keeps `security`/80.
- Catastrophic-root targets (`~`, `/`, drive roots, user-profile/home roots, `C:\Windows`, `/etc`, …) escalate **+20 at the evidence layer** — the block band is reached on evidence alone, so a soft declaration cannot dodge it (W2/W3 preserved and strengthened).
- `Remove-Item -Recurse` is now visible to the evidence destructive branch at all (it previously matched nothing — the native Windows shell had declaration-only grading).
- Verified live against the audit's criteria: `rm -rf node_modules` → allow/50 (warn band via the hook flow); `rm -rf /c/Users/<user>`, `rm -rf ~`, `Remove-Item -Recurse -Force C:\Users\<user>` → block/100; enforce-mode hook end-to-end: cleanup exits 0, catastrophic exits 2.

## [5.7.0] — 2026-08-06

Enforcement-visibility release — the product fix for **F0** of the 2026-08-05 governance gap audit, which found `DASHCLAW_HOOK_MODE=observe` had silently disabled enforcement machine-wide while `/decisions` showed 153 blocks that read as healthy. The principle this release encodes: **a logged verdict is never presented as an enforced one.** Platform + hooks only; no SDK source change (registries stay at 5.6.2).

### Added

- `action_records.enforcement_mode` (drizzle/0066): every create path now persists the client's enforcement posture — the hook already stamped it on guard calls, but POST `/api/actions` dropped it, so an observe-mode blocked row was indistinguishable from an enforced one in the ledger.
- `action_records.executed_despite` (drizzle/0066) + PostToolUse witness: when an observe-mode block or approval gate does not stop the tool call, PreToolUse leaves `{"action_id", "unenforced_verdict"}` state and PostToolUse — whose firing is itself the proof of execution — stamps the row via a new isolated PATCH branch (status-gated, first-writer-wins, no action-id existence oracle). This is the durable, class-closing fix: the ledger now records what *executed*, not just what was *decided*.
- Red observe-mode banner on `/approvals` and `/decisions` (`ObserveModeBanner`): names the observe-mode agents, links the executed-anyway count, and states the exact fix (`DASHCLAW_HOOK_MODE=enforce` + session restart).
- Ledger chips: gated rows render **"Executed despite block/approval gate"** (error) when the witness stamp exists, or **"Logged, not enforced"** (warning) when the row was created under observe mode — never identically to an enforced block.
- New red `executed_despite_block` signal (24h window) alongside the `observe_mode` signal, which is now **red** instead of amber — a standing "nothing is enforced" posture is not a degradation-severity condition.
- `docs/architecture/enforcement-boundary.md` gains the "Observe mode must be loud, and execution is witnessed" section; hooks README and `.env.example` now warn that the hook's `.env` walk applies one observe override to every session using that hook install.

### Fixed

- The pretool hook discarded the body of HTTP-error responses, so the observe-mode block path never saw the `action_id` that POST `/api/actions` returns *inside its 403 response* — `create_action` now reads the error body for blocked creates, and the hook test mock answers 403 like the real route (a 200 mock is what masked this).
- `/api/actions` list responses now include `enforcement_mode` and `executed_despite` (the list SELECT uses an explicit column list; detail routes already returned them via `SELECT *`).
- `gov_observe_mode` doctor check: `fix: null` → a concrete fix (where the mode is read from, why the override is machine-wide, restart requirement, and how to verify with the liveness probe).

## [5.6.3] — 2026-07-29

Platform-only maintenance release — one day's vigil arc: dependency triage, plans-machinery hardening, and an adversarial security pass over its own diffs. No SDK source changes; the Node + Python SDKs are intentionally not republished (registries stay at 5.6.2).

### Security

- Deny-lift is now a SQL precondition: revoking a `denied` plan (lifting an operator's explicit no) carries the separation-of-duties permission inside `reviewPlan`'s UPDATE predicate, so a denial landing after the route's pre-read can no longer be lifted by its own submitter. `denyLiftAllowed` defaults fail-closed.
- The review route's SoD gates key on `raw_status`: the new derived `expired` presentation status had silently disarmed the `=== 'denied'` clauses for lapsed denials (found by the 2026-07-29 adversarial review of this release's own diffs — 0 critical/high, 1 medium, 4 low, all actionable findings fixed in the same session).
- Demo `/api/plans` entries answer non-GET with an explicit 403; fixtures are static and expose no org data.

### Fixed

- Malformed `?limit`/`?offset` query params (e.g. `limit=abc`) no longer 500 — seven list routes (guard, guard/decisions, actions, activity, pairings, messages, security/prompt-injection) clamp with `Number.isFinite` instead of passing NaN to the SQL LIMIT clause.
- Reviewed plans past `expires_at` now present as `expired` in the plan read paths, and status filters match the derived value (`?status=approved` excludes lapsed plans, `?status=expired` finds them). Enforcement paths continue to read `expires_at` directly.
- The demo `/approvals` page shows preflight plans (a pending plan with per-step preview verdicts and a live approved plan mid-run) instead of an empty card.
- The platform guide's hero count matches its own dataset (417 → 421), and the drift checker now tallies `meta.counts` against the dataset so the class cannot recur.
- `js-yaml` 4 → 5 (named-exports-only ESM); `@types/js-yaml` dropped (v5 bundles types).

### Changed

- New partial index `idx_plan_authorization_steps_deny_hash` (drizzle/0065) — the org-wide denial probe's hash branch is now an indexed lookup.
- Filtered bulk-delete SQL moved from `DELETE /api/actions` into the repository (`deleteActionsByFilter`), sharing one WHERE builder with the write-ahead audit's target read; route-SQL baseline tightened 28 → 25.
- Five react-hooks v7 compiler rules (purity, refs, static-components, immutability, preserve-manual-memoization) now run at error; all 8 real violations fixed (the recorded count of 191 predated the v5 cull).
- Root dependency `dashclaw` tracks 5.6.2; `@modelcontextprotocol/server` on stable 2.0.0; openai 7; jsdom 30 and TypeScript 7 declined with recorded reasons (Node 20 floor / typescript-eslint support).

## [5.6.2] — 2026-07-28

Containment hardening — closes every recorded follow-up from the v5.6.0 ship.

### Fixed
- **Co-installed hook instances no longer collide on the containment
  worktree.** Two DashClaw hook installations firing for the same harness
  session (e.g. global `~/.claude` hooks plus a project's local hooks) used to
  derive the same branch/worktree name; the second instance's
  `git worktree add` failed and its containment permanently interrupted. The
  hook now sends its instance discriminator (`containment_instance`,
  `sha256(base_url|agent_id)[:12]` — the same suffix that already namespaces
  its tempdir state files) on the guard payload, and the server folds it into
  the stamped ref: `dashclaw/contained-<session>-<instance>`, capped at 64
  chars so every existing ref-shape validator still matches. The hook's local
  fallback derives identically (parity-tested on both sides); an absent or
  invalid discriminator keeps the legacy derivation byte-for-byte.
- **`/approvals` no longer fires one artifact fetch per contained action on
  mount.** `GET /api/actions?containment_status=...` now enriches each row
  with batched evidence state from a single `DISTINCT ON` query —
  `containment_has_evidence` and `containment_evidence_ref` — so the
  Promote-gating check is in place with zero per-card requests and the full
  diff loads lazily on first expand. If enrichment ever degrades the card
  falls back to the previous eager fetch; the server-side
  `CONTAINMENT_NO_EVIDENCE` / `CONTAINMENT_REF_MISMATCH` gates remain
  authoritative.
- **Containment verdict responses now carry the same `action` shape on every
  path.** The re-issue path returned a 9-column status subset while
  first-promote/discard returned the full row; re-issue now re-fetches and
  returns the full row (`reissued: true` still marks it).

### Added
- **The `/explain` guard simulator can now produce `allow_contained`** — a
  "contain file-scoped work" policy toggle (only available alongside the
  approval policy, mirroring the real `contain_above` validator), a
  containable action type, and the "skew only tightens" explanation when a
  non-file-scoped action lands in the containment band and interrupts
  instead.
- `resolveContainment` org-mismatch regression test (the operator-side flip's
  WHERE gate), plus tests for server-ref adoption and malformed-server-ref
  fallback in the hook.

### Docs
- SDK JSDoc/docstring drift fixed in both SDKs: `containment.ref` on the
  guard response (added v5.6.1 but undocumented), the `reissued` flag on
  `resolveContainment`, and the new list-enrichment fields on
  `listContained`/`list_contained`. `docs/architecture/runtime-api.md`
  describes the instance-namespaced ref derivation.

No SDK *code* changed (doc comments only). Correction to this entry's first
published form: npm and PyPI both carry **5.6.0** (published 2026-07-28, which
discharged the tail that had been owed since v5.4.0) — only the optional
doc-comment republish at 5.6.2 remains.

## [5.6.1] — 2026-07-28

### Security
- **`containment_ref` is now stamped server-side at guard `?record=true` time**
  — the recorded follow-up from the v5.6.0 ship. The guard derives the merge
  target from the payload's `harness_session_id` (an exact TS mirror of the
  hook's branch-segment sanitization), stamps it on the contained action row
  at creation, and returns it in the response's `containment.ref`; the
  PreToolUse hook adopts the server's ref for its worktree branch (regex-
  validated, local derivation as fallback for older servers). The
  `awaiting_promotion` flip can only *fill* a missing ref on legacy rows —
  `setContainmentAwaiting` now prefers the row's existing ref and a client
  ref that conflicts with the server stamp fails the WHERE gate (`409`), so
  a containment flip carries no attacker-controllable merge target.

### Fixed
- `scripts/check-surface-budget.mjs` lost its decorative shebang, which
  intermittently broke the full vitest run (rolldown parse failure when the
  script is imported by its unit test). Invocation is unchanged
  (`npm run surface:check`).

## [5.6.0] — 2026-07-28

### Added
- **Containment Verdicts — risky-but-reversible work proceeds inside a
  worktree, and the operator ratifies a diff instead of blocking a run.**
  A fifth guard decision, `allow_contained`, sits between `warn` and
  `require_approval` on the severity ladder. A `risk_threshold` policy gains
  an optional `contain_above` band (integer, strictly below the interrupt
  threshold, only on `require_approval` policies): a score inside the band
  returns `allow_contained` when the server can prove the act is
  file-scoped, and `require_approval` when it cannot. The Claude Code
  PreToolUse hook redirects `Edit`/`Write`/`MultiEdit` into a per-session
  git worktree (`.dashclaw/contained/<session>` on branch
  `dashclaw/contained-<session>`) via `hookSpecificOutput.updatedInput`;
  `Bash` always takes an instructive deny. PostToolUse commits the staged
  work on the containment branch and uploads the cumulative diff as a
  `patch` artifact; the operator reviews that diff on **/approvals** and
  clicks **Promote** or **Discard**. Promotion mints a single-use,
  act-hash-bound, 15-minute operator grant for exactly
  `git merge --no-ff <ref>`, which `dashclaw contained apply` consumes —
  and re-issue is available from the decision detail page when the window
  lapses or a merge conflicts. Surface: +1 route, +2 Node / +2 Python SDK
  methods (`resolveContainment` / `listContained`, Node 39 / Python 59),
  +1 CLI command group (`dashclaw contained list|diff|apply`), migration
  0064. RFC `docs/rfcs/2026-07-06-containment-verdicts.md` (governed-autonomy
  program, feature 3 of 3 — completes the program).

### Security
- **Capability negotiation makes version skew tighten, never loosen.** A
  caller receives `allow_contained` only when it advertises
  `client_capabilities: ['allow_contained']`; every other caller — old
  hooks, both SDKs, the MCP server, direct API clients — receives
  `require_approval` in its place, with
  `risk_breakdown._containment.downgraded_to_interrupt` recording the
  substitution. Eligibility is enforced server-side and is not a hook
  courtesy: HTTP, SQL, payments and deploys are never containable, and a
  shell act qualifies only when the evidence classifier grades it clean
  file-ops with no network git subcommand.
- **Six adversarial findings were closed before this shipped.** A guard
  bypass where evidence-folding rewrote the `containment_promote` sentinel
  to `apply` and silently disabled the governed-merge rail; a promote path
  that would mint a pre-approved grant for `git merge --no-ff null` when no
  ref was recorded; a grant-laundering path where an agent-planted
  `containment_promote` row could receive a real operator signature on an
  arbitrary act (the lookup now binds agent, canonical act hash and
  approver, and the action type is reserved at creation); `allow_grant` and
  plan-step grants that could authorize a merge without the Promote click;
  a backstop that flipped an action to awaiting-promotion after the diff
  capture had actually failed; and unredacted file content in the uploaded
  diff (the existing hook-side scrubber now runs over it).
- **Promotion is bound to the evidence the operator actually read.** The
  promote path requires the newest `patch` artifact's recorded ref to equal
  the action's `containment_ref` (`409 CONTAINMENT_REF_MISMATCH`) and
  refuses to promote an action with no captured diff at all
  (`409 CONTAINMENT_NO_EVIDENCE`); the review card disables Promote in both
  cases while leaving Discard available. This closes the cross-agent flip in
  which one org-key holder redirects the merge target of another agent's
  contained action. It is **not** a defense against a fabricated artifact
  from a compromised hook or credential holder — that remains the
  pre-existing limit stated in
  `docs/architecture/enforcement-boundary.md`, and the follow-up that would
  remove the attacker-controllable target entirely is to stamp
  `containment_ref` server-side at guard record time.

## [5.5.0] — 2026-07-26

### Added
- **Scoped Delegation Constraints — a subagent's authority is now a
  provable subset of its parent's.** New guard policy type
  `delegation_constraint` (the 15th): risk ceiling, action-type
  allow/block lists, path scope (the same glob engine as
  `protected_path`), spawn depth, and an optional
  `require_verified_parent` hard mode — enforced server-side on every
  guard call from a composed `parent:child` identity. Fires ONLY on
  composed ids (zero behavior change for single-agent fleets); matching
  binds the id string itself, so an unpaired composed id is still
  constrained and the base-fallback identity lookup cannot defeat
  attenuation. Tighten-only by construction: the evaluator escalates to
  `require_approval` or `block`, never grants. Rides every existing
  policy rail (CRUD, YAML import, modes, simulate, contract view,
  /policies UI) — **no new tables, no new routes, no MCP changes**. The
  /policies builder seeds parent/child from OBSERVED composed identities
  (one-click prefill); the shield gallery gains a 10th shield (Subagent
  Constraint, risk > 60 escalates); the claude-code mode ships an
  observe-grade starter aligned to the mode's 85 interrupt line. SDK:
  `createDelegationConstraint` / `create_delegation_constraint` (Node 37
  / Python 57). Attenuation is enforced against the identity the caller
  asserts — combine with JWKS verification for a cryptographic claim
  (documented). RFC `docs/rfcs/2026-07-06-scoped-delegation-grants.md`
  (governed-autonomy program, feature 2 of 3).

## [5.4.0] — 2026-07-26

### Added
- **Preflight Plan Authorization — one review card instead of N mid-run
  interruptions.** An agent submits its intended plan (`POST /api/plans`,
  ordered steps with optional literal acts) before executing; every step is
  dry-run through the real guard pipeline side-effect-free
  (`GuardOptions.simulate`) and stored with its preview verdict; the
  operator reviews ONE card on /approvals — per-step approve/deny toggles,
  expandable redacted act views, goal-bound disclosure — and each approved
  step becomes a single-use, act-or-goal-bound, TTL-bound grant consumed
  atomically when the matching action evaluates to `require_approval`
  (`builtin:plan_grant` provenance on the decision). Explicitly denied
  steps hard-block matching actions org-wide for the plan's TTL
  (`builtin:plan_deny`); revocation is instant and click-driven (Live plans
  section). A plan grant never downgrades `block`, nothing auto-approves,
  and off-plan actions fall back to per-action governance unchanged.
  Surface: +2 routes, +5 Node / +5 Python SDK methods (`submitPlan` family),
  +2 MCP tools (`dashclaw_plan_submit`, `dashclaw_plan_status`) — THESIS
  surface-budget amendment 2026-07-26; RFC
  `docs/rfcs/2026-07-06-preflight-plan-authorization.md` (governed-autonomy
  program, feature 1 of 3).

### Security
- **Eight adversarial pre-ship sweeps hardened the grant machinery before
  it ever shipped.** Denials are fail-closed and unevadable by act mutation,
  action_type relabeling, identity renaming, or field omission (they bind
  the act org-wide, raise on hash OR goal, and fail to `require_approval`
  when the lookup errors); plan submission and review enforce separation of
  duties (`created_by`, migration 0063 — the submitting credential cannot
  approve, deny, or lift the denial of its own plan; principal-less rows
  are operator-only); the review card renders the redacted act so approvals
  are never blind; stored acts and preview reasons are redacted while
  hashes bind the original bytes; simulate mode provably skips persistence,
  events, grants, AND webhook side effects; abandoned post-deadline
  evaluations cannot burn single-use grants; caps are SQL-enforced with
  hard code ceilings (25 steps, 480-minute TTL, aged pending slots).

### Fixed
- **Homepage LiveDemo rows no longer count as agent traffic in analytics.**
  On session/trial-cookie-authenticated instances the homepage demo's
  "Evaluate" click writes a real `guard_decisions` row (by design — the
  visitor sees it on /decisions), but its preset agent ids were not
  synthetic-excluded, so the hosted funnel counted a marketing-widget click
  as an agent-door first action — discovered while resolving the v8.1/v8.6
  verdict's pinned `keyUsed = 0` question, and worth a same-day correction
  to the verdict itself (genuine stranger first actions: 1 of 2, browser
  door; ACTIVATION stands). The three preset ids (`analytics-agent`,
  `openai-deployer-1`, `rogue-agent`) are now exact entries in
  `SYNTHETIC_AGENT_LIKE_PATTERNS`/`_RE`, pinned by the drift test, which
  retroactively cleans every analytics surface without touching the ledger
  display.

## [5.3.1] — 2026-07-26

### Security
- **Dependabot triage across all five lockfiles — every runtime-reachable
  advisory closed.** The 16 idle days accumulated 24 alerts (1 critical,
  11 high). Fixed: `next-auth` → 4.24.15 (the critical), `next` → 16.2.12,
  `sharp` → 0.35.3 (override — next pins ^0.34), `dompurify`, `js-yaml`,
  `postcss` in the root; `tar` in `cli/`; `@hono/node-server` → 2.x in
  `mcp-server/` (override; its 71-test suite green, `npm audit` clean so the
  publish-time `verify` gate no longer trips); `fast-uri` in
  `media/remotion/`. Accepted residuals, both dev-only: the eslint tree's
  `brace-expansion` v1 DoS (no backport exists; the only fixed major can't
  run `eslint-config-next` yet) and `packages/openclaw-plugin`'s upstream
  `openclaw` exact pins (override floors are declared and take effect when
  npm/upstream cooperate; nothing from that dev host ships to consumers).
- **eslint 8 → 9 + eslint-config-next 15 → 16, flat config.** `.eslintrc.json`
  and `.eslintignore` become `eslint.config.mjs` at strict behavior parity:
  core-web-vitals only, dot-directories ignored, unused-directive reporting
  off, and react-hooks v7's six new compiler-era rules off (191 pre-existing
  sites — enabling them is a dedicated pass, not a dependency bump). Lint
  gate stays green with zero findings.

### Fixed
- **up-smoke Windows: fresh installs no longer compile better-sqlite3.** The
  platform declared `better-sqlite3` as a dependency since the initial commit
  but never imported it anywhere (documented in `docs/absorbed-projects.md`).
  On the Windows CI runner no prebuilt binary matched and node-gyp could not
  recognize Visual Studio 18, so every `dashclaw up` died at `npm install`.
  Removed the dependency and its stale lockfile node — `npm ci` now installs
  zero native-compile packages.
- **`dashclaw up` streams setup progress and kills a hung setup after 10
  minutes.** `runSetupScriptReal` previously ran the setup child via
  `spawnSync`, buffering all output until exit — a hung migration (the
  standing macOS CI failure) showed "Running setup" and then nothing for 20
  minutes. Setup stderr now streams through to the operator (and CI's up.log)
  line by line with API keys/passwords scrubbed, and a watchdog kills the
  child after 10 minutes reporting the last activity, e.g. the exact
  migration spinner frame that wedged. The up-smoke workflow redaction also
  drops any `oc_live_` line as a second layer.
- **/policies "Always allow" no longer dead-ends on a leftover inactive rule.**
  When an org already had a policy with the same generated name (e.g. a
  `[Grant] api` deactivated in an earlier cleanup), re-granting from the
  triage inbox failed every time with 409 "A rule for this shape already
  exists" — while the inactive rule kept the warns firing and the group stuck
  in "Needs your call". The verdict route now revives the same-named policy in
  place (reactivates it with the fresh rules) for both Always allow and
  Tighten; the 409 remains only for the pathological can't-find-it case.

## [5.3.0] — 2026-07-10

Retired the livingcode subsystem. The Python "organism" that watched the repo
(shape snapshots, backlog proposals, the generated dashboard) never earned its
keep — its scheduled routines opened instantly-conflicting PRs daily, its
snapshot skill rotted between refreshes, and nothing a human used depended on
it. This release removes it end to end and keeps only the parts that were
genuinely load-bearing.

### Removed
- The `livingcode/` Python package (collectors, emitters, orchestrator, immune
  system, heartbeat, planner, ~40 modules + tests), its `.organism/` state
  directory, `organism.json`, and the three organism architecture docs.
- The generated livingcode dashboard (`public/livingcode/index.html`) and the
  `/proof` page's link to it.
- The `dashclaw-platform-intelligence` skill everywhere: the website download
  (zip + source dir), the plugin mirrors (Claude Code / Codex / Hermes), the
  `.agents`/`.hermes`/`.claude` copies, the `/downloads` card, the `/docs`
  section, and the `/self-host` skill CTA + section. The skill was emitted by
  livingcode and could not stay current without it. The `dashclaw-governance`
  skill (hand-authored) remains the plugin's skill.
- Doctor `shape` and `drift` check categories, `app/lib/doctor/generated/`
  (shape.json + generated checks), `app/lib/doctor/shape.mjs`, and the
  `regenerate_artifacts` fix. The auth/deployment/governance checks that looked
  table/env names up via the shape now use the literal names; every DB-backed
  block already fail-safes through its own try/catch. (CLI 0.9.1 drops the two
  category labels; MCP server 3.0.2 repoints its route-drift check at
  `docs/api-inventory.json` and drops the livingcode-emitted
  `routes-inventory.generated.json`.)
- The `organism` and `livingcode` protected-path groups from the guard's
  default `protected_path` matcher (their paths no longer exist).
- `npm run livingcode:refresh` and `scripts/livingcode-refresh.mjs`.

### Added
- `npm run bundles:refresh` (`scripts/refresh-bundles.mjs`) — the surviving
  10% of the old refresh script: mirrors the hand-authored governance skill and
  canonical `hooks/` scripts into `plugins/dashclaw/` and rebuilds the three
  download bundles (`dashclaw-governance.zip`, `dashclaw-governance-plugin.zip`,
  `dashclaw-claude-code-hooks.zip`) with the same hash-manifest idempotence.
  Pre-commit and living-merge's regenerate-all now run this instead; no Python
  required.

### Fixed
- `/setup`'s "validate integration" Node command pointed at the retired
  skill's `validate-integration.mjs`; it is now a self-contained `dashclaw`
  SDK ping snippet.
- The living-merge manifest, `.gitattributes` managed block, pre-commit
  staging list, platform guide dataset, and the doc-count gates no longer
  reference retired artifacts.

## [5.2.0] — 2026-07-10

The production-readiness pass: an external review (ChatGPT "work" mode) audited
the repo for production launch and every confirmed finding was fixed in one
overnight run. CI on main was red for 4 consecutive pushes when the night
started; it ends with a single authoritative release gate and the THESIS
first-run promise actually true.

### Added

- **The catastrophe pack seeds itself.** Every newly created self-hosted org
  gets the three-policy catastrophe-only pack (block mass-destructive
  operations at risk 100, hold secret-file writes for approval, warn-only
  runaway rate limit) at first migrate — the org-birth gate (`INSERT …
  RETURNING id`) means re-runs never duplicate and operator deletions are
  never resurrected. Existing orgs are untouched; the pack is one click away
  at /policies → Import. Proven live: fresh-DB seed, idempotent re-run,
  deletion-respect, and the rendered /policies ledger.
- **`dashclaw install claude` now installs protection, not observation**
  (CLI 0.9.0): fresh installs default to `DASHCLAW_HOOK_MODE=enforce`
  (`--observe` opts out), re-installs preserve the operator's chosen mode —
  fixing a long-standing clobber-to-observe bug — the SessionStart
  enforcement-liveness probe is wired automatically (closing the v8.2 scope
  cut), fresh installs get a 120s approval window so a human can actually
  click approve, and an honesty preflight warns when the target instance has
  zero policies instead of claiming protection.
- **One authoritative release gate.** `npm run release:check` (alias:
  `production:check`) now runs all 19 static gates CI runs — including the six
  it previously skipped (doc-counts --strict, surface, guide-drift,
  security-scan, both SDK integration suites) — plus a `--live` flag for the
  server suite, and writes a machine-readable `release-check-report.json`.
- **policy-smoke proves held → approved → resumed live** (RS1): a
  protected-path Write is held with an action id, approved via the API, and
  verified resumable — running first, against the pristine pack-only state.
- up-smoke runs on every push to main and every `v*` tag, extends its health
  budget to 20 minutes, and captures the backgrounded `up` output as a
  redacted failure artifact (previously: zero diagnostics, 5/5 failures blind).
- The launch film plays on the landing page, with the full marketing asset
  suite (demo, social clips, OG refresh, README hero) from the same run.

### Fixed

- **Guard: restrictive policies match the declared action type through the
  evidence-mismatch swap.** Declaring one action type while attaching act
  evidence that derived another could silently dodge a `require_approval` /
  `block` / `non_fabrication` rule — attaching *more* evidence weakened
  governance. Restrictive rules now also match the caller's declared type;
  permissive surfaces (allow grants, approval reuse) deliberately stay on the
  effective type so a declaration can't widen a grant. Found live.
- **One cause of the silent cross-platform `dashclaw up` hang.** The vendored
  embedded-postgres `start()` drains stderr but never stdout; once Postgres
  wrote ~64KB the kernel blocked the server mid-write and every setup
  migration hung forever. One-line stdout drain on the POSIX path (CLI 0.9.0).
  **Honest status:** the up-smoke workflow on this release still fails on the
  Windows and macOS CI runners at the same "wait for health" step (Linux
  passes) — `up` output now shows setup starting but its child output is
  buffered by `spawnSync` until completion, so the remaining cause is still
  under investigation via the fresh-Windows drill. Tracked in the maintainer
  log (2026-07-10).
- **Main was red for 4 pushes** — two independent v5.1.0 release misses:
  `contracts/sdk/release-plan.json` still said 5.0.2, and the platform guide
  never learned the six Team Tasks routes. Both fixed; this release also
  backfills the missing v5.1.0 changelog entry, tag, and GitHub Release.
- Scheduled ops can no longer hang or skip silently: the five curl-based cron
  workflows get `--max-time 30 --connect-timeout 10`, job-level
  `timeout-minutes: 5`, and a `::warning::` annotation when secrets are
  missing (the July 9 live-canary/jti-sweep 15-minute hangs were this class);
  live-canary's report call aborts after 15s and fails loudly.
- `check-hosted-ready.mjs` hard-fails on missing `NEXTAUTH_SECRET`,
  `NEXTAUTH_URL`, `ENCRYPTION_KEY` (exact 32-byte validation), and a sign-in
  provider — previously a hosted deploy could "pass readiness" and boot with
  no way to sign in and a crashing secrets subsystem. Redis stays a loud
  warning (the runtime genuinely degrades gracefully).
- docker-compose.yml is database-only: the `app` service hardcoded placeholder
  secrets that overrode `.env.local`, omitted `ENCRYPTION_KEY`, and silently
  built the demo-mode image. Every doc already used `docker compose up -d db`.
- The Mission Control ghost is fully retired (96 files): the PWA webmanifest
  shortcut pointed at the dead `/mission-control` route, docs claimed `/login`
  redirects there, MCP tool descriptions shipped the dead name to every
  client (mcp-server 3.0.1), and 40+ docs/UI/example references now say
  Approvals (`/approvals`).
- `docs/ops/production-readiness.md` regenerated (it still described the
  pre-v5 254-route repo); stale SDK counts (28 → 31) and the fictional
  `dashclaw://capabilities` MCP resource corrected at their sources.
- Assumptions page: demo fixtures key on `assumption_id`; Card keys and
  multi-select now use the canonical entity id (was a fatal duplicate-key
  warning caught by the new smoke gate).
- `/setup` no longer renders a lint-suppression marker in the enforcement
  liveness copy.

### Security

- Node SDK `_request()` gains a default 30s timeout (`timeoutMs` constructor
  option, `ETIMEDOUT` error code) — a hung server can no longer hang every
  SDK consumer. Ships to npm with this release.
- up-smoke failure artifacts redact the per-run admin password and single-use
  login URL before upload (security-review finding; public repo).
- `main` is protected by a repository ruleset: force-pushes and branch
  deletion are blocked (no bypass actors). Direct pushes remain allowed by
  design — local gates + CI stay the merge discipline.

### Changed

- Repo hygiene: 10 permanently-stale bot PRs closed (7 conflicting livingcode
  refreshes, 3 outdated weekly digests).

## [5.1.0] — 2026-07-09

Backfilled entry — this release shipped without a changelog entry, tag, or
GitHub Release (repaired in 5.2.0).

### Added

- **Team Tasks surface**: `/tasks` page, `dashclaw_task_create` /
  `dashclaw_task_update` / `dashclaw_task_event` MCP tools (+3, now 15), Node
  SDK `createTeamTask` / `appendTeamTaskEvent` / `updateTeamTask` (+3, now
  31), and six `/api/team-tasks` routes (now 120 routes).

### Fixed

- **The marketing demo no longer dead-ends on six surfaces.** The demo
  middleware's route table never learned the endpoints newer pages call, so
  on dashclaw.io: /policies died on `/api/policies/summary` (403 → "Couldn't
  load your policy posture"), /calibration showed "Failed to load: HTTP 403"
  (`/api/calibration/controller`), Doctor rendered the raw "Demo mode:
  endpoint disabled" fallback, the /policies triage queues
  (`proposals`/`tightening`/`loosening`/`calibration/proposals`) flagged as
  failed, /assumptions deliberately skipped fetching in demo (blank page even
  though fixtures existed), /identities locked anonymous demo visitors out
  behind "Admin access required", and clicking a session action landed on
  "decision not found" (`ar_demo_sess_*` ids existed only in the session
  ledger, never in the action-detail handler). All seven now serve
  deterministic fixtures: a posture summary consistent with the demo policy
  set, a shadow-mode calibration controller with a 40-event adjudication
  history, a read-only doctor snapshot with an honest "demo instance" warn,
  session actions that resolve as decision replays, and a read-only
  identities view. Demo policies now answer in guard_policies column shape
  (`policy_type`/`rules`), and the two fixture policies carrying retired
  types (`semantic_content`, `cost_ceiling`) became real ones
  (`non_fabrication`, `protected_path`) so the ledger stops branding demo
  rows RETIRED. /setup gained a `loading.tsx` so its seconds-long server
  render (readiness + canary) shows progress instead of a dead click.
  Regression-pinned in `demo-gap-fixtures.test.ts`. Demo-only — no live
  API behavior changed; SDKs are not republished.
- **Demo /setup renders inside the app shell, and the policies inbox no longer
  wedges on skeletons.** Follow-ups from the sweep above: demo visitors are
  anonymous, so /setup fell into its standalone public shell — sidebar gone;
  it now mirrors the middleware's demo rule (explicit `DASHCLAW_MODE=demo`,
  or the demo cookie on a marketing host) and renders in the app shell.
  And the "Needs your call" inbox dereferences queue-payload fields
  synchronously after `Promise.allSettled` (`payload.policies.length`), so
  the sweep's minimal `{ proposals: [] }` fixtures threw mid-load and left
  the section loading forever — the queue fixtures now carry every field the
  typed clients declare, pinned by a payload-shape regression test.

## [5.0.2] — 2026-07-07

### Fixed

- **Workspace import is idempotent against same-name policies again.** A
  bundle's guard policy arrives under a foreign id, so `ON CONFLICT (id)`
  never fired when the target org already had that policy under its own id —
  the insert died on `guard_policies_org_name_unique` (500, `23505`). The
  exact case every hosted-trial graduation hits: both orgs carry the default
  policy pack. The insert now also guards on the org-scoped natural key
  (`org_id, name`) and skips such rows. Found live by `drill:hosted` the same
  evening v5.0.1 shipped; proven fixed by a 6/6 re-run. Platform-only —
  SDKs are not republished.
- **The fresh-Windows drill launcher can now read its own verdict.**
  PowerShell writes `drill-result.json` with a UTF-8 BOM; the launcher's
  `JSON.parse` rejected it, the mid-write retry loop swallowed the error, and
  a drill whose sandbox side *passed* still "timed out" after 40 minutes. The
  launcher strips the BOM before parsing. (`scripts/drills/fresh-windows.mjs`)

## [5.0.1] — 2026-07-07

**First-run sign-in: `npx dashclaw up` now ends with a browser that is already
signed in — and the admin password is actually printed.**

### Fixed

- **The invisible admin password.** `setup.mjs` prints the first admin password
  once to stderr, but the `up` orchestrator pipes (and on success discards)
  that stream — so on every fresh install the password was written to
  `.env.local` and *never shown*. The CLI now prints it itself:
  `[ok] Dashboard admin password: …   (also saved to <appDir>/.env.local)`.
  (@dashclaw/cli 0.8.1)
- **A failed Claude Code hooks install no longer kills the sign-in tail.**
  Found by tonight's baseline fresh-Windows drill: a factory-fresh machine has
  no Python, `installClaude` threw, and `up` died after the server was healthy
  but *before* opening the browser or printing `Done.` The connect step now
  fails loudly but non-fatally, skips its checkpoint so the next `dashclaw up`
  retries it, and the run continues to the sign-in step. (@dashclaw/cli 0.8.2)

### Added

- **One-time browser sign-in (OTT).** Before starting the server, the CLI
  mints a single-use `DASHCLAW_LOGIN_OTT` (15-minute expiry) into the app's
  `.env.local`; the opened browser hits `/login?ott=…` and lands signed in,
  redirecting on to `/setup`. Consumed server-side by `POST /api/auth/local`;
  with `--no-browser` the sign-in link is printed instead. Falls back cleanly
  to `/setup` + password entry when minting fails or the platform predates the
  route. (`app/api/auth/local`, `app/login`, @dashclaw/cli 0.8.1)

Both SDKs republish at 5.0.1 (small real source deltas from the post-cull
cleanup `fe7ef21b`); the plugin bundle stays at 3.0.0.

## [5.0.0] — 2026-07-07

**The cull. DashClaw becomes exactly one product: the fail-closed approval layer
for unattended coding agents — and nothing else.**

This is the major break the new canonical product thesis
([`THESIS.md`](THESIS.md)) demands. DashClaw is now one loop —
**intercept → decide → approve → prove** — plus the surfaces that directly
support it (auth/keys, setup, health). Every surface that was not on that loop,
or scaffolding for a different product wearing the same name (the agent
platform), was removed. This is also the version at which the deprecated
`dashclaw/legacy` Node SDK subpath was promised to disappear — and it does.

Nothing is irreversible. Every removed surface is **recoverable by SHA** (git
history intact, no rewrites) via the kill ledger, and **no destructive database
migration ships** — retired tables stay physically in place.

### The cull, by the numbers (verified live at the release candidate)

| Surface | Before (4.76.0) | After (5.0.0) |
|---|---|---|
| API routes (canonical inventory) | 337 | 116 |
| App pages | 95 | 46 |
| MCP tools | 33 | 12 |
| MCP resources | 6 | 3 |
| Node SDK methods | 149 | 28 |
| Python SDK methods | 234 | 51 |
| CLI commands | 21 | 13 |
| Guard policy types | 17 | 14 |

221 route files, 49 pages, and ~1,100 tracked files removed across 19 waves.

### Removed (see the kill ledger for the exhaustive per-surface list)

The agent-platform tier: fleet/observability/dashboard/posture, team/RBAC,
workflows/work-orders/swarm, the prompts library, knowledge/RAG (pgvector),
learning + behavior learning + policy-coach, model-strategies/BYOK routing,
scoring + evaluations, code-sessions/optimal-files/skill-scan, messages/threads/
handoffs/open-loops, reputation/leaderboard + the routing engine, the drift
engine, the compliance cockpit, x402/FinOps/billing/plan-quota, managed secrets,
the status-widget PWA, the capability-registry CRUD/UI, the MCP server's absorbed
provider-tool fork (Stripe/Vercel/Neon/Twilio/Namecheap/Supabase/Sentry/… ~9k
lines), and the deprecated `dashclaw/legacy` SDK subpath + Python `[langchain]`
extra. Guard policy types `semantic_check`, `behavioral_anomaly`, and
`x402_spend_limit` are gone. `app/api/_archive` (48 runtime-dead routes) deleted
outright.

### Kept, folded, or demoted

- **The loop survives whole:** guard/policy/risk/calibration, the tri-runtime
  hooks (fail-closed, exit-2 on block), the OpenClaw gateway, `dashclaw_invoke`,
  action recording, the Approvals inbox, signed Ed25519 receipts + JWKS export,
  and the enforcement-liveness probe (re-homed onto SessionStart).
- **Compliance signing folds into Prove:** `/api/artifacts/evidence-bundle` now
  signs via `app/lib/integrity/bundle`; `/api/integrity/{jwks,verify}` stay.
- **Calibration ships on** in its constitutional mode (loosening is a human-
  ratified proposal in `/policies`).
- **Demoted off the front door:** the hosted trial (now the secondary "see the
  inbox without deploying" door, graduation/export intact), `/proof` +
  self-governance, and the `dashclaw_invoke` capability seam (inert-by-default,
  no in-product create path post-cull).

### The anti-regrowth brake

A mechanical surface-budget gate now ships: `npm run surface:check`
(`scripts/check-surface-budget.mjs`, `contracts/surface-budget.json`), wired into
CI. It fails the build if any governed surface exceeds its v5.0.0 ceiling unless
the same commit amends THESIS.md with a written reason. The 2026-03 purge regrew
in four months because its promised gate never shipped; this one did.

### Migration

Existing installs keep working against the surviving governance core. Removed SDK
methods, MCP tools, and route groups map to "out of scope per the thesis" (with
governance-core replacements where they exist) in the migration notes:
[`docs/releases/v5-migration.md`](docs/releases/v5-migration.md). The exhaustive
recoverable-by-SHA record is the kill ledger:
[`docs/releases/2026-07-07-v5-kill-ledger.md`](docs/releases/2026-07-07-v5-kill-ledger.md).

The `dashclaw` plugin bundle bumps to **3.0.0** (breaking hook changes: the
session digest is removed, the liveness probe re-homed, the code-session reporter
deleted — re-install hooks via `dashclaw install`). The `@dashclaw/cli` bumps to
**0.8.0** (8 commands removed). Platform + both SDKs share **5.0.0**.

## [4.76.0] — 2026-07-06

Entry-path drills: both doors proven on repeat (roadmap v8.3). Three
consecutive pre-launch sweeps found a flagship entry path broken, each caught
by a one-off manual effort. This turns those efforts into repeatable,
one-command, machine-readable drills that exercise the DISTRIBUTION path
(`npx dashclaw up` resolving the published CLI + release tarball) on
factory-fresh machines — the class CI's from-source `up-smoke` cannot catch.

### Added

- **`npm run drill:fresh-linux`** — owned-instance door on a disposable
  `node:20` container: `dashclaw up` → embedded Postgres → health → first
  governed action. `--as-root` models a fresh root VPS. **Proven green live**
  this ship (health 200, action 201, guard allow).
- **`npm run drill:fresh-windows`** — owned-instance door on a factory-fresh
  Windows image via Windows Sandbox, fully automated (`drill.ps1` at logon,
  host launcher polls a shared-folder result). The kept successor to the
  interactive `SandboxShared` harness.
- **`npm run drill:hosted`** — stranger door against the live hosted instance:
  mint → key works → first governed action → export → import into an owned
  instance → teardown. **Proven 6/6 live** against a local hosted-mode build;
  the seeded wrong-token run fails closed as expected. This is the drill that
  would have caught the missing hosted import route (v7.2) the day it lagged.
- **Hosted drill-mint token** (`app/lib/hosted/drill-mint.ts`): an
  operator-held `HOSTED_DRILL_TOKEN` (timing-safe, ≥24 chars, unset = no
  bypass) substitutes for Turnstile on mint so the stranger drill can run
  scriptably. Drill mints are **force-labeled `source='drill'`** and excluded
  from the reach cohort read; the `'drill'` label is reserved server-side so a
  normal mint cannot self-select into the excluded bucket (v8.3 security
  review). Rate limiting unchanged.
- `--cli @dashclaw/cli@<old>` reproduces historic break classes (`@0.7.2` =
  Windows VC++ runtime; `@0.7.1` = frozen-version missing import route).

### Fixed

- **`@dashclaw/cli` 0.7.6**: `dashclaw up --db embedded` as **root on POSIX**
  (a common fresh-VPS shape) failed — embedded Postgres refuses root and the
  CLI didn't set the `createPostgresUser` escape hatch. `rootPostgresOptions()`
  sets it when running as root (no-op on Windows / non-root). Caught live by
  the first `drill:fresh-linux --as-root` run.

### Notes

- macOS has no maintainer-executable fresh-machine drill (no VM on the
  maintainer host) — a recorded, deliberate gap.
- The live-hosted.dashclaw.io stranger run is gated on an operator setting (and
  rotating) `HOSTED_DRILL_TOKEN` on the hosted deploy env.
- Spec + acceptance evidence:
  `docs/superpowers/specs/2026-07-06-entry-path-drills-v83.md`.

## [4.75.0] — 2026-07-06

Enforcement liveness: the governor proves itself awake (roadmap v8.2). The
failure this attacks is v4.72.1's — a hook timeout misconfig cancelled the
pretool hook on every call, cancellation is fail-open, and the decision
ledger kept looking perfectly healthy while every block silently stopped
enforcing. The only detector that fired was the owner asking "how were you
able to write to those files?". That question is now an instrument the
system runs against itself.

### Added

- **Enforcement-liveness probe** (`hooks/enforcement_liveness_probe.py`,
  `npm run liveness:probe`): drives a synthetic held action — a `Write` to a
  probe-owned `.env` witness path, as the synthetic agent
  `smoke-liveness-probe` — through the real, unmodified PreToolUse hook
  under harness-faithful semantics (`timeout` is seconds; seconds×1000 past
  int32 overflows the harness timer and cancels the hook fail-open; exit 2
  blocks, everything else proceeds). The verdict comes from **observing
  whether the action executed** — the witness file — never from reading the
  decision ledger, because the ledger is exactly what lied in v4.72.1.
  Verdicts: `held`, `executed` (the v4.72.1 class), `unprovable` (no holding
  policy / observe mode / hook missing or hung — rendered broken, because
  enforcement you cannot prove is not enforcement).
- **Per-session cadence with zero new infrastructure**: the SessionStart
  digest hook spawns the probe detached at most once per 12h (marker
  throttle; `DASHCLAW_LIVENESS_PROBE_DISABLED=1` kill switch). The probe
  file is managed by `install-hooks` and ships in the CLI hook bundle.
- **`GET`/`POST /api/enforcement-liveness`** + `enforcement_liveness_runs`
  (drizzle `0060`): probe verdicts in their own table — never
  `action_records`/`guard_decisions` (live-canary precedent) — with 30-day
  retention pruned on insert. GET returns the derived state.
- **Holding / stale / broken surfaces**: `/setup#enforcement-liveness` card
  and a Mission Control Posture Scorecard row, both derived from one shared
  function (`app/lib/enforcement-liveness.ts`, 24h staleness window). A
  probe that silently stops running renders **stale, never green** — a
  silent probe is itself the v4.72.1 failure shape. Broken/stale also land
  as posture findings (broken = critical).
- **The seeded regression**: the exact v4.72.1 config (`timeout: 3600000`)
  is pinned by `test_seeded_v4721_timeout_yields_executed` and was driven
  live against a local prod build — verdict `executed`, surface red, fix
  instruction named. The healthy path was proven the same day on the
  governing instance: verdict `held` through the real hook and three real
  policies in ~1s.

### Notes

- Probe guard rows are synthetic (`smoke-` prefix) and excluded from every
  aggregate (posture, /proof, calibration mining, funnel, coverage,
  tightening/loosening evidence); the raw ledger keeps the labeled row as an
  audit trail, and approval-wait probes cancel their pending approval in
  teardown.
- Spec + acceptance evidence:
  `docs/superpowers/specs/2026-07-06-enforcement-liveness-v82.md`.
- **`dashclaw` plugin 2.16.0**: hook bundle gains the probe +
  session-digest auto-spawn. **`@dashclaw/cli` 0.7.5**: `dashclaw install
  claude` ships the probe as an optional bundle file (older hosted bundles
  keep installing cleanly).

## [4.74.0] — 2026-07-06

The calibrated interruption controller: DashClaw's first adaptive enforcement
component with a provable guarantee, plus the mathematical foundation document
for the whole governance core. The failure it attacks is the one that gets
governance switched off — interruptions that are wrong too often.

### Added

- **Calibrated interruption controller** (`app/lib/guard/calibration.ts`,
  default **off**, shadow-mode first per the charter). Set a target
  false-interruption rate α on `/calibration`; an online adaptive-conformal
  threshold θ learns from your approve/deny verdicts on interruptions and
  holds the labeled false-interruption rate at α with a **distribution-free,
  drift-proof bound** (Theorem 1 in the theory doc; pinned empirically by
  golden-vector-seeded tests including an induced mid-stream drift scenario).
  Per-agent **e-process alarms** (test supermartingale + Ville's inequality)
  escalate a misbehaving agent the moment cumulative denial evidence crosses
  the threshold, with false-alarm probability ≤ 5% at every stopping time.
- **Charter-compliant by construction**: shadow mode only records what the
  calibrated threshold would do (a `_calibration` sibling on every persisted
  decision); active mode is **tighten-only** — it raises `allow`/`warn` to
  `require_approval` and structurally cannot downgrade anything or touch
  `block`; loosening evidence routes to the existing human-ratified tuning /
  loosening proposal rails on `/policies`. Activation is an admin click,
  audit-logged.
- **Feedback loop wired to real adjudications**: approve → benign label,
  deny → dangerous label, expiry → no label (selective labeling handled, not
  assumed). Ingestion rides the approval routes best-effort (single + bulk),
  every consumed label lands in the new `guard_calibration_events` audit
  ledger, and controller state persists per org in `guard_calibration_state`
  (drizzle/0059; missing-table tolerant for pre-migration installs).
- **Operator surface `/calibration`** (Govern nav): mode control with a
  two-step active confirm, target-rate input, θ-vs-policy and observed-vs-
  target trends, standing agent alarms with one-click reset, and the
  adjudication ledger. Admin API: `GET/POST /api/calibration/controller`.
- **`docs/architecture/governance-core-theory.md`** — the governance core on
  a rigorous mathematical footing: the calibrated-interruption theorems with
  proof sketches and honest limits; the decision lattice formalized; the five
  charter invariants as temporal properties checked against the code (two
  hygiene findings reported); the tamper-evident ledger design (accepted,
  deferred); the algebraic-effects reading of the enforcement boundary; and
  explicit verdicts where machinery does not pay for itself.

### Performance

- Hot-path cost: controller **off adds zero queries** (settings ride the
  existing cached read; pinned by the guard query-budget tests);
  shadow/active adds one cached state read per org per 30s. The calibration
  phase measures 0ms at p50/p95/max in the persisted `_timings` ledger, and
  an interleaved main-vs-branch bench showed no regression attributable to
  this change.

## [4.73.1] — 2026-07-06

Fresh-Windows first-run fixes, all found by running `npx dashclaw up` in a
factory-clean Windows Sandbox. The install now completes end to end on a
machine with nothing on it; three platform bugs and a UX dead end fell out.

### Fixed
- **Migrations no longer hard-fail on non-UTF8 databases.** initdb on Windows
  inherits the OS locale, so fresh embedded clusters were WIN1252-encoded —
  and the UTF-8 arrows (`→`) in drizzle migration *comments* have no WIN1252
  equivalent, so Postgres rejected the statement (22P05) and `auto-migrate`
  died at the first one, early in the chain. All three migration executors
  (`scripts/auto-migrate.mjs`, `POST /api/setup/migrate`, the doctor migrate
  fix) now share `app/lib/setup/sql-statements.mjs`, which strips full-line
  SQL comments ($$-body-aware) before statements reach the server, plus a
  vitest guard that the stripped chain is 100% ASCII. The one non-ASCII
  character inside a string literal (drizzle/0005) is now a plain hyphen.
- **A failed core schema migration is now fatal in setup.** `setup.mjs`
  previously warned and continued when `auto-migrate` failed; the legacy
  migrate scripts then produced a bootable but *partial* schema (missing
  `live_canary_runs`, `guard_decisions.agent_name`, and everything after the
  failure point) that passed the core-tables readiness check and failed at
  runtime in confusing ways. Setup now reports `ok:false` and exits non-zero,
  so `npx dashclaw up` surfaces the real error instead of checkpointing a
  broken install as done.
- **`/setup` is no longer a dead end.** The post-install landing page (what
  `dashclaw up` opens) had no navigation into the product. It now carries an
  instance header — logo plus Mission Control / Decisions / Connect /
  Settings / Docs links — and two entry CTAs ("Open Mission Control",
  "Connect an agent"). Still fully server-rendered and pre-auth, so it keeps
  working when the database is down.

### `@dashclaw/cli` 0.7.4 (ships separately via `cd cli && npm publish`)
- **Embedded Postgres works from elevated (admin) shells** — the norm in
  Windows Sandbox and admin terminals. `postgres.exe` refuses an admin token;
  the server lifecycle on Windows now goes through `pg_ctl`, which creates
  the restricted token PostgreSQL requires. A detached server left running by
  a previous `up` is detected (`pg_ctl status`) and reused on its saved port,
  and `dashclaw down` stops it.
- **Embedded clusters are created UTF-8** (`initdb --encoding=UTF8
  --no-locale`) regardless of host locale — the other half of the WIN1252
  fix, and enough on its own to make the existing v4.73.0 tarball migrate
  cleanly.
- **The Microsoft VC++ runtime is auto-installed** when missing (fresh
  Windows lacks it; the Postgres binaries link against it). One-time ~25 MB
  download from microsoft.com, elevation via the Windows UAC consent dialog;
  the manual-install message remains as the fallback when the install fails.
- **Resumed installs no longer re-run initdb** on an existing data directory
  (it refuses non-empty dirs — every resumed embedded install would have
  failed, on all platforms).
- Embedded-postgres failures that reject with no error value no longer crash
  the error formatter ("Cannot read properties of undefined") and eat the
  real message; the DB picker menu no longer prints twice on Windows; the
  Node DEP0190 deprecation warning no longer appears mid-prompt.

## [4.73.0] — 2026-07-06

Two work streams in one release: a measured performance pass over the
governed-action hot path, and a silent-failure hardening sweep across every
client surface (SDKs, hooks, MCP server, CLI, doctor).

### Performance
- **Guard hot-path latency: the single hook call (`POST /api/guard?record=true`)
  dropped p50 221→124ms / p95 263→185ms (−44% / −30%) on a 10ms-RTT database**
  (local-Postgres self-host: ~7ms p50). The cost was sequential DB round trips,
  not any single query; independent reads now overlap:
  - the record path's gate reads (idempotency row, org plan, quota meter) run
    concurrently with the replay lookup and the evaluation;
  - the learning-context read overlaps the mandatory audit persist (the persist
    is still awaited and still fail-closed — no decision is ever returned
    unaudited);
  - the org-halt check runs concurrently with the idempotent-replay lookup, and
    policy + risk-template loads run concurrently on cold caches;
  - `POST /api/actions` batches its four independent gate reads into one wait
    (the idempotent-replay gate stays serial: a replayed key still does no
    other work).
- **`guard_decisions.idempotency_key` column + partial index (drizzle/0058)**
  replaces the idempotent-replay lookup's per-row `context::jsonb` seq scan
  over the 10-minute window — measured 3.05ms → 0.038ms at ~1k window rows,
  and the cost no longer grows with fleet decision volume. Deploy-before-migrate
  is safe in both directions: the audit INSERT retries with the legacy column
  list on 42703 and the lookup falls back to the jsonb scan, so an unmigrated
  instance keeps working and keeps replay dedupe. Run `npm run db:migrate`
  after pulling.
- The guard route now emits a **`Server-Timing` response header**
  (`replay`/`eval`/`record`/`total`) so stage latency is observable per call
  from any client or browser devtools. Response bodies are unchanged.
- **New: `scripts/bench-guard-hotpath.mjs`** — a repeatable hot-path benchmark
  against any running instance: six scenarios (simple allow, the hook path,
  idempotent replay, approval-gated decision, standalone record, health floor),
  p50/p90/p95/p99 per scenario plus the Server-Timing stage split, and
  `--assert scenario:stat:ms` regression gates that exit non-zero so a future
  slowdown is caught by a gate, not a user.

### Fixed
- **`runGoverned(..., { wait: false })` was a silent approval bypass** in both
  SDKs: when a decision came back `require_approval`, the governed work ran
  anyway with the approval still pending. Both SDKs now throw
  `ApprovalPendingError` instead (the work is never executed while approval is
  pending); poll `waitForApproval` and re-run once approved.
- **A guard decision that cannot be durably audited now answers an honest 503**
  (`GUARD_AUDIT_PERSIST_FAILED`, with `/setup` pointer) instead of a generic
  500 — callers can tell "governance is degraded" apart from an ordinary error.
- **MCP server: a post-execution audit-write failure no longer rewrites
  execution truth.** When the governed work ran but the local audit append
  failed, the result now carries `audit_error` alongside the truthful execution
  outcome instead of misreporting the run as failed (or staying silent).
- Silent-failure sweep across the pretool/posttool/stop hooks, CLI local
  doctor, doctor checks, and repositories: swallowed exceptions now surface as
  loud, classified errors with actionable messages.
- **`npx dashclaw up` embedded Postgres died on fresh Windows machines with a
  bare `code: 3221225781` and empty stderr** (found by a Windows Sandbox
  fresh-machine test). That code is `0xC0000135` STATUS_DLL_NOT_FOUND: the
  embedded Postgres binaries need the Microsoft Visual C++ runtime, which
  fresh Windows installs don't ship. The CLI now preflights the runtime DLLs
  before the embedded attempt and maps the exit code if it still slips
  through, both with an actionable fix (vc_redist download link, winget
  command, or `--db docker` / `--db url`). Reaches users as `@dashclaw/cli`
  0.7.3.
- **Release-tarball installs no longer print contributor-tooling noise**: the
  living-merge npm `prepare` hook exits silently when there is no `.git`
  (i.e. every `dashclaw up` install), instead of telling end users to run an
  internal `install.ts` script.

### Added
- **Enforcement-posture attribution**: the pretool hook reports
  `enforcement_mode` (`enforce` vs `observe`) on every guard call, persisted
  with the decision — the dashboard and doctor can now show when an agent's
  blocks are logged but not actually enforced (the failure mode behind the
  v4.72.1 incident).
- `/decisions` renders the server-reconciled `unknown` outcome state (zombie
  actions whose outcome never arrived within the stale-outcome window).

## [4.72.1] — 2026-07-06

**Enforcement fix: the Claude Code pretool hook was being cancelled by the
harness — fail-open.** Every DashClaw hook installer wrote the PreToolUse
timeout as `3600000`, a milliseconds value in a field Claude Code reads as
**seconds**. The harness multiplies by 1000, the result overflows the
32-bit timer ceiling (2,147,483,647 ms), the timer fires immediately, and
Claude Code cancels the hook and lets the tool call proceed. Net effect:
`block` decisions and `require_approval` waits were never enforced in
Claude Code sessions, while guard decisions still landed in the ledger —
which made the gap invisible. Found by investigating why writes to a
protected path succeeded with their approvals still pending.

### Fixed
- Pretool hook timeout corrected to `3660` (seconds; just above the hook's
  maximum 3600s approval wait, so its own exit-2 block always resolves
  first) in every surface that plants it: `scripts/install-hooks.mjs`
  (both variants), `hooks/settings.json`, the Claude Code plugin
  `hooks.json` (`dashclaw` plugin **2.15.1**), the CLI installer
  (`@dashclaw/cli` **0.7.2**), the Claude Code guide's example config, the
  setup skill, and the platform-guide entry (which had documented the
  broken value as intentional "1-hour timeout (3600000ms)").
- CLI installer test now pins the corrected value and asserts it stays
  under the 2,147,483s overflow ceiling.

### Operator action
- Existing installs keep the broken value until hooks are reinstalled or
  the settings entry is edited: change `"timeout": 3600000` to
  `"timeout": 3660` on the `dashclaw_pretool` PreToolUse hook and restart
  the session.

## [4.72.0] — 2026-07-06

**Page-hotspot health pass #2.** After v4.71.0 retired the worst file in the
codebase, the next-worst structural offenders on the health index were three
page-component function hotspots. This release decomposes the two biggest —
behavior-preserving verbatim extraction, same recipe as the stop-hook pass —
and pins the extracted logic with tests.

### Changed
- `app/decisions/[actionId]/page.tsx` (1,261 lines, the Decision Replay
  surface) is now a 467-line orchestrator over 9 focused modules in
  `_components/`: pure helpers (timeline event ordering, the 40/70 risk
  bands, status variants, assumption-drift math), `ChronologicalTimeline`,
  `CausalTimeline`, the Policies/Assumptions/Signals/Evidence tab bodies,
  `ReplaySidebar`, and `CopyButton`.
- `app/scoring/page.tsx` (980 lines) is now a 453-line orchestrator over 6
  modules in `_components/`: shared types + constants, the 80/60/40 score-band
  helpers, and the Profiles/Score Explorer/Risk Templates/Calibrate tab
  components. Existing scoring-page flow tests (Score recent, dimension CRUD,
  calibrate params) pass unchanged through the new structure.

### Added
- 33 new unit tests (`decision-replay-helpers.test.ts`,
  `decision-replay-components.test.tsx`, `scoring-page-helpers.test.ts`)
  pinning timeline event ordering and fallback timestamps, the 40/70 risk
  bands, drift labels, the 80/60/40 score bands, tab empty states, and the
  assumption/loop action wiring.

### Removed
- Dead code that rode along in the replay page since its early revisions:
  the never-rendered `getResultText`/`getResultSummary`/`decisionType`
  cluster and four unused lucide imports.

## [4.71.0] — 2026-07-06

**Stop-hook health pass.** `hooks/dashclaw_stop.py` was the repo's
worst-scoring file (1.0/10 on the health index: 852 NLOC in one file, no
matched test file) — and the platform guide said so publicly. Same treatment
as the v4.66.x hotspot passes: behavior-preserving decomposition plus
boundary tests.

### Changed
- `hooks/dashclaw_stop.py` (1,172 lines) is now a 598-line orchestrator over
  three new unit-testable `dashclaw_agent_intel` modules, bodies moved
  verbatim:
  - `stop_transcript.py` — transcript parsing, turn boundaries, token-usage
    math (incl. the JS-parity cache-read rounding), governed tool_use
    collection, assumption extraction, distribution/PATCH-body math.
  - `stop_state.py` — the tempdir cross-hook contract: turn actions, cursor,
    posted-assumption keys, throttle markers, upload offsets,
    session-id sanitization.
  - `stop_uploads.py` — insights push + opt-in anonymized sample upload,
    config as explicit parameters instead of module globals.
- Plugin bundle copy (`plugins/dashclaw/hooks/`) synced byte-identical.

### Added
- 67 new Python tests (`test_stop_transcript.py`, `test_stop_state.py`,
  `test_stop_uploads.py`, `test_dashclaw_stop.py`) pinning the seams the
  monolith never had pinned: turn-boundary rules, cache-read rounding
  parity, the governed-tool matcher, assumption idempotency files, the
  opt-in-default-OFF sample-upload gate, throttle markers, and offset
  bookkeeping. Full hook suite: 494 tests, all green.
- The platform guide's Stop-hook entry moves experimental → stable with the
  new evidence.

## [4.70.0] — 2026-07-06

**Policy playground + plugins audit.** The platform guide grows its first
truly interactive governance tool and closes its thinnest coverage area.

### Added
- **Policy playground** in the guide's Policies section: pick a policy type
  (8 templates mirroring real live-observed rule shapes), edit the rules
  JSON, and replay the draft against your own instance's recent action
  history via `POST /api/policies/simulate`. Read-only — shows exactly what
  the policy *would have* blocked, warned, or sent to approval, with summary
  tiles and the first matched actions. Uses the same browser-only connection
  config as the Try-It panels.
- **Plugins area in the guide** — 19 audited entries covering the Claude
  Code plugin (manifest, 6 hooks, 2 skills, MCP configs, assets), the Codex
  install surface, the Hermes plugin (beta), the Claude Desktop connector
  (experimental, cooperative-only by design), the OpenClaw gateway plugin,
  and the demo package — each with evidence-based status. Guide total:
  1,415 → 1,434 entries.

### Fixed
- Removed a stale local `openclaw-plugin` 1.2.5 build artifact surfaced by
  the plugins audit (package is at 1.4.0; the tgz was untracked and
  referenced nowhere).

## [4.69.0] — 2026-07-06

**Guide follow-through.** The v4.68.0 platform-guide audit surfaced real
defects and real gaps; this release closes them the same day.

### Fixed
- **Python SDK README** documented a `guard(context, include_signals=...)`
  parameter that does not exist (calling it raises `TypeError`). Removed; the
  server's `POST /api/guard?include_signals=true` query flag is noted as the
  way to get live signal warnings.
- **`/mission-control/codebase` was unreachable** — a live Codebase
  Intelligence page with zero inbound links. Now in the sidebar's Observe
  group. (`/quality` was also flagged but is an intentional legacy-bookmark
  redirect and stays unlinked.)

### Added
- **Guide drift CI gate** — `npm run guide:drift:check`
  (`scripts/check-platform-guide-drift.mjs`) fails the build when the API
  surface in `docs/api-inventory.json` changes without the platform guide's
  dataset being regenerated. The guide can claim 100% coverage only while
  this passes.
- **Guide polish**: URL-hash deep links that expand and scroll to any of the
  1,415 entries (with a copy-link button on each), "Also via" cross-links
  between an API route and the SDK methods / MCP tools that call it (and
  back), a "create one →" API-key helper in the Try-It panel, and `/` to
  focus search.
- **Discoverability**: the Complete Platform Guide is now the first card in
  /connect's guides grid and a link in the public footer.

### Notes
- The Node SDK README's method count (149) is **correct** per the canonical
  counting rule (`scripts/count-sdk-methods.mjs`: class-body public methods
  only); the guide lists more entries because it also documents the
  constructor, error classes, and the `execution.capabilities` namespace.
  The guide now says so explicitly.
- The beachhead blog's placeholder Loom already renders a graceful "coming
  soon" poster; the walkthrough recording remains the open human step.

## [4.68.0] — 2026-07-06

**The Complete Platform Guide.** One interactive reference covering 100% of
the product surface — 1,415 entries spanning every product page (93), every
API route+method (449, including the 48 archived `_archive` routes documented
as not-routable), the full Node SDK (162 canonical + 193 deprecated legacy
methods), the full Python SDK (234 methods), the CLI (36 commands), the MCP
server (151 tools + 6 resources), and the hook/auth/setup surface. Every
entry carries an evidence-based stable/beta/experimental/deprecated/archived
mark.

### Added
- **`/guides/platform`** — searchable, filterable interactive guide with
  per-area read-progress tracking, copy-to-clipboard on every snippet,
  expandable per-endpoint reference cards (inputs, auth, response shape,
  errors, gotchas, source file), and per-endpoint "Try it" panels that run
  against the reader's own instance with a key they supply (stored only in
  their browser — nothing baked in).
- **Live-captured examples** in the quickstart: the governed-action loop
  (health → guard → record → decisions ledger → assumptions/loops → posture)
  shown as real request/response pairs captured from a running instance —
  PowerShell (`curl.exe`) first, bash, TypeScript SDK, Python SDK, and MCP
  tool forms. Keys/org ids replaced with placeholders; nothing fabricated.
- **`docs/platform-guide-coverage.json`** — coverage manifest mapping every
  one of the 1,415 inventoried items to its guide section, with a
  `liveVerified` flag distinguishing live-exercised interfaces from
  code-derived documentation.
- Docs page callout + sidebar link to the new guide.

## [4.67.0] — 2026-07-05

**Guides expansion: 8 → 11 frameworks.** The roadmap's compounding-surface
lever: three new step-by-step integration guides, each backed by a runnable
example that was executed live against a fresh build before shipping.

### Added
- **`/guides/autogen`** — govern AutoGen tool calls with the Python SDK
  4-step loop; backed by the existing `examples/autogen-governed`.
- **`/guides/pydantic-ai`** + **`examples/pydantic-ai-governed`** — governed
  functions in the agent `tools=[...]` list, with the `TestModel` pattern for
  keyless agent-loop tests.
- **`/guides/vercel-ai-sdk`** + **`examples/vercel-ai-governed`** — a generic
  `governed()` wrapper that turns any AI SDK tool `execute` into a governed
  one (guard → createAction → waitForApproval → updateOutcome), verified
  against `ai` v7.
- All three discoverable from the `/connect` framework-guides grid and the
  `/self-host` integration section.

### Fixed
- **POST `/api/actions` idempotent replay now carries the top-level
  `action_id` alias** like the fresh-create response. The SDKs auto-derive
  idempotency keys from (agent, type, goal, hour), so any client reading
  `response.action_id` broke only on the retry path — found when the new
  example crashed on its second run. Regression assertion added.
- **Examples are re-runnable**: `autogen-governed`, `pydantic-ai-governed`,
  and `vercel-ai-governed` stamp each demo run with a `session_id` nonce so
  a re-run within the idempotency window creates new actions instead of
  replaying the prior (terminal) ones; the two Python examples also move off
  the deprecated `record_assumption` to `register_assumption`.

## [4.66.5] — 2026-07-05

**Page-hotspot health pass.** Finishes the day's structural hardening on the
last two function-hotspot biomarkers, both UI pages. Behavior-preserving:
state, handlers, fetch logic, and JSX are unchanged — section markup moved
verbatim into module-level components (stable identity, so focus and mount
behavior are untouched). All 30 page tests pass unchanged; both pages
render-proved on a fresh demo-mode build (full SSR content for every
section, zero console errors, zero failed requests).

### Changed
- **`app/learning/page.tsx`** — the 788-line `LearningDashboard` is now a
  state-holder over seven section components (`ExportHeaderCard`,
  `StatsOverview`, `DecisionsCard`, `LessonsCard`, `RecommendationOpsCard`,
  `SuggestedPoliciesCard`, `CodeSignalsCard`, `LogDecisionModal`), with the
  pure outcome/confidence helpers at module scope.
- **`app/policy-coach/page.tsx`** — the 536-line `PolicyCoachPage` sheds its
  four big inline blocks: `RecorderCard` (recorder + upload opt-in),
  `LiveStrip`, `DismissModal`, and `EditPolicyModal` are now module-level
  components; the page keeps only state, handlers, and layout.

## [4.66.4] — 2026-07-05

**Signals health pass.** Continues v4.66.3's hotspot work on the next
decision-adjacent biomarker: `computeSignals` in `app/lib/signals.ts` — the
posture engine behind `?include_signals=true` on guard, `/api/signals`, the
signals cron, and agent profiles — was a single 536-line function.
Behavior-preserving: bodies moved verbatim, push order preserved (the stable
red-first sort keeps equal-severity ordering identical), all 71 pre-existing
signals tests pass unchanged.

### Changed
- **`app/lib/signals.ts`** — each signal category's row→signal mapping is now
  an exported pure `build*Signals` function (16 of them);  `computeSignals`
  reduces to: settings fetch → one parallel query batch → builders → filter
  → sort. Best-effort try/catch semantics per category are unchanged.
- **`__tests__/unit/signals-builders.test.js` (new)** — 18 tests pin every
  severity threshold at its exact boundary (spike >2x, risk ≥90, failures >5,
  loops >96h, invalidations ≥4, assumptions >30d, running >24h, workflows
  >60m, approvals/sessions ≥4h, branch ≥5 behind, `auth_required` red), plus
  per-agent/per-server dedup and malformed-intel-context handling — none of
  which were directly testable while the loops lived inline.

## [4.66.3] — 2026-07-05

**Guard hot-path health pass.** `app/api/guard/route.ts` — the file every
governed action flows through — was the repo's worst-health file (1.0/10:
a ~270-line handler, a twice-duplicated advisory block, a dead branch).
This is a behavior-preserving decomposition: the response shape is
byte-identical, pinned by the 86 pre-existing guard tests (characterization,
idempotency, jwks, hot-path) plus a live proof of fresh evaluation,
idempotent replay, and GET against the rebuilt route.

### Changed
- **`app/lib/guard-identity.ts` (new)** — the Phase 2 JWT verification /
  replay-protection / act-binding block extracted verbatim from the POST
  handler. Same mutations, same fail-soft semantics, same log lines.
- **`app/api/guard/route.ts`** — the idempotent-replay short-circuit is now
  a named `tryIdempotentReplay` (org-halt bypass guarantee intact); the
  Advocate advisory attach is one `attachAssumptionAlerts` helper instead of
  two copies; GET's self-host branch (byte-identical to the normal path)
  collapsed.
- **`__tests__/unit/guard-identity.test.js` (new)** — 13 tests directly pin
  the replay-status matrix (oversized jti, missing exp, null issuer,
  replay-off `disabled`, `exp_too_far`) and the JWT-sub identity override,
  branches previously reachable only through full route mocks.

## [4.66.2] — 2026-07-05

**Quality-loop harness hardening.** The recurring find-and-fix pass this round
traced every browser/HTTP symptom (500s on `/guides/*`, a 404 on `/proof`) to
one environmental root cause: a stale `next start` process holding port 3000
and serving an out-of-date `.next` build while a fresh build sat unused
underneath it. The app itself was green — the harness now refuses to be fooled.

### Fixed
- **`scripts/startup-smoke.mjs`** — a port-availability preflight
  (`assertPortAvailable` in `scripts/lib/startup-smoke.mjs`) now runs before
  the server spawns: if a stale process already holds the target port, the
  smoke run fails loudly with per-OS instructions to free it, instead of
  silently smoke-testing the old process's build and reporting false 500s.
  Covered by two new unit tests in `__tests__/unit/startup-smoke.test.js`.
- **`.claude/workflows/dashclaw-find-and-fix.js`** — the workflow is now
  actually launchable: every `agent()` call carries an explicit `model:`
  override (haiku for discover/smoke/gate agents, sonnet for
  triage/fix/integrate), as required by the agent-model-guard hook, and the
  file's line endings are pinned to LF via `.gitattributes` (CRLF control
  characters blocked the Workflow permission check on checkout).

## [4.66.1] — 2026-07-05

**`npx dashclaw up` freshness: GitHub releases become the version pointer**
(`@dashclaw/cli` 0.7.1). Found by the post-v7.3 first-run pass: `up`
resolved the platform version from npm's `dashclaw` latest, which lags on
platform-only releases (the SDKs republish only when SDK source changes) —
fresh owned instances were installing platform 4.63.2, three releases
stale and **missing `POST /api/workspace/import`, the graduation door
v7.2 promises trial users**.

### Fixed
- **`@dashclaw/cli` 0.7.1** — `dashclaw up` now resolves the platform
  version from the latest GitHub Release first (one rides every ship),
  falling back to npm latest only when the GitHub lookup fails; both paths
  still verify the tag's tarball exists before installing. Existing users
  heal automatically on next run: the `npx dashclaw` shim always executes
  the latest published CLI. Instances already installed at a stale version
  can refresh with `dashclaw up --update`.

## [4.66.0] — 2026-07-05

**The self-governance proof surface** (roadmap v7.3, spec
`docs/superpowers/specs/2026-07-05-self-governance-proof-v73.md`). The
project's most distinctive true fact — DashClaw's maintenance is itself
governed by DashClaw — rendered as live evidence where strangers land,
not as copy.

### Added
- **`/proof` marketing page** — live aggregate evidence that DashClaw
  governs its own maintainer: governed actions to date, guard decisions
  and their mix, decision cadence, latest governed ship. Numbers are
  server-side fetches of `SELF_GOVERNANCE_SOURCE_URL` (5-minute
  revalidate); when the feed is unreachable the page says so honestly
  instead of showing cached or fabricated numbers. Linked from the front
  page, navbar, and footer; registered in `MARKETING_ROUTES`.
- **`GET /api/self-governance`** — public, aggregate-only evidence
  endpoint on the `/api/hosted/funnel` precedent: 404 unless the operator
  opts the instance in with `DASHCLAW_SELF_GOVERNANCE_PUBLIC=true`, 60s
  in-memory memo, no org identifiers and no free-text columns on the wire
  (fixed-literal decision keys; the only strings are the manifest-derived
  platform version and ISO timestamps). Synthetic verification traffic
  (smoke/loadtest/liveproof families) is excluded — the proof counts real
  governance only. Instance-wide by design — multi-tenant instances should
  leave the flag unset.

## [4.65.0] — 2026-07-05

**The graduation path: the trial cap becomes a door** (roadmap v7.2, spec
`docs/superpowers/specs/2026-07-05-graduation-path-v72.md`). A hosted
trial's governance record no longer dies with the workspace.

### Added
- **Workspace carry-out**: `GET /api/workspace/export` downloads the org's
  durable governance record (guard policies, guard decisions, action
  records, open loops, assumptions, agent identities) as a versioned
  bundle; `POST /api/workspace/import` loads one into the caller's org —
  idempotent (re-import skips existing rows) and org re-scoped. Column
  sets are derived from the schema and pinned by a classification test;
  credentials, credential-equivalents, and managed secret values never
  ride a bundle. `signature`/`verified` are stripped too — they attest to
  the source instance's signing key (security review hardening).
- **Export workspace button** on the trial card at `/connect` — one click,
  file downloads; the first export of a hosted trial stamps graduation.
- **`dashclaw import <bundle.json>`** (CLI 0.7.0): loads a bundle into the
  configured instance over HTTP.
- **`graduated` funnel annotation** — orgs that took their record out;
  snapshot-frozen at deletion (drizzle/0057), truthful zeros, rendered on
  `/setup`.

### Fixed
- `/setup` now actually renders the per-channel `bySource` table — v4.60.0
  claimed this render and it never landed (recorded in the maintainer log).
- The fresh-install fallback DDL (`CRITICAL_TABLES_DDL`) was missing
  `hosted_trial_snapshots` entirely; the table is now present and
  registered in the drift-gate test so it cannot rot again.

## [4.64.0] — 2026-07-05

**Act-content grant binding.** The operator-approval grant now covers the
*act*, not just the sentence: closes the security review's last open
follow-up (approve X, do Y). Spec:
`docs/superpowers/specs/2026-07-05-act-content-grant-binding.md`.

### Security
- **Operator approvals bind to the approved act's content** (drizzle/0056).
  Rows created with an evidence-first `act` payload get a server-computed
  canonical digest stamped as `action_records.act_content_hash` (a
  client-supplied hash is never trusted), and the guard's single-use grant
  consume additionally requires the retry's act to recompute to the same
  hash — approving act X can no longer authorize a different act Y sharing
  the same agent + declared_goal + action_type. Rows without an act keep
  the previous tuple match (binding tightens, never loosens; residuals
  recorded in `docs/SECURITY.md`). Live-proven by the new policy-smoke AE
  family; grant SQL, stamping, position pins, and validation all pinned by
  unit tests.

### Added
- **`/approvals` shows an "Act-bound" badge** on act-stamped pending cards,
  with plain-language hover copy — the operator sees when an approval is
  pinned to the exact recorded act.
- **MCP `dashclaw_record` accepts `act`** (@dashclaw/mcp-server 2.2.0) and
  forwards it, so MCP-created pending approvals participate in the binding
  (previously the MCP surface had no way to carry the act into the row).
  No Node/Python SDK changes needed — both already send the scrubbed act
  on the guard call and the record create, so binding is automatic for
  `runGoverned` / `run_governed`.

### Fixed
- **`POST /api/actions` silently dropped the `act` payload** — the record
  schema's whitelist stripped it before it reached the repository.
  `validateActionRecord` now accepts `act` with the same deep validation
  (16KB cap, per-kind shape) as the guard input.
- **The two pending-row creator paths persisted different action_types**
  when the evidence fold swapped the evaluation type: `guard?record=true`
  stored the derived type, `POST /api/actions` the declared one — so
  SDK-created grants could never match an act-carrying retry. `/api/actions`
  now persists the type the evaluation actually ran under, consistent with
  `guard_decisions`.

## [4.63.2] — 2026-07-05

**First-run reliability.** Live-verifying the two README quick-start commands
exactly as a fresh user runs them (published packages, clean environment,
local Docker Postgres) surfaced five compounding first-run killers — none
visible on hosted/Neon deployments, where every prior end-to-end proof ran.
All five are fixed and the full pipeline is proven green end to end: install →
Postgres → drizzle + legacy migrations → build → healthy server → auto-wired
Claude Code hooks → a real guard decision in the ledger.

### Fixed
- **`npx dashclaw up` actually completes on a local database now.** Live-verifying
  the quick-start commands as a fresh user surfaced five compounding first-run
  killers, all invisible on hosted/Neon deployments:
  1. *Indefinite hang in setup.* `scripts/_db.mjs` gave local (non-Neon)
     connections a `postgres.js` pool with no `idle_timeout`; roughly a dozen
     setup migration scripts never call `sql.end()`, so each one finished its
     work and then held the event loop open forever — `up` sat silently on
     "Running setup" for as long as you let it. Idle connections now close
     after 5s and the scripts exit naturally. (Neon URLs use the stateless
     HTTP driver, which is why every hosted proof passed.)
  2. *The drizzle chain never ran locally.* Local setup executed only the
     legacy `migrate-*` scripts, but the schema source of truth — `settings`,
     `token_budgets`, `agent_messages.action_id`, every newer table — lives in
     `drizzle/*.sql`, which only the Vercel build applied. Fresh local installs
     ended `no_tables`-unready with `settings` missing. `scripts/auto-migrate.mjs`
     now runs first in `SETUP_MIGRATION_SCRIPTS`.
  3. *`migrate-token-budgets` was a parse error on every PostgreSQL* —
     `UNIQUE(org_id, COALESCE(agent_id, ''))` inline in CREATE TABLE is not
     legal SQL; the expression uniqueness now lives in a UNIQUE INDEX matching
     `drizzle/0017`.
  4. *`migrate-behavioral-ai` imported `dotenv/config`* — dotenv is not a
     dependency of this package, so fresh installs crashed with
     ERR_MODULE_NOT_FOUND wherever npm didn't hoist it transitively
     (`backfill-embeddings.mjs` had the same import; both now use
     `./_load-env.mjs`).
  5. *Pipe-backpressure deadlock in setup's process runner.* `runAsync` in
     `scripts/setup.mjs` drained a child's stderr but never its stdout, so any
     migration chattier than the ~64KB pipe buffer blocked on write forever —
     which the newly-added drizzle chain is on a fresh database. stdout is now
     drained too.
- **`@dashclaw/cli` 0.6.2 — `npx dashclaw up` no longer dies when port 5433 is
  taken.** Both Docker and embedded provisioning hardcoded host port 5433; any
  machine with another Postgres there (a second dev database is common) got a
  raw `Command failed: docker run` and a half-created `dashclaw-pg` container
  that poisoned every retry. Provisioning now prefers 5433 and scans forward
  to the first free port (logged, never silent), reuses a running container on
  whatever port it maps, restarts a stopped one on its recorded port, and only
  recreates it (data volume preserved) when that port was taken by another
  process. A failed `docker run` cleans up its half-created container, docker
  errors surface stderr instead of being swallowed, and the port-free probe
  uses a dual connect+wildcard-listen check because on Windows a loopback bind
  falsely succeeds while another process holds the wildcard port. If the DB
  legitimately moves ports, `up` updates the saved instance config and the
  app's `.env.local` in place. Found by live-verifying the README quick-start
  commands as a fresh user; proven against the real poisoned-port state.

## [4.63.1] — 2026-07-05

**Documentation restructure.** The docs now have a front door and an adoption-journey
information architecture; a full drift audit against the live code fixed every
mismatch it found.

### Added
- `docs/README.md` — the documentation index (understand → try → connect →
  operate → reference), including an explicit map of which `docs/` directories
  are internal process artifacts rather than product documentation.
- `docs/concepts.md` — the mental model on one page: the four primitives, the
  governance loop, decision verdicts, the risk max-blend, evidence-graded
  intent, the mechanical-vs-cooperative enforcement boundary, approvals, and
  durable outcomes.
- `docs/integrations/claude-code.md` and `docs/integrations/mcp.md` — real
  integration guides for the two highest-traffic connection paths, honest per
  the enforcement-boundary copy rule.
- `docs/operations.md` — the operator guide: day-one policy seeding, the five
  approval surfaces, the ledger, posture, the emergency halt, doctor.
- `docs/troubleshooting.md` — the errors integrators actually hit
  (`503 SCHEMA_NOT_INITIALIZED`, `410 APPROVAL_EXPIRED`, `409` outcome
  conflicts, the guard-vs-action id footgun, silent hooks) with fixes.
- `sdk/README.md` / `sdk-python/README.md`: the Sessions surface (5 methods)
  and Drift Detection surface (10 methods) are documented for the first time.
- `cli/README.md`: `dashclaw halt on|off|status` — the org kill switch — was
  implemented but undocumented.
- Three new `check-doc-counts.mjs` gates so the new pages' counts cannot rot.

### Fixed
- `sdk/README.md` claimed pairing lives "only on the deprecated legacy SDK"
  with a `dashclaw/legacy` import example — `createPairing`/`waitForPairing`
  have been canonical since their promotion; the claim contradicted the same
  file's own Messaging section. Corrected, example now imports `dashclaw`.
- `sdk-python/README.md` parity table listed a `get_lessons` method that does
  not exist in the Python client; removed, real Node-only gaps stated instead.
- `docs/architecture/capabilities.md` — a stale early taxonomy contradicting
  `PROJECT_DETAILS.md`, still linked from `docs/agent-bootstrap.md` as "the
  Extensions Guide" — now carries a SUPERSEDED banner and the bootstrap doc
  points at the current system map.
- `QUICK-START.md` rewritten: one recommended entry path instead of four
  competing ones, and the closing scope note no longer reads as *encouraging*
  new routes into `app/api/_archive/`.
- `DEMO.md` and the `npx dashclaw-demo` quick start now cross-link — two
  unrelated things were both called "the demo" with no reference to each other.
- `docs/SECURITY.md` gained the missing 2026-07-05 hardening section
  (evidence-graded intent, separation-of-duties approvals, the JTI replay
  default flip) and a note on its section ordering.
- `CONTRIBUTING.md` gates now match CI (`typecheck`, `next build`, full vitest,
  `check-doc-counts --strict`); `docs/documentation-governance.md` refreshed
  after five stale months to govern the docs that actually exist.

- **The "claims are proven live in CI" promise is now true.** MAINTAINER.md,
  README, and the trust-and-failure model all stated that the policy smoke
  harness runs in CI on every push — it never did. Neither did the cross-org
  isolation suite, the only behavioral proof of org isolation in the repo.
  Both now run on every push and PR in the `startup-smoke` CI job: after the
  health smoke, CI boots the built app against the job's fresh Postgres 16
  service and runs `scripts/policy-smoke.mjs` (120 live checks: guard decision
  vocabulary, effective-risk max, block/require_approval thresholds, approval
  lifecycle incl. separation-of-duties with the operator exemption, outcome
  finality 409s, idempotent replay, flood budgets, tuning loop) and
  `scripts/cross-org-smoke.mjs` (31 live checks: two run-unique orgs with
  DB-minted keys, neither able to read, mutate, enumerate, approve, or consume
  the other's governance resources). A regression in any publicly claimed
  governance behavior now fails the push that introduces it.
- **`first-governed-action` examples never printed their decision-replay
  link.** Both the Node and Python variants destructured an `action_id` off
  `guard()` — which evaluates but does not record, so the field is never
  present and the advertised "View decision replay" line silently never
  printed. The examples now run the canonical loop (guard → enforce the
  decision in code → `createAction` for the ledger entry) and print a replay
  link that resolves; both SDKs' `guard()` doc comments stop promising an
  `action_id` the call never returns. Proven live against a fresh instance.
- **`cli/README.md` documented a `--db <url>` form that crashes.** The flag
  accepts only `docker|embedded|url`; the doc now describes `--db url` as the
  prompt-based bring-your-own-Postgres mode it actually is.
- **`docs/architecture/runtime-api.md` said the Node SDK has 104 public
  methods; the real count is 149.** Corrected, and the file is now gated by
  `check-doc-counts.mjs` so it cannot silently drift again.

## [4.63.0] — 2026-07-05

**Evidence-first guard**: SDK, MCP, and REST callers can attach the actual act —
the shell command, HTTP request, SQL statement, or file write — and the server
classifies it deterministically instead of trusting the self-declared
`action_type`/`risk_score`. Closes the "self-declared intent" hole against a
lying *model* (the developer-controlled wrapper authors the payload, not the
LLM); a lying *process* is still only stopped by credential custody via the
capability registry. Spec: `docs/superpowers/specs/2026-07-05-evidence-first-guard.md`.

### Added
- `act` field on `POST /api/guard` (`{kind: shell|http|sql|file, …}`, capped at
  16KB, per-field caps, scrubbed client-side and redacted server-side before
  persistence). The server classifier (`app/lib/guard/evidence.ts`) derives an
  action type and risk that folds in via `max()` — evidence can only raise a
  score, never lower it.
- Declared/derived mismatch handling: evaluation proceeds under the derived
  action type, adds a `+10` modifier, and flags `evidence_mismatch` on the
  decision. Guard responses carry `intent_source: evidence|declared` and
  `derived_action_type`; `intent_source` grades `evidence` only when the
  derived type is the type the evaluation ran under, so an unrelated junk act
  cannot satisfy an evidence policy.
- `require_evidence` policy type (17th) — escalates declared-only guard calls
  to warn / require_approval / block; available in the policy builder's type
  picker and as the 10th pre-built safety switch ("Evidence Required").
- Node SDK: `runGoverned(act, params, fn)` and `guardedFetch(url, init, params?)`
  (147 → 149 methods) with a client-side secret scrub (`scrubAct`, exported).
  Python SDK: `run_governed(act, params, fn)` + `scrub_act` (233 → 234 methods).
- MCP: `dashclaw_guard` accepts and forwards `act`. Claude Code hook: attaches
  the real Bash/PowerShell command and file-write payloads as `act` (scrubbed),
  so hook decisions are evidence-graded server-side even if the hook's own
  client-side classification is tampered with.
- Decision Replay shows the intent source (Evidence with the redacted act, or
  Declared); `/posture`'s enforcement dimension grades declared-only decisions
  at half weight and shows the evidence/declared mix.
- `@dashclaw/mcp-server` 2.0.1 → 2.1.0 (act passthrough).

### Notes
- Zero behavior change when `act` is absent — characterization suite unchanged.
- Sending `act` to an older server is safe (unknown keys are ignored).
- The enforcement-boundary ADR gained an "Evidence-graded intent" section with
  the honest threat model; nothing new enters any hashed or signed vector.

## [4.62.2] — 2026-07-05

The two structural risks named in the v4.62.1 audit, tackled. Pure refactors —
no route, response-shape, SDK, or contract changes; the full suite passes with
an identical test count (5,241) before and after.

### Changed

- **Webhooks and orgs now have real repositories.** The two domains that had
  no `app/lib/repositories/` module at all — their SQL lived raw in six route
  files — are extracted: `webhooks.repository.ts` (6 functions) and
  `orgs.repository.ts` (10 functions), query text moved verbatim, routes keep
  their existing validation/auth/response logic and pass their `getSql()`
  instance through. No test changed. The route-SQL ratchet baseline drops from
  **83 direct calls to 58** and is regenerated so CI now enforces the lower
  bound (`docs/route-sql-baseline.json`).
- **`app/lib/guard.ts` split into cohesive modules.** The 2,025-line policy
  engine is now a 25-line façade re-exporting an identical 15-export surface
  from `app/lib/guard/`: `caches.ts` (every piece of module-level mutable
  state — all four caches, invalidation, `__resetGuardCaches`,
  `getOrgHaltState`), `risk.ts` (scoring + breakdown), `policy.ts`
  (`evaluatePolicy`/`evaluateWebhookPolicy` + degradation contract),
  `persistence.ts` (`persistGuardDecision`), `evaluate.ts` (`evaluateGuard`
  orchestration + x402 post-insert verification), with `types.ts`/`internal.ts`
  for shared types and severity helpers. Code moved verbatim — the
  halt-before-replay seam and all statement ordering inside `evaluateGuard`
  are unchanged, and no consumer import or test was touched. Dependency
  layering is one-directional (no submodule imports the façade).

Structural health pass. An independent audit of the current tree (app/, sdk/,
sdk-python/, cli/, mcp-server/, packages/, both test trees) followed by
behavior-preserving cleanup: dead code deleted only after grep-verifying zero
callers, one silently broken drift check repaired, one duplicated validator
unified, and the biggest untested auth path given direct coverage. No route,
SDK-surface, or contract changes.

### Fixed

- **`scripts/sync-cli-vendored-code.mjs` was silently dead.** The drift check
  that guards `cli/lib/code/vendored.js` against its canonical sources had
  pointed at `merge.js`/`bundle.js` since those files were renamed to `.ts` —
  every run reported `missing_canonical` and could never detect real drift.
  Re-pointed at `merge.ts`/`bundle.ts`; the check runs again and confirms the
  vendored copy is currently in sync.

### Added

- **14 unit tests for `POST /api/internal/resolve-key`**
  (`__tests__/unit/internal-resolve-key.route.test.ts`) — the self-host
  API-key resolution bridge previously had zero direct tests (it was only
  exercised through a fully mocked fetch in the middleware suite). Now covered:
  the Neon/self-host gate (404 before auth), operator-key auth including
  empty-key edge cases, the resolved-principal payload shape, revoked and
  unknown keys, `touchKeyLastUsed` stamping, and DB-error responses.

### Changed

- **`boundedIdField` deduplicated.** The fleet-attribution id bound existed as
  byte-identical private copies in `app/api/actions/route.ts` and
  `app/api/guard/route.ts`; it now lives once in `app/lib/validate.js` and both
  routes import it.
- **Root hygiene.** One-off audit/spec artifacts moved to `docs/archive/`
  (`AUDIT_FINDINGS.md`, `OVERNIGHT-CLEANUP-REPORT.md`, `SPEC-mega.md`,
  `bar-mega.json`) and `AGENTLENS_INTEGRATION_GOAL.md` to `docs/architecture/`,
  with every citing reference updated. Deleted ~10.5 MB of unreferenced root
  PNGs, a stray supergoal prompt dump, and the orphan `agents/ceo/` persona
  config (unrelated to DashClaw; references a skill and `$AGENT_HOME` that do
  not exist in this repo). `.gitignore` hardened against the artifact classes
  that got committed (`*-mega.*`, root supergoal dumps, mangled-path litter).

### Removed

Dead code, each deletion grep-verified to have zero callers outside its own
file/tests before removal:

- `app/components/GuardSimulation.tsx` (308 lines) and
  `app/components/SwarmActivityLog.tsx` (220 lines) — orphaned components with
  no importers; also dropped the stale `GuardSimulation.js` entry from the
  version-hardcode allowlist.
- `app/lib/connectGuide.ts` and its test — superseded by the host resolution
  in `app/lib/guideContent.ts`; nothing in production imported it.
- `app/lib/missionControl.ts` — `buildRecentChangesDigest` and
  `buildOperatorBrief` (production-dead; only their own tests called them).
- `app/lib/readiness/configurationCheck.mjs` — two private, unexported
  near-duplicates of the real section builders in `applicationCheck.mjs` /
  `databaseCheck.mjs` (~190 lines), plus the import only they used.
- `mcp-server` — unreferenced exports `capabilityLabel`, `effectIsExecutable`
  (`src/policy.ts`) and `numberField` (`src/providers/shape.ts`); committed
  `lib/` build output regenerated.
- Hooks — dead `_clear_session_tool_map` in `dashclaw_code_session_reporter.py`
  and an unused duplicate `_safe_session_id` (with its regex) in
  `dashclaw_agent_intel/behavior_recorder.py`, removed from the canonical
  `hooks/` copies and all tracked mirrors.
- `sdk-python/tests/test_ws5_m5_adaptive_loop.py` — entire class skipped with
  "feature removed in SDK refactor"; a dead test file, not coverage.

## [4.62.0] — 2026-07-05

Separation of duties on the approval gate — the maintainer's call on the
boundary question v4.61.1 left open. Requiring a human session to approve
would break the two legitimate machine-carried approval paths (single-admin
self-host on the operator key; MCP `approve_action`, where a human directs
an assistant). The invariant that survives every topology is narrower and
stronger: **the principal that created an action can never be the principal
that approves it.**

### Security

- **`created_by` principal stamp** (drizzle/0055). Every action record now
  stores the middleware-attributed principal of the creating request
  (`operator`, `key_<uuid>`, `trial:<org>`, session user) — taken from the
  trusted auth header, never the client body. Stamped by every
  pending-approval creator: `POST /api/actions`, guard `?record=true`, x402
  purchases, capability invoke/test, workflow execute, work orders, and
  registered-agent invocations. NULL on legacy/system rows.
- **Self-approval is rejected.** The approval routes refuse an approval
  whose principal equals the action's `created_by`
  (`403 SELF_APPROVAL_FORBIDDEN`); bulk resolution excludes such rows inside
  the same atomic UPDATE (reported as failed, never resolved). An explicitly
  minted admin agent key can no longer approve its own submissions.
- **The `operator` root principal is exempt, and that boundary is now
  documented as the trust model** (`docs/SECURITY.md`): in single-admin
  self-host the operator key legitimately submits and approves; an agent
  holding root is outside what enforcement can protect. Give agents scoped
  `member` keys.
- **Grant-binding limitation recorded honestly**: the operator-approval
  grant still binds retries by agent + goal string + action type (15-minute
  single-use window), not by action-content hash; binding on `act_hash` is
  the recorded follow-up once the SDKs stamp it on both sides.

## [4.61.1] — 2026-07-05

Security hardening from a full governance-controls review (adversarial
multi-agent pass over auth, guard, approvals, and tenant scoping). Three
gaps closed; the remaining review findings (grant string-binding, the full
approval-auth boundary) are surfaced for a product decision, not silently
patched.

### Security

- **Capability `/test` now runs the guard.** `POST /api/capabilities/[id]/test`
  called the org's real endpoint with the org's real credentials and a
  caller-controlled body without `evaluateGuard` — a blocked capability's
  exact side-effect was reproducible via `/test`, and the org kill-switch
  (halt) was bypassed entirely. Test invocations now evaluate the guard
  first: `block` → 403 with a blocked-action record, `require_approval` →
  202 with a pending approval; policies and halts apply to tests exactly as
  to invokes.
- **Ledger deletion is audited.** `DELETE /api/actions` (admin-gated bulk
  delete) hard-deleted `action_records` with no trace. It now writes an
  activity-log record (actor, count, ids, filter) so ledger erasure is
  itself an audited event.
- **Approvals require an attributable principal.** Key- and operator-
  authenticated requests carried no `x-user-id`, so `recordApproval` stored
  `approved_by = ''` — an approval attributed to nobody that still satisfied
  the guard's operator-approval grant. Middleware now attributes every
  authenticated principal (`operator` for the bootstrap `DASHCLAW_API_KEY`,
  the `key_<uuid>` row id for DB keys, `dev` for the dev no-key fallback;
  sessions and trials were already attributed), both approval routes reject
  an empty principal with `403 APPROVER_IDENTITY_REQUIRED`, and the guard's
  grant lookup additionally refuses empty-string `approved_by` grants.
- **New API keys default to `member`, not `admin`** (API default and the
  dashboard create-form default). An implicit admin default meant the same
  key an agent uses to submit actions could approve them — machine
  self-approval through the human gate. Admin keys must now be requested
  explicitly; `docs/SECURITY.md` records the rule "agent keys must never be
  admin."

## [4.61.0] — 2026-07-05

Auth-lookup failure honesty. A cold audit (principal-engineer pass over the
whole repo) picked this as the single change that most improves adoption
and trust: any database failure inside the middleware's API-key/OAuth
lookup — stale schema after a deploy, unreachable Postgres, missing column —
was swallowed into a flat `401 "Invalid or missing API key"`. The project's
own docs called it "the stale-schema trap": the error blamed the caller's
key when the instance was broken, which is the worst possible first-hour
signal for a new adopter. The repo already stated the correct principle for
trial sessions ("a DB lookup FAILURE is NOT the same as 'org gone'",
`middleware.js`); this release applies it to the main auth path.

### Changed

- **Middleware auth now answers `503` — never `401` — when the credential
  lookup itself fails.** Classified bodies mirror `app/lib/apiErrors.ts`
  and the operator-key path: `SCHEMA_NOT_INITIALIZED` (Postgres
  42P01/42703, with `migrate_url`), `DB_CONNECTION_FAILED` (08xxx/57P03,
  network errors, Neon driver fetch failures), `AUTH_LOOKUP_FAILED`
  (anything else). Every body says the key itself was not checked and
  names the fix. A `401` now means the database positively rejected the
  credential (no such key, or revoked). Applies to the api_keys slow path,
  the self-host internal resolve-key hop (whose 500 body now carries the
  Postgres error code so the distinction survives the hop), and OAuth
  bearer verification (a DB outage no longer triggers the `/api/mcp`
  re-auth challenge loop). Fail-closed is unchanged: a 503 still denies;
  failures are never cached, so the next request re-checks.

### Fixed

- Docs that taught the old misleading symptom (CLAUDE.md gotcha, plugin +
  hooks troubleshooting, Claude Desktop connector guide, hosted runbook,
  platform-intelligence skill) now describe the honest 503 contract.

## [4.60.1] — 2026-07-05

Roadmap v6.3 "organic search surface" — the marketing SEO truth pass. The
live site had no crawl plumbing at all (`/robots.txt` and `/sitemap.xml`
404'd, zero canonical URLs, zero structured data), so strangers who search
had nothing to land on. Spec:
`docs/superpowers/specs/2026-07-05-seo-truth-pass-v63.md`.

### Added

- **Host-aware `/robots.txt` and `/sitemap.xml`** (route handlers): the
  marketing host (`dashclaw.io` / `www.dashclaw.io`) gets crawl rules +
  an 18-URL sitemap; **every other host serving this codebase — the
  hosted trial, self-host instances, previews — answers `Disallow: /`**
  so private governance dashboards never get indexed. No fabricated
  `lastmod` dates.
- **Canonical + page-specific OpenGraph/Twitter tags on all 17 marketing
  pages** (landing, 8 guides, 3 blog posts, /docs, /self-host, /privacy,
  /connect, /downloads, /practical-systems) via a single
  `marketingPageMetadata()` helper (`app/lib/marketingSeo.ts`), plus
  `metadataBase` and the canonical-host fix (`www.dashclaw.io`, where the
  apex actually redirects) in the root layout.
- **JSON-LD structured data**: SoftwareApplication + Organization on the
  landing page, BlogPosting with real git-derived publish dates on the 3
  blog posts (no fabricated authorship), TechArticle on the 8 guides.
- Unit coverage: `__tests__/unit/marketing-seo.test.ts` pins the per-host
  robots/sitemap behavior and the canonical/OG builder.

### Fixed

- Hermes guide: the doctor note now reads "API reachability plus a
  finalize: true probe" — the doctor genuinely has 4 sections; the old
  sentence enumerated 5 items. (The claims audit found everything else
  accurate; the full table is in the spec.)

## [4.60.0] — 2026-07-05

Roadmap v6.4 "reach attribution" — pulled forward per the roadmap's own
watch-list trigger (reach channels started moving the same day: PR #9313
live, Glama listing approved). Before this, a mint carried no source: a
successful reach act would have been indistinguishable from organic
arrival, wasting the v6.5 measurement read. Spec:
`docs/superpowers/specs/2026-07-05-reach-attribution-v64.md`.

### Added

- **Mint-time source capture** (one write at mint, no analytics platform):
  the `/connect` mint sends `document.referrer` + the page's
  `utm_source`/`utm_medium`/`utm_campaign`; the server sanitizes
  (`app/lib/hosted/mint-source.ts` — allowlisted keys, length caps) and
  resolves one channel label (`utm_source` > referrer host > `direct`;
  own-host referrers are not a channel). Stored at org grain
  (`organizations.trial_mint_source` + `_raw`), spoofable by design —
  measurement, not security.
- **Snapshot freeze** (drizzle/0054): `hosted_trial_snapshots` gains
  `mint_source` + `mint_source_raw`, written by the same fail-closed
  deletion freeze as v4.6. Pre-v6.4 rows stay NULL = unknown, never
  guessed.
- **Per-channel funnel annotation**: `GET /api/hosted/funnel` and the
  /setup "Trial activation funnel" card gain `annotations.bySource`
  (`{source, minted, firstAction}`, truthful zeros, `unknown` distinct
  from `direct`, top-10 + `other` rollup since labels are
  attacker-mintable strings on a public route).
- Tests: mint-source resolver suite, bySource aggregation (unknown bucket,
  rollup), snapshot freeze columns; policy smoke AA1 now pins
  `annotations.bySource`.
- Live proof (local hosted mode): a mint tagged `utm_source=v64-live-proof`
  appeared in the funnel route and rendered on /setup; deleting the
  workspace froze `mint_source` + raw strings into the snapshot; residue
  cleaned to zero.

## [4.59.2] — 2026-07-05

Roadmap v6.2 "registry presence" — be findable where agent builders look,
with submissions the project's own credentials can make. Docs-only ship
plus one metadata file; the Node/Python SDKs are not republished (registry
stays at 4.32.0).

### Added

- Submitted DashClaw to
  [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers/pull/9313)
  (Security section) via their agent-PR fast-track, with AI authorship
  stated per the charter's outward-acts clause.
- `mcp-server/glama.json` (schema verified live): names `ucsandman` as
  maintainer so Glama's crawler indexes the MCP server.

### Changed

- `docs/DISTRIBUTION-LISTINGS.md` re-framed under the charter's
  outward-acts clause and extended into the recorded submissions ledger:
  live listings verified 2026-07-05 (official MCP registry active at
  2.0.1, PulseMCP, npm/PyPI, the repo-as-plugin-marketplace, ClawHub),
  8 declined venues each with a reason (incl. two honesty blocks: Cline's
  tested-install attestation, awesome-claude-code's human-submitter
  requirement), and 4 accelerants for Wes.
- Roadmap v6 drafting evidence corrected in place: the "listed in no MCP
  registry" claim was false — the official registry has carried
  `io.github.ucsandman/dashclaw` since 2026-06-11. The maintainer log
  records the recon miss.

## [4.59.1] — 2026-07-05

Roadmap v6.1 "the repo speaks" close-out — the README stranger-walk and
repo-metadata truth pass. Docs-only ship; the Node/Python SDKs are not
republished (registry stays at 4.32.0).

### Changed

- `README.md` first screen, re-read as a stranger: the hosted trial is now
  the first actionable thing — a "Try it now" link to
  [hosted.dashclaw.io/connect](https://hosted.dashclaw.io/connect) (both
  URLs probed live before linking) plus a new step 2 in the 60-second
  proof path (mint a trial workspace, send the first governed action from
  the browser). Previously the trial first appeared at line 123 inside a
  CLI install comment.
- `README.md` now states the project's most distinctive true fact on the
  first screen: this repo is maintained by an AI in public under a
  human-held charter, linking `MAINTAINER.md` and the maintainer log.
- Repo metadata truth pass (description, homepage, 18 topics): verified
  accurate against the product — zero changes needed, recorded per the
  "fix only what's wrong, no churn" rule.
- `docs/plans/owner-roadmap.md`: v6.1 marked SHIPPED;
  `docs/maintainer-log.md` records the stranger-walk findings and why the
  fix was ordering, not content.

## [4.59.0] — 2026-07-05

Roadmap v5.5 "reach-readiness verdict" — the era's exit instrument, and
the close of roadmap v5. Docs-only ship; the Node/Python SDKs are not
republished (registry stays at 4.32.0).

### Added

- `docs/superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md`: the
  reach-readiness verdict — **READY**. Cites the live funnel (4 minted /
  0 key used / 0 first action / 0 retained, all mints predating the v5
  fixes), states the three-part bar (mechanism, instrument, window — all
  met 2026-07-05) and the measurement contract for the first reach act,
  including the explicit counter-verdict trigger (≥10 mints with zero
  first actions moves the diagnosis from friction to value-prop).
- The v5.2 human live proof landed this session: a human Turnstile mint
  reached a governed action via the guided browser flow in 29 minutes on
  hosted.dashclaw.io; the maintainer run was then removed under the
  funnel-truth protocol (cap-0 delete, residue verified zero).
- `@dashclaw/cli@0.6.0` publish confirmed live on npm (closes v5.4's open
  loop).

Roadmap v5.4 "the outsider run": the CLI trial path (`dashclaw install
claude --trial`, QUICK-START's 3-Minute Hosted Trial) was walked cold for
the first time — fresh environment, published CLI, no ambient env,
following only what the screen says — against the live hosted instance.
Every stumble was fixed in the same release. Recorded run:
`docs/superpowers/specs/2026-07-05-outsider-run-v54.md`. Platform-only for
the Node/Python SDKs (registry stays at 4.32.0); `@dashclaw/cli`
republishes at 0.6.0.

### Fixed
- **`@dashclaw/cli` 0.6.0 — the trial's first question was unanswerable
  cold.** `dashclaw install claude --trial` prompted "Hosted DashClaw
  URL:" but no outsider-facing doc ever named the instance. The CLI now
  defaults to `https://hosted.dashclaw.io` (announced; override with
  `--endpoint <url>` or `DASHCLAW_HOSTED_URL`), pinned by test.
- **`@dashclaw/cli` 0.6.0 — stdin EOF during a prompt exited 0 silently
  with nothing installed.** `ask()`/`askSecret()` left pending promises
  when piped stdin ended; node drained the loop and exited clean. Both
  now reject loudly ("stdin closed before the prompt was answered");
  child-process regression tests in `cli/test/prompt-eof.test.js`.
- **Published-CLI staleness.** npm's `@dashclaw/cli@0.5.0` (2026-06-13)
  had drifted from the repo at the same version number — outsiders got
  hooks without the `--agent-id` identity declaration (v2.2), the
  `Workflow` matcher (v4.3), or the Codex session-digest wiring. 0.6.0
  carries all of it.
- **Copy truth:** QUICK-START said "paste the endpoint + key" — the trial
  flow prompts only for the key; QUICK-START/README/cli README/help text
  now name `hosted.dashclaw.io` as the default trial instance.

### Verified (recorded cold run, 2026-07-05)
- Machine time under 10s end to end: install 5s, installer 0.9s after key
  paste, governed action through the installed hook 0.9s — the "3-Minute
  Hosted Trial" claim stands once the URL friction is gone.
- On the live instance: starter pack pre-seeded (4 policies), decision
  recorded (`agent claude-code`, risk 15), `dashclaw cost` truthful zero,
  stop-hook recap line, and the v5.3 instrument stamped
  `api_keys.first_used_at`/`last_used_at` on a genuine cold path.

## [4.57.1] — 2026-07-05

Landing page redesigned from a 14-section feature inventory into a
9-beat narrative, and `/explain` brought under the same marketing
header. Platform-only — SDKs stay at 4.32.0.

### Changed
- **Landing page (`app/page.tsx`) rebuilt around proof-first structure:**
  hero decision record (one governed action rendered end to end:
  intercept → require_approval → approve → outcome → signature) beside
  the claim, then live demo → governance-vs-tracing → the four-call loop
  annotated → stack quickstarts as tabs (new `StackQuickstarts`, reusing
  `frameworkQuickstarts`) → the enforcement boundary stated plainly →
  use cases → control-room index → CTA. New `HeroDecisionRecord`
  component; hosted-trial CTA logic, marketing tracking ids
  (`vs-alternatives`/`sdk`/`features`/`live-demo`), and the drift-gated
  MCP tool/resource count string all preserved.
- **`app/landingData.js`** now exports only the two rendered arrays
  (`frameworkQuickstarts`, `signals`); the unrendered `corePrimitives`
  array was removed (dead-array trap).
- **`/explain`** carries a static replica of the main page's navbar
  above its section nav, which is demoted to a quiet "On this page" row;
  anchor offsets adjusted so section links land below both sticky bars.
- **Reduced motion:** the global `prefers-reduced-motion` block in
  `app/globals.css` now also zeroes `animation-delay`, so staged reveals
  collapse to an instant render.

## [4.57.0] — 2026-07-05

Roadmap v5.3 — activation instrument sharpened. The hosted-trial funnel
closes its two recorded blind spots (now that v5.1 sessions make them
closable) and gains the browser-vs-agent distinction v5.2 made reachable.
Platform-only — SDKs stay at 4.32.0. Spec:
`docs/superpowers/specs/2026-07-05-activation-instrument-sharpened-design.md`.

### Added
- **Trial visit stamps (org grain).** `organizations.trial_first_seen_at`
  / `trial_last_seen_at`, written fire-and-forget by middleware on a
  cache-miss positive trial-session resolution (the 60s trial-org cache
  doubles as the write throttle). A timestamp, not page-view analytics —
  the funnel can finally distinguish "minted and never returned" from
  "returned, never connected an agent."
- **`api_keys.first_used_at`.** Set once (COALESCE) alongside every
  `last_used_at` stamp on both resolution paths (inline Neon middleware +
  the self-host internal resolve-key route). Deliberately not backfilled:
  NULL means "used before 4.57.0 or never" — time-from-mint-to-first-key-use
  is measurable for keys used from now on.
- **Funnel annotations** on `GET /api/hosted/funnel` and the /setup "Trial
  activation funnel" card: `returned` (seen again >1h after mint),
  `returnedNeverConnected`, `medianHoursToFirstKeyUse`, and
  `firstActionVia` (browser vs agent, keyed on the v5.2 card's pinned
  agent id, now a shared constant in `app/lib/hosted/browser-action.js`).
  Annotations, not new steps — the 4-step funnel is untouched, and unknowns
  (pre-4.57.0 evidence) count in no bucket, truthful-zeros style.
- **Snapshot extension** (`drizzle/0053`): `hosted_trial_snapshots` gains
  `first_key_used_at`, `first_seen_at`, `last_seen_at`, `first_action_via`,
  frozen at deletion time inside the same fail-closed
  snapshot-before-delete write; pre-4.57.0 archived rows keep NULLs.

### Security
- Focused review of the new middleware writes + public aggregate
  disclosure: SHIP, 0 blockers, 2 LOW accepted-tradeoff notes recorded in
  the spec (self-reported agent id can distort the browser/agent split —
  analytics only; small-n annotation counts are the same low-cardinality
  property the v4.6 review accepted). Cross-org stamping impossible (UPDATE
  keyed on the JWT-verified org id); the v5.1 transient-vs-gone cookie
  contract is untouched (stamp fires only after a positive resolve,
  fire-and-forget).

## [4.56.1] — 2026-07-05

Landing-hero polish + a clean anonymous console. Platform-only — SDKs stay
at 4.32.0.

### Fixed
- **One primary CTA in the hero.** The marketing deployment rendered two
  competing brand-orange buttons: the self-host CTA's quiet style was keyed
  to the server's hosted flag, which is off on the marketing site even
  though the trial CTA renders there (`NEXT_PUBLIC_HOSTED_TRIAL_URL`). The
  self-host button now drops to the secondary style whenever the trial CTA
  is configured, the three CTA labels are single-line on one shared
  baseline, and the trial terms ("Free for 30 days, no credit card. Your
  first governed action runs in the browser, no install needed.") sit as
  one caption under the whole row instead of dangling beneath one button.
- **Zero console errors for anonymous visitors.** `AgentFilterProvider`
  (mounted on every page, marketing included) fetched `/api/agents`
  unconditionally, logging a 401 in every anonymous visitor's console. The
  fetch is now gated on the session probe (demo mode still passes), and
  `/api/session/effective` — which answers `{authenticated:false}` from the
  caller's own cookie and nothing else — joined `PUBLIC_ROUTES`
  (boundary-matched, rate-limited, headers stripped) so the probe itself no
  longer 401s. Security review of the middleware change: SHIP, 0 findings;
  pinned by `middleware-auth.test.js`. Verified rendered: marketing-mode
  build, zero console errors and zero 4xx/5xx at load and full-page scroll,
  desktop and mobile.

## [4.56.0] — 2026-07-05

Roadmap v5.2 — **First governed action in the browser.** v5.1 gave a
minted trial a session and a visible product; this ships the activation
step itself: a guided "send your first governed action" on `/connect`
that needs no install. The browser exercises guard + record against the
trial's own org and the decision lands in the ledger, live. Spec:
`docs/superpowers/specs/2026-07-05-first-governed-action-browser-design.md`.
Platform-only — no SDK source change, so npm/PyPI stay at 4.32.0.

### Added
- **Guided first governed action on `/connect`** (trial branch only): a
  card showing the real request payload (editable `declared_goal` +
  `action_type`, fixed `agent_id: browser-first-action`) that sends one
  same-origin `POST /api/guard?record=true` riding the v5.1 trial-session
  cookie — no proxy, no new route, no new auth surface. The decision
  renders in place (allow / warn / block / require_approval, server risk
  score, reason, matched-policy count) with a deep link to
  `/decisions/<action_id>`; a `block` renders the truthful "blocked
  actions never reach the action ledger" copy, and a trial-envelope 403
  renders the honest cap/expiry message. Defaults are pinned by test
  against the shared synthetic-traffic exclusion so browser activations
  can never silently vanish from the hosted funnel — a browser-guided
  action is a real governed action and counts as `firstAction`
  (maintainer verification runs tag `liveproof.*` and stay excluded).
- **Inbound paths**: the `/decisions` empty state, Mission Control's
  QuickStart, and the post-mint success state now point at
  `/connect#first-action` (a full-load `<a>` post-mint, so the
  server-rendered card picks up the just-set session cookie); the
  landing hosted-trial CTA gains the zero-install claim; QUICK-START's
  trial section documents the browser path. Smoke section AC pins the
  hosted-off inertness of the panel.

### Verified
- Local rendered proof (production build, `DASHCLAW_HOSTED=true`): HTTP
  contract 6/6 (card renders only for the trial session; the guided call
  returned `allow`, `recorded: true` + `action_id`; the ledger deep link
  renders; anonymous same-origin write refused 401) and a browser
  click-through (card → send → ALLOWED badge → Decision Replay page,
  zero console errors). Security review: SHIP, 0 findings — the "no new
  auth surface" claim confirmed against the diff.

## [4.55.0] — 2026-07-05

Roadmap v5.1 — **A way back in.** The hosted trial's first funnel reading
(v4.6) was 4 mints, 0 activations: the mechanism recon found that a
Turnstile-minted trial got an API key and *nothing else* — no session, no
dashboard, no way back after the tab closed. The trial handed a stranger a
credential into a void. This ships the way back in. Spec:
`docs/superpowers/specs/2026-07-05-a-way-back-in-design.md`. Platform-only —
no SDK source change, so npm/PyPI stay at 4.32.0.

### Added
- **Trial session cookie** (`dashclaw-trial-session`): `POST
  /api/hosted/workspaces` now mints a signed httpOnly JWT session (HS256 via
  `NEXTAUTH_SECRET`, `SameSite=Lax`, `Secure` in prod, `exp` pinned to the
  trial's `trial_ends_at`) alongside the API key, so closing the tab no
  longer orphans the workspace. Degrades to today's key-only response when
  `NEXTAUTH_SECRET` is unset; the response reports `session: boolean` so the
  UI never promises a dashboard it didn't sign the browser into.
- **Middleware trial-session branch** (hosted-only, fail-closed): after the
  NextAuth and local-admin checks, a valid trial cookie whose org is a live
  hosted trial renders that trial's *own* mission-control and decisions
  (`x-org-role: admin` of exactly its own org). Same-origin dashboard
  fetches get read visibility with the trial write envelope (action cap +
  expiry via `enforceHostedTrial`). A cleaned-up/expired trial lands on an
  honest `/connect?trial=expired` state, never a dead `/login`. A transient
  DB error **preserves** the cookie (deny-and-retry) — only a definitively
  gone trial clears it.
- **`/connect` way back in**: the post-mint screen adds "Open your
  dashboard" (only when a session was actually minted); a returning trial
  visitor sees a workspace card (expiry, action usage, links to
  mission-control/decisions/API-keys); the mint section stays available so a
  capped trial always has a path forward. Mission Control and the decisions
  ledger empty states link to "connect your first agent".

### Security
- **Operator-route hardening.** The new trial admin session armed four
  routes that gated on `x-org-role: admin` alone. A shared
  `denyTrialPrincipal` guard (hosted-only, fail-closed) now blocks a
  hosted-trial principal from cross-tenant/operator ops: `GET`/`DELETE
  /api/hosted/workspaces/:id` (inspect/delete any workspace), `POST
  /api/orgs` (create uncapped tenants), `POST /api/hosted/cleanup`
  (instance sweep, admin-role path), and `GET /api/keys/reveal` (the
  operator bootstrap key). The operator (non-trial org) still passes; the
  cron/secret paths are unchanged. Found by an in-ship security review
  (BLOCK → fixed → SHIP).

## [4.54.0] — 2026-07-05

Roadmap v4.6 — **Funnel truth: read the trial evidence.** The hosted trial
has run since June with the funnel unread; this is the instrument that
decides v5's direction (reach vs RBAC vs deepen). No outreach — the funnel
reads, it does not steer. Spec:
`docs/superpowers/specs/2026-07-05-funnel-truth-design.md`.

### Added
- **`GET /api/hosted/funnel`** (route 332): the hosted-trial activation
  funnel — mint → first key used → first governed action → retained
  week 1 — computed from existing ledgers (`organizations`, `api_keys`,
  `guard_decisions` ∪ `action_records`) with the shared synthetic-traffic
  exclusion. Aggregate-only: no org ids, slugs, or key prefixes ever leave
  the repository. Hosted-gated (404 when `DASHCLAW_HOSTED` is off), public
  like `/api/hosted/capacity` — an explicit, security-reviewed disclosure
  decision recorded in the spec — with a per-instance 60s memo so anonymous
  hot loops hit memory, not the DB. A mint = `hosted_mode` +
  `trial_action_cap > 0`; capacity-full `markTrialFull` placeholders never
  count. Retention has a denominator: workspaces younger than 7 days render
  as `week1Pending`, never as churned.
- **Trial activation funnel card on `/setup`** (hosted mode only): the four
  steps with conversion rates, week-1 eligibility, median hours to first
  governed action, per-mint-week cohort table (8 weeks), and the
  `truthfulSince` evidence window. Absent on non-hosted instances — the
  instrument doesn't apply, and a permanently-zero funnel would be noise.
- **`hosted_trial_snapshots`** (drizzle/0052): deletion-time freeze of each
  trial's funnel milestones, written **inside `deleteHostedWorkspace`
  before the FK child sweep** and deliberately carrying no FK to
  `organizations` so the catalog-driven sweep can't destroy it. The write
  is fail-closed: a failed snapshot aborts the delete (the cleanup sweep
  retries) rather than silently recreating the survivorship bias — without
  this, expired 30-day trials vanish from the funnel and mint counts decay.
  Pre-ship purged history is unrecoverable; `truthfulSince` marks the
  honest window.
- **Smoke AA1**: the funnel gate — 404 on hosted-off instances, aggregate
  shape with zero org identifiers on hosted-on (114 checks total). Funnel
  math is pinned by vitest (14 new tests) plus a live-DB round-trip:
  deleted trial still counts, frozen retention kept, synthetic excluded.


Roadmap v4.5 — **Loosening direction: proposals that relax.** v3.2 built
tightening; precision requires the mirror or over-interrupting policies get
bulk-disabled instead of tuned (the June disable-pattern, re-proven live by
v4.1). Spec: `docs/superpowers/specs/2026-07-05-loosening-direction.md`.

### Added
- **`/api/policies/loosening`** (route 331, stable): loosening proposals
  computed on read from interrupt-approval outcomes — the exact evidence
  class v4.1 recorded ("100%-approved protected-path interrupts = loosening
  evidence"). Two rules at two grains: `relax_policy_scope` carves an
  always-approved action type out of a policy's `action_types` envelope
  (exact-match splice; the rest stays governed), `deactivate_policy` for
  policies always overridden with no surgical fix (protected_path,
  rate_limit, envelope-emptying). `risk_threshold` policies are excluded —
  tuning owns that direction; one human never sees the same policy in two
  queues. Bar: override rate ≥ 0.95 with minFired 10 / minResolved 5,
  deadline-degraded and synthetic decisions excluded in SQL.
- **Ratify applies the relaxation server-side** in the same request
  (tightening's precedent): the `lp_` content-stable id doubles as a
  snapshot integrity check, the patch is rebuilt from the policy's CURRENT
  rules (409 on drift), and the write self-suppresses the proposal through
  the policy's `updated_at` evidence-window reset. Undo deletes the judgment
  and keeps the change (`change_kept` — the `policy_kept` precedent).
  Decisions persist in `loosening_proposal_decisions` (drizzle/0051).
- **Fifth judgment-spine queue** on `/policies` (`#loosening`): same row
  grammar, ratify/dismiss/undo buttons, evidence line with approved/denied
  counts and override rate, deep link to the decisions ledger.
- Engine unit tests (16) pin both rules, the 0.95 boundary, the
  envelope-empty fallthrough, and the tuning-ownership exclusion; smoke
  Z1–Z5 prove the live round-trip: seed → mine → surgical ratify (carved
  type flows, sibling still interrupts) → self-retire → undo keeps the
  relaxation. 113/113 live checks.

### Fixed
- **The tuning repository had no synthetic exclusion** — `smoke-*`/
  `loadtest-*` agents and `smoke.%`/`loadtest.%`/`liveproof.%` action types
  counted as tuning evidence since v1 (the same failure v4.1 diagnosed in
  the flood path, pointed at the proposal engine). Both evidence queries
  now exclude harness traffic in SQL before aggregation; the smoke harness
  uses the new `?include_synthetic=1` toggle on `/api/policies/proposals`.
  `getDegradationStats` deliberately stays unfiltered — it measures
  guard-path latency health, and a deadline blown on harness traffic is a
  real miss.

Roadmap v4.4 — **One judgment spine: unify the proposal queues.** Every
policy judgment a human faces — tuning, tightening, calibration, and
behavior-learning — now appears in one Judgment queue on `/policies` with
one decision grammar (propose → ratify/dismiss → undo). The engines stay
where they live; only the review surface and the decision UX unify.

### Added
- **JudgmentSpine** (`app/policies/components/JudgmentSpine.tsx`): one
  section replacing the three sibling proposal sections (Tuning,
  Tightening, Calibration) and additionally hosting pending
  behavior-learning suggestions — per-queue adapters over each engine's
  existing GET/POST routes, no new aggregate API, no persistence moves.
  Queue anchors preserved (`#tightening` deep-links from posture still
  land) and `/policy-coach` remains the behavior workbench.
- **Behavior suggestions join the decision grammar**: new
  `action: 'undo'` on `POST /api/behavior/suggestions` (deletes the
  recorded judgment; an adoption's draft policy is kept and echoed as
  `policy_kept`, the tightening precedent), and adopt-enforceable now
  persists a `status='adopted'` suppression row with the new
  `behavior_dismissals.policy_id` column (drizzle/0050).
- **`agent_allowlist` guard policy type** (16th): warns (or escalates)
  when an agent uses an action type outside its observed safe envelope;
  fires only on novel action types by construction. Behavior Learning's
  enforceable suggestion types lift 2/6 → 3/6 with simulation ==
  enforcement parity (`decideSample` mirrors the evaluator); authoring
  supported in the `/policies` policy builder. No-lift verdicts for the
  sequence pair and model-mismatch recorded in `docs/behavior-learning.md`
  with revival triggers.
- **Smoke X1–X3 + Y1**: allowlist enforcement round-trip and the behavior
  undo contract, live-proven (107/107).

### Fixed
- **Adopted suggestions no longer re-surface as pending**: adopting an
  enforceable behavior suggestion had never written a suppression row, so
  the same suggestion returned on every analysis pass. The `adopted` row
  closes it (and makes the adoption undoable).
- **Warn-level reasons ride in `signals`** (existing guard contract) — the
  new smoke pins it rather than expecting a top-level `reason`.

## [4.51.0] — 2026-07-04

Roadmap v4.3 — **Fleet attribution: parent → subagent → workflow lineage.**
Lineage lands as persisted evidence joined at read time — never a client-side
guess. A multi-agent fan-out now reads as one governed unit with per-leaf
attribution instead of N unrelated agents.

### Added
- **Lineage columns** (drizzle/0049): `action_records.harness_session_id`
  (stamped by the PreToolUse hook on *every* record) and
  `action_records.subagent_uuid` (stamped on leaf calls inside a subagent).
  The `sess_*` DashClaw-session namespace is untouched — overloading
  `session_id` would have corrupted session aggregates (documented collision).
- **Spawn linkage**: the PostToolUse hook extracts the spawned agent id from
  an Agent/Task/Workflow tool_response and the server selectively persists
  that ONE `outcome_metadata` key (`spawned_agent_uuid`) into the
  `outcome_progress` jsonb — build finding: the outcome whitelist had silently
  dropped *all* `outcome_metadata` since it existed. The stamp lands even on
  already-auto-closed spawn rows (lineage is not a close field). The fan-out
  view joins `leaf.subagent_uuid = spawn.spawned_agent_uuid` per session.
- **Workflow fan-outs are governed at spawn**: `Workflow` joins `Agent|Task`
  in every hook matcher (settings template, installers) and the tool
  classifier — a fan-out is guard-evaluated and recorded as `orchestration`
  before it runs. Per-run leaf ids remain an upstream gap (no run identifier
  on hook stdin), recorded in the spec.
- **Fan-outs surface**: new `GET /api/agents/fanouts` (route 330;
  `?include_synthetic=1` diagnostic) over a read-time lineage join; `/agents`
  gains a Fan-outs panel (parent, agents, spawns/actions, span) deep-linking
  to `/swarm?swarm_id=<session>`; `/swarm` finally honors the scope param.
- **Smoke section W** — W1–W4 pin the lineage contract: fields persist, the
  stamp survives the whitelist, the fan-out reads as one unit with the join
  populated, synthetic sessions stay invisible.

### Fixed
- `GET /api/swarm/graph?swarm_id=` scoped branch merged the entire org roster
  back into the "scoped" result, so scoping never filtered anything
  (pre-existing, previously unreachable from the UI). A scoped view now
  returns only the session's agents.

### Changed (data, owner-directed)
- Historical identity migration: the mislabeled `codex` agent (all Claude
  Code sessions recorded under it via the stray env var fixed in v4.50.0) is
  renamed to `claude-code` across ~100k ledger rows in 12 tables, composed
  subagent ids included; unique-key collisions merged in favor of the newer
  `claude-code` rows. Real Codex CLI runs still mint `codex` going forward.

No Node/Python SDK source change — the SDKs are not republished (registry
stays at 4.32.0).

## [4.50.0] — 2026-07-04

Roadmap v4.2 — **Coverage truth: the record knows what it missed.** The item
was drafted on the April ~96% PostToolUse miss rate; live diagnosis found the
miss had recovered invisibly (~3% auto-close over 48h) — and that
invisibility, in both directions, is the defect this release fixes.

### Added
- **Closure provenance** — `action_records.close_source` (`outcome` |
  `stop_autoclose` | `direct`, drizzle/0048): every action row now records
  durably *how* it reached terminal state, replacing string-matching on the
  Stop-hook placeholder. Stamped server-side only, atomically with the close.
- **Coverage reports** — the Claude Code Stop hook posts one per-turn
  expected-vs-recorded report to the new `POST /api/coverage` (route 329),
  computed from the transcript's `tool_use` ground truth — evidence that is
  independent of whether PreToolUse/PostToolUse fired. `GET /api/coverage`
  returns per-agent record + outcome coverage over a window;
  `?include_synthetic=1` is an ephemeral diagnostic view.
- **`/agents` Coverage column** — per-agent record coverage with an explicit
  dashed **"No evidence"** state, so absence of evidence never renders as
  health; outcome coverage in the tooltip.
- **Posture finding** — `Event coverage dropped` (dimension: auditability)
  fires when a real agent's record or outcome coverage falls below 90% with a
  minimum evidence sample of 20, deep-linking to `/agents`. Synthetic families
  (smoke/loadtest/liveproof) are excluded end-to-end via the shared predicate.
- **Smoke section V** — V1–V4 live-prove the drop-detection math (a 20%
  degraded stream vs a 100% healthy control) and that synthetic reports never
  leak into real coverage or posture.

### Fixed
- `route-sql:check` false positive: prose like `` foo.sql` `` in a route-file
  comment counted as a tagged SQL template (pre-existing gate breakage on
  `app/api/setup/migrate/route.ts`); the scanner now requires a real `sql`
  identifier boundary.
- Fresh-install parity for `close_source`: added to `CRITICAL_TABLES_DDL` and
  the runtime reconcile column list (and declared in
  `contracts/setup/runtime-migration.json`), so fresh and legacy schemas agree.

### Operational (this machine, not code)
- Root-caused fleet-wide mis-attribution: a stray User-level
  `DASHCLAW_AGENT_ID=codex` plus pre-v4.29 global hook wiring recorded **all**
  Claude Code sessions as agent `codex` (`claude-code` = 0 rows in 7 days).
  Rewired global hooks with explicit `--agent-id claude-code` and removed the
  env var; new sessions attribute correctly. Historical rows are not rewritten.

No Node/Python SDK source change — the SDKs are not republished (registry
stays at 4.32.0).

## [4.49.1] — 2026-07-04

Roadmap v4.1 — own-fleet interruption noise. The 2026-07-04 approval-flood
banner ("~1,802 interrupts in window") was the guard-load harness: the
runaway-loop valve correctly paused a 2,500-evaluations/hour synthetic
agent, but the harness's traffic wasn't classified synthetic, so it lit
every human surface. Spec:
`docs/superpowers/specs/2026-07-04-own-fleet-interruption-noise.md`.

### Fixed

- The shared synthetic-traffic predicate (`app/lib/calibration-mining.js`)
  now covers the guard-load harness (`loadtest-*` agents) and the
  `loadtest.*` / `liveproof.*` action-type families, alongside the
  existing `smoke.*` families. Consumers fixed by the shared change:
  approval-flood counting (no more flood banners from load runs), posture
  governable units + incident window (the "loadtest.read is not fully
  governed" findings stop being minted), tightening proposals, and
  calibration mining. The action-type side generalizes from a single LIKE
  pattern to a pattern list (`SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS`); the
  regex↔LIKE agreement test pins the new families in both forms.
- Diagnosis verdicts recorded in the spec: the `rate_limit` evaluator and
  both Claude Code Mode policy configs are unchanged (the valve worked;
  per-agent scoping already isolates harness ids); the 100%-approved
  protected-path `apply` interrupts are recorded as loosening evidence
  for v4.5; the posture approval dimension's 0 is a stale ungoverned
  capability (`ps-qa:review_artifact`), not flood fallout.

## [4.49.0] — 2026-07-04

Closes roadmap v3.7 (deferred-debt triage): every parked item from this era got
a written build-or-kill verdict — 9 builds shipped below, 6 kills recorded with
reasons and revival triggers. Spec:
`docs/superpowers/specs/2026-07-04-deferred-debt-triage.md`.

### Changed
- **JWKS verification is fail-closed when no issuer is configured**: with
  `DASHCLAW_ALLOWED_ISSUER` unset, bearer tokens now resolve `unverified` and
  the JWKS is never fetched (previously any issuer with a reachable JWKS was
  accepted — letting any API-key holder forge "verified" identity for
  arbitrary agent ids). Flipped while the verified fleet was empty, same
  evidence as the v3.6 default flips; enabling verification is the same single
  env var it always was. The `/setup` enforcement-posture card gains a
  verified-identity row (issuer URL never disclosed).
- **API error responses redact exception detail in production**: the shared
  `apiErrorResponse` handler (219 call sites) returned raw `err.message` to
  any API-key/JWT holder — schema internals leaking to governed agents. In
  production, `detail`/`code` are withheld unless
  `DASHCLAW_EXPOSE_ERROR_DETAIL=true`; development unchanged; the curated 503
  branches (schema-not-initialized, DB unreachable) stay descriptive. The
  public `/api/setup/migrate` error path got the same gate.
- **x402 purchases accept a closed currency set**: `DASHCLAW_X402_CURRENCIES`
  (comma list, default `USDC`); unknown currencies → 400. Spend aggregation
  sums amounts 1:1 against USD budget ceilings, so a fabricated currency
  corrupted budget-limit bookkeeping — this is budget integrity, not hygiene.

### Added
- **x402 purchase idempotency**: optional `idempotency_key` on
  `POST /api/x402/purchases` (migration 0047, unique per org). A retried
  request returns the original purchase with `idempotent_replay: true` instead
  of minting a second action + purchase row that double-counts spend —
  bringing the money route up to the protection `/api/guard` and
  `/api/actions` already had.
- **Codex SessionStart digest parity**: `dashclaw install codex` now ships the
  session-digest hook and wires `[[hooks.SessionStart]]` — the parity doc's
  "wire only after confirming the event fires" condition was met by probing
  codex-cli 0.139.0 (event enum + a live registered SessionStart hook).
  Installer test pins both.
- **`CRITICAL_TABLES_DDL` drift gate**: the setup-migrate fallback DDL was a
  stale pre-Phase-2 snapshot (guard_decisions missing 8 columns — any deploy
  taking that branch would hard-fail the required audit INSERT). Every table
  block regenerated from `schema/schema.js`, and a new unit test fails the
  suite if the fallback ever diverges again.
- **Expired approvals show when they expired** (`/approvals`): the Expired
  section rendered an unlabeled *request* time; rows now carry labeled
  Requested/Expired timestamps, and pending cards show their expiry.
- **Degradation by-day strip** (`/policies`): the tuning cockpit's
  `by_day` data was fetched but never rendered; it now draws as a quiet
  bar-per-day strip beside the existing sentence.
- Guard-load SLO gate calibrated from a real warmed run (see the scope doc for
  the derivation); the harness stays on-demand by design.

### Fixed
- Dependabot's npm_and_yarn updater no longer fails EOVERRIDE: the duplicate
  `postcss` devDependency was removed; `overrides.postcss` remains the single
  source of the GHSA-qx2v-qp2m-jg93 pin (own commit, pre-release).

### Killed (recorded verdicts, see the spec)
- /decisions list risk-composition hint (hot shared list path; full breakdown
  one click away). Degradation per-policy split (timing artifact, not a policy
  property). Guard-load CI wiring + LLM slow-path scenario (flaky-by-nature in
  shared CI; unseeded slow-path is "theatre" per the harness's own authors;
  revival trigger = degradation-rate recurrence). `verification_status` DB
  enum (single writer through a TS union). Full per-org JWKS issuer binding
  (hosted multi-tenant future; revisit on real demand). Assumption
  contradiction detection (no false-positive budget exists; LLM-free
  techniques conflate similarity with contradiction). Calibration
  duplicate-vs-corpus detection + in-UI rename (deferral rationale intact,
  zero recurrence since v4.34.0).

## [4.48.0] — 2026-07-04

Closes roadmap v3.6 (enforcement over assertion): "blocks are absolute" is now
stated exactly — mechanical where the code can enforce it, cooperative where it
can't — and the hardening defaults graduated while the flip was measurably
free. Spec: `docs/superpowers/specs/2026-07-04-enforcement-over-assertion.md`.

### Changed
- **`DASHCLAW_JTI_REPLAY_PROTECTION` now defaults to `required`** (was
  `best_effort`): a verified JWT must carry a fresh `jti`, and a replay-store
  outage fails closed. Flipped on evidence: the live ledger held 176,149 guard
  decisions with **zero** verified-JWT traffic, so no existing caller changes
  behavior — future issuers onboard against the full contract from day one.
  Verified-JWT traffic only; API-key callers resolve `not_applicable` and are
  never touched (now pinned by `evaluateGuard`-level tests). Rollback is one
  env var: `DASHCLAW_JTI_REPLAY_PROTECTION=best_effort`. The duplicated
  default literal is gone — both call sites read one getter
  (`app/lib/replay-protection.ts`).
- **`DASHCLAW_ACT_BINDING` now defaults to `best_effort`** (was `off`): a
  verified token bound to a different `(action, target, goal)` tuple now
  blocks. Blocking requires a *present* binding claim, so issuers that don't
  mint one see zero behavior change. `required` stays opt-in (it would make
  minting the claim a precondition for JWKS adoption). Rollback:
  `DASHCLAW_ACT_BINDING=off`.

### Added
- **Enforcement-boundary ADR** (`docs/architecture/enforcement-boundary.md`):
  the canonical per-surface table of where a block is mechanically executed
  (Claude Code / Codex / Hermes hooks, the OpenClaw gateway plugin, and
  `dashclaw_invoke` server-executed capabilities) versus cooperatively honored
  (SDK, direct API, bare MCP, Claude Desktop / consumer chat) — plus the
  recorded **kill** of the universal enforcing proxy for non-cooperating
  harnesses: consumer chat exposes no pre-execution interception point, and
  re-registering every connector behind `dashclaw_invoke` would make DashClaw
  a connector broker, not a governance runtime. Supersession trigger recorded.
- **`/setup` Enforcement posture card**: the instance's live hardening modes
  (replay protection, action binding, degraded-evaluation fallback), read
  through the guard's own getters so the card can never disagree with the
  engine. Because `/setup` is unauthenticated, a knob set *below* its hardened
  default renders as "review recommended" with the value withheld (in-ship
  security-review fix) — a hardened instance discloses only defaults; a
  weakened one hands no recon to visitors.
- `evaluateGuard`-level replay-protection mode tests (7), mirroring the
  act-binding block: `best_effort` vs `required` across `replayed`,
  `not_present`, `unavailable`, `unique`, and the `not_applicable` API-key
  exemption.

### Fixed
- **Truth pass on every "blocks" claim**: README (proof path, Intercept/
  Enforce rows, injection-scanning claim), QUICK-START (demo framing, "abort
  on block" now says the caller's abort is the enforcement), SDK READMEs (the
  Python "unauthorized action prevented" comment is gone), `app/docs` SDK
  snippets, `/self-host` and landing feature cards, `runtime-api.md`
  ("blocks are absolute" now scoped to the decision layer with the per-surface
  link), `PROJECT_DETAILS.md`, the governance skill (explicit note that the
  skill is the cooperative half and hooks are the mechanical backstop), and
  `docs/CLAUDE-DESKTOP-PLUGIN.md`, which previously carried **no**
  advisory-vs-enforced language at all. Product copy now says nothing
  stronger than what the code enforces.

## [4.47.0] — 2026-07-04

Closes roadmap v3.5 (attention budgets: approval-flood guard) — as an audit,
not a build. The item's premise was false: the W3 interruption budget shipped
complete in v4.15.0 (2026-06-12) and the roadmap's 2026-07-03 drafting sweep
missed it. What v3.5 actually needed was the era's truth bar applied to the
shipped guard: one real gap (flood detection counted synthetic traffic),
smoke + rendered proof, and the three June owner questions decided on the
record. Spec revision:
`docs/superpowers/specs/2026-07-04-approval-flood-guard-revision.md`. No SDK
source change (no republish).

### Fixed

- **Synthetic traffic can no longer trip an approval flood.** The flood
  counting query (`getRecentApprovalCountsByPolicy`) predated v3.1 and
  counted policy-smoke / self-test traffic like real interrupts — a live
  smoke run's `require_approval` decisions accrued toward the fleet budget
  (default 30/15min), and a fleet trip suppresses per-action Telegram/Discord
  prompts for **every** policy while minting the red `approval_flood` signal.
  Synthetic verification traffic could therefore silence real approval pings.
  The query now excludes the shared v3.1 predicate (`smoke.%` action types +
  synthetic agent families from `calibration-mining.js`) inside the unnest
  subquery, before aggregation — same structural posture as posture, mining,
  and tightening.

### Added

- **`GET /api/approvals/floods?include_synthetic=1`** — an ephemeral
  would-trip diagnostic view that counts synthetic traffic too: nothing
  persisted, nothing suppressed, nothing notified (the stateful evaluation
  never runs). Exists so the policy-smoke harness has a positive control —
  proving the detector sees a burst — instead of a negative-only assertion
  that can't distinguish a working exclusion from a dead detector
  (tightening's `?include_synthetic=1` precedent). The banner never sends it.
- **Policy-smoke U1–U4** (95 checks total): a budget-exceeding synthetic
  burst is fully interrupted (U1), visible to the diagnostic view with a
  truthful count (U2), invisible to the real flood view (U3), and bulk-denied
  in one call with truthful `{matched, resolved, failed}` (U4).

### Notes — v3.5 closeout audit findings (no code change needed)

- Bulk resolution already honors v2.3 approval expiry (sweeps expired rows
  before matching; the lister excludes overdue rows) — an approval whose
  client stopped waiting can never be bulk-released.
- Constitution §1 holds structurally: bulk matches only `pending_approval`
  rows by a policy's compiled `action_types`; blocked actions never enter
  that state, and `protected_path` policies are refused outright.
- The three June owner questions, decided by the maintainer with v2
  evidence (recorded in the spec revision): budget defaults **kept**
  (10/policy/15min, 30 fleet), digest default **kept** (24h, adapters-gated),
  pause-rule **keeps** pending approvals pending — v2.3 expiry now makes the
  leftovers expire truthfully, which is a stronger rationale than the June
  proposal had.
- Rendered proof: a seeded non-synthetic 50-approval burst rendered as ONE
  flood banner on /approvals ("50 interrupts in 15m — per-action pings
  paused", pause/approve-all/deny-all armed confirms) with all 50 approvals
  still individually actionable below; zero console errors; seeded rows
  removed and flood state verified cleared by hysteresis afterward.

## [4.46.0] — 2026-07-04

Ships roadmap v3.4 (live-host canary): "probe production as the user" becomes
a system, not a lesson. Three audits in one day had failed by trusting code
over the deployed hosts; now a scheduled canary asserts every public
surface's contract from the outside, hourly, and its verdict lands where the
operator already looks. No SDK source change (no republish).

### Added

- **Live-host canary (`scripts/live-canary.mjs` + `.github/workflows/live-canary.yml`).**
  An hourly GitHub Actions cron probes the production hosts as a real
  unauthenticated client — 9 probes, every contract verified against live
  production before it became an assertion: marketing homepage (with the
  trial CTA present), docs render, demo entry redirect, the demo-cookie
  class (the v4.36.3 bug, asserted curl-grade), trial `/connect`, OAuth
  authorization-server + protected-resource discovery, and two probes whose
  pass condition is an auth *challenge*: the trial mint passes on the
  Turnstile `400 missing_token` rejection (fail-closed proven, zero junk
  trials — a `200` is the failure), and the MCP handshake passes on the
  `401` + `WWW-Authenticate resource_metadata` challenge. 15s timeout, one
  retry on network/5xx flake; probes need no secrets, so killing a live
  surface fails the job within one interval even before reporting is wired.
- **`POST/GET /api/live-canary` + `live_canary_runs` (drizzle `0046`).**
  The canary files its verdict to the instance (API-key auth, validated and
  length-capped payload, repository-only SQL, 14-day retention pruned on
  write). Verdicts live in their own table and never touch the action or
  guard ledgers — the canary's synthetic traffic is *structurally* excluded
  from posture scoring and calibration mining rather than filter-excluded.
- **/setup "Live host canary" card (`/setup#live-canary`).** Pass / fail /
  stale / not-reporting states with per-probe verdicts; a canary that has
  not reported for 3h renders as its own warning ("a silent canary is
  itself a finding"). Staleness shares one constant
  (`LIVE_CANARY_STALE_MS`) with the posture derivation so the two surfaces
  cannot disagree about what fresh means.
- **Posture `auditability` finding (`view_live_canary`).** A fresh failed
  run derives exactly one collapsed finding (content-stable key, so
  snooze/accept-risk survive re-derivation) with a one-click path to the
  /setup card; a passing run clears it. The score formula is intentionally
  untouched — a dead marketing page is an operator alarm, not evidence
  about fleet governance.

### Security

- **Cross-tenant public-page injection (HIGH) — found and fixed in-ship.**
  The public `/setup` card originally rendered the instance-wide latest
  run; check titles/details are free text from any API-key holder, so on
  the multi-tenant hosted instance a self-serve trial tenant could have
  planted arbitrary text on the shared unauthenticated page. The card now
  renders only the trusted canary org's runs (`DASHCLAW_CANARY_ORG_ID`,
  default `org_default`); tenants' own runs stay visible to them via the
  org-scoped `GET` and their posture finding.

## [4.45.0] — 2026-07-04

Completes roadmap v3.3 (fresh-install truth) and the trust & failure model
ADR's Phase 2 queue. The theme: isolation and write-path health stop being
claims the code makes and become facts CI proves on every push, against a
genuinely fresh install. No SDK source change (no republish).

### Added

- **Cross-org isolation smoke suite (`scripts/cross-org-smoke.mjs`).** Seeds
  two run-unique orgs with their own DB-minted API keys, creates governance
  resources in org A over real HTTP, then proves org B's key cannot read,
  mutate, enumerate, approve, or consume any of them — 31 checks across
  actions, assumptions, open loops, messages (including cross-org sender
  impersonation), handoffs, agents/presence, guard decisions, policies, and
  approvals, with same-org controls proving the 404s are isolation rather
  than breakage. Cleanup sweeps every table carrying `org_id` (discovered
  from `information_schema`), so the suite stays complete as new governance
  tables appear and leaves zero rows behind.
- **Fresh-install CI gates.** The `startup-smoke` CI job (empty
  `postgres:16` + drizzle migrations only) now chains policy smoke → the
  cross-org isolation suite → a doctor **write-path canary gate** over live
  HTTP: the job fails unless every `write-canary` check passes, so the
  replayed fresh-install presence-heartbeat bug — the canonical
  silent-death case — fails CI on a fresh schema before any agent traffic
  exists. Skippable knobs (`STARTUP_SMOKE_SKIP_CROSS_ORG`,
  `STARTUP_SMOKE_SKIP_CANARY`) mirror the existing policy-smoke opt-out.

### Changed

- **The no-silent-catch guard now covers server-side write surfaces.** The
  guard test that banned empty catches in interactive UI code now also scans
  `app/api/**` (excluding `_archive`) and `app/lib/repositories/**` — the
  only layer allowed to touch SQL — and comment-only catch bodies count as
  silent. The escape hatch is line-level, not file-level: a comment-only
  catch passes only with an explicit `/* best-effort: <reason> */` pragma,
  so whole files stay protected and `grep -rn "best-effort:" app/` is the
  exemption ledger. The accompanying sweep upgraded genuinely write-adjacent
  swallows to `console.warn` with context: trial-action metering and
  agent-presence upsert on the guard hot path, approval webhook dispatch,
  policy-template pack loading, `policy_updated` event publishes, and the
  self-host key `last_used_at` touch.

## [4.44.0] — 2026-07-04

Roadmap v3.3's core, out of the trust & failure model ADR's Phase 2 queue:
the doctor learns to prove writes land instead of inferring health from
reads. Kills the silent-death bug class at day zero of a fresh install. No
SDK source change (no republish).

### Added

- **Doctor write-path canary (`write-canary` category).** Two subsystems
  died silently this era behind best-effort catches (the fresh-install
  presence heartbeat being the canonical case), and a staleness probe
  cannot tell "no traffic yet" from "write path broken" on a fresh install.
  The new category actively exercises the write paths by running the REAL
  repository writers — `upsertAgentPresence`, `createActionRecord`,
  `persistGuardDecision` (now exported for exactly this) — against an
  isolated canary org (`org_doctor_canary`, FK-satisfying, invisible to
  every org-scoped surface), verifies the row landed, and deletes it. A
  write path that errors is a **fail** with the `migrate` auto-fix
  attached, never a benign warn. Flows to `GET /api/doctor`,
  `npm run doctor` / `dashclaw doctor`, and the `/doctor` panel; the
  replayed presence-heartbeat bug is pinned as a failing canary in
  `doctor-write-canary.test.js`.
- **/setup "Write-path health" section.** The canary verdicts render on the
  operator's existing truth surface with pass/fail pills and a click path
  to the `/doctor` auto-fix on failure. Because `/setup` is public
  (pre-onboarding), the canary run is memoized as an in-flight promise with
  a 60s TTL (concurrent anonymous GETs share one run — no write
  amplification) and fail copy is sanitized (raw database error text stays
  on the authenticated doctor surfaces and in server logs).

### Security

- Public `/setup` canary hardening (from the pre-ship review): in-flight
  promise memoization closes the concurrent-miss write-amplification
  window, and schema-revealing Postgres error text is withheld from the
  unauthenticated page.

## [4.43.0] — 2026-07-04

Phase 2 of the trust & failure model ADR, fourth batch: guard-layer
hardening — approvals stop being season passes, and the runaway valve counts
what actually happens. No SDK source change (no republish).

### Changed

- **Operator-approval grants are single-use and fingerprint-bound.** A HITL
  approval previously blanket-covered unlimited identical-goal calls for 15
  minutes, matched on the goal string alone. The grant is now consumed
  atomically (`UPDATE … SET approval_grant_used_at … WHERE … IS NULL`,
  drizzle/0045) — one approval downgrades exactly one retried evaluation,
  with Postgres row-locking picking a single winner under concurrent
  identical calls — and additionally binds to the approved `action_type`, so
  a generic goal string cannot carry one approval across action kinds. The
  approve-then-retry UX is unchanged: exact idempotent retries replay the
  resulting allow via the idempotency short-circuit (revived in v4.38.1 —
  the two fixes compose). Pre-0045 schemas fail closed (grant lookup errors
  leave require_approval standing) until `db:migrate` runs.
- **`rate_limit` counts guard evaluations, not recorded actions.** The
  runaway valve counted `action_records`, so a guard-only integration (no
  `?record=true`, no action POSTs) could loop forever without tripping it.
  It now counts `guard_decisions` — every evaluation; idempotent replays
  add no rows, so retries never double-count — on a new
  `(org_id, agent_id, created_at)` index (drizzle/0045). Reason wording
  follows: "Agent made N guard evaluations in Xmin".

## [4.42.0] — 2026-07-03

Phase 2 of the trust & failure model ADR, third batch: the one-knob outage
contract (D2). No SDK source change (no republish).

### Changed

- **Fast evaluation failures join the degradation contract** — any guard
  evaluation phase that throws before the deadline (policy load, risk read,
  DB error) now yields the same degraded decision as a deadline overrun
  (per-policy override → `DASHCLAW_GUARD_FALLBACK` → `require_approval`),
  persisted through the mandatory audit gate with a structured
  `_degraded.kind: 'error'` marker. Previously these rejected out of
  `evaluateGuard` as a 5xx, so `FALLBACK=allow` never applied during a DB
  blip — the knob only covered the slow path.
- **The audit gate stays absolute (and the ADR now says so verbatim):** an
  unaudited decision is never returned, allow or otherwise. When persistence
  itself is down the server errors and the client-side
  `DASHCLAW_GUARD_UNAVAILABLE_POLICY` governs (default: block).

## [4.41.0] — 2026-07-03

Phase 2 of the trust & failure model ADR, second batch: the verified-identity
gate. Per-agent capability allowances stop trusting a self-asserted
`agent_id`. No SDK source change (no republish).

### Added

- **Verified-identity gate on capability access rules (ADR D1)** — an
  unverified `agent_id` assertion can never obtain a MORE permissive outcome
  than the org-wide default: per-agent allow-lists apply only to
  JWKS-verified identities, while restrictive agent-specific rules still
  bind asserted ids (they exist to contain honest-but-drifting agents, the
  actual threat model). Downgrades are explicit — `evaluateAccess` returns
  `identity_downgrade { asserted_access, reason }`, the invoke 403 surfaces
  it, and the capability Access tab explains the semantic.
- **`GET /api/capabilities/[id]/access/check?verified=true`** — preview what
  a verified identity would get (read-only simulation; enforcement always
  resolves from the actual JWT).

### Changed

- **Capability invoke joins the shared identity contract** — the route now
  resolves identity via `resolveAgentIdentity` (a JWKS-verified JWT `sub`
  overrides the body `agent_id`, matching /api/guard, /api/actions and
  /api/x402/purchases), threads `verification_status` into the guard
  context, and stamps the real verification state on its action records
  (previously hardcoded `verified: false`).

## [4.40.0] — 2026-07-03

Phase 2 of the trust & failure model ADR, first batch: x402 money truth.
Spend enforcement stops trusting a number the org's own registry can
contradict, and money columns become exact decimals. No SDK source change
(no republish).

### Added

- **Spend clamp (ADR D1)** — `POST /api/x402/purchases` now enforces
  `max(declared spend, resolved endpoint default_price)`. A known-priced
  endpoint cannot be under-declared past `x402_spend_limit` caps, budget
  windows, or approval thresholds. The enforced amount flows to the guard
  gates, the action cost estimate, and the stored purchase row (window sums
  count reality); the declared figure is audited in the guard context as
  `declared_spend_amount`; the response reports
  `spend_enforcement: { declared, enforced, clamped }`.
- **x402 tables modeled in `schema/schema.js`** — `x402_providers`,
  `x402_endpoints`, `x402_purchases` had been raw-SQL-only since drizzle/0021;
  the money subsystem was invisible to schema tooling (arch-review finding).

### Changed

- **Money columns are exact decimals** (`drizzle/0044_x402_money_numeric.sql`)
  — `x402_purchases.spend_amount` and `x402_endpoints.default_price` convert
  REAL (float32) → `numeric`; spend aggregation casts follow
  (`::real` → `::numeric`). Scores stay REAL (not money). A new drift-class
  test (`__tests__/unit/drizzle-money-types.test.js`) fails CI if a future
  REAL money column ships without a conversion.
- `computeEffectiveRisk` documentation now says what the blend guarantees —
  a server-computed risk *floor* over declared descriptors, not fact-checking
  (ADR D1 naming rule). Product copy needed no sweep: "payment validation" was
  never claimed anywhere user-facing.

## [4.39.0] — 2026-07-03

The emergency halt becomes a click, and the button becomes honest. Also
records the trust & failure model ADR (`docs/architecture/trust-and-failure-model.md`)
— the four design decisions from the architecture review, decided and
written down. No SDK source change (no republish).

### Added

- **Halt control on Mission Control** (`HaltControl` in the CommandStrip) —
  the org kill switch (`/api/halt`) had zero rendered surface; an incident
  operator had no button. Now: a two-step confirm "Halt org" control with an
  optional reason while running; a full-width banner (actor, reason, relative
  time) with a two-step Resume while halted; hidden entirely for non-admins.
  Demo mode gets a working simulated `/api/halt` so the control is clickable
  on the public demo. Rendered proof: full halt→banner→resume cycle driven
  headless against the production build, zero console errors.
- **Trust & failure model ADR** — descriptor trust is attestation-with-
  corroboration (spend clamps to known endpoint price, per-agent rules
  require verified identity — both queued Phase 2); the outage contract is
  one knob with the refined invariant *an allow is never returned unaudited*;
  x402 is pre-authorization + attestation of record, stated exactly.

### Changed

- **Org-halt reads moved to a dedicated 3s cache** (was: riding the 30s
  guard settings cache). `/api/halt`'s eager invalidation only reaches the
  lambda that served it, so on multi-instance deploys other warm instances
  honored a halt only at TTL expiry — up to 30s of stale allows after the
  kill switch was thrown. Cross-instance propagation is now bounded at ~3s.
  One shared settings read still fills both caches, so the guard cold path
  stays at exactly one settings query (the hot-path round-trip budget test
  caught the first draft adding a query, and kept both properties honest).

## [4.38.1] — 2026-07-03

Roadmap v3.3 opener — fresh-install truth. Three confirmed findings from the
pre-implementation architecture review, fixed the same day. No SDK source
change (no republish).

### Fixed

- **Guard idempotency replay was silently dead on fresh drizzle-chain
  installs.** The replay lookup compared `created_at > NOW() - INTERVAL`
  without a cast; on the 0000 baseline `guard_decisions.created_at` is
  physically TEXT, so the comparison raised 42883, the best-effort catch
  returned null, and every retried `idempotency_key` re-evaluated and wrote a
  second audit row (double-counting approval-flood / signal / digest
  windows). The lookup now casts `created_at::timestamptz`, which behaves
  identically on both column shapes. Regression-pinned by
  `__tests__/unit/guard-idempotency-cast.test.js`.
- **Fresh-vs-legacy schema drift, normalized at the root**
  (`drizzle/0043_normalize_text_timestamps.sql`). The 0000 baseline created
  47 `*_at` columns as TEXT while `schema/schema.js` and `setup/migrate`
  declare timestamp — the physical type depended on which installer ran, and
  the class kept producing silently dead subsystems. 0043 conditionally
  converts each drifted column to `timestamp` (no-op where already
  converted), drops the broken text `DEFAULT 'now()'` literals, and installs
  real `now()` function defaults. Columns that are text in both (e.g.
  `organizations.trial_ends_at`) are intentionally untouched. The class is
  now pinned shut by `__tests__/unit/drizzle-timestamp-parity.test.js`: any
  future text `*_at` column that schema.js types as timestamp fails CI until
  a normalization entry covers it.
- **`?record=true` side effects survive Vercel function freeze.** The guard
  route's meter increment, hosted-trial count, presence heartbeat, and
  Mission Control event were fire-and-forget promises racing the response;
  a post-response freeze dropped them (a quota/billing undercount that never
  self-heals). They now run via `after()`, matching the `POST /api/actions`
  sibling. Pinned by `__tests__/unit/guard-route-record-after.test.js`.

## [4.38.0] — 2026-07-03

Roadmap v3.2 — findings become proposals (the tightening direction). The
tuning-proposal engine (v4.22.0) only ever loosens; posture's critical
"ungoverned high-risk action reached allow" findings were exactly tightening
evidence, rendered as review chores. They are now one-click policy proposals.
No SDK source change (no republish).

### Added

- **Tightening-proposal engine** (`app/lib/posture/tightening.ts`) — pure,
  rule-based, no LLM. One rule (`govern_ungoverned_allow`): ≥3 ungoverned
  allows at risk ≥50 for the same (action_type × riskLevel) propose a
  `require_approval` policy in the review-verdict "Tighten" shape. Grouping
  is identical to v3.1's pattern-collapsed `review_incident` posture
  findings, so proposal and finding mirror one-to-one (shared `finding_key`,
  content-stable `tp_` ids). An active governing policy suppresses the
  pattern — a ratified proposal retires through the policy it created, not
  bookkeeping.
- **`GET/POST /api/policies/tightening`** (route 327) — proposals computed on
  read; admin POST `ratify` creates the ACTIVE policy server-side in the same
  request (no partial state), resolves the mirrored posture finding, and
  audit-logs; `dismiss` records a redacted reason and stops re-proposing;
  `undo` removes the judgment but keeps a created policy. Decisions persist
  in `tightening_proposal_decisions` (drizzle 0042). Smoke-only
  `?include_synthetic=1` / `?min_observed=` let the harness prove the
  pipeline without polluting the real queue.
- **/policies "Tightening proposals" section** — evidence cards (observed
  count, risk range, window, decisions-ledger link) with armed-confirm
  Ratify… / Dismiss… / Undo, between Tuning and Calibration proposals.
- **/posture cross-link** — `review_incident` findings carry
  `fix.proposalId`; the resolve panel links "Review tightening proposal" to
  `/policies#tightening` and the evidence to `/decisions` (the previously
  dead `deepLink` is now rendered).
- **Policy smoke S1–S5** — live round-trip: seeded ungoverned pattern reaches
  allow, mines into the expected proposal, default GET stays synthetic-free,
  ratify flips the same call to `require_approval`, pattern retires, undo
  keeps the policy (91/91 checks on a production server).

### Fixed

- /posture incident evidence line hardcoded "high-risk" regardless of the
  group's actual risk level; it now states the count without the wrong level
  (the title carries the level).


Roadmap v3.1 — posture signal integrity, the first item of Roadmap v3 ("the
instrument tells the truth"). The live posture surface read 30/100 with 164
findings, most of them noise; every number on it is now true. No SDK source
change (no republish).

### Fixed

- **Posture: synthetic verification traffic no longer grades the org.**
  `getObservedActionUnits` and `getRecentDecisions` exclude the policy-smoke
  / self-test agent families and `smoke.*` action types in SQL, before
  aggregation and the incident LIMIT (patterns shared with the calibration
  miner via `SYNTHETIC_AGENT_LIKE_PATTERNS`; regex↔LIKE agreement pinned by
  unit test). On the maintainer's live instance this alone removed 100
  synthetic critical findings.
- **Posture coverage math can no longer go negative.** `summary.coveredUnits`
  is counted from coverage grades in the engine (units at grade 1) instead of
  the route's `unitCount - openFindings` (which read −22 live).
  `summary.pointsRecoverable` now sums open findings only.
- **Risk calibration: `rm -rf .next` no longer hard-blocks at 100.**
  Recursive deletes of well-known regenerable build artifacts (`.next`,
  `dist`, `node_modules`, `__pycache__`, …) cap at 35 client-side and map to
  the `cleanup` action type (server lands in the warn band, never block).
  Globs, absolute paths, and unknown names keep the full destructive grade.
  Incident-sourced golden vector `rm-rf-next-build-cache` (corpus: 34).

### Changed

- **Incident findings collapse by pattern.** "Ungoverned high-risk action
  reached allow" now mints ONE finding per (action type × risk level) with a
  truthful `observedCount` and up to 5 example decision ids — a hundred
  same-shape leaks is one judgment, not a hundred chores. Finding keys are
  content-stable across scan windows.
- **Quieting a finding is now visible and attributed.** Non-open findings
  carry `statusMeta` (actor, note, updatedAt); `/posture`'s Risk-accepted
  ledger renders who accepted what, when, and why; `GET /api/posture` summary
  gains `acceptedRisk {count, lastActor, lastAt}`. Attribution (actor/note)
  is redacted for key-authenticated callers — human sessions only (security
  review finding, fixed in-ship). Timestamps remain for all callers.

### Added

- Policy smoke checks R1–R3 (harness traffic absent from posture, coverage
  bounds sane, accepted-risk summary shape) — smoke = 86.

## [4.36.3] — 2026-07-03

The first real user through the new trial front door (the maintainer) hit "Demo mode: write APIs are disabled" on the mint click. Two stacked middleware bugs. No SDK change.

### Fixed
- **The hosted-trial instance honored the demo cookie** — `hosted.dashclaw.io` matched the `*.dashclaw.io` marketing-host check, so anyone who had clicked Mission Control (which mints `dashclaw_demo` on whatever host you're on) had every write demo-blocked, including the trial mint. A deployment with `DASHCLAW_HOSTED=true` now never enters cookie-demo: a trial instance is a real runtime, not a marketing sandbox.
- **The demo passthrough list ran below the write block** (latent since 4.36.1), so it only exempted reads — a no-op for the POSTs it exists to protect. Passthrough now precedes the write block; `/api/hosted` and `/api/auth` POSTs reach their real handlers in demo mode.

Both pinned by regression tests in `__tests__/unit/demo-auth-bypass.test.js`.

## [4.36.2] — 2026-07-03

The hosted trial has been live at `hosted.dashclaw.io` since June — and nothing anywhere linked to it. The deployment topology is three Vercel projects from this repo (marketing/demo at www.dashclaw.io, the maintainer's instance, and the multi-tenant trial instance); 4.36.1's "structurally unreachable" diagnosis was true of the marketing site only. This release makes the trial discoverable and its copy honest. No SDK change.

### Added
- **Marketing → trial link** — `HostedTrialCTA` gains a marketing mode: when `NEXT_PUBLIC_HOSTED_TRIAL_URL` is set (now configured on the marketing project, pointing at `https://hosted.dashclaw.io/connect`), the hero renders a plain cross-origin "Start a hosted trial — free for 30 days" link with no same-origin capacity probe.
- **`/privacy`** — explicit no-SLA/no-backup-guarantee sentence for the hosted trial; production workloads self-host.

### Fixed
- **The trial CTA no longer depends on Google sign-in** — the hosted deployment has no Google provider configured, so the old `signIn('google')` click was a dead end even where the CTA rendered. It now links to `/connect`, where the anonymous Turnstile mint (the signup path that actually works, and discloses the 30-day / 10,000-action caps before provisioning) lives.
- **Hero trust band** — "No usage caps" qualified to "No usage caps when self-hosted"; the hosted trial is capped and the line sat directly under the trial CTA.
- **`docs/DISTRIBUTION-LISTINGS.md`** — corrected to the real topology: the connector-directory listing targets `hosted.dashclaw.io/api/mcp`, and the reviewer test account is self-serve via the live trial (no manual mint needed).

## [4.36.1] — 2026-07-03

Two live-site fixes found by the maintainer clicking the actual site. No SDK change.

### Fixed
- **Landing "Explore the Demo" button was dead** — the bottom CTA linked `/demo`, whose middleware redirect to `/#live-demo` drops its hash during client-side navigation from `/`. Same-page anchor now, mirroring the identical hero-button fix.
- **The instant hosted trial was structurally unreachable on the marketing site** — demo-mode middleware 403'd `/api/hosted/capacity` (not in the passthrough list), so the trial CTA never rendered there. `/api/hosted` now passes through demo mode (inert where `DASHCLAW_HOSTED` is unset; every hosted route self-guards with a 404). Corrected in 4.36.2: the trial itself was live the whole time on the separate `hosted.dashclaw.io` project — the marketing site just never linked to it.

## [4.36.0] — 2026-07-03

Desktop distribution closeout (roadmap v2.7). Three parallel audits — connector-docs truth pass, four-surface plugin parity, public-listing readiness — then one fix sweep. No SDK source change.

### Added
- **`/privacy`** — public privacy policy page (footer-linked from every public page). Covers the two deployment models (self-hosted: your database, zero telemetry; hosted trial: what is collected and why), subprocessors, retention/deletion, and contact. This was the immediate-rejection blocker for the Anthropic Connectors Directory submission.
- **`/self-host`** — the "Connect your agent framework" grid gains a **Claude Desktop** tile (OAuth connector, no install) linking to the connector config in `/docs`.
- **`docs/DISTRIBUTION-LISTINGS.md`** — maintainer runbook for the three listing channels (Claude Code plugin directory, official MCP Registry, Anthropic Connectors Directory), each reduced to a single human action.
- **Hosted `/api/mcp` agent identity** — OAuth Bearer callers (the Claude consumer-app custom connector) now get the server-level `claude-desktop` identity, closing the write-identity fallback that let the model pick its own `agent_id` per call. The Bearer credential decides the identity even when an `x-api-key` header rides along (it is the credential the client actually forwards); `x-api-key`-only callers are unchanged. Pinned by three route tests.
- **Version-sync guard, second group** — the three plugin ecosystem manifests (Claude Code / Codex / Hermes) must now agree with each other (`npm run version:sync:check`); they had drifted 2.15.0 / 2.14.2 / 2.14.1. All three now carry 2.15.0, and `scripts/build-desktop-plugin.mjs` reads its version from the Claude Code manifest instead of hardcoding one.

### Fixed
- **Codex Code Sessions ingest was silently dead** — `dashclaw install codex` never shipped `dashclaw_code_session_reporter.py`, so the import inside `dashclaw_stop.py` failed inside a try/except and ingest no-oped. The installer now copies it (pinned by the installer test).
- **Docs no longer recommend the broken Desktop install** — the `.mcpb` bundle (crash-loops on Desktop's bundled Node) is retired: its build scripts and test are deleted, `mcp-server/README.md`'s ".mcpb" section is replaced with the OAuth-connector pointer, and every stdio config block (root README coverage table, mcp-server README header, `/docs` code-block title) stops attributing stdio to Claude Desktop chat.
- **`plugins/dashclaw/PLUGIN_PARITY.md`** rewritten: Claude Desktop is documented as the fourth surface (cooperative governance, structural no-hooks ceiling), the Codex deltas are disclosed (no SessionStart digest — lifecycle unverified), and the Hermes README's identity env var is corrected to `DASHCLAW_HERMES_AGENT_ID`.

## [4.35.1] — 2026-07-03

Marketing & docs backfill (roadmap v2.6d). The era retro-audit's systematic clause-4 failure — ten capabilities shipped v4.22.0–v4.35.0 absent from every page that claims completeness — paid down in one sweep. No new API surface; no SDK change.

### Added
- **Landing page (`/`)** — the operations capability cards now carry the era's capabilities: itemized risk composition on decision replay, per-harness identities grouped on /agents, evidence-based session retros, the agent_defense advocate rollup, policy tuning proposals, x402 spend gates with live budget meters, degradation observability, one-click assumption invalidation, and approval expiry.
- **`/self-host` "What you just deployed" grid** — new **Spend Governance** category card (x402 providers, per-purchase caps + window budgets, live meters, FinOps rollup) and era items across Governance / Observability / Security so the completeness claim is true again.
- **`/docs`** — five previously undocumented subsystems: **Risk composition (`risk_breakdown`)** on the guard response, **Policy tuning proposals** (`GET /api/policies/proposals`), **Degradation observability** (deadline fallback precedence + the degradation rollup), **x402 spend limit tiers** (per-purchase vs cumulative window budget, org vs agent scope) with a `GET /api/x402/budget` method entry, and **Composed identities** (per-harness `<parent>:<sub>` families, governance inheritance, fleet grouping). All anchored in the sidebar.
- **`/explain`** — "The session retro" section (the advocate's successor): posture derived purely from evidenced findings (`clean`/`review`/`flagged`), `GET /api/sessions/:id/retro`, rendered on the session detail and readable by the agent over MCP.
- **`/connect`** — the approval step now documents the expired third outcome (`err.status === 'expired'` from `waitForApproval`).

### Fixed
- **The landingData dead-array trap is dead** — `app/landingData.js` now exports only the three arrays `app/page.tsx` renders (`corePrimitives`, `frameworkQuickstarts`, `signals`); the five imported-but-never-rendered feature arrays (and the unimported `agentToolCategories`) are removed, with `scripts/check-doc-counts.mjs` and the ship-skill notes updated to match.

## [4.35.0] — 2026-07-03

x402 budget consumption visibility (roadmap v2.6c; spec `docs/superpowers/specs/2026-07-03-x402-budget-visibility.md`). The cumulative budget gate computed window spend on every governed purchase but never rendered it — an operator couldn't see "this agent is at $43 of $50" until a purchase blocked. HUMAN-EXPERIENCE.md debt from the era retro-audit, now paid.

### Added
- **`GET /api/x402/budget`** — live budget consumption per active budget-bearing `x402_spend_limit` policy: window/scope normalized exactly like the guard's gate, sums from the SAME repository predicate (`sumWindowSpend`), so the meter and the gate share one definition of "spend". Agent-scoped budgets return per-identity-family rollups via the new `sumWindowSpendByFamily` (composed `<base>:<type>` ids roll up to their base), and `agent_ids`-targeted policies meter ONLY the families they actually gate. `?agent_id=` narrows to that identity family. Route count 325 → 326.
- **/spend/x402 → Window budgets** — meter cards above the purchases table: spend vs hard budget with an approval-threshold tick, warning tone at/over the approval threshold (or 80% of the hard budget when no approval tier), error at/over the budget; agent-scoped cards render one bar per family and honor the page's agent filter. Verified rendered headless against a real $708-of-$800 warning-band scenario.
- **/policies/rules consumption suffix** — budget-bearing x402 policy rows show live "`$X of $Y used`" (top family for agent scope) next to the rule sentence.
- **Policy smoke B7** (82 → 83 checks) — pins that the budget read API reports exactly the window sum the gate just evaluated ($12 = two allowed purchases + one pending approval; the blocked purchase never lands).
- Demo instance serves a hot meter scenario for `/api/x402/budget`.

### Fixed
- **/policies/rules rate_limit rows rendered "`Max 150 / undefinedmin`"** when the policy omitted `window_minutes` — now defaults to 60 like the guard's evaluator.
- `X402PolicyRules` type was missing the cumulative budget tier fields (`budget_usd`, `budget_approval_threshold`, `budget_window_days`, `budget_scope`) that shipped with the gate.

## [4.34.1] — 2026-07-02

### Fixed
- **Fresh-install presence heartbeats were silently dead** (drizzle `0041`): `upsertAgentPresence` writes `updated_at` and upserts `ON CONFLICT (org_id, agent_id)`, but the drizzle `0000` table had neither the column nor a unique constraint on that pair — legacy databases got both out-of-band (composite PK), so production worked while every fresh install dropped ALL heartbeats behind a best-effort catch (`[presence] heartbeat skipped` in the CI logs). `0041` adds the column and a guarded unique index (no-op on legacy DBs — proven against both shapes); policy smoke Q1 (81 → 82 checks) pins the implicit heartbeat end-to-end via the `reported_status: 'online'` discriminator.
- **CI red since v4.33.0, twice over**: the calibration event loaders (and the miner CLI) compared TEXT `created_at` against timestamptz — 42883 on fresh schemas, fixed with `::timestamptz` casts pinned by unit tests; and `docs/sdk-critical-contract-harness.json` predated v2.3's deliberate `approval_wait_seconds: 300` declaration on `guard`/`createAction` in both SDKs — fixture updated, both harnesses green.

## [4.34.0] — 2026-07-02

Calibration proposals human surface (roadmap v2.6b; spec `docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md`). The v2.6 flywheel's review flow — a GitHub Actions summary with copy-paste forge commands — was rejected the day it shipped and became the first debt paid under `HUMAN-EXPERIENCE.md`: proposals are now evidence cards in the product and the human's entire role is clicks.

### Added
- **/policies → Calibration proposals** — a third cockpit section renders mined calibration-vector proposals as evidence cards (rule, suggested label, shape, event count, evidence tier, risk range, provenance). **Ratify… / Dismiss… are buttons** with the cockpit's armed-confirm pattern; ratified/dismissed/forged states render as strips with Undo. Verified rendered and clicked end-to-end headless.
- **`GET /api/calibration/proposals`** — proposals computed on read from the org's own ledger with the same pure mining pipeline as the weekly workflow (synthetic-traffic filter always on), decisions joined by the content-stable `cv_` id; `?status=ratified` is the maintainer's forge queue, and ratified-not-forged decisions whose shape aged out of the window still surface from their stored snapshot. **`POST`** records ratify / dismiss / undo / mark_forged (admin-only, redacted, audit-logged). Route count 324 → 325.
- **`calibration_proposal_decisions` table** (drizzle `0040`) — the human's judgment as an auditable row; `forged_at`/`vector_name` close the loop when the maintainer commits the vector.
- **Policy smoke P1–P5** (76 → 81 checks) — pins the ratification record end-to-end live: ratify → maintainer queue → mark_forged leaves the queue → undo cleans up.

### Changed
- The pure mining lib moved `scripts/lib/calibration-mining.mjs` → `app/lib/calibration-mining.js` (re-export shim keeps script/test imports); the weekly `calibration-mine.yml` summary now points reviewers at /policies and remains the artifact/history record. MAINTAINER.md calibration protocol: judgment is a click in the product; the maintainer session consumes `?status=ratified`, forges, and `mark_forged`s.

### Security
- The mined representative echoed by GET passes `redactAny` — the same scrub the persisted path applies (review finding, fixed pre-ship; review verdict SHIP-SAFE, 0 critical/high).

## [4.33.1] — 2026-07-02

The human-experience retro-audit (docs/plans/2026-07-02-human-experience-retro-audit.md): four parallel auditors swept every maintainership-era ship (v4.22.0–v4.33.0) against the new HUMAN-EXPERIENCE.md contract. Most product surfaces pass; this patch fixes every gap small enough to do properly inline, and roadmap v2.6b–v2.6d carry the rest (calibration review UI, budget consumption meter, marketing/docs backfill).

### Fixed
- **/policies now tells the whole x402 truth** — a budget-gated policy previously read as a per-purchase cap only: the contract sentences never mentioned `budget_usd`/`budget_window_days`/`budget_scope` (now rendered as "30-day per-agent paid spend exceeds $100", inline-editable like the per-purchase terms), and the /policies/rules list showed the raw string `x402_spend_limit` instead of a sentence.
- **Threshold selects display off-preset values** — a configured threshold not in the preset step list (e.g. $80) silently displayed as the first option ($1.00); the configured value is now always an option. Also fixed duplicate React keys when one policy emits two interrupt/block sentences.
- **/assumptions invalidation is a visible control** — was right-click-only with a native `window.prompt()`; every active assumption card now carries an "Invalidate…" button opening an inline reason field + Confirm/Cancel (the tuning-proposals pattern), with the notify-the-agent consequence stated. The context-menu path still works.
- **Session-retro posture is above the fold** — the "was I manipulated" verdict sat five blocks deep on /sessions/{id}; a compact `Retro: Clean/Review/Flagged` chip now renders in the header next to the status badge, anchored to the full card.
- **Docs accuracy: `waitForApproval` third outcome** — the docs claimed deny-or-timeout; expired approvals are a distinct outcome (`ApprovalDeniedError` with `err.status === 'expired'`, per `sdk/dashclaw.js`) and are now documented.
- All three changed pages verified rendered headless against real local data (budget sentences, armed invalidate row + cancel, chip position y≈273 at 1280×800), zero console errors.

## [4.33.0] — 2026-07-02

Calibration flywheel automation (owner roadmap v2.6). The golden-vector corpus grew only when a session-holder remembered the protocol; now a weekly run PROPOSES vectors from live evidence and a human ratifies each one — nothing auto-applies (constitution §3: the corpus is enforcement). No new product surface; the human surface is the GitHub Actions run summary + artifact, an explicit decision in the spec. Spec: `docs/superpowers/specs/2026-07-02-calibration-flywheel-automation.md`.

### Added
- **Synthetic-traffic filter in the calibration miner** (`isSyntheticEvent`, default-on) — policy-smoke, up-smoke, sdk-live, demo/dev-suite traffic is *designed* to trip policies (inflated client scores, deliberate blocks), so mining it calibrates the scorer against a fiction. Explicit agent-id families + the `smoke.*` action-type prefix; excluded counts reported, never silent (`--include-synthetic` to disable). Live proof: 725 synthetic events excluded from a 30-day window.
- **Proposal mode (`--propose` / `--summary` / `--top`)** — turns mined candidates into ready-to-ratify proposals, each carrying provenance and (when the shape is reconstructible) the exact `npm run calibration:add` forge command; unreconstructible shapes are flagged `needs_manual_context`. Capped at the top 15 strongest per rule after the first live run produced 5.8k raw candidates — the cut is reported in the summary, and the artifact keeps the complete candidate lists. No scorers run at propose time; the forge runs both at ratification.
- **Weekly scheduled workflow `.github/workflows/calibration-mine.yml`** — Monday 06:00 UTC + manual dispatch: mines the live ledger (same `DATABASE_URL` secret as CI), renders the proposals into the run summary, uploads the JSON artifact. Fork-safe skip when the secret is unset.

### Fixed
- Miner events now carry `agent_id` and the linked `action_id`, so candidate representatives prefer evidence a forge command can be built from.

## [4.32.0] — 2026-07-02

"Was I manipulated?" session retro (owner roadmap v2.5, Advocate v2b). Every protective signal DashClaw records — injection-shield hits, non-fabrication verdicts, goal declarations, guard blocks, spend outcomes, invalidated assumptions — lived on individual actions; answering "was this agent manipulated in that session?" meant reconstructing it by hand across dozens of detail pages. Now one report composes it per session, on demand, with no new tables and no LLM. Spec: `docs/superpowers/specs/2026-07-02-session-retro-design.md`.

### Added
- **`GET /api/sessions/{sessionId}/retro`** — the per-session defensibility report: deterministic detectors (prompt-injection warned/blocked, non-fabrication blocks, goal drift vs the session's first declared goal, late novel action types, risk spikes vs the session median, denied/expired and outlier purchases, guard interventions, later-invalidated assumptions), each finding carrying its evidence and action/decision ids. Posture is derived, never invented: `flagged` = any high finding, `review` = any finding, `clean` = none — plus an honesty block (`actions_with_guard_decision` vs `actions_total`) so a mostly-ungoverned session can never read as exonerated. Composed on read from existing rows via the same session↔action predicate the aggregates use (stamped `session_id` or the legacy agent+time-window arm).
- **Retro card on `/sessions/{id}`** — posture chip, honest coverage line, goal timeline, findings grouped by kind with links to each action. Click path: `/sessions` → session → retro.
- **MCP tool `dashclaw_session_retro`** (33rd tool) — an agent can pull its own defensibility report; defaults to the active session (pass `session_id` explicitly after `dashclaw_session_end`, which clears the active default). Available on the hosted `/api/mcp` route automatically (shared definitions + handlers).
- **Policy smoke O1–O4** (72 → 76 checks) — seeded session proves posture, goal-drift and intervention findings, and coverage honesty live, including the legacy unstamped-action attribution arm.

### Fixed
- **NULL risk scores no longer skew the risk-spike baseline** — an unscored action previously counted as risk 0 and dragged the session median down; it is now excluded from the baseline.
- **MCP tool count pins and docs** updated 32 → 33 across the README, docs page, mcp-server README, and skill references (routes 323 → 324).

## [4.31.1] — 2026-07-02

Internal QA tooling plus a calibration hardening fix. No new product surface and no route/SDK/MCP change — a patch release (the Node + Python SDKs are intentionally not republished; npm/PyPI stay at 4.30.0).

### Added
- **Guard hot-path load & stress harness (`npm run guard:load` → `scripts/guard-load.mjs`).** `/api/guard` sits in the hot path of every governed action and this repo has a history of guard latency regressions; functional + policy smoke prove correctness, this proves the endpoint holds its latency and degrades gracefully under concurrency. autocannon-based (new dev-dependency), operator-key auth like `policy-smoke.mjs`, local-DB-only. Three scenarios — `fast` (universal path + its `guard_decisions` audit write), `record` (`?record=true`, adds the `action_records` insert + Neon-pool pressure), and a `ramp` stress sweep that reports the knee — gating exit code on p99 + errors/5xx. Scope + the deferred LLM slow-path follow-up: `docs/plans/2026-07-02-guard-load-harness-scope.md`.
- **`/repro` skill (`.claude/skills/repro/`).** Turns a bug symptom into a structured, reproducible bug report (summary / environment / repro steps / actual vs expected / evidence) and optionally scaffolds a failing regression test that pins it — a sharper fix prompt than a raw symptom, and a test that stops the bug returning.

### Fixed
- **Two wrong self-blocks calibrated away:** `rmdir` of an empty directory and `Remove-Item -Recurse:$false` both scored 100 (extreme-risk block). The classifier now grades `rmdir` as a bounded delete (coreutils rmdir cannot remove content; Windows `rmdir /s` still escalates) and reads `-Recurse:$false` as the explicit non-recursion it is. Golden corpus 31 → 33 vectors, fix + vectors in one commit per the calibration playbook.

## [4.31.0] — 2026-07-02

Assumption-invalidation notifications (owner roadmap v2.4, Advocate v2a). The assumption ledger was write-only during a task: an operator could mark an agent's assumption false, and the agent would keep acting on it, none the wiser. Now invalidation reaches the agent before it acts again. Spec: `docs/superpowers/specs/2026-07-02-assumption-invalidation-notifications-design.md`.

### Added
- **Invalidating an assumption notifies the owning agent.** `PATCH /api/assumptions/:assumptionId` with `validated: false` (operator-only trigger — the `/assumptions` context menu or a direct API call) writes a durable inbox message (`message_type: assumption_invalidated`, `doc_ref` = the `asm_…` id, JSON directive body). Best-effort: the PATCH reports `notification: { message_id }` or `notification_error` — the invalidation itself never fails on a notify error. No new tables: the message IS the notification record, its read state IS the acknowledgment.
- **`assumption_alerts` rides the guard response until acknowledged.** Every `POST /api/guard` from the owning agent (or its identity family, both directions) carries the unread alerts (newest 3) as a sibling advisory field — like `secret_scan`, it never changes the decision, and a 30s negative cache keeps the hot path free. "Mid-task" for non-resident agents = until acked: the agent hears it on its very next governed action, whenever that is.
- **The pretool hook surfaces and acks the alert:** prints "⚠ Operator invalidated an assumption you recorded …" even on allow, then marks the message read — one conditional extra HTTP call only when alerts are present, so the single-call rule holds on the common path. MCP `dashclaw_guard` and both SDKs pass the raw field through unchanged (no SDK changes; ack via the existing mark-read surfaces).
- **`/assumptions` shows delivery state:** invalidated rows carry `notification_status` (`unread` | `acknowledged`) from the API and render an "agent notified · unread" / "agent acknowledged" chip. `/messages` surfaces the new type in its filter. Policy smoke N1–N5 (72 checks total) prove the full lifecycle live: invalidate → inbox → guard alert → ack → alert gone.

### Fixed
- **`/assumptions` context-menu Validate/Invalidate silently 404'd:** the page tagged cards with the serial row id while the detail route matches only `asm_…` assumption ids — the operator invalidate path (v2.4's trigger) never worked. Reproduced live, card entity ids now use `assumption_id`.

## [4.30.0] — 2026-07-02

Approvals lifecycle hygiene (owner roadmap v2.3). The item-2 live audit's third finding: approvals whose tool calls had already hard-blocked (hook timeout) still sat pending forever; approving them flipped the row to `running`, executed nothing, and reported nothing. Now a pending approval expires once its requesting client has provably stopped waiting, and acting on the dead record tells the truth. Spec: `docs/plans/2026-07-02-approvals-lifecycle-hygiene.md`.

### Added
- **Clients declare their wait window:** new optional `approval_wait_seconds` field (integer, 5–86400) on `POST /api/guard`, `POST /api/actions`, and `POST /api/x402/purchases`. The Python pretool hook sends its `DASHCLAW_APPROVAL_TIMEOUT` (default 30s); the MCP server and both SDKs send their 300s default. The server stamps `approval_expires_at = now + window + 15 min retry grace` on `pending_approval` rows (drizzle/0039 + partial index) — the grace mirrors the operator-approval grant window, so "operator approves after the hook timed out, agent retries" keeps working.
- **`expired` is a first-class, server-set action status.** Lazy expiry (pairing-flow precedent, no cron): overdue pending rows flip on the approval-queue list, on action read, on the approve attempt, and before bulk resolution; legacy rows without a stamp expire 24h after creation, clearing the historical backlog. `POST /api/approvals/:id` on an expired record returns **410 `APPROVAL_EXPIRED`** ("approving it can no longer release anything") instead of a fake success, and external approval messages (Discord/Telegram) are edited to "Expired".
- **`/approvals` renders an Expired section** — muted, non-approvable rows below the pending queue, so the queue itself only shows approvals that can still release something. Policy smoke M1–M4 (67 checks total) prove the lifecycle live, including a seeded past-the-window scenario and the x402 ride-along.

### Changed
- **x402 purchases ride the same lifecycle:** denying or expiring a pending x402 approval reconciles the paired purchase (`execution_status` `pending → denied`/`expired`) — previously a deny left it `pending` forever. The spend predicates (FinOps rollups + the guard's cumulative budget gate) now exclude `denied`/`expired` alongside `failed`, so dead approvals stop reserving budget.
- **SDKs treat `expired` as terminal:** `waitForApproval()` / `wait_for_approval()` raise `ApprovalDeniedError` with status/decision `expired` (distinct from an operator deny); the pretool hook stops polling on `expired`.

### Fixed
- **MCP `dashclaw_wait_for_approval` misreported genuine approvals:** it checked `status === 'completed'`, but an approval flips the row to `running` — so real approvals returned `approved: false`. It now resolves on `approved_by`/`running`/`completed` and reports `expired: true` with a reason when the approval expired.

## [4.29.0] — 2026-07-02

Agent identity & attribution v2, "who is asking" (owner roadmap v2.2). The item-2 live audit's second finding: every agent on the machine reported the same machine-wide `DASHCLAW_AGENT_ID`, so Wes couldn't tell who was asking for approval. Root cause verified in source: the hooks' `.env` loader gives the inherited environment precedence, `dashclaw install codex` never wired hook identity at all, and the Hermes shims used `setdefault`. Spec: `docs/plans/2026-07-02-agent-identity-attribution.md`.

### Added
- **Per-harness identity via `--agent-id` argv:** the identity-reading hooks (`dashclaw_pretool.py`, `dashclaw_stop.py`, `dashclaw_session_digest.py`) resolve identity as **argv flag > `DASHCLAW_AGENT_ID` env > harness default**, and every installer now writes the flag onto its hook commands — `dashclaw install claude` (the id chosen at install), `scripts/install-hooks.mjs` (per-project and `--global`, `claude-code`), and `dashclaw install codex` (`codex`, fixing Codex hook actions previously mis-attributed to the `claude-code` default). Two harnesses sharing one machine env now report two identities. Un-migrated installs keep exact legacy behavior; re-running any installer migrates.
- **`DASHCLAW_HERMES_AGENT_ID`:** the Hermes shims now pass `--agent-id` explicitly (override, not `setdefault`) valued from this harness-specific var (default `hermes`), and the Hermes-native hooks prefer it over the generic var — a stray machine-wide export can no longer mis-attribute Hermes traffic.
- **`/agents` groups sub-agents under their parent:** composed ids render indented beneath their base agent with the sub-agent segment as the display name (presentational; every row stays a full fleet identity).
- **Identity-family x402 budgets:** agent-scoped cumulative budgets normalize the acting id to its family base (`baseAgentId`) and `sumWindowSpend` counts the base plus its `<base>:<type>` children — a sub-agent cannot escape the parent's budget via its composed id. New `(org_id, agent_id, created_at)` index (drizzle/0038, the follow-through 0036's comment deferred). Policy smoke L1–L3 (62 checks total).

### Changed
- **`DASHCLAW_SUBAGENT_IDENTITY` default flipped `provenance` → `distinct`** (RFC 2026-06-01 rollout step 3 — the RFC is complete): Claude Code sub-agents are now distinct fleet identities (`claude-code:explore`) by default, inheriting the parent's pairing, targeted policies, and budgets through the server-side base fallback. Rollback is one env var: `DASHCLAW_SUBAGENT_IDENTITY=provenance`.

### Fixed
- **Agent-targeted policies now apply to composed sub-agent ids** (`loadApplicablePolicies` matches the base parent, exact entries still win) — without this, the default flip would have silently detached every agent-targeted policy from delegated work.
- **`agentExistsInOrg` accepts composed ids whose parent belongs to the org**, so a fresh sub-agent can be referenced (messages/feedback) before its first recorded action lands.

## [4.28.0] — 2026-07-02

Guard-deadline noise: instrument, diagnose, fix (owner roadmap v2.1 — the first item of roadmap v2, "earn the interruption"). At least 2 of ~10 interruptions in the item-2 live audit were fail-closed deadline degradations on mundane file edits. Diagnosis on live data found the cause: the server heuristic scores `apply` at base 60 — exactly the predictive-risk LLM threshold — so every mundane edit recruited a 1.2–3s LLM call inside the guard's 3500ms deadline. Spec: `docs/plans/2026-07-02-guard-deadline-noise.md`.

### Added
- **First-class degradation marker:** `guard_decisions.degraded` boolean column (drizzle/0037) plus structured `context._degraded` (`kind`, `deadline_ms`, `action`, `phase_in_flight`). The fail-open (`allow`) path now leaves a persisted trace too — previously it left none, and detection required string-matching `reason`.
- **Per-phase evaluation timings** persisted as `context._timings` on every guard decision (policies / risk / predictive / local_policies / webhooks / grants / signals / total), so degraded evaluations diagnose against a steady-state baseline.
- **Degradation visibility on `/policies`:** `GET /api/policies/proposals` returns an org-wide `degradation` summary (count, rate, last occurrence, by-day) rendered as a notice strip next to the tuning proposals. Policy smoke checks K1–K2 (57 total).
- **`scripts/diagnose-guard-deadline.mjs`:** per-day degradation rates, per-phase timing percentiles (normal vs degraded), and a cold-start heuristic over live data.

### Fixed
- **The deadline noise itself:** the predictive-risk LLM amplifier now (a) skips when the (agent, action_type) history is empty — it provably returned adjustment 0 "cannot assess" after seconds of latency — and (b) is bounded by the remaining deadline budget (`llmBudgetMs`, min 1200ms, 600ms safety margin): a slow provider yields `llm_skipped: 'timeout'` with the statistical adjustment intact instead of a degraded `require_approval`. Measured: no-history evaluations dropped from up to 3.1s to ~150–320ms total; the previously-degrading path completes within budget with zero degradations. Score semantics unchanged; `llm_skipped` provenance rides in `_risk_breakdown.predictive`.
- **Proposal evidence hygiene:** `getDecisionMixByPolicy` / `getApprovalOutcomesByPolicy` exclude degraded decisions (column-first, reason-ILIKE fallback for pre-0037 rows) — a degraded interruption is latency's fault, not the policy's, and must not teach the tuning engine that a policy over-interrupts.

## [4.27.0] — 2026-07-02

June-deferral triage (owner roadmap item 6): the five items parked during June's 20-phase sweep each got a verdict — three built, two killed with recorded reasons. The deferral ledger is now empty.

### Added
- **`GET /api/guard ?days=N`** (1–90, mirrors `/api/actions`): windows both the rows and the `total` count, so `?decision=block&days=7` returns the true weekly denied count. `/activity`'s weekly narrative now uses the windowed API count instead of a 200-row capped buffer (busy weeks undercounted). New policy smoke checks J1–J2.
- **Evaluations concept walkthrough** at `/docs#evaluation-framework` (scorers → runs → scores → distributions), linked from the `/evaluations` empty states.
- **Agent-picker URL persistence:** the global agent filter reads `?agent=` on load and keeps it in the URL across navigation (`history.replaceState`, no Suspense-boundary cost). Filtered dashboard views are now deep-linkable and survive reload.
- **Workflows → ledger link:** "All runs in the decisions ledger →" on the workflows tab bar, deep-linking `/decisions?action_type=workflow_execute`.

### Decided (killed, with reasons in the spec)
- **No /workflows Runs tab** — the decisions ledger filtered to `workflow_execute` *is* the org-wide runs view; per-template history already ships on the template detail page.
- **No Mission Control cadence port** — the live/batch/pause buffer solves SSE flood-reading; Mission Control's feed is a 30-second poll, already batched by design.

## [4.26.0] — 2026-07-02

Effective-risk escalation observability (owner roadmap item 5): every risk escalation is now explainable in one glance, and the two calibration holes exposed by the June "risk 100" forensics are closed.

### Changed
- **Velocity is an amplifier, not a signal.** The predictive layer's +5 velocity term (>5 actions/hour) now applies only when a failure-rate prior already fired (`failure_rate > 0.25`) — "failing, and failing fast." Clean high-velocity agents no longer pay a flat risk tax; runaway-loop protection remains the `rate_limit` policy's job. The cold-start `no_history` prior is unchanged.
- **The LLM risk amplifier (±20) is triggered by server-side evidence only** (`max(server heuristic, org template)` + statistical prior vs the threshold). An agent-reported score still max-folds into the final risk — an agent declaring danger is believed — but a false-high client score (e.g. a classifier fallback) can no longer recruit the LLM adjustment on top of itself.

### Added
- **`risk_breakdown.predictive` decomposition** (additive keys): `statistical_adjustment`, `velocity`, and `llm { adjustment, model, reasoning }` are recorded separately, so forensics never infer the LLM term by subtraction. The Risk-derivation panel renders the history prior and the LLM assessment as separate rows, and the public `/replay` story card gains a one-line composition strip (`server 20 · template 15 · agent 42 · history +5 → 47`). New policy smoke checks I1–I3 (harness 49 → 53).

### Fixed
- **The breakdown panel was blank on the modern FK-linked path**: `getGuardDecisionById`/`getActionWithRelations` never lifted `context._risk_breakdown` to the `risk_breakdown` field the UI reads; only legacy time-window-correlated decisions showed a derivation. `GET /api/actions/:id` now exposes `guard_decision.risk_breakdown`.
- **`GET /api/guard` (decision list) 500ed on local Postgres** (`42883 operator does not exist: text -> unknown`): the list query applied a jsonb operator to the TEXT `context` column. Both paths now lift the breakdown in JS — which also sidesteps `::jsonb` casts rejecting contexts carrying literal backslash-u0000 escapes — and the list payload still never leaks the raw context blob.

## [4.25.0] — 2026-07-02

The agent's advocate (owner roadmap item 4): the governance ledger, reframed and surfaced as protection FOR the agent — the assumption ledger as its alibi, the shields as its defense against weaponization, the spend gates as its guard against bankrupting mistakes.

### Added
- **`agent_defense` rollup on `GET /api/actions/:id`** (additive response keys; no new route). For every governed action: what the agent declared (`declared_goal`/`reasoning`/`authorization_scope`/`trigger`), what it assumed (total/validated/invalidated/open counts), the exact guard decision that governed it — joined by the `guard_decision_id` foreign key, replacing the legacy action_type+60s-timestamp correlation in the new UI — and each shield's outcome (prompt-injection scan, non-fabrication verdict/violations/receipt, x402 spend gate for purchase actions). The linked decision row also rides along as `guard_decision` with its JSON columns parsed.
- **Structural shield persistence.** The guard now records the prompt-injection scan's outcome (`clean | warned | blocked | disabled`) in the persisted decision context (`_shields`, next to `_risk_breakdown`) — warn-level catches and "scan ran, found nothing" were previously not recorded anywhere. Honesty rule throughout: rows from before this release render as `not_recorded`; the advocate surface never fabricates a clean bill.
- **Surfaces:** an "Agent Defense" card on the action detail views, a counts-only badge row on the shareable `/replay` story card (never assumption text), a "The agent's advocate" section on `/explain`, and advocate positioning in `/docs`. New H-series claims in the claims-audit ledger, pinned live by policy smoke checks H1–H4 (harness 44 → 49).
- **PowerShell command classification in the governance hooks.** The pretool hook now routes the PowerShell tool through the semantic classifier, which understands Verb-Noun cmdlets (`Get-*` readonly, `Remove-*` destructive, `Invoke-Expression` code execution, `Invoke-WebRequest` network), and bounded single-file `Remove-Item` grades like bounded `rm` (`-Force` is not recursion). Born from two wrong interruptions of the maintainer itself this session — both are now labeled calibration vectors (corpus 26 → 31).

## [4.24.0] — 2026-07-02

Calibration corpus v2 — mining (owner roadmap item 3). *(Entry backfilled during the 4.25.0 release: the 4.24.0 ship landed without its changelog block — the maintainer-log entry existed, this file was missed.)*

### Added
- **`npm run calibration:mine`** — read-only miner over guard decisions, recorded behavior samples, and the approvals ledger for calibration candidates: benign evidence that scored into the interrupt band, dangerous evidence that scored below it, and shapes a human has repeatedly approved. Every candidate carries its evidence rows and the persisted `_risk_breakdown`.
- **`npm run calibration:add`** — the vector forge: takes an `action_id` or raw command, runs both scorers live (client `classify_bash`, server `computeRiskScore`), and emits a fixture-ready golden vector with provenance and suggested bounds.
- Chain-aware `classify_bash` (per-segment classification of `&&`/`;`/`|` chains) and `npx` reclassification; corpus grew 22 → 26 vectors and closed the June "git show risk 100" forensics case (client-70 fallback + velocity + LLM amplifier).

## [4.23.0] — 2026-07-02

Cumulative x402 budget gate (owner roadmap item 2): the spend policy now interrupts runaway *cumulative* cost, not just the single purchase.

### Added
- **`x402_spend_limit` cumulative budget tier.** New optional rules alongside the per-purchase caps, mirroring their semantics: `budget_approval_threshold` (window sum + incoming ≥ → require_approval) and `budget_usd` (> → block), over a rolling `budget_window_days` window (1–365, default 30), scoped org-wide or per-agent via `budget_scope`. Both tiers coexist in one policy and the guard returns the more severe result. The sum uses the FinOps spend predicate (`execution_status <> 'failed'`) so the product has one definition of "spend"; the guard evaluates before the purchase row is written, so the incoming purchase never double-counts. Policies without budget fields gain zero DB queries.
- **Fail-closed by design:** a failed window-sum query degrades via the standard contract (per-policy `on_failure` → `DASHCLAW_GUARD_FALLBACK` → `require_approval`; `allow` is the explicit escape hatch and records a skip-warning on the persisted decision), and an unattributed purchase under an agent-scoped budget routes to approval instead of slipping through — omitting `agent_id` is not a budget bypass.
- **Concurrency close-out (from this ship's adversarial security review — PASS, 1 MEDIUM fixed in the same release):** N parallel purchases could each pass the budget check against the same pre-insert window sum (no transactions on Neon HTTP). The purchases route now re-verifies the hard budget after the row commits and compensates on breach before the agent executes payment — purchase → `failed`, action → `blocked` (audit trail preserved), response → 403.
- **Authoring parity:** budget fields in the /policies rule builder (compile/decompile/summary), typed rules, and validated via `POST/PATCH /api/policies` (`budget_usd` 0 = hard spend freeze is valid). Migration `0036` adds an `(org_id, created_at)` index for the guard-hot-path sum.
- **Live proof:** policy smoke harness section B6 accumulates real purchases ($4/$4/$4/$10) into require_approval at the threshold and block over the budget, in CI on every push; 15 new evaluator golden vectors cover boundaries, severity precedence, scope, and every degradation path.

### Fixed
- The platform-intelligence skill described `x402_spend_limit` as enforcing a "daily ceiling" — an overpromise while the evaluator was per-purchase only. The description now matches reality (per-purchase caps + rolling-window budget + provider lists), and the /explain playground caption states that the cumulative budget is real but not part of the simulation.

## [4.22.0] — 2026-07-01

Policy-tuning proposal loop (owner roadmap item 1): the outcomes ledger now feeds policy configuration — with a human ratifying every change. *(Entry backfilled 2026-07-02; the ship itself landed 2026-07-01 as `2cd1071a..478c7231`.)*

### Added
- **Per-policy interruption stats + proposal engine.** For each guard policy: interruptions (warn / require_approval / block), approval outcomes of those interruptions, and override rate over a rolling window that clips at the policy's own `updated_at` — accepting a proposal resets its evidence, so tuning can't ratchet on stale data. Rule-based proposals (no LLM): `raise_risk_threshold` (≥10 fired, ≥5 resolved, ≥90% overridden → propose +10, capped at 95), `keep_policy` (≥80% denials — evidence it works), `dead_policy` (60 days, zero fires). Loosen-only; never against block-action policies.
- **/policies review feed.** Each proposal carries its evidence; accept = one click that PATCHes the policy through the existing validated route; dismiss records a redacted reason. Nothing auto-applies (constitution §3).
- **`action_records.guard_decision_id` join** (migration `0035`): approvals now link back to the guard decision and its matched policies — stamped server-side, validated (`act_gd_` format + same-org) when client-supplied.
- Policy smoke harness grew 25 → 40 live checks, including the T1 end-to-end tuning-loop scenario.

### Fixed
- Latent approvals bug surfaced by the new smoke check on its first CI run (hotfix `478c7231`).

## [4.21.1] — 2026-06-15

Security: patch the transitive esbuild and vite advisories.

### Security
- **Cleared 5 high-severity dependency advisories** (`npm audit`: 5 high → 0). Replaced the too-low scoped `@esbuild-kit/core-utils → esbuild ^0.25.0` override with a global `esbuild: ^0.28.1` and added `vite: ^8.0.16`, lifting every resolution out of the vulnerable ranges. Fixes esbuild RCE (GHSA-gv7w-rqvm-qjhr) and Windows arbitrary-file-read (GHSA-g7r4-m6w7-qqqr) across the direct, `vite`, `tsx`, and `drizzle-kit` paths, plus vite's `server.fs.deny` bypass (GHSA-fx2h-pf6j-xcff) and launch-editor NTLM hash disclosure (GHSA-v6wh-96g9-6wx3). The global override also deduplicated 3 separate esbuild installs into one. No source changes; full vitest suite, lint, and build all pass. Platform-only release — SDK source unchanged, so npm/PyPI stay at their last SDK number.

## [4.21.0] — 2026-06-13

One-command local install: `npx dashclaw up`.

### Added
- **`npx dashclaw up` — one command from nothing to a running, governed local DashClaw.** Installs the app to `~/.dashclaw`, provisions Postgres (Docker if present → embedded Postgres, no accounts → paste a `postgresql://` URL), generates secrets, mints the admin API key, applies migrations, builds, starts on `:3000`, and offers to wire Claude Code hooks. Re-running boots an existing install; `npx dashclaw down` stops it; `--update` upgrades; failures checkpoint and resume. Flags: `--yes --no-browser --db docker|embedded|url --dir --port --source-dir --update`.
- **SDK bin shim:** the `dashclaw` npm package now exposes a `dashclaw` bin that forwards `npx dashclaw <args>` to `@dashclaw/cli` (`@dashclaw/cli` 0.5.0 carries the `up`/`down` commands).
- **`scripts/setup.mjs` non-interactive mode** (`--yes --database-url --json --skip-install --skip-build`) so the installer can drive it as a child process with a single-line JSON contract on stdout.
- **3-OS CI smoke** (`.github/workflows/up-smoke.yml`): end-to-end `up` against embedded Postgres on ubuntu/windows/macos.

### Fixed
- `up` installer hardening from review + a real end-to-end run: stdin-`ignore` so a stray prompt can't hang setup; `--database-url` overrides a stale `.env.local`; non-interactive setup fails loudly on an unreachable DB; `--json` never echoes a pre-existing admin password; url-mode reuses the saved DB URL on resume instead of re-prompting; boot detects a live server and reuses it instead of spawning a duplicate; setup skips its redundant install+build when driven by `up`; Windows docker-filter caret + embedded-init cleanup + tarball-failure cleanup.

## [4.20.2] — 2026-06-13

Security + reliability hardening from an adversarial review and a security pass. Platform-only — no SDK source change, so the Node + Python SDKs are intentionally not republished at this version.

### Security
- **Org kill-switch (halt) can no longer be bypassed by the idempotency replay (CRITICAL).** A halted org's retried action carrying a matching `idempotency_key` was served its cached pre-halt decision (allow/warn/require_approval) for up to the 10-minute replay window — and with `?record=true` recorded as running. Halt is now read before the replay short-circuit (new `getOrgHaltState`, sharing the cached settings read + eager invalidation), so every evaluation under a halt blocks as documented.
- **`/api/webhooks/stripe` is reachable for Stripe's unauthenticated signed POST** — added to the public routes so billing events stop 401ing before signature verification (dormant until `STRIPE_SECRET_KEY` is set, but would have silently desynced billing from entitlements).
- **Public-route matching is boundary-aware** (`pathname === route || startsWith(route + '/')`) so a future sibling of a public prefix (e.g. `/api/cron-report`) cannot ship unauthenticated — the foot-gun that once exposed the whole `/api/prompts` surface.
- **Local admin login is brute-force resistant** — a DB-backed per-target failure counter locks the login after repeated failures (previously only the per-instance in-memory rate limiter), fail-open so a broken store can't lock the operator out.
- **CLI and MCP client warn on a plaintext-`http` base URL** to a non-local host, where the API key would travel unencrypted.

### Fixed
- **Context-menu governance actions surface server failures instead of silently succeeding (MAJOR).** Site-wide right-click Approve/Deny/Delete/Revoke checked no response status and refreshed unconditionally, so a 401/403/500 looked like success; they now throw on `!res.ok` and surface the failure, matching the hardened approvals page.
- **Vercel preview deployments build again** — `auto-migrate` skips on a non-production build with no `DATABASE_URL` (the preview environment has none) instead of hard-failing, while a production build missing it still fails loudly. Stops failed-preview emails on every Dependabot PR.
- **HITL approvals are honored on guard re-evaluation**, and the hook text scorer is calibrated.
- **`node -e` / `python -c` are no longer blocked by accident** — the bash classifier gained an interpreter intent so inline eval lands in the warn band instead of inheriting the worst-case unknown-command risk that pushed it into the block band.
- Repo hygiene: the marketing "Run live demo" button is wired to the live-demo anchor; stale gate logs and one-off reports were cleaned up; the 32 MB marketing video was untracked.

## [4.20.1] — 2026-06-12

Launch-readiness patch (Show HN prep): MCP read-path fixes + doc hygiene.

### Fixed
- **MCP read tools honor explicit `agent_id` filters** (`@dashclaw/mcp-server` 2.0.1): on the 8 query tools (`loop_list`, `learning_query`, `decisions_recent`, `handoff_latest`, `secret_list`, `secret_due`, `inbox_list`, `behavior_suggestions`) the server-configured agent id no longer silently rewrites an explicit per-call filter — "show me agent X's loops" used to return the caller's own rows. Write tools keep server-priority identity pinning (impersonation guard, unchanged) and their tool descriptions now say so instead of promising an override.
- `GET /api/actions/loops` actually filters by `action_id` — the MCP `loop_list` tool has always advertised and sent the param, but the route silently ignored it and returned every loop.
- README: dropped the stale `(v2.13.3)` version label from the Durable execution finality section (platform versions are 4.x; the label read as the current release).
- Removed `docs/homepage-draft-claude-code.md` — a superseded Phase-3 homepage draft whose maintainer checklist (unpublished screencast URL) was visible in the public repo.

### Notes
- The May 2026 smoke-test reports of `loop_list`/`learning_query` returning 500s were re-verified against the live instance: both were fixed by the earlier loops-route join fix and are healthy; the agent_id filter rewrite above was the remaining real defect.
- Republish owed: npm `@dashclaw/mcp-server` 2.0.1, plus the SDK 4.20.x republish carried over from 4.20.0 (registries last at 4.11.0).

## [4.20.0] — 2026-06-12

Guard Enforcement Contract (Organ 3 / One-System program, Phase 1): the trust spine now fails closed. Full reference: `docs/guard-enforcement-contract.md`.

### Added
- **Evaluation deadline** — guard policy evaluation is bounded (default 3500ms, `DASHCLAW_GUARD_DEADLINE_MS`); on overrun a degraded decision is built from accumulated state (never downgrading an already-found block), still persisted through the audit gate, with recovery marked partial. The hooks' 5s/zero-retry HTTP budget can no longer be bricked by a slow webhook or LLM phase.
- **Org kill switch** — `POST/GET /api/halt` (admin-only, both transitions audited via activity_logs) + `dashclaw halt on|off|status [--reason]`. While halted, every guard evaluation for the org returns an immediate audited block across hook/MCP/SDK/API; eager cache invalidation makes it effective on the very next call (no 30s TTL lag); the halt read piggybacks the existing hot-path settings query.
- **End-to-end idempotency** — every auto-retrying client derives an idempotency key (one convention, reference `sdk/dashclaw.js deriveIdempotencyKey`, pinned by cross-language golden vectors): hooks key on `tool_use_id`, MCP/SDKs on content + hour bucket; SDK `createAction` auto-derives when the caller didn't supply one (explicit key wins). `/api/guard` accepts `idempotency_key`; `?record=true` short-circuits on the existing action row; a duplicate guard call inside a 10-minute window replays the prior decision (`idempotent_replay: true`) and writes NO new guard_decisions row, keeping approval-flood/signal/digest counts honest.
- MCP guard context enrichment toward hook parity: optional `target`, `write_paths`, `content` (capped 20k), `tool_name` inputs let protected-path, secret-scan, and content policies fire on MCP-originated calls.
- `docs/guard-enforcement-contract.md` — degradation precedence, deadline, cross-surface unavailable policy, idempotency derivation, kill switch.

### Changed
- **Fail-closed degradation defaults** — webhook `on_timeout` and semantic-check `fallback` defaults flipped from `allow` to the global contract: per-policy override → `DASHCLAW_GUARD_FALLBACK` → `require_approval`. `DASHCLAW_GUARD_FALLBACK=allow` is the explicit self-hoster escape hatch; the env enum now accepts `require_approval`. Policy-builder UI defaults flipped to match (existing policies with explicit values are untouched).
- **MCP fail-closed mapping** — `dashclaw_guard` maps transport errors / non-2xx / malformed responses to an explicit fail-closed result governed by `DASHCLAW_GUARD_UNAVAILABLE_POLICY` (default `block`, same env name + default as the Python hooks); `dashclaw_record` fails loud ("NOT written to the audit ledger") instead of returning a raw error blob.
- Hook HTTP retries are transient-only: non-transient 4xx fail immediately (408/429/5xx still retry); the AUTH_FAILED sentinel is preserved.

### Fixed
- Livingcode mirror pipeline: plugin hook mirrors (`plugins/dashclaw/hooks/*.py` + `dashclaw_agent_intel/`) and the platform-intelligence skill mirrors are now auto-staged into the SAME commit as their canonical source (previously they landed in follow-up sync commits); `dashclaw_session_digest.py` added to the living-merge post-merge regen manifest.

## [4.19.1] — 2026-06-12

Docs/media patch.

### Added
- README overhaul: a Remotion-rendered governance-loop animation (intent → guard → approve → record, in the product's token palette) plus a "control plane, running" tour with live screenshots of the Decisions Ledger, Mission Control, Analytics, and Governance Posture. Animation source lives in `media/remotion/` (standalone subproject, not part of the platform dependency tree); render with `npm run render:gif`.

## [4.19.0] — 2026-06-12

Full-app polish run (Phases 4–6 of the 2026-06-12 close-out): three user-reported UI defects root-caused and fixed, an 88-page UI sweep, and a 7-dimension backend sweep — every fix adversarially verified before landing.

### Added
- Mission Control: repeated occurrences of one signal now collapse into a single governed-events row with a ×N occurrence chip; the X dismisses every occurrence (feed items carry `dismiss_keys` + `occurrence_count`). Fixes the "dismiss does nothing" defect (45 identical rows shared one feed id).
- /policies: the interruption contract's learned suppress-rules collapse to a one-line rollup ("N suppressed patterns · M added this week"), expanding to action-type groups with deduped shapes, basename-first paths, bounded scroll, per-rule remove and clear-group (existing DELETE endpoints), and a persisted open state. `ContractGrant` now carries `created_at`.

### Fixed
- Work Orders: the status filter rendered as an empty white box (`bg-surface` is not a theme class — the native select kept the browser's white background under inherited white text). Now tokenized like every other input.
- UI sweep (15 files): raw-palette classes replaced with theme tokens; `window.alert`/`window.confirm` replaced with inline toasts and two-step confirmations (decisions, workflow runs, workflows bulk delete); bare catch blocks now log with context.
- Backend sweep: silent `.catch(() => {})` on learning rebuilds, presence heartbeats, x402 compensation deletes, and hosted orphan cleanup now log; the un-awaited meter/index work on `POST /api/actions` runs in `after()` (Vercel killed it at response end); `GET /api/scoring/profiles` clamps `limit`/`offset`; broadcast read updates batched; billing-portal SQL moved into the orgsTeam repository (route-sql 79→78). Security review of the sweep diff: PASS.

## [4.18.0] — 2026-06-12

Governance-posture close-out (Mission A of the 2026-06-12 run).

### Added
- `docs/plans/2026-06-12-posture-score-rebaseline.md` — adversarially verified audit of the 2026-06-05 posture plan: Tasks 8–19 confirmed SHIPPED on main with named passing tests (17-agent fan-out, refute-by-default verification); only the recurring SDK-publish tail remains open.

### Fixed
- SUPERSEDED banners on the stale 2026-06-05 posture plan and 2026-06-06 PROGRESS handoff (both previously read as resumable work).
- Stale "44-method stable surface" SDK count in the dashclaw-agent skill knowledge (now points at the canonical SDK READMEs instead of hardcoding a number).
- `.playwright-mcp/` added to `.gitignore` so Playwright MCP discovery artifacts can't be swept into commits.

## [4.17.1] — 2026-06-12

Polish-pass patch.

### Fixed

- **CLI doctor repo checks now actually run in a DashClaw checkout** — repo detection matched a stale package name (`dashclaw` vs the real `dashclaw-platform`; structural fallback added for renamed forks), and the schema-behind probe now goes through `npm run doctor` (which carries the tsx loader) with env passthrough, so it verifies the local DB for real instead of degrading to a warning.
- **Bulk approval resolution emits one aggregate `action.updated` event** so live dashboards refresh after a flood resolution (no per-action publish storm).
- Recovery suggestion/steps echoed by the hooks are length-bounded (defense-in-depth from the preship review).

## [4.17.0] — 2026-06-12

Layered-intelligence close-out: the 2026-04-03 plan was audited against current main (it had already shipped in April — 15/17 tasks live); this release closes the two real gaps the audit found.

### Fixed

- **Hooks now surface guard recovery guidance.** The server has attached recovery recipes (suggestion + steps) to warn/block guard decisions since the layered-intelligence ship, but `dashclaw_pretool.py` silently discarded them — agents never saw the guidance. `handle_warn`/`handle_block` now print the recovery suggestion and up to 5 steps (length-bounded) to stderr; hook exit codes are unchanged.

### Added

- **Test hardening from the layered-intelligence gap audit** (`docs/plans/2026-06-12-layered-intelligence-rebaselined.md`): dedicated unit tests for the 4 intel signal types (`session_stalled`, `branch_stale`, `mcp_degraded`, `green_insufficient`); a true end-to-end integration suite — real pretool hook subprocess vs a mock guard returning recovery (Python), and guard-recovery→session `blocked_reason` linkage (JS). The stale 2026-04-03 plan + RFC carry SUPERSEDED banners pointing at the re-baselined plan.

## [4.16.0] — 2026-06-12

W4 "kill the setup tax": `dashclaw doctor --fix` one-command self-repair across the instance, the repo checkout, and the operator machine.

### Changed (behavior)

- **CLI `dashclaw doctor` is now report-only by default** (it previously auto-applied remote fixes). Pass `--fix` to apply safe auto-fixes; doctor then re-checks and prints a what-changed report. `--no-fix` stays accepted as a no-op alias and wins over `--fix`. Exit codes are unchanged (0 healthy, 1 otherwise); `--json` is additive (local checks carry `local: true`). `npm run doctor` follows the same report-only default with the same `--fix` opt-in. CLI bumps to 0.4.0 (npm publish owner-gated).
- **`POST /api/doctor/fix` now requires an admin-role API key and an org context** (403 otherwise). Remote fixes and the data-hygiene probe are scoped to the caller's org — hosted deployments share one database, so cross-org reads/writes from doctor are no longer possible. Unscoped instance-wide runs remain operator-local only (`npm run doctor`).

### Added

- **Doctor `data-hygiene` category** (11th engine category): detects non-ISO strings in client-written TEXT timestamp columns (the `Date.toString()` incident class), classifying parseable (fixable) vs unparseable (reported, never mutated) values.
- **`normalize_timestamps` remote fix**: idempotently rewrites parseable non-ISO timestamp values to ISO-8601 with exact per-column row counts; a second run changes 0 rows.
- **CLI local doctor checks** (merged with the remote report; the server can't see these): stale compiled `mcp-server/lib`, `.gitattributes` drift (auto-restore only under a provable line-ending/whitespace-only diff), local DB schema behind code, OpenClaw runtime plugin disabled/stale (detect-only), stale global CLI shim, broken/missing DashClaw Claude-hook installs, and leaked machine-scope `DASHCLAW_*` env vars (detect-only, prints names + removal instructions, never values).
- **MCP `doctor` tool platform section**: when `DASHCLAW_URL` + `DASHCLAW_API_KEY` are configured, the existing tool appends a read-only `platform` report from `GET /api/doctor` (fix metadata stripped, API key redacted from errors). Tool count stays 32; the report is unchanged when credentials are absent.
- **CLI doctor degrades instead of dying**: when the instance is unreachable, local machine/repo checks still run and report (synthetic `remote_unreachable` check, exit 1).

## [4.15.0] — 2026-06-12

### Added

- **Interruption budget / approval flood guard (W3).** No single policy — or the fleet — can generate unbounded approval interruptions anymore. When a policy exceeds the org budget (`DASHCLAW_INTERRUPT_BUDGET`, default 10 `require_approval` interrupts per `DASHCLAW_INTERRUPT_WINDOW_MIN` 15-minute window; fleet-wide cap `DASHCLAW_INTERRUPT_BUDGET_FLEET`, default 30), per-action Discord/Telegram prompts pause for that source and ONE flood event goes out through the notification adapters instead. Pending approvals are never auto-resolved and machine webhooks are never suppressed; every fail-open path falls back to today's per-action behavior. Flood state lives in a settings marker with hysteresis (clears below half-budget), evaluated on read so floods also clear once traffic stops.
- **Flood resolution surfaces.** `GET /api/approvals/floods` reports tripped budgets; `POST /api/approvals/bulk` (admin-only, capped at 500, one batched UPDATE with the same per-row race guard as single approvals, fully audited) bulk-allows or bulk-denies the pending actions a flooding policy produced; a calm warning banner on `/approvals` and `/policies` offers pause-rule / approve-all / deny-all behind two-step confirms.
- **Fleet digest.** `GET /api/digest/fleet` composes a compact 24h digest (decision mix vs prior day, pending approvals with oldest age, flood state, attribution coverage, spend, top signals — one line when the fleet is quiet) and a request-piggybacked digest tick (no cron; claimed-marker pattern, `DASHCLAW_DIGEST_INTERVAL_HOURS`, default 24, `0` disables) delivers it daily through the configured Slack/Discord/email adapters. `?lite=1` serves the SessionStart hook within its 1.4s budget, and the session digest now surfaces pending approvals and active floods at the start of every Claude Code session. See `docs/fleet-digest.md`.
- **Two new risk signal types (16 → 18).** `approval_flood` (red) mirrors the interruption-budget state; `coverage_drop` (amber) fires when token-attribution coverage falls below 90% over 7 days with ≥50 actions.

### Fixed

- **The compiled MCP server lib lagged its source.** `/api/mcp` was serving 30 tools while the docs (correctly) cited 32 — `dashclaw_work_order_submit` and `dashclaw_work_order_status` existed in `mcp-server/src/tools.ts` but had never been compiled into `lib/tools.js`. Recompiled; the work-order tools are now actually served.

### Notes

- The signal dedup hash now includes `policy_id`, so the first signal sweep after this deploy re-alerts every currently-active signal once; dedup re-stabilizes on the next tick.

## [4.14.0] — 2026-06-11

### Fixed

- **A review-feed "tighten" can no longer gate an entire action type org-wide.** `POST /api/policies/review/verdict` dropped the shape's `target_prefix` when compiling non-path tighten verdicts, so a narrow "tighten `other` → host" verdict produced `require_approval` over ALL `other` actions for every agent — which routed the whole swarm's routine traffic into approval and flooded the operator (live incident, 2026-06-11). The guard engine now supports an optional `target_prefix` on `require_approval`/`block_action_type` rules (boundary-aware host/path matching shared with `allow_grant` via `targetPrefixMatches`), the verdict route carries the prefix through, and a rule scoped to a target never fires for target-less actions. The offending live policy was deactivated.

### dashclaw OpenClaw plugin [1.4.0]

- **Codex turns that end a run without usage are surfaced, never silently dropped.** Investigation confirmed the Codex app-server genuinely emits no usage notification for some turns (not a race): fold-forward distribution onto the next usage-bearing turn already recovers mid-run gaps, and `agent_end` now logs a warn breadcrumb (runId + unattributed count) for the trailing-turn residue that is unrecoverable in-process. Three new tests pin fold-forward arithmetic, the double-counting guard, and the breadcrumb. The gateway's `defaultModel` was corrected from `openai-codex/gpt-5.5` to the swarm's actual `claude-fable-5`.

## [4.13.0] — 2026-06-11

### Added

- **Token attribution coverage — the silent-failure detector for cost data.** `getCostAggregation` now reports `attribution` (`attributed_count` / `total_count` / `coverage_pct`) org-wide and a `coverage_pct` per agent: the share of governed actions that actually carry token data. `/spend` surfaces a warning when coverage drops below 90%, naming the lowest-coverage agents with a pointer to `npm run diagnose:cost`. Built after a live diagnosis found the OpenClaw fleet's cost attribution had been silently dark since 2026-06-08 (the `dashclaw-governance` OpenClaw plugin had been disabled in gateway config — re-enabled and verified live; see #147). An attribution outage is now visible the day it happens, not weeks later.
- **Close-the-loop spec + plan** under `docs/superpowers/` (quiet distribution + dogfood value loop; W2–W4 workstreams queued).

## [4.12.0] — 2026-06-11

### Added

- **SessionStart memory digest hook for Claude Code (`hooks/dashclaw_session_digest.py`).** Every new Claude Code session opens with a compact digest of what the agent already learned: recent decisions (outcome + confidence), the top distilled lessons from the learning loop, overall success rate, and the latest unconsumed handoff with a pointer to `dashclaw_handoff_consume`. Read-only and strictly fail-silent — missing config, an unreachable instance, or a slow API prints nothing and exits 0 inside a ~3s budget, so session start is never blocked. Same env config as the sibling hooks (`DASHCLAW_BASE_URL`/`DASHCLAW_URL` + `DASHCLAW_API_KEY`, optional `DASHCLAW_AGENT_ID`); opt out with `DASHCLAW_DIGEST_DISABLED=1`. Distributed everywhere the other hooks are: `scripts/install-hooks.mjs` (per-project and `--global --governance`, now a managed hook file), the `dashclaw` plugin bundle (`hooks.json` SessionStart entry), the `dashclaw-claude-code-hooks.zip` download, and `hooks/README.md`.
- **OpenClaw is now featured across the marketing site, with its origin story.** The landing hero names OpenClaw among the runtimes that can hard-block via lifecycle hooks, the Works-with band lists it, `frameworkQuickstarts` gains an OpenClaw config card, and `/guides/openclaw` opens with the origin line — OpenClaw is the framework that inspired the "Claw" in DashClaw. Downloads-page copy updated to the five-script hook bundle (four hook events).
- **Platform-salvage payload landed from the `platform-salvage` branch (PR #144).** The layered-intelligence plan and design RFC (`docs/plans/2026-04-03-dashclaw-layered-intelligence.md`, `docs/rfcs/2026-04-03-dashclaw-layered-intelligence-design.md`), the GroundLock C2PA sidecar reference implementation (`docs/integrity/groundlock-c2pa-sidecar.ts`, excluded from TypeScript compilation), the HN launch-readiness audit script (`scripts/hn_readiness.py`), and the Kimi/Moonshot governed-agent example documented in `examples/README.md`. Cherry-picked without the branch's stale v4.7.10 release commit.

### Fixed

- **The marketing-site "Mission Control" CTA enters the demo sandbox again.** The launch-prep commit (`1f525c87`) repointed `/demo` at the landing-page live-demo widget and dropped the `dashclaw_demo` cookie set, which orphaned the entire cookie-demo path — the navbar/footer "Mission Control" buttons became a visible no-op on the landing page and the demo dashboard was unreachable from the UI. Plain `/demo` keeps the launch-prep behavior (live-demo anchor, no cookie); the new `/demo?sandbox=1` (now wired to both Mission Control CTAs) mints the 24h httpOnly cookie and forwards into `/mission-control`, where reads serve deterministic fixtures and writes stay blocked. `/demo?leave=1` still exits.

### dashclaw plugin [2.15.0]

- **SessionStart memory digest hook ships in the plugin bundle.** `hooks/dashclaw_session_digest.py` added to the plugin with a `SessionStart` entry in `hooks.json`, so plugin installs open every session with the recent-decisions/lessons/handoff digest. Read-only, fail-silent, same env config as the sibling hooks.

## [4.11.0] — 2026-06-11

### Added

- **Work Orders — task-grade contracts with self-verifying receipts.** Submit typed work (`POST /api/work-orders`) against a registered contract (`work_order_types`, JSON-Schema-subset validation in both directions) with a budget ceiling and timeout; any external worker claims the next queued order atomically (`POST /api/work-orders/claim`, `UPDATE … SKIP LOCKED` lease) and reports completion (`POST /api/work-orders/:id/complete`) — DashClaw validates the output against the contract, links artifacts, and writes a canonical SHA-256 receipt (`work_order_receipts`) covering input/output hashes, cost, lifecycle timestamps, and the governance trail (guard decision, matched policies, audit record). Receipts are independently verifiable — no DashClaw-side secret. Submission runs through guard like any governed action; over-budget completions are flagged on the receipt. Ships 7 new routes (317 total), the `/work-orders` dashboard (queue + ledger + client-side "Verify receipt hash"), 8 Node SDK methods (137), 8 Python SDK methods (233), 2 MCP tools `dashclaw_work_order_submit` / `dashclaw_work_order_status` (32), a `research_brief` seed contract, and a ~75-line reference worker at `examples/work-order-worker/` (deterministic mock mode without an Anthropic key). DashClaw stays the control plane — execution is external workers via claim/complete.

### Security

- **Resolved all 19 open CodeQL alerts (#101–#119).** Source fixes: `js/regex-injection` in `app/lib/integrity/verify.ts` (forbidden-pattern compilation routed through `assertSafePattern`); `js/unvalidated-dynamic-method-call` in `app/lib/guard.ts` and `app/lib/validate.js` (policy evaluator/validator dispatch via a `Map` guarded by `.has()` + `typeof === "function"`); `js/polynomial-redos` ×7 across `mcp-server/src/dashclaw/guard.ts` and six `providers/*.ts` (secret-redaction regexes rewritten with zero-width lookaheads; trailing-slash strip replaced by a linear `stripTrailingSlashes`); `js/incomplete-sanitization` in `mcp-server/src/service.ts` (markdown audit-export cells now escape backslash before pipe and normalize newlines); `js/incomplete-url-substring-sanitization` in `mcp-server/src/launch/checks.ts` (dot-bounded `.vercel-dns.com` host match). The seven test-file url-substring alerts were dismissed as false positives (assertions/harness filters over fully-controlled mock URLs). Each fix carries a regression test.

### Fixed

- **PreToolUse/Stop hooks no longer misreport an HTTP 401 as "Guard unreachable."** `api_request` swallowed urllib `HTTPError` into a generic failure, so a bad/missing `DASHCLAW_API_KEY` looked like a dead host. The guard path now surfaces a 401/403 distinctly ("unauthorized — invalid or missing API key"); genuine connection failures still report "unreachable". Fix mirrored byte-identically across `hooks/` and `plugins/dashclaw/hooks/`. (#145)

### dashclaw plugin [2.14.2]

- Hooks-bundle refresh shipping the 401-misreport fix above; bundle zips regenerated.

## [4.10.0] — 2026-06-11

### Added

- **Interruption contract — the `/policies` page is now a plain-English contract, not a policy list.** `GET /api/policies/contract` renders the org's active guard policies into a `ContractView`: when agents will interrupt you (with editable spend thresholds inline), what blocks outright, what's recorded silently, standing "never bother me" grants, and a weekly friction estimate (interrupts × ~20s). The rebuilt cockpit (`ContractPanel`) shows it with live 7-day fire counts; shields moved into a collapsed "Add protection" disclosure with bidirectional toggles.
- **Review feed with one-click verdicts.** `GET /api/policies/review` groups silently-recorded warn decisions since your last review by action shape; `POST /api/policies/review/verdict` (admin) acts on a group: `fine` advances the cursor, `always_allow` mints a scoped allow-grant, `tighten` mints a protected-path / require-approval policy, `mark_all_reviewed` clears the queue. The `/policies` "To review" queue (`ReviewFeed`) drives it with optimistic updates and inline error recovery.
- **Contract renderer** (`app/lib/policy-modes/contract.ts`): deterministic policy→sentence templates for all 15 policy types, resilient to malformed rules; demo mode ships a faithful claude-code contract + review fixtures.

### Changed

- **Claude Code mode defaults redesigned for low interruption — action needed if you imported the old mode.** The `claude-code` pack now gates paid (x402) spend at **$5 approve / $25 block** (was $0.01/$0.10), and external comms / sync / api actions are **warn-not-gate**: recorded silently for the review feed instead of interrupting you. **Existing orgs keep their old imported policies until they re-apply the mode** — mode import dedupes by policy name, so nothing changes silently; open Policies → mode → re-apply `claude-code` to adopt the new defaults.
- `/policies` retires the posture-header / enforcement-summary / shield-list / recent-digest cockpit in favor of the contract + review layout.

### Fixed

- Review timestamps are timestamptz-cast and ISO-normalized; verdict shape inputs carry 128/256-char length guards (parity with `validate.js`).


## [4.9.0] — 2026-06-10

### Added

- **`@dashclaw/mcp-server` 2.0.0 — governance + governed execution in one server.** The offlocalai-mcp fork's TypeScript codebase absorbed into `mcp-server/` (Apache-2.0 + NOTICE, zero upstream-brand strings outside NOTICE); the four hand-written v1 JS modules ported to TS with identical compiled paths and named exports, so `app/api/mcp/route.ts` and all consumers run unmodified. One stdio server now registers the 30 governance tools + 6 resources (when `DASHCLAW_URL`+`DASHCLAW_API_KEY` are set), provider-execution tools for 14 providers (each **only when its credential env var is present** — no token, no tools), and the always-on project/policy context set. `bin/dashclaw-mcp` doubles as the operational CLI (`doctor`, `context`, `map`, …).
- **Launch plans (mcp-server):** `create_launch_plan` / `get_launch_status` / `preflight_launch` / `verify_launch` — stateful launch tracking derived from the launch playbook, with **reality-checked, never self-reported completion** (each step re-verified against provider/local state via guarded reads), preflight (token presence+validity, mappings, Stripe mode sanity, Namecheap IP whitelist), and end-to-end verify (domain resolves, deployment READY, env vars present, webhook enabled, email domain verified). Plans live under `.dashclaw-local/launches/`; steps execute only through the existing guard/policy/approval path. Guide: `mcp-server/docs/launch-plans.md`.
- **Guard policy types `warn_action_type` + `allow_grant`** — warn-level action-type policies and scoped allow-grants with boundary-aware matching (host/path suffix bypass closed), an action-shape library for grants + review grouping, and the `allow_grant` form round-trip fixes.

### Changed

- mcp-server doc-count gates now read the TS sources (`src/tools.ts` / `src/resources.ts`); the mcpb bundle ships `NOTICE`; root typecheck/lint/vitest exclude `mcp-server/**` (the package runs its own `npm run verify` — 287 tests).
- mcp-server test env is hard-isolated: machine `DASHCLAW_*` vars are stripped before every test file, so suites can never reach a live server.

### Removed

- mcp-server's `@modelcontextprotocol/server` alpha dependency and unused `@cfworker/json-schema` (the v2 server runs on `@modelcontextprotocol/sdk` ^1.12).

## [4.8.0] — 2026-06-10

20-phase governance sweep closeout (28-item backlog): Node SDK `createPairing`/`waitForPairing` + `getAgentEnv`, Python SDK `get_agent_env`, operator pairing flow, managed agent env delivery, and 12 new doc-count gates. (Block backfilled — the release shipped without a changelog entry.)

## [4.7.11] — 2026-06-10

### Added

- **`dashclaw install claude [--trial]`** — clone-free Claude Code governance install in the CLI: preflights `/api/health` + an authenticated read before writing anything, downloads the hooks bundle from the target instance itself (or copies from a repo checkout), resolves `python3`-vs-`python`, wires managed hook entries into `~/.claude/settings.json`, stores credentials in `~/.dashclaw/claude-hooks/.env` (mode 600 — never in settings.json), and defaults to observe mode. `--trial` opens the hosted signup page and accepts the pasted key. README quick start rerouted through it — no clone step.
- **`dashclaw cost [--lens fleet|claude-code] [--period 7d|30d|90d]`** — terminal spend readback over `GET /api/finops/spend` with an aligned table + summary line, friendly unconfigured/unreachable/401/empty states, and flag validation.
- **Starter pack auto-seed** — hosted trial provisioning now seeds the `claude-code-starter` policy pack (4 policies) right after the key mint, so the first governed session enforces something. Seeding failure logs loudly but never fails provisioning. Pack import logic extracted to `app/lib/guardrails/import-pack.ts` (route behavior unchanged).
- **Visible first session** — the Stop hook prints a one-line recap after any turn that governed ≥1 action (`[DashClaw] Governed N action(s) this session — $X.XX (caching saved $Y.YY) · <url>/decisions`), quoting the same `code_sessions` cost row the `/api/finops/spend` claude-code lens aggregates.
- **`POST /api/guard?record=true`** (additive) — also creates the running action record in-request (shared `createActionRecord` repository, same redaction/quota/side-effects as `POST /api/actions`) and returns the real `action_id`; no record on block decisions. The pretool hook now makes ONE HTTP call per governed tool call, with a version-tolerant fallback to the legacy two-call flow against older servers.
- **`docs/HOSTED_TRIAL_RUNBOOK.md`** — the operator flip checklist for taking the hosted trial live (companion to `hosted-deployment-runbook.md`).
- `drizzle/0027` — the live-DB `action_records` indexes (`org_id`, `org+action_id`, `org+agent_id`, `org+timestamp_start`, `org+recommendation_id`) codified into `schema/schema.js` + migrations with `IF NOT EXISTS`; fresh installs no longer seq-scan the hottest table.

### Changed

- **Turbopack everywhere.** The 1,411 mismatched relative `.js` import specifiers (pointing at since-converted `.ts`/`.tsx` files) were codemodded to extensionless across 448 files, removing the reason for the `--webpack` opt-out: `npm run dev`, `dev:smoke`, `npm run build`, and the Vercel `buildCommand` all run Turbopack. Build compile 100s → ~7s; dev server ready in ~300ms with first page ≤0.8s (was 4.6s).
- **Dashboard fast paint.** `/api/operations/feed` p50 1.4–1.5s → ~0.3s: integration-health probes run in parallel behind a 5-min module cache and the feed request path never awaits live external probes; Mission Control paints each data slice as it lands instead of gating on the slowest of 9 fetches; `/api/signals` collapsed from ~7 sequential query waves to 2 (p50 ~0.25s); recharts (344KB) moved behind `next/dynamic` on `/spend`, `/spend/code`, `/analytics`.
- **Guard hot path.** `POST /api/guard` executes ≤4 DB round-trips cold / ≤2 warm (was ~9): org policies + predictive-risk settings sit in 30s module caches (invalidated by every policy mutation path), the learning context is ONE batched scalar-subquery statement, and predictive risk (including its statistical adjustment) is skipped entirely when `PREDICTIVE_RISK_ENABLED` is off. Guard p50 0.291s → 0.110s. Decision semantics pinned by characterization tests committed before the refactor.
- **Hook fail-closed latency.** An unreachable instance now fails closed in ≤3s instead of ~8s: guard retries default 3 attempts → 1 (`DASHCLAW_GUARD_RETRIES`), failed health probes are negative-cached for 60s, and a 2s TCP preflight bounds the SYN-blackhole case only when the cached probe verdict is unreachable. Always exit 2 — never fail-open.
- **Code Sessions capture defaults ON, metadata-only.** `DASHCLAW_CODE_SESSIONS_ENABLED` now defaults on with prompt text, assistant text, thinking, tool inputs (except safe path fields) and tool results stripped before anything leaves the machine; `DASHCLAW_CODE_SESSIONS_ENABLED=0` opts out entirely and `DASHCLAW_CODE_SESSIONS_CONTENT=full` is the explicit full-text opt-in.
- The static plugin `hooks.json` invokes hooks through a new `hooks/run_hook.cjs` node shim that resolves `python3`-vs-`python` and runs the hook exactly once (a `python3 X || python X` one-liner would re-run the hook when a guard block exits 2) — fixes python3-only macOS/Linux.

### Fixed

- `getCostAggregation` summed lifetime token counts with `::integer`, overflowing at 2³¹ on real fleets ("integer out of range" 500 on the fleet spend lens) — now `::bigint` with `Number()` coercion.
- livingcode's doctor-checks emitter wrote a `../../db.js` specifier into the generated module after `app/lib/db` became TypeScript — emits extensionless now (was the last Turbopack blocker).
- `dashclaw_posttool.py` (`_extract_outcome`) crashed on every MCP connector tool call: MCP tools deliver `tool_response` as a bare list of content blocks, not a dict, so `.get()` threw a `TypeError`. Normalized both shapes before extraction; MCP tool outcomes and cost records now record correctly.

## [4.7.10] — 2026-06-09

### Changed

- **Repowise code-health structural sweep — 12 phases, behavior-preserving, no public surface change.** The 21 lowest-health files were decomposed structurally (dashboard Hotspot 5.47→6.69, Average 8.65→8.74, Worst 1.0→4.06): `middleware.js`'s 934-line CCN-287 `middleware()` is now a ~20-line sequencer over named auth/demo/page handlers with an ordered demo route table (auth/routing behavior pinned by 14 new characterization tests); `app/lib/guard.ts` 3.85→9.55 (CCN 122→8); both SDK clients refactored into private helpers behind **frozen public surfaces** (Node 126 / Python 224 methods, contracts + parity green); the Python hooks, tooling/CLI, repositories, app-lib, and scripts clusters all structural-cleared (max CCN ≤8, nesting ≤3 on every target). ~300 new characterization tests; full suite 3788 + pytest 299 green; migration SQL/DDL proven byte-identical by runtime capture.

## [4.7.9] — 2026-06-09

### Changed

- Platform-only production-readiness and launch-prep release (entry backfilled in 4.7.10): public proof paths, setup contracts, security posture docs, hosted/doctor diagnostics, accessibility, and smoke coverage tightened. No SDK source change — SDKs were not republished.

## [4.7.8] — 2026-06-08

### Fixed

- **Fresh installs no longer break on `settings` / `learning_episodes` / `daily_totals` upserts.** The three UNIQUE indexes backing those `ON CONFLICT` upserts were only created by the standalone `migrate-multi-tenant.mjs` / `migrate-learning-loop-mvp.mjs` scripts — not by the `drizzle/*.sql` set that `auto-migrate.mjs` runs on every Vercel deploy. A fresh deploy got the tables but not the indexes, so those upserts threw _"no unique or exclusion constraint matching the ON CONFLICT specification."_ Added `drizzle/0026_onconflict_unique_indexes.sql` (idempotent `CREATE UNIQUE INDEX IF NOT EXISTS`); it auto-applies on the next deploy and is a no-op on existing instances.

_SDK note: platform/migration release — no Node/Python SDK source change, so the SDKs are not republished; npm + PyPI stay at 4.7.2._

## [4.7.7] — 2026-06-08

### Fixed

- **The `x402` purchase list query is now bounded.** `listPurchases` gained an explicit `LIMIT 1000` on both the all-purchases and per-provider branches, matching the connections / agent-presence caps — guarding the last unbounded growing-table scan from the query-perf sweep.

### Changed

- **`check-doc-counts` now gates the MCP governance tool count across the peripheral docs** (`mcp-server/README.md`, the `/docs` page, `examples/`, `docs/monetization-plan.md`), not just the root README. The count drift fixed in 4.7.6 now fails the build instead of slipping through review.

_SDK note: platform/tooling release — no Node/Python SDK source change, so the SDKs are not republished; npm + PyPI stay at 4.7.2._

## [4.7.6] — 2026-06-08

### Fixed

- **MCP governance tool count corrected to 29 across the docs.** The MCP server exposes 29 governance tools (variously mis-documented as 26 or 28). Reconciled `mcp-server/README.md`, the `/docs` page, the `examples/`, and `docs/monetization-plan.md`, and added the three tools that were missing from the README + `/docs` tool catalogs: `dashclaw_assumption_record`, `dashclaw_posture`, and `dashclaw_posture_next`.

_SDK note: docs-accuracy release — no Node/Python SDK source change, so the SDKs are not republished; npm + PyPI stay at 4.7.2._

## [4.7.5] — 2026-06-08

### Fixed

- **Silent fetch failures across 14 pages and components now surface.** Data-loading errors that previously left a view blank or showing stale numbers now render an explicit error state with a retry, and a stale-data path in the learning code-signals view was corrected. A lint-level guard now blocks new empty `catch` blocks in the app tree.
- **Evaluation stats now honor the `agent_id` and `scorer_name` filters.** `GET /api/evaluations/stats?agent_id=…` / `?scorer_name=…` previously ignored both parameters and returned org-wide aggregates; they now filter every aggregate (by-scorer, trends, distribution, overall).
- **Time-range filters compare as timestamps, not strings.** Activity (`?before`/`?after`) and evaluation-score date filters now cast `created_at` to `timestamptz` for correct temporal comparison and day-bucketing regardless of stored format; a malformed `before`/`after` value now returns `400` instead of surfacing a database error as `500`.
- **Aggregate stats are returned as numbers.** `listActions` `avg_risk`/`total_cost` and the swarm-graph node metrics are now coerced from Postgres' string-typed aggregates to numbers — fixing inflated swarm node sizes caused by string concatenation in the sizing math.

### Changed

- **Signal and learning writes are batched.** The per-signal snapshot upsert and the two learning-loop insert loops now issue one chunked multi-row `INSERT` per batch instead of one round-trip per row, and three unbounded list/aggregate `SELECT`s were given explicit `LIMIT`/candidate-set bounds — cutting database round-trips on the cron signal pass and the learning rebuild.

_SDK note: platform hardening release — no Node/Python SDK source change, so the SDKs are not republished; npm + PyPI stay at 4.7.2._

## [4.7.4] — 2026-06-08

### Added

- **Route test coverage for five previously-untested endpoints** — `GET /api/actions/[actionId]/artifacts`, `.../trace`, `GET|PATCH /api/actions/loops/[loopId]`, `GET /api/actions/stats`, and `GET /api/activity` now have unit tests (27 cases) covering success, error, and filter paths.
- **A PERCENTILE_CONT regression guard** for the operations-summary latency card, so the p50/p95 query can't silently revert to the old `AVG`/`MAX` mislabel.

### Fixed

- **The eval test suite no longer flakes under the full run.** `app/lib/llm.ts`'s module-level provider cache leaked across vitest worker files — a provider key set in one test left `isLLMAvailable()` true for later files, intermittently breaking the eval scorer suite (~1 in 3 full runs). The cache now resets between tests; the full suite is 10/10 green.

### Changed

- **The OpenAPI spec version is no longer hardcoded.** `scripts/generate-openapi.mjs` reads `info.version` from `package.json`, so the spec tracks the unified platform version (was frozen at `2.0.0`). Advanced the `PROJECT_DETAILS.md` freshness stamp.

_SDK note: platform/test/tooling release — no Node/Python SDK source change, so the SDKs are not republished; npm + PyPI stay at 4.7.2._

## [4.7.3] — 2026-06-08

### Fixed

- **The site-wide right-click "Copy" copied the page URL instead of the text under the cursor**, making it a duplicate of "Copy page link". The fallback context-menu "Copy" now copies the highlighted selection if there is one, otherwise the visible text of the element you right-clicked, and only falls back to the page link when there's genuinely no text. (`app/components/context-menu/actionRegistry.tsx`)
- **A right-click on an SVG icon or raw text node resolved to `<body>`**, so "Copy" would have grabbed the entire page's text. `pageTarget` now climbs to the nearest `HTMLElement` — the element actually under the cursor. (`app/components/context-menu/ContextMenuProvider.tsx`)

_SDK note: platform-only release — no Node/Python SDK source change, so the SDKs are not republished; npm + PyPI stay at 4.7.2._

## [4.7.2] — 2026-06-08

### Fixed

- **Spend Overview / Your Claude Code / Analytics no longer get stuck on stale data.** A failed period/range fetch was swallowed (`if (res.ok) setData(...)` with an empty catch), so the page kept the previous period's numbers under the new period label and the initial load could dead-end on "Failed to load." These pages now reset on switch, retry once (absorbing a Neon cold-start), and surface an explicit error with a Retry instead of showing stale or misattributed figures.
- **Mission Control "Latency p95" was the slowest single request, not the 95th percentile.** `operations/summary` computed `AVG(duration_ms)` as "p50" and `MAX(duration_ms)` as "p95"; it now uses real `PERCENTILE_CONT` (e.g. a 393s outlier-driven "p95" is now a true ~47s p95).
- **Capability counts were inconsistent across Mission Control.** Runtime showed "6/6" while Capability Health showed "6/14" because never-invoked (`unknown`) capabilities fell through the summary buckets. Counts now partition every row with a distinct **untested** bucket, and Runtime/PostureScorecard treat untested as neutral (matching the canonical `deriveStatus` and the Capabilities page).
- **The Approval Backlog tile silently read 0.** `AVG(timestamp_start::timestamptz)` has no Postgres implementation, so the query threw at plan time and the `safe()` wrapper zeroed the whole card. It now averages elapsed time correctly.
- **Drift "Recent baselines" and "Alerts by metric" ignored the selected agent** — only the overall summary was agent-scoped; both now honor the agent filter.
- **Drift / Evaluations / Learning Analytics no longer show a previous filter's results when a filtered refetch fails** — the stale slice is cleared and a non-blocking error/Retry banner is shown; the Sessions poll marks data stale on failure.
- **The urgent-message marker never rendered** on the dashboard Recent Messages card (`msg.urgent === 1` tested a Postgres boolean against `1`); it now uses a truthy check.

### Changed

- **Signal dismissals are now per-instance and honored by the live feed.** The dismissal key includes the signal's `detected_at`, so dismissing an agent's heartbeat alert no longer suppresses every future silence; and the Mission Control live ledger hides the same dismissed instances, so posture ("All clear") and the feed can no longer contradict each other. (One-time effect: previously dismissed, still-active signals reappear once, then behave correctly.)

## [4.7.1] — 2026-06-08

### Fixed

- **The right-click context menu now covers the entire site, not just tagged entity rows.** Previously the menu was augment-only — it appeared over `[data-entity-type]` items and let the native browser menu surface everywhere else (blank space, panels, the governance-categories list, headings, untagged text). Now a generic **fallback menu** (Copy / Copy page link / Reload) opens on right-click anywhere on the app surface, so every part of the site is right-clickable with at least a Copy. Over a tagged entity you still get its full governance actions. The one exception is a text-entry field (input / textarea / contenteditable), which keeps the native menu because browsers block programmatic Paste and a custom menu cannot replicate it there.

## [4.7.0] — 2026-06-08

Sitewide interactions v2 — the v4.6.0 context-menu + multi-select systems now cover **every** entity-bearing surface, every on-page reference is clickable, approvals are actionable from the notification bell, the demo site has no empty pages, and the Policy Coach behavior recorder is reliable.

### Added

- **Clickable references everywhere + a reusable `EntityLink` primitive.** A new `EntityLink` deep-links any entity to its destination (decision/agent/session/capability/workflow/knowledge detail routes, `codeSession`/`modelStrategy`, and `policy` → `/policies?policy=<id>` highlight), rendering a real `<Link>` when a destination exists and a still-right-clickable tagged `<span>` otherwise. Inline non-clickable renders were converted across `/decisions`, `/approvals`, `/approve`, and the Mission Control capability-health card. The top `SystemStatusBar` ticker's **Critical / Elevated** counts are now links to `/security?severity=red|amber`, and `/security` honors the `?severity` filter (with a canonical severity→route map). `/policies` accepts `?policy=<id|name>` and scrolls/highlights the matching shield (auto-revealing it if it's off).
- **Context menu on every entity-bearing surface.** `data-entity-type/id/status` tags extended from the v4.6.0 set to the remaining gap pages and inline rows — activity, code-sessions, evaluations (scores + scorers), integrations, learning (lessons + recommendations), model-strategies, prompts, team, identities, security signals, the Policies cockpit (`ShieldList`/`RecentDigest`), and the agent-detail policies section. Tagged surfaces went from ~20 to ~34. Three new governance action sets back real per-item routes: **model-strategy delete, prompt-template delete, team-member remove**.
- **Multi-select + bulk on every list page.** The shared `useSelection`/`SelectCheckbox`/`BulkActionBar` system was wired into six more lists — prompts, team, identities (mutating: delete / remove / revoke via the existing per-item routes), and audit-log, assumptions, evaluations (read-only **Copy IDs**, never a fabricated destructive route for an immutable log).
- **Approve / deny from the notification bell.** `NotificationCenter` now surfaces live pending approvals (`GET /api/actions?status=pending_approval`) with inline **Approve / Deny** that reuse `POST /api/approvals/{id}` (same server-enforced admin + org gate as the approvals page — the client gate only hides the buttons), optimistic removal, a combined unread+pending badge that refreshes on `action.updated`, and a "View all → /approvals" link. Existing ephemeral SSE notifications are preserved.
- **Demo data for every page.** Thirteen previously-empty demo endpoints now return deterministic, read-only fixtures (sessions, identities, knowledge collections, API keys, secrets, model strategies, the reputation leaderboard, posture + findings, FinOps spend, and the behavior recorder / samples / suggestions) so the demo site no longer renders blank pages. Policy Coach in demo mode showcases sample records + suggestions.
- **Policy Coach is browseable + observable.** A live "Recent samples" panel (redacted tool / action / command-shape / paths / risk / guard-decision / outcome / age) backed by `GET /api/behavior/samples?list=N`, a live status strip (last-sample age, captured-this-session, auto-stop window), and an empty state that distinguishes "recorder off" from "on, nothing captured yet."

### Fixed

- **Behavior recorder reliability — the chronic Policy Coach `SAMPLES=0`.** Root cause: samples were only appended at `PostToolUse`, which misses ~96% of the time (and never on early stop). The recorder now **persists a `running` record at `PreToolUse`** and a new Stop/SessionEnd flush appends any orphaned pending sample as `interrupted`; `readSamples` **merges by `event_id`** (finalized/interrupted supersedes running) so counts and analysis stay correct even when `PostToolUse` never fires. Samples remain local-only and redacted.

### Security

- Adversarial security review of the full diff: 0 Critical / 0 High / 0 Medium. The `?list=` samples endpoint is auth-gated, bounded `[1,200]`, and redacted on read; bell approve/deny is server-enforced admin + org-scoped; demo handlers are pure read-only literals below the demo write-block; bulk fan-out adds no new IDOR (every per-item route stays org-scoped). Two pre-existing Lows (shared-tempdir recorder sweep; instance-global local-only samples endpoint) were recorded, not introduced by this release.

## [4.6.0] — 2026-06-07

### Added

- **Site-wide right-click governance context menu.** Right-clicking any DashClaw item — a decision, agent, capability, session, secret, webhook, API key, posture finding, knowledge collection, assumption, loop, policy, or message — opens a token-styled menu with the governance actions for that entity (Approve/Deny, Validate/Invalidate, Resolve/Cancel, Delete/Revoke, Snooze/Accept-risk, Mark-rotated, View, Run guard…) plus generic Copy ID / Copy link / Open. It is **augment-only**: the menu appears only over a recognized `[data-entity-type]` item; right-clicking blank space, text, or an input keeps the native browser menu, so copy/paste/inspect are never hijacked. Fully keyboard-operable (Arrow/Enter/Escape, focus returns to the trigger), rendered in a viewport-collision-aware portal. One provider mounted in `SessionWrapper`; rows across ~16 surfaces carry `data-entity-type/id/status`.
- **Site-wide multi-select + bulk actions.** A shared `useSelection` system (Set-based, shift-click range, `Ctrl/Cmd+A` select-all with an input guard) wired into 10 high-value list pages — decisions, sessions, approvals, agents, capabilities, secrets, api-keys, webhooks, posture, knowledge — with a `BulkActionBar` in the page header and confirm-gated destructive actions. Bulk operations fan out over the **existing per-item governed routes** via `Promise.all` (no new routes, no new direct SQL, no new authorization surface — each call is still admin/org-scoped server-side). The two prior ad-hoc selects (`/decisions`, `/workflows`) were unified onto the shared hook.

### Changed

- **Mission Control redesign — "Split Posture / Live Ledger."** The low-value, clunky, slow operations-feed band is gone. Mission Control is now a two-column instrument panel: a sticky **Posture Scorecard** (six governance-category status rows that double as ledger filters, runtime vitals, fleet, spend) and a **Live Governance Ledger** — a multi-select **Intervention Queue** (inline + bulk approve/deny) over a 40-row-capped, SSE-live event stream. Performance: the three independent 30s polls (page + feed + runtime) collapse into **one coordinated `Promise.allSettled`**, the SSE-triggered refetch is **debounced (~750 ms)** instead of a 7-fetch-per-event storm, the poll is paused on a hidden tab, and the in-memory feed is capped. All six feed categories (approvals, 24h failures, risk signals, capability health, integration health, stale loops) are preserved. The layout was selected by a four-candidate, judge-scored design tournament.

### Security

- Removed an inert `x-org-role: admin` header from the workflows bulk-delete fan-out. It was never honored (middleware strips client-supplied role headers and re-injects the authenticated principal), so this is a clarity fix, not a bypass — the bulk path enforces the same server-side admin gate as the single-item path.

SDKs republish at 4.6.0 per the unified-version model (no SDK surface change — Node 126 / Python 224, byte-identical to 4.5.x).

## [4.5.1] — 2026-06-07

### Fixed

- **Applying a policy mode is now idempotent — re-applying a mode actually turns it back on.** `POST /api/policies/modes/import` previously deduped by name and *skipped* any policy that already existed, without reactivating it. So an org whose mode policies had been toggled off (e.g. all of Claude Code Mode's policies sitting at `active=0`) could click **Apply Claude Code Mode** and get a silent no-op: HTTP 201 "success", but nothing turned on, so the `/policies` cockpit stayed on its empty state ("No governance active"). Existing-by-name mode policies are now **reactivated and refreshed** to the mode's current compiled definition instead of skipped; the response reports both `imported` (new) and `reactivated` (pre-existing) counts. The mode-apply drawer no longer reports a silent success — if nothing was created or reactivated and the server returned errors, it surfaces them.
- **`/policies` empty state redesigned.** The bare centered-text "No governance active" message is now a calm, on-brand empty-state card (shield icon, "No mode applied" headline, a one-line explanation, and a real primary CTA) per `.impeccable.md`.

SDKs republish at 4.5.1 per the unified-version model (no SDK surface change — Node 126 / Python 224, byte-identical to 4.5.0).

## [4.5.0] — 2026-06-07

### Added

- **Instant Hosted Trial.** On a hosted instance (`DASHCLAW_HOSTED=true`), a visitor clicks **"Govern your Claude — free"** on the landing page, signs in with Google, and is auto-provisioned an isolated, usage-capped governed trial workspace in seconds — no key to copy. They connect Claude through a keyless OAuth connector on a stripped **`/connect?hosted=`** "Add to Claude" screen, and their actions stream to their own Mission Control. New **`GET /api/hosted/capacity`** public endpoint (300 routes total: 51 stable / 24 beta / 225 experimental) powers a landing pre-check. New **`HOSTED_MAX_ACTIVE_TRIALS`** global concurrent-trial cap (default 500) is a fail-closed cost circuit breaker enforced on both the sign-in path and the anonymous provision route — at the cap, new sign-ins land on a "trials are full" state and provision nothing. The whole feature is **inert on self-host** (capacity 404s, the CTA is hidden, sign-in doesn't trial). Operator prod-flip documented in `docs/hosted-deployment-runbook.md`, with a minimal Vercel env checklist in `docs/instant-trial-vercel-setup.md`.

### Changed

- The landing hero demotes the "Self host the runtime" CTA to secondary when in hosted mode, keeping exactly one primary action per mode.

### Security

- **Authenticated sessions bypass the cookie-driven demo.** A visitor who kicked the tires anonymously (got the `dashclaw_demo` cookie via `/demo`) and then signed in now gets their real trial runtime instead of demo fixtures. Fails closed — only a cryptographically-verified NextAuth or local-admin principal bypasses demo; an unauthenticated/forged cookie still gets demo, and the `DASHCLAW_MODE=demo` env path (forces demo for everyone) is unchanged.

SDKs republish at 4.5.0 per the unified-version model (no SDK surface change — Node 126 / Python 224, byte-identical to 4.4.6).

## [4.4.6] — 2026-06-07

### Deprecated

- The `dashclaw/legacy` Node SDK subpath (`sdk/legacy/dashclaw-v1.js`) is deprecated and will be **REMOVED in v5.0.0**. It still works for now; loading it (via either `import 'dashclaw/legacy'` or `require('dashclaw/legacy')`) emits a one-time runtime warning (opt out with `DASHCLAW_SUPPRESS_LEGACY_WARNING=1`). Migrate to the canonical `dashclaw` import. Pairing methods (`createPairing`, `createPairingFromPrivateJwk`, `waitForPairing`) currently live only on legacy and must be promoted to the canonical SDK before v5.0.0. Drifting legacy method counts in the docs were reconciled. The published `./legacy` export is unchanged — this release is non-breaking.

## [4.4.5] — 2026-06-07

### Fixed

- **`npm run dev` no longer 500s on every route.** `next dev` defaulted to Turbopack, which does not apply the webpack `.js`→`.ts` `extensionAlias`, so `middleware.js` could not resolve its `demoFixtures`/`demoMiddleware` imports and every request returned 500 — local testing was effectively broken. The dev script now runs `next dev --webpack -p 3000`, matching the production build toolchain; all 73 page routes verified rendering clean (0 console errors, 0 network failures). The production build was always `next build --webpack` and was unaffected.
- **`/capabilities/[capabilityId]` — two `react-hooks/exhaustive-deps` warnings cleared.** `CapabilityAccessTab` now memoizes its loader via `useCallback`; the detail page drops a dead default parameter (all call sites already pass it) and documents an intentional refresh-only-on-`capabilityId`-change effect. Behavior unchanged.
- **`recent-digest` unit test — fixed a `TS2532` possibly-undefined indexed access** under `noUncheckedIndexedAccess`, restoring a clean `npm run typecheck`.

SDKs republish at 4.4.5 per the unified-version model (no SDK surface change — Node 126 / Python 224, byte-identical to 4.4.4).

## [4.4.4] — 2026-06-06

### Changed

- **`/policies` — posture cockpit** — the page now opens read-first on what is governing the fleet right now, superseding the 4.4.3 front-door/console iteration (and its `Modes · Shields · Custom · Activity` lineage). It shows a status line (active mode, interruption level, agent count, pending approvals), a signal-only enforcement summary (`N warn · N require approval · N block · everything else allowed`, with the full compiled rules behind *View rules*), a flat shields list carrying live `fired N×` counts, and a recent-decisions digest. Applying or changing a mode moves into a focused right-drawer with an impact preview; the 50-agent "applies to" chip wall is gone — scope shows as one read-only line (on-demand scope *editing* is a fast-follow). Activity now links out to `/decisions`; custom rule authoring moves to `/policies/rules`. Reuses the existing modes engine, guard, shields, and `/api/policies`; 13 superseded components retired; no schema migration. SDKs republish at 4.4.4 per the unified-version model.

### Added

- **`GET /api/policies/summary`** — a read-only endpoint that synthesizes the cockpit's posture: current mode(s) (from `_mode` tags), enforcement rule buckets, the compiled rule list, shield states, 30-day decision outcomes, and per-policy `fired N×` counts (via a defensive `matched_policies` unnest that degrades to zero on error so the page always renders). Routes 298 → 299 (51 stable). No new SDK methods, MCP tools, or schema.

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

A batch of behavior-preserving bug fixes from an unattended cleanup run. No new routes, SDK methods, or contract changes; each fix ships a regression test and the full suite stays green. See `docs/archive/OVERNIGHT-CLEANUP-REPORT.md` for root-cause detail and the per-fix commits.

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
