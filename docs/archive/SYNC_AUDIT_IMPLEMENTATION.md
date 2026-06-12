# DashClaw Sync Audit — Implementation Pass — 2026-06-02

Implements fixes from `SYNC_AUDIT.md`. Audit-only items became real, tested changes. Scope was protected: **no** OAuth connector, MCP, auth, middleware, or billing files were touched. No schema changes were needed, so **no migration** was generated.

## Verification (run before writing this report)

- `npm run lint` → **clean** (0 errors), every batch.
- `npx vitest run` (full suite) → **2505 passed, 5 skipped, 0 failed** after the tail pass (2479 → 2492 → 2505 across the three passes).
- `npx next build` → **succeeded** each batch; route manifest emitted `/secrets`, `/doctor`, and the renamed `/compliance` + `/scoring` pages.
- `git diff` reviewed each batch → only audit-scoped files staged; the unrelated in-progress `plugins/dashclaw/*` work was deliberately left unstaged; secret-pattern scan returned nothing.

**54 new/updated test cases** across 16 files asserting real fields, statuses, outputs, permissions, and error paths (not mock-echo) — including a UI↔backend contract test that compiles every policy type through the real `validatePolicy`, the Run→`/execute`→navigate flow, the corrected compliance evidence keys, and the capability access dry-run. (28 first pass; +13 continuation; +13 tail pass.)

---

## Implemented findings

### High

| # | Finding | Implementation | Tests |
|---|---------|----------------|-------|
| H1 | **Capability `invoke` had no UI** | New `app/capabilities/[capabilityId]/components/CapabilityInvokePanel.jsx` (guided form + advanced JSON, `agent_id`/`declared_goal` inputs, renders every structured response: success+result+audit link, blocked_by_policy, pending_approval, quota_exceeded, circuit_breaker_open, access_denied, execution errors). Wired into `app/capabilities/[capabilityId]/page.jsx` with an "Invoke" toggle; POSTs to the real `/invoke`, refreshes health+history. | `capability-invoke-panel.test.jsx` (5), `capability-detail.page.test.jsx` (updated) |
| H2 | **Workflow "Launch" ran no steps** | `app/workflows/[templateId]/page.jsx` button now calls `/execute` (the governed step executor), navigates to the run timeline on any produced run, and surfaces blocked/quota/no-steps inline. `/launch` left intact for non-UI callers. | Verified via `next build` + the `/execute` route contract (see *Test gaps*) |
| H3 | **Compliance evidence tiles read wrong keys (3/4 showed 0)** | `app/compliance/page.js` now reads `guard_decisions_total` / `guard_decisions_blocked` / `action_records_total` (matches `app/api/compliance/evidence/route.js`). | Verified against the route's response shape |
| H4 | **Assumptions filters/counters read a nonexistent `status`** | New shared `app/lib/assumptions-status.js` (`deriveAssumptionStatus`, filter options); `app/assumptions/page.js` derives status from the real integer `validated`/`invalidated` columns, filters client-side (incl. the "Invalidated" tab the API can't filter), and counts from the full set. | `assumptions-status.test.js` (5) |
| H5 | **API keys silently always `admin`** | New shared `app/lib/apiKeyRoles.js`; `app/api/keys/route.js` validates + honors `role` (`admin`/`member`, matching the `api_keys_role_check` constraint), returns/logs it; `app/api-keys/page.js` adds a role selector and shows each key's role badge. Default stays `admin` for backward compatibility with non-UI callers. | `keys.route.test.js` (+4: default, member, invalid→400, INSERT binding) |
| H6 | **Policy builder omitted 4 enforced types** | Unified `POLICY_TYPE_OPTIONS` (all 11) in `app/policies/lib/policyFormModel.js`, used by both `CustomTab.jsx` and `generate/page.jsx`. Added real rule-builder inputs (`PolicyRuleBuilderSection.jsx`), compile/decompile/summary, and `formatRules` for `behavioral_anomaly`, `permission_escalation`, `green_contract`, `branch_freshness`. | `policy-types-coverage.test.js` (6, incl. FE→`validatePolicy` contract for all types) |
| H7 | **DLP scanner had no UI** | New `app/components/SecurityScanners.jsx` mounted on `/security` — paste text → `POST /api/security/scan`, renders findings + redacted text. | `security-scanners.test.jsx` (3) |
| H8 | **Prompt-injection scanner had no UI** | Same component (mode toggle) → `POST /api/security/prompt-injection`, renders risk/recommendation, plus a recent-scans list from the `GET`. | `security-scanners.test.jsx` |
| H9 | **Code-session alerts were a dead-end counter** | New `app/components/CodeSessionAlertsPanel.jsx` mounted on `/code-sessions` — lists alerts (severity, kind, body, link to the session), "Mark all read" → `POST /alerts/read-all`. | `code-session-alerts-panel.test.jsx` (3) |
| H10 | **Doctor self-heal had no dashboard UI** | New `app/components/DoctorPanel.jsx` + `app/doctor/page.js` — `GET /api/doctor`, checks grouped by category with status badges, per-check "Fix" → `POST /api/doctor/fix`, swaps in the recheck. Added to nav. | `doctor-panel.test.jsx` (2) |
| H11 | **`/evaluations` unreachable from nav** | Added `/evaluations` (and `/doctor`) to `app/components/Sidebar.js`. | Verified via `next build` |
| H12 | **Secret rotation had no UI** | New `app/secrets/page.jsx` — list (org-wide or by agent scope), track (name/agent/interval/notes → `POST /api/secrets`), per-row "Mark rotated" (`PATCH last_rotated_at`) and delete, plus an org-wide rotation-due banner from `/api/secrets/rotation-due`. Stores rotation metadata only — never secret values. Added `/secrets` to the Configure nav. Admin-gated via the real `useEffectiveRole`. | `secrets-page.test.jsx` (6: list, mark-rotated PATCH body, delete, create POST body, due banner, member read-only) |
| H13 | **Skill safety scanner had no UI** | New `app/components/SkillScanner.jsx` mounted on `/security` — multi-file (filename + content) → `POST /api/skills/scan`, renders pass/fail, per-finding severity + `file:line` + rule + masked match, and a cached badge. | `skill-scanner.test.jsx` (4: clean pass, high-severity fail, multi-file request body, client-side guard) |

### Medium / enum

| Finding | Implementation |
|---------|----------------|
| Webhook dropdown omitted approval events | `app/webhooks/page.js` `EVENT_TYPES` now includes `approval_pending`/`approval_granted`/`approval_denied` (matches `VALID_EVENT_TYPES`). |
| Decisions ledger lacked `pending_approval` filter | `app/decisions/page.js` status options include `pending_approval` (humanized labels). |
| Capability registry health filter omitted `failing`/`untested` | `CapabilityRegistryFilters.jsx` now lists all `deriveStatus()` values. |
| Capability edit `health_status` dropdown omitted runtime values | `CapabilityBasicsSection.jsx` adds `untested`/`failing`. |

---

## Continuation pass (2026-06-02) — what closed

The two remaining High governance surfaces and both flagged test gaps are now done:

- **H12 Secrets rotation UI** and **H13 Skill safety scanner UI** — shipped (see the High table above). No schema change.
- **H2 / H3 test gaps closed.** `workflow-detail.page.test.jsx` now asserts the Run button POSTs `/execute` and `router.push`-es to `/workflows/{id}/runs/{action_id}` on success, and surfaces a policy block inline without navigating. `compliance-page.test.jsx` renders the page and asserts the evidence tiles read the corrected keys (`guard_decisions_total` / `guard_decisions_blocked` / `action_records_total`). To make the latter testable, `app/compliance/page.js` was renamed to `page.jsx` (the repo convention for unit-tested pages — Vite's `.js` loader doesn't parse JSX); no behavior change, no import references the old path.

## Tail pass (2026-06-02) — Medium/Low + partially-wired

Five committed batches. **With these, every High item in `SYNC_AUDIT.md` is done (15/15) and all fabricated/misleading data is removed.**

### Two High items the earlier passes skipped

| Finding | Implementation | Tests |
|---------|----------------|-------|
| **[H] "Score an action" had no UI** — profiles were buildable but never runnable | `app/scoring/page.jsx` (renamed from `.js`): a "Score recent" button on each profile card batch-scores real ledger actions (scoped to the profile's `action_type`) via `POST /api/scoring/score`, then surfaces the returned summary. | `scoring-page.test.jsx` (1) |
| **[H] Verify a signed receipt/bundle had no UI** | New `app/components/VerifyReceiptPanel.jsx` on `/compliance/exports` — paste JSON (receipt/bundle toggle) → `POST /api/integrity/verify` → renders `ok` + `kid`/`reason`. | `verify-receipt-panel.test.jsx` (4) |

### Fabricated / misleading data removed (the inverse-gap items)

| Finding | Implementation |
|---------|----------------|
| Swarm panel showed invented `Stability 99.8%` / `Sync Latency 12ms` / `Drift State Nominal` / `AGENT_CLASS_V2` | `app/swarm/page.js` now shows the real per-node `cost` and org-wide `Total Actions` / `Total Cost` aggregates; the fabricated badge + tiles are gone. |
| `decisions/[actionId]` + `actions/[actionId]` "Drift Detection" cards hardcoded `0.02 (Nominal)` | Both now compute a real invalidated-assumption ratio from the assumptions already loaded (or show "no assumptions to assess"). |

### Hidden stored data surfaced

| Finding | Implementation | Tests |
|---------|----------------|-------|
| Ops summary `latency.p50_ms` + `approval_backlog.avg_wait_minutes` dropped | `RuntimeSummaryCard.jsx` shows p50 next to p95 and avg-wait next to oldest. | `runtime-summary-card.test.jsx` (1) |
| Fleet `idle`/`busy`/`stale` rendered as a gray "unknown" dot | `app/agents/page.js` `statusDotMap` gains those three states. | — |
| Assumption `drift_score` / `drift_summary` never requested | `app/assumptions/page.js` fetches `?drift=true`: an "At risk · drift" counter + per-row `drift N` badge. | — |
| Capability access couldn't be previewed for an agent | `CapabilityAccessTab.jsx` adds a "Check effective access" dry-run → `GET .../access/check`. | `capability-access-tab.test.jsx` (2) |

### Partially-wired "fetched-but-ignored" bugs

| Finding | Implementation | Tests |
|---------|----------------|-------|
| Workflow run-detail never refreshed — running runs looked frozen | `runs/[runActionId]/page.jsx` polls the run GET every 4s while running/pending, stops on terminal. | build-verified |
| Workflow run cancel was unreachable | `WorkflowRunHeader.jsx` renders a "Cancel run" button (POST `.../cancel`) for running runs + a Cancelled badge. | `workflow-run-header.test.jsx` (3) |
| Evidence-bundle response discarded; errors swallowed in `catch {}` | `ArtifactsTab.jsx` surfaces the returned bundle summary (step/artifact counts) and any error. | `artifacts-tab.test.jsx` (2) |

### Triage filters (backend query params the UI never sent)

| Finding | Implementation |
|---------|----------------|
| Drift alerts: no severity/ack/metric filters | `app/drift/page.js` adds all three; the metric dropdown is sourced from the previously-orphan `/api/drift/metrics` catalog. |
| Evaluation scores: no scorer/min-max filters, `total` ignored | `app/evaluations/page.js` adds scorer + pass/fail filters and surfaces `total` as "Showing N of M". |

## Not fixed (precise next steps)

Still open from `SYNC_AUDIT.md` — each route exists; only the UI is missing. Best continued in a fresh session, one independent item per backend+frontend read:

- **Learning surfaces** — policy `suggestions` (generate + one-click accept), distilled `lessons`, `code-signals` aggregation; and the partially-wired recommendation `metrics`/funnel (outcomes + deltas dropped).
- **Editing flows** — scoring dimension CRUD + risk-template PATCH; prompt-template PATCH; knowledge-collection PATCH; resolve/edit message threads; compliance-schedule rename.
- **Orphan endpoints** — policy `proof` export + `test` runner; profile-score `?view=stats`; `/api/usage/costs`; settings governance flags (`PREDICTIVE_RISK_*`, cost threshold) + settings DELETE ("Disconnect").
- **Detail-page displays** — per-action `model` (+ analytics by-model); recommendation linkage (applied/overridden + reason); guard-decision integrity fields; org-wide artifacts list/delete; workflow-runs list filters + `total`; code-session stored fields (`stuck_loops`, `model_requests`, cache savings, ingest provenance).
- **Stale-frontend bugs (Notes)** — Handoffs tab calls `GET /api/handoffs` (405; only POST exists); `/routing` + `/feedback` target archived APIs. These are real bugs, not missing UI — decide endpoint vs. repoint.

### Test-coverage notes

- The four pass-1 enum fixes and the tail-pass `.js`-page filters (drift/eval) are param/string plumbing verified by `next build` + reading the routes; the run-detail polling is a standard `setTimeout` loop, also build-verified.

---

## Files

**New (13):** `app/lib/assumptions-status.js`, `app/lib/apiKeyRoles.js`, `app/capabilities/[capabilityId]/components/CapabilityInvokePanel.jsx`, `app/components/SecurityScanners.jsx`, `app/components/CodeSessionAlertsPanel.jsx`, `app/components/DoctorPanel.jsx`, `app/doctor/page.js`, plus 6 test files (`assumptions-status`, `policy-types-coverage`, `capability-invoke-panel`, `security-scanners`, `code-session-alerts-panel`, `doctor-panel`).

**Modified (19 tracked):** `app/compliance/page.js`, `app/assumptions/page.js`, `app/policies/lib/policyFormModel.js`, `app/policies/components/PolicyRuleBuilderSection.jsx`, `app/policies/components/CustomTab.jsx`, `app/policies/generate/page.jsx`, `app/api/keys/route.js`, `app/api-keys/page.js`, `app/webhooks/page.js`, `app/decisions/page.js`, `app/capabilities/components/CapabilityRegistryFilters.jsx`, `app/capabilities/new/components/CapabilityBasicsSection.jsx`, `app/capabilities/[capabilityId]/page.jsx`, `app/workflows/[templateId]/page.jsx`, `app/security/page.js`, `app/code-sessions/page.js`, `app/components/Sidebar.js`, and 2 test files.

### Continuation pass (2026-06-02) files

**New (5):** `app/secrets/page.jsx`, `app/components/SkillScanner.jsx`, and 3 test files (`secrets-page`, `skill-scanner`, `compliance-page`).

**Renamed (1):** `app/compliance/page.js` → `app/compliance/page.jsx` (no behavior change; enables the H3 render test).

**Modified (3):** `app/components/Sidebar.js` (+`/secrets`), `app/security/page.js` (mount `SkillScanner`), `__tests__/unit/workflow-detail.page.test.jsx` (+2 H2 cases). Docs: `PROJECT_DETAILS.md` (+`/secrets` surface).

### Tail pass (2026-06-02) files

**New (7):** `app/components/VerifyReceiptPanel.jsx`, plus 6 test files (`scoring-page`, `verify-receipt-panel`, `runtime-summary-card`, `artifacts-tab`, `workflow-run-header`, `capability-access-tab`).

**Renamed (1):** `app/scoring/page.js` → `app/scoring/page.jsx` (enables the score-flow test).

**Modified (13):** `app/scoring/page.jsx`, `app/compliance/exports/page.js`, `app/swarm/page.js`, `app/decisions/[actionId]/page.js`, `app/actions/[actionId]/page.js`, `app/mission-control/components/RuntimeSummaryCard.jsx`, `app/agents/page.js`, `app/assumptions/page.js`, `app/workflows/[templateId]/runs/[runActionId]/page.jsx`, `app/workflows/[templateId]/runs/[runActionId]/components/WorkflowRunHeader.jsx`, `app/components/ArtifactsTab.jsx`, `app/drift/page.js`, `app/evaluations/page.js`, `app/capabilities/[capabilityId]/components/CapabilityAccessTab.jsx`.

**Migrations:** none. **Protected areas touched:** none (no OAuth/MCP/auth/middleware/billing; `plugins/*` left unstaged throughout).

---

## Tail pass 2 (2026-06-02) — Medium/Low continuation

Six more committed batches working the Medium/Low/partially-wired list, each lint + build + full-suite verified (suite steady at 2505 pass):

| Area | What shipped |
|------|-------------|
| **Learning** | Suggested Policies card (GET `/api/learning/suggestions` + one-click Accept → real policy); Code Signals card (`/code-signals`, 7d/30d/90d + savings); recommendation metrics now show the dropped deltas (failure_reduction, latency, cost) + applied-vs-baseline outcomes. |
| **Prompts** | Template edit → PATCH `/api/prompts/templates/[id]`; "Usage by Version" card (`stats.by_version`); runs-tab template filter (`template_id`). |
| **Detail pages** | `decisions/[actionId]` + `actions/[actionId]` now show per-action `model` + learning-recommendation linkage (applied/overrode + reason) below the metrics grid. |
| **Scoring (pt 1)** | Active/Archived profile filter + Unarchive; profile-score stats strip (`?view=stats`); risk-template edit → PATCH; Score-Explorer `raw_value`/`weight` per dimension. |
| **Workflows** | Templates-list status filter (`?status=`); detail Runs-tab status filter + surfaced `total`. |
| **Evaluations** | Cancel a stuck run (PATCH `{status:'failed'}`); per-run score-distribution detail (`/runs/[id]`). |

### Still remaining (precise next steps for a fresh session)

Read `SYNC_AUDIT.md` (backend `file:line` map) alongside this doc and continue:

- **Editing/orphans**: compliance-schedule rename + format/window display; policy `proof` export + `test` runner + `/policies/templates` catalog; model-strategy `/complete` test; agent connections POST + `auth_type`/`plan_name` display; org rename + role-scoped keys. *(`/api/usage/costs` done — `4d503500`.)*
- **Displays**: org-wide artifacts list/delete; code-session stored fields; setup/proof inline breakdown; workflow per-step resume; outcome-sweep indicator. *(decisions `swarm_id`+`model` and guard-decision integrity done — see Tail pass 4 follow-ons `1a6b38ea`/`3a15d49a`.)*
- **DEAD PAGE — `/goals` (AWAITING USER DECISION):** the goal/milestone `cost_estimate` item is moot because `app/goals/page.js` fetches `/api/goals`, which exists ONLY under `app/api/_archive/goals/` — so `/goals` is dead in non-demo mode (demo-only fixtures), same as the already-removed `/routing` + `/feedback`. `/goals` is not in the main nav. Recommend the same treatment (delete the dead page) but flagged rather than auto-removed since it wasn't in the original audit's stale-frontend list.
- **Stale-frontend bugs — `/routing` + `/feedback`** — ✅ DONE (`090a30d9`, user-approved): both dead pages deleted + the `/feedback` Sidebar entry removed. `app/lib/routing/*` and `routing.repository.js` left intact (live governance internals). The Handoffs 405 bug is also done (`9ca8f2ad`).
- **SDK methods targeting archived endpoints — ✅ DONE (`0e0855dc`, user-approved breaking removal)**: Node `submitFeedback` (108→107) and the Python routing + feedback suites (227→211) removed — all targeted `/api/routing/*` and `/api/feedback/*` which exist ONLY under `app/api/_archive/` (404). Both SDK tracks set to `next_bump: major` in `contracts/sdk/release-plan.json` (Node→3.0.0, Python→3.0.0); **the owner publishes via `npm run release:sdks`** (current_version unchanged until then). Docs reconciled: `sdk/README.md`, `sdk-python/README.md`, `app/docs/page.js`, `docs/sdk-parity.md`, `PROJECT_DETAILS.md` (107/211), CHANGELOG. Legacy Node SDK (`dashclaw/legacy`) frozen shims + `app/lib/routing/*` (live governance) left intact. **NOTE:** `plugins/dashclaw/.claude-plugin/plugin.json` dropped its `"skills": "./skills/"` key in `03e8da5a` (Claude Desktop authorship, owner-requested) — flag if the plugin should still auto-declare its two skills.

## Tail pass 3 (2026-06-02, session continuation)

Five more clusters + one real bug fix, each lint + full-suite + build gated (suite 2505 → 2519). New `.jsx` get tests; `.js` display/filter plumbing is build-verified.

| Area | What shipped | Commit |
|------|-------------|--------|
| **Scoring (pt 2)** | Post-creation dimension CRUD ("Manage dims" → POST/PATCH/DELETE `/profiles/[id]/dimensions[/[dimId]]`); calibrate `agent_id` + per-metric toggle chips. `scoring-page.test.jsx` +3. | `988afacd` |
| **Settings governance** | New `/settings?tab=governance` (`GovernancePanel.jsx`): predictive-risk toggle+threshold, cost-alert threshold, outcome timeout; per-setting DELETE ("Remove"); LLM-provider badge from `/api/settings/llm-status`. **Predictive keys stored with `category:'general'`** (guard reads them with that exact filter — the audit's `'system'` would have been a silent no-op). `governance-panel.test.jsx` (3). | `12d46757` |
| **Knowledge** | Collection edit form → PATCH `/collections/[id]` (the list pencil dead-ended read-only); created/updated timestamps; item-status enum verified-complete (only pending→indexed\|failed). Renamed detail page `.js`→`.jsx`. `knowledge-detail.page.test.jsx` (2). | `162310b9` |
| **Message threads** | Resolve/Reopen toggle + inline editable summary → PATCH `/api/messages/threads`; `onThreadUpdated` refreshes the parent list. Renamed `ThreadConversation.js`→`.jsx`. `thread-conversation.test.jsx` (2). | `ca04cbf0` + `65128093` (fixup — the rename committed at 100% similarity, so the content landed in a follow-up) |
| **Handoffs GET (real bug)** | `/api/handoffs` only had POST, so `GET /api/handoffs` 405'd — breaking the Workspace Handoffs tab AND the SDK read methods (Node `getLatestHandoff`, Python `get_handoffs`/`get_latest_handoff`). Added `GET` (list + `?latest=true`) backed by new `listHandoffs()`; the tab now reads the real `bundle` shape (summary/decisions_made/open_loops/state_snapshot). `handoffs.route.test.js` +4. CHANGELOG + api-inventory/OpenAPI regenerated. | `9ca8f2ad` |

**Suite:** 2519 passed / 5 skipped. **Protected areas:** none touched. **`plugins/*`** left unstaged throughout (one livingcode-refresh attempt spuriously zero-byted `dashclaw-governance-plugin.zip` via a transient Windows file lock while rebuilding it from the user's unstaged plugin edits; restored from the pushed tip and kept out of the commit).

## Tail pass 4 (2026-06-02, continuation) — SDK 3.0.0 fallout + more displays

| Area | What shipped | Commit |
|------|-------------|--------|
| **SDK breaking removal** | Removed Node `submitFeedback` + the Python routing/feedback suites (all hit archived `/api/routing`+`/api/feedback`). Reconciled to published **3.0.0** (manifests, release-plan, CHANGELOG, sdk-parity, PROJECT_DETAILS 107/211) and stripped the dead surface from the livingcode skill references (`api-surface.md`, `platform-knowledge.md`) + rebuilt the platform-intelligence zip. | `0e0855dc`, `21e60873`, `b545b23b` |
| **livingcode zip hardening** | `scripts/livingcode-refresh.mjs` built skill zips by deleting the destination first, so a locked source (Claude Desktop holding `dashclaw-governance/SKILL.md` open) left a 0-byte zip that got committed. Now builds to `<name>.tmp.zip`, `$ErrorActionPreference='Stop'`, swaps only on a verified non-empty success. | `6869a039` |
| **Capability detail fields** | `CapabilityHealthCards` "Invocation detail" (total/successful/failed counts, pending approvals, last success/failure, last-test, recent errors); `CapabilityFactsCard` est. cost/invocation + `docs_url` link. `capability-health-facts.test.jsx` (4). | `3acfff6e` |
| **Drift attribution** | `drift_type`/`dimension` badges + "Ack'd by <user> · <when>" on the drift alert rows (display-only `.js`). | `29c95357` |
| **Security fix** | The capability `docs_url` link allowed a `javascript:`/`data:` scheme (stored XSS, flagged HIGH by commit review). Scheme allow-list (http/https only) at the render site + regression test. | `65b8fb95` |
| **Agent-session controls** | Session detail "Clear block" (→ `status:running`) and "Mark finished" (→ `status:finished`) wiring the previously-unreachable PATCH, honoring the closed-session 409. Renamed `page.js`→`.jsx`. `session-detail.page.test.jsx` (3). | `8804d5d9` |

**Suite:** 2525 passed / 5 skipped. The governance-zip Windows file-lock is now self-healing (the generator keeps the prior zip on a build failure) — root cause was Claude Desktop holding the skill's SKILL.md open.

## Tail pass 5 (2026-06-03) — remaining "wire existing backend → UI" items

Eight committed clusters, each TDD'd (`.jsx`/component surfaces) or build-verified
(server-component `.js` display plumbing), every cluster gated on lint + the **full**
`vitest` suite + `next build` before commit + push. Suite **2582 → 2605** (+23 cases
across 7 new test files + 1 extended). Protected areas: none touched (no
OAuth/MCP/auth/middleware/billing). The local `.dashclaw/` recorder output and the
untracked `examples/governed-chat-harness/` were left unstaged throughout.

Ground truth for each item was established by a read-only recon fan-out first, which
corrected two recon assumptions: the policy test-runner is **not** hollow (`convertPolicy`
always emits `tests`), and the code-session detail page is an **async server component**
(so it stays `.js` + build-verified, not the `.jsx` rename the per-item blueprint assumed).

| Area | What shipped | Commit |
|------|-------------|--------|
| **Policies** | Orphaned endpoints wired into the Custom tab: Export proof (new `ProofExportPanel`, GET `/api/policies/proof` md/json + copy/download), Run tests (POST `/api/policies/test`, per-policy pass/fail), and the import pack picker now driven by GET `/api/policies/templates` (`policy_count` + per-policy `rules_summary`). `proof-export-panel.test.jsx` (5), `policy-custom-tab.test.jsx` (3). | `138da6a0` |
| **Compliance schedule** | Inline rename (PATCH `{name}`, using the full row the route returns) + `format`/`window_days`/`include_*` badges. `page.js`→`.jsx`. `compliance-exports.page.test.jsx` (2). | `e520d5fe` |
| **Artifacts** | Per-row delete in `ArtifactsTab` (DELETE `/api/artifacts/[artifactId]`), removing the row on success + not-found/failure message. `artifacts-tab.test.jsx` (+2). | `fe33865c` |
| **Code sessions** | `naive_cost_usd` + `cache_savings_usd` + naive token grid + parser metadata (`parser_version`/`model_requests`/`stuck_loops`) on the session detail Summary, coerced with `Number()`. Server component — build-verified. | `e2ec0905` |
| **Setup proof** | `ProofPanel` now renders an aggregate pass/fail/warn score + per-category/check breakdown (was download-only). `.js`→`.jsx`. `proof-panel.test.jsx` (3). | `432c21b9` |
| **Workflows** | Per-step "Resume from here" (POST `{from_step}`) on non-completed steps of a failed run, threaded page→timeline→card; `handleResume` treats only a string arg as a step_id (header still passes a click event = global resume). `workflow-run-step-card.test.jsx` (3). | `724862d8` |
| **Model strategies** | Live failover test panel (POST `/api/model-strategies/[id]/complete`, BYOK) rendering provider/model/cost/output, the `provider_errors` chain on a 502, and a clear live-billed warning. `model-strategy-test-panel.test.jsx` (3). | `db9c8db8` |
| **Agents** | Read-only `AgentConnectionsSection` on the agent detail — provider + `auth_type`/`plan_name`/`status`/last-reported. `agent-connections-section.test.jsx` (2). | `c1b5c72a` |

### Still remaining — flagged for user decision (out of the "wire existing backend" scope)

Each of these is **not** a straight UI-wiring of an existing route, so they were deliberately
left for a decision rather than auto-implemented:

- **Org rename + role-scoped keys** — touches `/api/orgs/*` (org/key management). The org-rename
  PATCH is low-risk wiring, but `/api/orgs/[orgId]/route.js` carries a **pre-existing direct-SQL
  violation** (the route-sql baseline tolerates it; left as-is, not fixed) and role-scoped key
  **minting** duplicates the existing `/api-keys` surface. Org/key management is auth/billing-adjacent.
- **Outcome-sweep manual trigger** — the *indicator* (the `lost_confirmation` `OutcomeBadge` + the
  decisions `filterOutcome` dropdown) already ships. What's missing is a **net-new mutating admin
  endpoint** (`POST /api/admin/trigger-outcome-sweep`); the existing `/api/cron/outcome-sweep` is
  `CRON_SECRET`-only. Relevant for free-tier (no cron), but it is new backend, not UI wiring.
- **Agent connections write form** — the read side shipped (`c1b5c72a`); the batch-upsert **editor**
  (POST `/api/agents/connections`, up to 50) is a net-new writer that the SDK `reportConnections`
  already covers.
- **DEAD PAGE `/goals`** — still AWAITING USER DECISION (carried from Tail pass 2). `app/goals/page.js`
  fetches `/api/goals`, which exists **only** under `app/api/_archive/goals/`, so `/goals` is dead in
  non-demo mode (demo-only fixtures) and not in the main nav — the same situation as the already-removed
  `/routing` + `/feedback`. Recommend the same treatment (delete), flagged because it wasn't in the
  original audit's stale-frontend list.

### Adversarial review pass (2026-06-03)

A multi-agent review (one reviewer per cluster vs the real route/repository, each finding
independently verified) ran over all eight clusters. It surfaced **6 real bugs**, all fixed
(suite 2605 → 2608, still lint + full-suite + build gated):

| Fix | Commit |
|-----|--------|
| **Workflow resume dropped prior step outputs** — `buildResumeContext` read `step.output_json`, but the only caller passes steps already shaped through `shapeStepResult` (`output`). Pre-existing; the test fixtures fed raw rows (a shape production never passes), masking it. Fixed + fixtures corrected. | `407a38ff` |
| **`plan_name` never persisted** — `upsertConnection` omitted `plan_name` from the INSERT/UPDATE, so the new agent-connections `plan_name` display would always be empty. Now persisted (validated). | `bdf8e17e` |
| **Model-strategy `max_tokens`** — `Number(x) \|\| undefined` replaced with an explicit `> 0` guard + `min="1"`. | `5aad20ff` |
| **Policies import-result error reporting** (3 findings, one root) — the panel treated the route's `errors` **array** as a number, so error badges/messages never rendered, and it referenced a non-existent `details` field. Now reads `errors.length`, lists the messages, and handles the `{error}` failed-import shape. Pre-existing. | `9a27b34f` |

**Not fixed (1, by design):** a `JSON.parse(frameworks)` without try/catch on the compliance exports
list (pre-existing; the verifier rated it unlikely under normal operation since the backend
`JSON.stringify`s + validates that column). Left as-is to avoid speculative error-handling for a
case that can't occur via normal writes — flagged here rather than hardened.

### Flagged-decision outcomes (user-approved 2026-06-03)

The four flagged items above were resolved by explicit user decision:

| Item | Decision | Result |
|------|----------|--------|
| **`/goals` dead page** | Delete | Removed `app/goals/page.js` + the now-dangling `View all → /goals` link in `GoalsChart`. `GoalsChart` itself (a demo-only dead `/dashboard` widget on archived `/api/goals`) flagged for a separate decision. `e01a554c` |
| **Org rename + role-scoped keys** | Org rename only | New `OrgNameEditor` wires PATCH `/api/orgs/[orgId] {name}` on the Team page (admin-gated). Key minting left on `/api-keys`; the orgs route's pre-existing direct-SQL left as-is. `898680bd` |
| **Outcome-sweep manual trigger** | Build it | New admin-gated, org-scoped POST `/api/admin/trigger-outcome-sweep` (repositories only, no direct SQL) + a "Run sweep now" button on `/decisions`, so free-tier (no cron) instances can finalize timed-out actions. `463f02b1` |
| **Agent-connections write form** | Skip | Read display already ships (`c1b5c72a`); writes go through the SDK `reportConnections`. No editor built. |

**Suite 2608 → 2612.** With these, the SYNC_AUDIT "Still remaining" list is fully resolved — every
item is either implemented, deleted by decision, or explicitly skipped by decision. Net-new this
session: 1 route (`267 → 271` total across the session's additions), ~16 components/pages, and 27
test cases across the tail-pass-5 + review + decision work.
