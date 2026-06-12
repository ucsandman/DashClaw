# DashClaw Sync Audit — 2026-06-01

Frontend/backend sync gaps: governance capabilities the backend supports that the dashboard never exposes to users. Audit-only — no code was changed.

> **STATUS (updated 2026-06-02):** This is the original audit. Remediation is underway — **all 15 High items are done** and all fabricated/misleading data is removed, plus a large chunk of the Medium/Low/partially-wired tail. See **`SYNC_AUDIT_IMPLEMENTATION.md`** for exactly what's implemented and the precise "Still remaining" backlog (~25 items). Use that doc as the source of truth; the `file:line` map below is still the backend reference for the remaining items.

## Summary

- **Active API route+method capabilities mapped:** ~219 (≈170 fully wired) across the non-archived runtime (`app/api/**` excluding `app/api/_archive/**`).
- **Schema tables audited (columns vs UI):** 64 (≈46 fully surfaced).
- **Closed value-sets / enums audited:** 14 (8 fully covered FE↔BE).
- **Distinct gaps found:** **79** — 15 High, 42 Medium, 22 Low.
- **Partially wired (endpoint called, response partly ignored):** 12 (5 Medium, 7 Low).
- **Stale-frontend / inverse issues (FE calls dead endpoints, or shows invented data):** 6 (see Notes).

Method: 11 feature-domain agents read every route + page in their slice and cross-referenced calls; 3 cross-cutting agents swept all routes for orphans, all schema columns for hidden fields, and all enums for missing values. Findings below are deduped across those overlapping sweeps. Items the agents couldn't fully confirm are tagged **[VERIFY]**.

> Severity = user impact. **High** = a core governance capability users can't reach/act on, or governance data shown wrong/empty. **Medium** = useful data or action hidden. **Low** = metadata/minor/diagnostics.

---

## Gaps

### [H] Capability `invoke` — the governed-execution path — has no UI control
- **Backend:** `app/api/capabilities/[capabilityId]/invoke/route.js:40` — `POST /api/capabilities/{id}/invoke` runs the full governed invocation (guard eval, DLP scan, quota, circuit breaker, access check, executes the HTTP capability, records the action).
- **Frontend:** No page/component calls `/invoke`; the detail page only exposes "Run test" (`POST /test`, a low-risk synthetic call). `invoke` appears only in `app/docs/page.js` prose and generated doctor snapshots.
- **User impact:** The primary product action — actually invoking a registered capability under policy/quota/access enforcement — is unreachable from the dashboard. Operators can't trigger a real governed call or see the guard/quota/access-denied/circuit-breaker responses.
- **Recommended fix:** Add an "Invoke" action beside "Run test" on the capability detail page (reuse the generated input form), POST to `/invoke`, and render the structured outcomes (blocked_by_policy, pending_approval, quota_exceeded, circuit_breaker_open, access_denied, success+security summary).

### [H] Compliance "Enforcement evidence" tiles read wrong field names — 3 of 4 always show 0
- **Backend:** `app/api/compliance/evidence/route.js:30-42` returns `guard_decisions_total`, `guard_decisions_blocked`, `approval_requests`, `action_records_total` (+ breakdown arrays).
- **Frontend:** `app/compliance/page.js:454-466` reads `guard_decisions`, `blocked`, `actions_recorded` — keys that don't exist on the response, so three of the four SOC2/ISO evidence tiles render the `?? 0` fallback even when enforcement is active.
- **User impact:** The core compliance evidence artifact silently reports 0 guard decisions, 0 blocked, 0 actions recorded — making a working governance runtime look empty/broken to an auditor.
- **Recommended fix:** Rename the FE reads to `guard_decisions_total` / `guard_decisions_blocked` / `action_records_total` (keep `approval_requests`); optionally render the `breakdown` array.

### [H] Workflow `/execute` (the only endpoint that runs steps) has no UI — "Launch" runs nothing
- **Backend:** `app/api/workflows/templates/[templateId]/execute/route.js:39` — `POST .../execute` runs the steps, persists `workflow_step_results`, captures artifacts, enforces guard+quota, and writes the run timeline the run-detail page renders.
- **Frontend:** No FE file calls `/execute`. The detail page's "Launch" button (`app/workflows/[templateId]/page.jsx:122`) calls `/launch`, which only writes an `action_records` row and runs **no** steps; the Runs tab text even says "Use the SDK or API to execute this workflow."
- **User impact:** Users can build and "launch" a workflow but can never execute its steps from the UI — no step results, artifacts, or run timeline are produced without dropping to the SDK.
- **Recommended fix:** Add a "Run workflow" button that POSTs to `/execute` (with an optional variables editor) and navigates to the run-detail page, or repoint "Launch" at `/execute` for templates with executable steps.

### [H] Governed-secrets rotation tracking has zero UI
- **Backend:** `app/api/secrets/route.js:10,24` (list/create), `app/api/secrets/[id]/route.js:10,29` (rotate/delete), `app/api/secrets/rotation-due/route.js:10` (overdue-within-N-days); table `governed_secrets` (`schema/schema.js:1333-1349`) with `last_rotated_at`, `rotation_interval_days`, `next_rotation_due`, `days_until_due`, `notes`.
- **Frontend:** No `/secrets` page and no FE reference to `/api/secrets`. (`app/components/SecretGenerator.js` is an unrelated client-side `.env` generator — a naming false-friend.)
- **User impact:** Users can't register a secret, record a rotation, set an interval, add notes, delete one, or see which secrets are overdue — an entire governance-hygiene feature is API-only.
- **Recommended fix:** Add a Secrets surface (Settings/Security tab or `/secrets` page): list from `GET /api/secrets`, a create form, per-row "Mark rotated"/delete, and a "rotation due" panel from `/api/secrets/rotation-due`.

### [H] Skill-safety scanner has no UI surface
- **Backend:** `app/api/skills/scan/route.js:11` (`POST` — scans skill files for unsafe content, returns findings + passed), `app/api/skills/scans/[id]/route.js:10` (GET a stored scan); table `skill_scan_results` (`schema/schema.js:1352-1362`).
- **Frontend:** No `/skills` page and no FE reference to either route (only SDKs/docs/tests). The stored pass/fail + findings are never displayed.
- **User impact:** Users cannot scan a skill bundle for malicious content from the dashboard nor review past scan results — a core governance capability is SDK/MCP-only.
- **Recommended fix:** Add a Skills security panel (under `/security` or a new page) that POSTs files to `/api/skills/scan`, renders findings/passed, and links to scan detail.

### [H] Sensitive-data (DLP) scan `/api/security/scan` is never called by the UI
- **Backend:** `app/api/security/scan/route.js:10` — `POST` scans text for secrets/PII (`scanSensitiveData`), returns findings, categories, critical_count, redacted_text, and stores metadata in `security_findings`.
- **Frontend:** The Security page only calls `GET /api/security/status`. No page POSTs to `/scan`; the `security_findings` history is never read.
- **User impact:** No interactive way to check text for leaked secrets/PII, and the stored findings history is invisible.
- **Recommended fix:** Add a "Scan text for secrets" tool to `/security` that POSTs to `/scan` and shows findings + redacted output, plus a recent-findings list.

### [H] Prompt-injection scanner + its persisted history have no UI
- **Backend:** `app/api/security/prompt-injection/route.js:11` (`POST` — risk_level, recommendation, categories, findings) and `:63` (`GET` — stored scan log with risk_level/recommendation/source/scanned_at).
- **Frontend:** No page references the route. `/security` shows runtime risk *signals* but not the injection scanner or its persisted `prompt_injection_scans` log.
- **User impact:** Users can't run a prompt-injection check from the UI or review the scan history the backend deliberately stores.
- **Recommended fix:** Add an injection-scan tool + history table to `/security` (POST to scan, GET to populate), mirroring the DLP panel.

### [H] Doctor diagnostics + one-click Fix have no dashboard UI
- **Backend:** `app/api/doctor/route.js:7` (`GET` — full diagnostic engine: db/config/auth/deploy/SDK/governance-staleness/shape-drift with suggested fixes) and `app/api/doctor/fix/route.js:8` (`POST` — applies a named fix, returns a fresh recheck).
- **Frontend:** Zero `fetch('/api/doctor...')` anywhere; both appear only as CLI-pointing prose in `app/self-host/page.js:124` and `app/connect/page.jsx`.
- **User impact:** A signed-in operator can't run health diagnostics or apply remediations (regenerate secrets, run migrations, fix CORS, seed default policy) from the dashboard — only via the CLI.
- **Recommended fix:** Add a Diagnostics section (Settings tab or `/setup`) that GETs `/api/doctor`, renders checks by category, and a per-check "Fix" button POSTing to `/api/doctor/fix`.

### [H] Code Sessions alerts are a dead-end counter — no list, no read, no clear
- **Backend:** `app/api/code-sessions/alerts/route.js:12` (`GET` alerts + unread_count) and `app/api/code-sessions/alerts/read-all/route.js:9` (`POST` mark read). Alerts are generated on every ingest (cost-anomaly, cache-crater, stuck-loop).
- **Frontend:** Only the unread **count** is shown as a subtitle string (`app/code-sessions/page.js:19-21`); nothing lists the alerts or calls `/alerts/read-all`.
- **User impact:** Users see "N unread alerts" but cannot read which session triggered a cost spike / cache crater / stuck loop, navigate to it, or ever clear the badge.
- **Recommended fix:** Add an alerts panel/drawer on the code-sessions index that GETs `/api/code-sessions/alerts`, renders title/body/severity with a link to the session, and a "Mark all read" button.

### [H] `/evaluations` page is unreachable from the sidebar
- **Backend:** `app/api/evaluations/route.js` + `/stats` + `/scorers` + `/runs` — full evaluations surface.
- **Frontend:** The nav only has "Quality" → `/quality`, which redirects to `/scoring` by default (`app/quality/page.js:18-23`); nothing links to `/evaluations` (it needs `?view=evaluations`). The dashboard EvalScoreCard "View →" link only appears once scores already exist.
- **User impact:** Users can't discover or open Evaluations (scores, scorer CRUD, runs) through normal navigation — the scorer/run creation forms are effectively hidden when there's no data yet.
- **Recommended fix:** Add a sidebar item for `/evaluations` (or a Quality hub linking both `/scoring` and `/evaluations`).

### [H] No UI to verify a signed evidence receipt or compliance bundle
- **Backend:** `app/api/integrity/verify/route.js:20` — `POST {receipt}`/`{bundle}` re-verifies the signature against the published JWKS (route comment: "anyone holding a receipt/bundle should be able to verify its integrity"). Paired with `/api/integrity/jwks`.
- **Frontend:** No page POSTs to `/verify`; the only callers are server-side during export hashing. Compliance/exports produce signed bundles but offer no "verify this" control.
- **User impact:** A core trust capability — letting an auditor independently confirm a downloaded receipt/bundle is authentic and untampered — has no reachable control. **[VERIFY]** (verification is inherently machine-ish, but the route targets external human re-verifiers).
- **Recommended fix:** Add a "Verify receipt/bundle" control (paste JSON or upload) on `/compliance/exports` that POSTs to `/api/integrity/verify` and renders `ok` + `kid`/`reason`.

### [H] "Score an action" has no UI — profiles can be built but never run
- **Backend:** `app/api/scoring/score/route.js:33` — `POST /api/scoring/score` scores a single action or a batch against a profile, persists to `profile_scores`, returns composite + per-dimension scores.
- **Frontend:** No FE file POSTs to `/score`; the Score Explorer (`app/scoring/page.js:93`) is GET-only. There's no button anywhere to actually score an action.
- **User impact:** Users can create scoring profiles but can never run them; scores only ever appear from seeded/SDK data. (`/scoring` is also only reachable via the unlabeled `/quality`→`/scoring` redirect.)
- **Recommended fix:** Add a "Score action" control (single + batch) in the Score Explorer or per profile that POSTs `{profile_id, action}` to `/api/scoring/score`.

### [H] Policy builder dropdown omits 4 enforced policy types
- **Backend:** `app/lib/validate.js:253` `POLICY_TYPES` accepts `behavioral_anomaly`, `permission_escalation`, `green_contract`, `branch_freshness` (plus the 7 shown); each is fully evaluated by the guard engine (`app/lib/guard.js:658,778,798,813`).
- **Frontend:** Both manual authoring dropdowns omit them — `app/policies/components/CustomTab.jsx:21` lists 7, `app/policies/generate/page.jsx:12` lists 6 — and `formatRules` lacks their cases, so even AI/pack-generated ones render as the raw `policy_type` string.
- **User impact:** Operators can't manually create the policy types that block privilege escalation, gate deploys on green-state/branch freshness, or flag behavioral anomalies; they're reachable only via the AI generator or packs, and mislabeled in the list.
- **Recommended fix:** Add the four `{value,label,desc}` entries to both dropdowns and their `case` branches to `formatRules`.

### [H] API-key role (admin/member/readonly) is neither settable nor shown — every UI key is admin
- **Backend:** `app/api/keys/route.js:88` hardcodes new keys to role `admin`; `GET` returns `role`. The org-scoped route `app/api/orgs/[orgId]/keys/route.js:87` accepts `admin|member|readonly`.
- **Frontend:** `app/api-keys/page.js:63` POSTs `{label}` only (no role selector) and never renders `key.role`.
- **User impact:** Every key minted from the dashboard is silently an admin key; users can't create least-privilege member/readonly keys or even see an existing key's privilege — a real least-privilege governance gap.
- **Recommended fix:** Add a role `<select>` to the create form, honor `role` in `/api/keys` (default `member`), and show each key's role badge.

### [H] Assumptions page filter tabs and counters are broken (read a field the API never returns)
- **Backend:** `app/api/assumptions/route.js:34` — `GET` filters on `validated`/`stale` and returns integer columns `validated`/`invalidated`; it never reads `status` or returns a string `status`.
- **Frontend:** `app/assumptions/page.js:43` sends `params.set('status', ...)` (ignored, so every tab returns the full list) and computes stats/badges off `a.status` (lines 64-66,130,159) — a nonexistent field — so Validated/Invalidated/Pending counters always read 0 and every badge falls back to "pending."
- **User impact:** The Assumptions page's four filter tabs are non-functional and its counters are always wrong; users can't filter or triage assumption drift from the primary surface.
- **Recommended fix:** Map tabs to the API contract (`validated=true|false`, `stale=true`) and derive display state from `a.validated`/`a.invalidated` instead of `a.status`.

---

### [M] Model-strategy `/complete` (live failover test) has no UI
- **Backend:** `app/api/model-strategies/[strategyId]/complete/route.js:25` — `POST` runs a real completion through the primary→fallback chain with BYOK creds + budget caps, returns output + provider/cost tracking.
- **Frontend:** No FE reference; the strategy detail page only GET/PATCH/DELETEs. There's no "Test strategy" control.
- **User impact:** Users configure a primary model, fallback chain, and budget caps but can't validate that creds resolve, fallback fires, and cost is within budget — the feature's core value (proven failover) is unverifiable from the UI.
- **Recommended fix:** Add a "Test strategy" panel (messages textarea → POST `/complete`) showing the answering provider, fallback path, and cost.

### [M] Scoring dimension CRUD (add/edit/delete after creation) is entirely unwired
- **Backend:** `app/api/scoring/profiles/[profileId]/dimensions/route.js:8` (POST add) and `.../[dimensionId]/route.js:8,25` (PATCH/DELETE).
- **Frontend:** Dimensions are only set inline in the create POST (`app/scoring/page.js:113`); existing profiles render dimensions read-only with no add/edit/delete.
- **User impact:** Once a profile exists, users can't re-weight, rename, add, or remove a dimension without rebuilding the whole profile — weight tuning is impossible post-creation.
- **Recommended fix:** Add per-dimension edit/delete + "Add dimension" controls on the profile card wired to the dimension routes.

### [M] Risk-template editing (PATCH) has no UI — create-or-delete only
- **Backend:** `app/api/scoring/risk-templates/[templateId]/route.js:8` — `PATCH` updates name/description/action_type/base_risk/rules.
- **Frontend:** `app/scoring/page.js` wires GET/POST/DELETE but never PATCH; the template card has only Delete.
- **User impact:** Users can't adjust a risk template's base risk or rules after creation — they must delete and recreate (losing the id/history).
- **Recommended fix:** Add an "Edit" button that opens the create form pre-filled and PATCHes the template.

### [M] Profile-score statistics (`view=stats`) are computed but never shown
- **Backend:** `app/api/scoring/score/route.js:20` — `GET ?view=stats&profile_id=` returns total_scores, avg/min/max, stddev, unique_agents/actions.
- **Frontend:** No FE passes `view=stats`; Score Explorer lists individual scores only.
- **User impact:** Operators see a raw score list but no distribution/average/spread per profile.
- **Recommended fix:** Fetch `?view=stats` when a profile is selected and render a stat strip.

### [M] Scoring profile archive is a one-way soft-delete (no status filter, no unarchive)
- **Backend:** `GET /api/scoring/profiles` accepts `?status=` and PATCH sets any status, so archived profiles can be reactivated.
- **Frontend:** `app/scoring/page.js` fetches with no `status` (defaults to active only) and the sole mutation is "Archive"; there's no filter or unarchive.
- **User impact:** Archiving makes a profile vanish permanently with no path to view or restore it. **[VERIFY]**
- **Recommended fix:** Add a status filter (Active/Archived/All) and an "Unarchive" action (PATCH `status:'active'`).

### [M] Policy "Proof report" generator is an orphan endpoint
- **Backend:** `app/api/policies/proof/route.js:14` — `GET ?format=md|json` generates a compliance/proof report of all active policies.
- **Frontend:** No FE fetches `/policies/proof`; the Policies page has no "export proof" control.
- **User impact:** Users can't generate/download the policy proof compliance artifact from the UI — it's SDK-only.
- **Recommended fix:** Add an "Export proof" button on the Policies Custom tab that GETs `?format=md` and offers download/copy.

### [M] Policy test-runner is an orphan endpoint
- **Backend:** `app/api/policies/test/route.js:15` — `POST` runs each active policy's embedded test cases, persists a test run, returns pass/fail.
- **Frontend:** No FE POSTs to `/policies/test` (the per-policy "Simulate" is a different endpoint).
- **User impact:** Users can't validate policies against their own test cases or see stored test-run history.
- **Recommended fix:** Add a "Run tests" button on the Policies tab that POSTs `/policies/test` and renders the summary.

### [M] Policy-templates catalog endpoint unused — UI shows static previews
- **Backend:** `app/api/policies/templates/route.js:9` — `GET` returns each pack's name/description/recommended_for **and** `policy_count` + parsed per-policy `rules_summary`.
- **Frontend:** `app/policies/components/CustomTab.jsx:19` / `PolicyAdvancedImportPanel.jsx` hardcode the 4 packs from a local `PACK_PREVIEWS` constant and never call `/templates`.
- **User impact:** Users picking a pack see static blurbs, not how many policies it contains or the actual rules each would install; the pack list can drift from the server's real catalog. **[VERIFY]**
- **Recommended fix:** Have the pack picker GET `/api/policies/templates` and show `policy_count`/`rules_summary` before import.

### [M] Org endpoints (`/api/orgs*`) — rename + role-scoped keys — are completely unwired
- **Backend:** `app/api/orgs/route.js:22,50` (GET/POST orgs), `app/api/orgs/[orgId]/route.js:9` (GET/PATCH rename), `app/api/orgs/[orgId]/keys/route.js:19` (role-scoped key CRUD).
- **Frontend:** None of `/api/orgs*` is fetched anywhere outside generated shape files.
- **User impact:** Admins can't rename their workspace, create additional orgs, or mint role-scoped keys from the UI; the org's `active_keys` count and detail are never shown. (Related to the API-key-role gap above.)
- **Recommended fix:** Surface org rename (PATCH) on the Team page (org name already shown read-only) and route role-scoped key creation through `/api/orgs/[orgId]/keys`; org-create can stay CLI/onboarding.

### [M] Governance config flags are backend-read but not settable from the UI
- **Backend:** Read by the runtime, writable only via generic `POST /api/settings`: `PREDICTIVE_RISK_ENABLED`/`PREDICTIVE_RISK_THRESHOLD` (`app/lib/guard.js:232-233`), `DASHCLAW_ACTION_COST_THRESHOLD` (`app/lib/cost-alerts.js:15`), `DASHCLAW_OUTCOME_TIMEOUT_MINUTES` (settings allowlist). All are valid setting keys.
- **Frontend:** No control writes any of these; the dashboard only edits integration creds, `MODEL_PRICING`, and `ENFORCE_AGENT_SIGNATURES`. **[VERIFY]**
- **User impact:** Users can't enable/tune predictive risk scoring, set a per-action cost-alert threshold, or adjust the durable-finality timeout without hand-crafting an API call.
- **Recommended fix:** Add a "Governance settings" card (toggle + numeric inputs) POSTing to `/api/settings` with `category:'system'`.

### [M] Settings DELETE (fully disconnect an integration/setting) has no UI control
- **Backend:** `app/api/settings/route.js:137` — `DELETE ?key=&agent_id=` removes a setting row (admin-only), logs `setting.deleted`.
- **Frontend:** No FE issues a DELETE; the integrations editor only POSTs, and clearing a field saves an empty string rather than deleting the row.
- **User impact:** Once an integration credential/setting is saved it can only be overwritten, never removed — there's no true "Disconnect," and an empty-string overwrite is treated differently than absent.
- **Recommended fix:** Add a "Disconnect"/"Remove" button that DELETEs each field key, then refetches.

### [M] `/api/settings/llm-status` is an orphan endpoint
- **Backend:** `app/api/settings/llm-status/route.js:12` — `GET` returns `{available, provider, model}` so the UI can enable/disable LLM-dependent features.
- **Frontend:** No page fetches it; the one optional LLM feature (the `llm_judge` scorer) doesn't gate on it. **[VERIFY]**
- **User impact:** The UI gives no signal about whether an AI provider is configured and never conditionally enables LLM-dependent controls.
- **Recommended fix:** Call it from the Evaluations/scorers UI to badge "LLM provider: …" and disable `llm_judge` when `available` is false.

### [M] Evaluation run detail (per-run score distribution) is never opened from the UI
- **Backend:** `app/api/evaluations/runs/[runId]/route.js:12-29` — `GET` returns `{run, distribution}` (per-run score buckets).
- **Frontend:** `app/evaluations/page.js` lists runs but rows aren't links and nothing fetches a single run.
- **User impact:** Users see aggregate run stats but can't drill into a run's score distribution.
- **Recommended fix:** Make each run row open a detail view/modal fetching `/runs/${id}` and render the distribution.

### [M] Evaluation run status PATCH (cancel a stuck run) has no control
- **Backend:** `app/api/evaluations/runs/[runId]/route.js:31-47` — `PATCH` updates run status + `completed_at`.
- **Frontend:** No button PATCHes a run; runs execute async and can only be observed.
- **User impact:** A run stuck in `pending`/`running` (e.g. dead executor) can't be cancelled or cleared from the UI.
- **Recommended fix:** Add a "Cancel" action on non-terminal runs that PATCHes `{status:'failed'}` and refreshes.

### [M] Drift alert filters (severity / acknowledged / metric) are not exposed
- **Backend:** `app/api/drift/alerts/route.js:8-15` — `GET` accepts `severity`, `acknowledged`, `metric`, `offset`.
- **Frontend:** `app/drift/page.js:78` passes only `agent_id`+`limit`; no severity/ack/metric controls.
- **User impact:** On busy fleets users can't narrow drift alerts to e.g. `critical` or `unacknowledged`, or to one metric.
- **Recommended fix:** Add filter controls (severity select, "unacknowledged only" toggle, metric select from `/api/drift/metrics`).

### [M] Evaluation score filters (scorer/min-max/evaluated_by) are not exposed
- **Backend:** `app/api/evaluations/route.js:24-33` — `GET` supports `scorer_name`, `evaluated_by`, `min_score`, `max_score`, `action_id` and returns `total`.
- **Frontend:** `app/evaluations/page.js:89` passes only `agent_id`+`limit`; no filter UI, and `total` is ignored.
- **User impact:** Users can't filter scores to failing items (`max_score=0.5`) or a specific scorer/evaluator — a core triage flow is missing.
- **Recommended fix:** Add score filter controls wired into the query and surface `total`.

### [M] Webhook event dropdown omits the 3 approval-lifecycle events the backend delivers
- **Backend:** `app/api/webhooks/route.js:11` `VALID_EVENT_TYPES` includes `approval_pending`/`approval_granted`/`approval_denied`, actively fired from `app/api/actions/route.js:351` and `app/api/approvals/[actionId]/route.js:103`.
- **Frontend:** `app/webhooks/page.js:49` lists only 8 of 11 types — the three approval events are missing from both the create grid and the delivery-row labels.
- **User impact:** Users can't subscribe a webhook to the core human-in-the-loop approval events from the UI, and approval deliveries render with the raw enum string.
- **Recommended fix:** Add the three approval entries (with labels) to `EVENT_TYPES`.

### [M] Decisions ledger status filter omits `pending_approval`
- **Backend:** `app/lib/validate.js:12` `ACTION_STATUSES` includes `pending_approval`; it's filterable (`/api/actions?status=pending_approval`, used by `app/approve/page.js:121`).
- **Frontend:** `app/decisions/page.js:370` status dropdown lacks `pending_approval` (the Capabilities history table includes it, confirming it's real).
- **User impact:** On the main ledger, an operator can't filter to actions awaiting approval — the most governance-relevant subset.
- **Recommended fix:** Add `pending_approval` to the status options in `decisions/page.js`.

### [M] Capability access-check (dry-run evaluation) is not surfaced
- **Backend:** `app/api/capabilities/[capabilityId]/access/check/route.js:9` — `GET ?agent_id=` evaluates effective access (agent rule → org default), returns `{access, rule}`.
- **Frontend:** No FE calls it; `CapabilityAccessTab` lists/creates/deletes rules but can't test what a given agent resolves to.
- **User impact:** Operators configuring allow/deny/require_approval rules can't preview the effective decision for a specific agent — rule debugging is guesswork.
- **Recommended fix:** Add an `agent_id` input + "Check access" button to `CapabilityAccessTab`.

### [M] Generic agent-session status can't be changed from the UI (PATCH unreachable)
- **Backend:** `app/api/sessions/[sessionId]/route.js:28` — `PATCH` updates `status, green_level, branch_freshness, commits_behind, blocked_reason` (with a closed-session 409 guard).
- **Frontend:** `app/sessions/[sessionId]/page.js` renders state read-only; the only button is "Refresh."
- **User impact:** An operator viewing a blocked/stalled agent session can't resolve, close, or clear the block from the dashboard.
- **Recommended fix:** Add status controls ("Mark finished", "Clear block") that PATCH `/api/sessions/:id`, honoring the 409.

### [M] Knowledge collection edit (PATCH) is advertised but not implemented
- **Backend:** `app/api/knowledge/collections/[collectionId]/route.js:46` — `PATCH` updates name/description/source_type/tags/ingestion_status.
- **Frontend:** `app/knowledge/page.js:80` shows an "Edit" pencil that just navigates to the read-only detail page; no PATCH exists anywhere in `app/knowledge`.
- **User impact:** The "Edit" affordance doesn't edit; collections are effectively immutable after creation (rename/re-tag/change description all impossible).
- **Recommended fix:** Add an edit form that PATCHes the collection, or relabel the link to "Open."

### [M] Org-wide artifact list + delete are unreachable
- **Backend:** `app/api/artifacts/route.js:9` (GET all org artifacts with action_id/step_id/agent_id/type filters + `total`) and `app/api/artifacts/[artifactId]/route.js:26` (DELETE).
- **Frontend:** The only artifact surface (`ArtifactsTab.jsx`) fetches the per-action `/api/actions/{id}/artifacts` only — never the org-wide list, never delete.
- **User impact:** Users can't browse/filter artifacts across actions (the filters + `total` are inert) and can never delete an artifact (e.g. a duplicate auto-generated evidence bundle).
- **Recommended fix:** Add an org-wide Artifacts page consuming `GET /api/artifacts`, or at minimum a per-row delete in `ArtifactsTab`.

### [M] Learning policy-suggestions (generate + one-click accept) is hidden
- **Backend:** `app/api/learning/suggestions/route.js:11` (`GET` auto-generated policy suggestions from negative-feedback trends) and `:23` (`POST {action:'accept', suggestion_index}` → materializes a real guard policy via `insertPolicy`).
- **Frontend:** No FE fetches `/learning/suggestions`.
- **User impact:** An entire feature — DashClaw proposing approval policies from feedback drift and accepting them in one click — is fully unreachable (both view and the policy-creating accept).
- **Recommended fix:** Add a "Suggested Policies" card on `/learning` (or `/policies`) listing each suggestion's evidence + suggested policy with an "Accept" button.

### [M] Learning consolidated-lessons endpoint unused (UI shows raw lessons instead)
- **Backend:** `app/api/learning/lessons/route.js:9` — `GET` returns `consolidateLessons()`: per-action hints (risk_cap, prefer_reversible, confidence_floor, expected duration/cost), guidance, sample_size, plus unacknowledged `drift_warnings`.
- **Frontend:** No FE calls it; `/learning` renders plain rows from `/api/learning` instead.
- **User impact:** The synthesized, actionable lessons and live drift warnings the learning loop produces are invisible; users see only legacy/raw lessons.
- **Recommended fix:** Point a "Distilled Lessons" card at `/api/learning/lessons` and render hints + drift_warnings.

### [M] Learning code-signals (optimizer findings) aggregation has no UI
- **Backend:** `app/api/learning/code-signals/route.js:17` — `GET (7d/30d/90d)` returns optimizer findings by kind with occurrence/session counts and `total_savings_usd`.
- **Frontend:** Only docs prose references it; no card/chart and the period filter has no control.
- **User impact:** Code-optimizer findings folded into the learning loop (and the dollar savings they represent) are never shown.
- **Recommended fix:** Add a "Code Signals" panel with a period toggle rendering findings by kind + total savings.

### [M] Agent self-reported `idle`/`busy`/`stale` statuses are never surfaced; fleet filter omits them
- **Backend:** `app/api/agents/heartbeat/route.js:30` accepts `status ∈ {online, offline, idle, busy, stale}` and returns it as `reported_status`.
- **Frontend:** `app/agents/page.js:16` `statusDotMap` lacks `idle`/`busy`/`stale` (they fall to a gray "unknown" dot), the filter offers only all/online/critical/offline, and `reported_status` is never rendered.
- **User impact:** An agent heartbeating `busy`/`idle` shows as a meaningless gray dot, and operators can't filter busy vs idle.
- **Recommended fix:** Add `idle`/`busy`/`stale` to the dot maps + filter and surface `reported_status` as a label.

### [M] Agent connections POST (provider connections) has no UI writer
- **Backend:** `app/api/agents/connections/route.js:39` — `POST` batch-upserts up to 50 connections with `auth_type ∈ {api_key, subscription, oauth, pre_configured, environment}` and `status ∈ {active, inactive, error}`.
- **Frontend:** The GET is rendered as read-only badges; no form creates/edits/deletes a connection (SDK-only via `reportConnections`).
- **User impact:** Users can see agent-reported integrations but can't add, correct, or clear one (e.g. a stale `error` connection).
- **Recommended fix:** Add an "Add/edit agent connection" control POSTing to `/api/agents/connections`.

### [M] Workflow run cancel is unreachable from the run-detail page
- **Backend:** `app/api/workflows/templates/[templateId]/runs/[runActionId]/cancel/route.js:9` — `POST` CAS-cancels a running parent action + its running steps.
- **Frontend:** The run-detail header shows a "Running" badge but only a Resume button (for failed runs); Cancel is reachable only indirectly via an Operations-Feed signal.
- **User impact:** An operator watching a stuck/long run has no direct way to stop it.
- **Recommended fix:** Render a "Cancel run" button in `WorkflowRunHeader` when `status === 'running'`.

### [M] Workflow templates list has no status filter (draft/active/archived)
- **Backend:** `app/api/workflows/templates/route.js:19` — `GET` accepts `?status=`.
- **Frontend:** `app/workflows/page.jsx:146` always fetches `?limit=100` with no status control, though detail/new pages let users set status.
- **User impact:** On instances with many templates, users can't narrow to active vs archived — clutter is always shown together.
- **Recommended fix:** Add a status segmented control/dropdown appending `?status=`.

### [M] Prompt template edit (rename/description/category) is not exposed
- **Backend:** `app/api/prompts/templates/[templateId]/route.js:26` — `PATCH` updates name/description/category (admin).
- **Frontend:** `app/prompts/page.js` wires GET/POST/DELETE + versions but no PATCH.
- **User impact:** A typo'd template name or wrong category is permanent unless the user deletes+recreates (losing version history).
- **Recommended fix:** Add an inline edit affordance that PATCHes the template header.

### [M] Assumption drift scoring is computed but shown as a hardcoded "Nominal"
- **Backend:** `app/api/assumptions/route.js:50-78` — `GET ?drift=true` computes per-assumption `drift_score` (0-100) and a `drift_summary {at_risk, ...}`.
- **Frontend:** Only `app/security/page.js:101` requests drift; the Assumptions page never does, and the decision-replay "Drift Detection" cards (`app/decisions/[actionId]/page.js:921`, `app/actions/[actionId]/page.js:599`) render a **hardcoded "0.02 (Nominal)"** bar.
- **User impact:** The real backend-computed assumption-drift risk is never shown; operators see a fake static figure that doesn't reflect actual at-risk assumptions.
- **Recommended fix:** Request `drift=true` on the Assumptions page and render `drift_summary.at_risk` + per-row `drift_score`; replace the hardcoded "Nominal" block with the computed value.

### [M] Decisions ledger can't be filtered by `swarm_id`
- **Backend:** `app/api/actions/route.js:60` — `GET` accepts `swarm_id` to scope the ledger to a swarm.
- **Frontend:** `app/decisions/page.js` wires agent/type/status/outcome/risk_min filters but never `swarm_id`.
- **User impact:** Users running multi-agent swarms can't filter the decision ledger by swarm. **[VERIFY]**
- **Recommended fix:** Add a swarm dropdown to the ledger filter row (gated on whether swarms exist).

### [M] Per-action `model` is stored but has no structured display, filter, or cost breakdown
- **Backend:** `app/lib/repositories/actions.repository.js:255` writes `action_records.model`; returned by `getActionWithRelations`. Cost aggregation is never grouped by model.
- **Frontend:** `app/decisions/page.js` and `app/analytics/page.jsx` never render `action.model` or offer a model filter (it appears only in the raw JSON dump at `app/actions/[actionId]/page.js:740`).
- **User impact:** Operators can't see which model drove a decision, filter the ledger by model, or attribute spend per model. **[VERIFY]**
- **Recommended fix:** Add `model` to the decisions detail metrics grid and an analytics `by_model` cost breakdown.

### [M] Learning-recommendation linkage on actions is never shown in any decision view
- **Backend:** `app/lib/repositories/actions.repository.js:252,275-277` store `recommendation_id`, `recommendation_applied`, `recommendation_override_reason`; returned via `SELECT *`.
- **Frontend:** Neither decisions nor action-detail pages render them in any structured way (raw JSON dump only).
- **User impact:** The learning loop's point — whether an agent followed or overrode a recommendation, and the override *reason* — has no structured surface tying a decision back to its recommendation.
- **Recommended fix:** Show "Applied recommendation `<id>`" / "Overrode — reason: `<…>`" in the action/decision detail Timeline section.

### [M] Guard-decision integrity fields (verification/replay/act status) are never returned or shown
- **Backend:** `schema/schema.js:553-570` stores `verification_status`, `replay_status`, `act_status`, `jti`, `act_hash`, `evidence` per call (written by `app/api/guard/route.js:102-170`). But `guardrails.repository.js:63-66` `listGuardDecisions` selects only id/decision/risk_score/agent_id/action_type/reason/matched_policies/context/created_at.
- **Frontend:** No surface displays or filters on these; `/api/guard/decisions` consumers render only `decision`.
- **User impact:** Operators can't see or filter which governed calls came from unverified/expired/failed tokens, were replayed, or had action-binding mismatches — the entire JWT-integrity audit axis is recorded but invisible.
- **Recommended fix:** Add the integrity columns to the `listGuardDecisions` SELECT and surface them as badges + an optional filter on a guard-decisions view.

### [M] Operations-summary `latency.p50_ms` and `approval_backlog.avg_wait_minutes` are returned but not displayed
- **Backend:** `app/api/operations/summary/route.js:80-88` returns `latency.p50_ms` and `approval_backlog.avg_wait_minutes` next to the shown p95/oldest values.
- **Frontend:** `app/mission-control/components/RuntimeSummaryCard.jsx` renders only p95 and oldest_minutes.
- **User impact:** Operators see worst-case latency and oldest-pending age but not median latency or average approval wait.
- **Recommended fix:** Add p50 and avg-wait sub-values to the latency and approval-backlog rows.

### [M] Usage cost breakdown (`/api/usage/costs`) is an orphan endpoint
- **Backend:** `app/api/usage/costs/route.js:9` — `GET` returns `total_cost_usd`, `total_actions`, per-`action_type` breakdown, and a daily cost series.
- **Frontend:** No FE caller; `/usage` calls only `/api/usage`. (The same numbers are partly reachable via `/analytics`.) **[VERIFY]**
- **User impact:** The dedicated per-action-type + daily spend view this route powers is never surfaced on the usage page.
- **Recommended fix:** Fetch `/api/usage/costs?period=` on `/usage` and render the breakdown + daily chart, or note it as superseded by `/analytics`.

### [M] Billing checkout/portal exist but no UI triggers them, and `/billing` (the upgrade target) is a missing page
- **Backend:** `app/api/billing/checkout/route.js:14` (`POST` → Stripe Checkout URL) and `app/api/billing/portal/route.js:9` (`GET` → portal URL). Quota-exceeded responses link users to `/billing` and `upgrade_url:'/billing'` (`app/lib/usage.js:250`).
- **Frontend:** No FE caller; there's no Subscribe/Upgrade/Manage-billing button and **no `app/billing` page exists**, so the upgrade link is dead.
- **User impact:** When Stripe is configured, a user can't start a subscription or open the billing portal, and the quota-exceeded upgrade path is a broken link. **[VERIFY]** (may be intentionally dormant on free-tier deploys).
- **Recommended fix:** If billing is live, add Subscribe/Manage-billing buttons (gated on `stripe_configured`) and a `/billing` page; otherwise remove the dead `/billing` links.

### [M] Resolve-thread / edit-summary (`PATCH /api/messages/threads`) has no control
- **Backend:** `app/api/messages/threads/route.js:55` — `PATCH` updates a thread's status (open→resolved with `resolved_at`) and summary.
- **Frontend:** No FE PATCHes threads; `ThreadConversation.js` only displays status/summary.
- **User impact:** Users can create and read thread state but can never resolve a thread or add a summary — threads accumulate permanently "open."
- **Recommended fix:** Add a "Resolve thread" toggle and editable summary to the thread header.

### [M] `code_sessions.stuck_loops` and `model_requests` (behavioral/cost signals) are stored but never displayed
- **Backend:** `schema/schema.js:1222-1223` store `stuckLoops`, `modelRequests` per session.
- **Frontend:** Neither the session table nor detail page renders them.
- **User impact:** An operator can't see how many stuck loops the parser detected or how many model requests a session made.
- **Recommended fix:** Surface `stuck_loops` (warning tone when >0) and `model_requests` in the session-detail Summary card.

### [M] Code-session cache-savings / naive-cost figures are stored but never displayed
- **Backend:** `code-sessions.repository.js:376`/`getSessionDetail` return `cache_savings_usd`, `naive_cost_usd`, and naive token columns (`schema/schema.js:1225-1231`).
- **Frontend:** No code-sessions page renders `naive_cost_usd`/`cache_savings_usd` (grep returns zero hits).
- **User impact:** The headline "caching saved you $X vs un-cached" figure — already computed and stored — is invisible; users see cost but not the savings.
- **Recommended fix:** Add a "Cache savings (vs naive)" line to the session Summary and optionally a column on the project sessions table.

### [M] Goal/milestone `cost_estimate` is stored but never shown
- **Backend:** `schema/schema.js:209` (`goals.costEstimate`), `:221` (`milestones.costEstimate`).
- **Frontend:** `app/goals/page.js` renders title/category/status/progress only.
- **User impact:** Per-goal/per-milestone spend attribution is invisible. (Note `/goals` itself is not in the main nav.)
- **Recommended fix:** Show `cost_estimate` next to each goal/milestone when > 0.

---

### [L] Capability edit/new `health_status` dropdown omits runtime-set values
- **Backend:** test/invoke routes write `failing` and `healthy`/`degraded` (`app/api/capabilities/[capabilityId]/test/route.js:96`, `invoke/route.js:296`); POST/PATCH accept any string.
- **Frontend:** `CapabilityBasicsSection.jsx:107` lists only unknown/healthy/degraded/unhealthy — missing `failing`/`untested`, so editing a failing capability mis-renders.
- **User impact:** Manual health-status editing can't select the values the runtime actually sets.
- **Recommended fix:** Either drop manual `health_status` editing (it's runtime-managed) or include the full value set.

### [L] Capability registry health filter omits `failing`/`untested`
- **Backend:** `app/lib/capability-health.js:19` `deriveStatus` emits `failing`, `untested`, `healthy`, `degraded` (+ passthrough `unhealthy`).
- **Frontend:** `CapabilityRegistryFilters.jsx:1` `HEALTH_FILTERS` offers only all/healthy/degraded/unhealthy/unknown, and the list does an exact match — a `failing` capability can't be isolated.
- **User impact:** Failing/untested capabilities hide under "All health" only.
- **Recommended fix:** Add `failing`/`untested` to `HEALTH_FILTERS` and reconcile `unhealthy` vs `failing` naming.

### [L] Capability pricing is stored/used but not editable or shown numerically
- **Backend:** `capabilities.repository.js:51` persists `pricing_json`; `invoke/route.js:259` uses `pricing.estimated_cost_usd` as the recorded action cost.
- **Frontend:** No pricing input in new/edit forms; the registry card shows only a boolean "priced" badge, never the value.
- **User impact:** Users can't set/edit pricing (which drives recorded cost) and the cost figure is never displayed.
- **Recommended fix:** Add a pricing input to the form and display `estimated_cost_usd` on detail/registry views.

### [L] Capability `docs_url` is editable but never linked on the detail view
- **Backend:** `capabilities.repository.js:53` persists/returns `docs_url`.
- **Frontend:** It's a form input (`CapabilityBasicsSection.jsx:131`) but no read view links it.
- **User impact:** A captured documentation URL is unreachable from the dashboard.
- **Recommended fix:** Render `docs_url` as a "View docs" link in `CapabilityFactsCard`/status hero.

### [L] `/api/drift/metrics` (trackable-metric catalog) is an orphan endpoint
- **Backend:** `app/api/drift/metrics/route.js:4-11` — `GET` returns the catalog of trackable drift metric names.
- **Frontend:** No FE fetches it; the drift page offers no metric picker.
- **User impact:** The metric catalog can't drive a filter; users don't know which metrics drift detection covers.
- **Recommended fix:** Consume it to populate a metric filter on `/drift` (pairs with the drift-filter gap), or drop the route.

### [L] Compliance schedule rename (PATCH name) + format/window/flags aren't surfaced
- **Backend:** `app/api/compliance/schedules/[scheduleId]/route.js:4` supports PATCH of `enabled` **and** `name`; `listSchedules` returns window_days/format/include_* flags.
- **Frontend:** `app/compliance/exports/page.js:137` only PATCHes `{enabled}`; no rename, and format/window/flags aren't shown post-creation.
- **User impact:** Users can't rename a schedule or review/adjust its settings without delete+recreate.
- **Recommended fix:** Add inline rename (PATCH `{name}`) and show the schedule's format/window/flags.

### [L] Learning maturity-levels endpoint unused; FE hardcodes the definitions
- **Backend:** `app/api/learning/analytics/maturity/route.js:4` — `GET` returns canonical level thresholds.
- **Frontend:** `app/learning/analytics/page.js` hardcodes the master/expert/…/novice list (~lines 359-365) instead of fetching it.
- **User impact:** If backend thresholds change, the UI silently drifts; the canonical source endpoint is dead.
- **Recommended fix:** Fetch `/maturity` and render the returned levels.

### [L] Learning recommendation-events endpoint not callable from the UI
- **Backend:** `app/api/learning/recommendations/events/route.js:34` — `POST` records lifecycle events (fetched/applied/overridden/outcome).
- **Frontend:** No FE posts events (expected from agents/SDK); there's no operator control to log applied/overridden/outcome. **[VERIFY]**
- **User impact:** Adoption/success-lift metrics depend on these events and can read empty with no UI path to seed them.
- **Recommended fix:** Optionally add "Mark applied/overridden" controls per recommendation row, or document as SDK-only and flag the empty-metrics state.

### [L] Single scoring-profile GET (with dimensions) is never used
- **Backend:** `app/api/scoring/profiles/[profileId]/route.js:8` — `GET` returns one profile incl. dimensions.
- **Frontend:** The page relies on the list endpoint; no profile-detail refresh. **[VERIFY]**
- **User impact:** Minor today; relevant only once a dimension-edit UI is added.
- **Recommended fix:** Call it when a profile-detail/post-edit refresh view is added.

### [L] Scoring calibrate `metrics`/`agent_id` params can't be set from the UI
- **Backend:** `app/api/scoring/calibrate/route.js:18` accepts `metrics` and `agent_id`.
- **Frontend:** The Calibrate form sends only `action_type` + `lookback_days`. **[VERIFY]**
- **User impact:** Users can't scope calibration to an agent or chosen metrics.
- **Recommended fix:** Add optional `agent_id` + a metric multi-select to the form.

### [L] Code-session ingest/parser provenance fields are returned but unsurfaced
- **Backend:** `getSessionDetail`/`listSessions` return `source_file`, `source_mtime`, `parser_version`, `jsonl_records`, `duplicate_fragments_skipped`, plus the `naive_*` token/cost columns.
- **Frontend:** None appear in any code-sessions page.
- **User impact:** Ingest-fidelity diagnostics (records parsed, dup fragments skipped, naive vs deduped cost, parser version) aren't viewable.
- **Recommended fix:** Add a collapsible "Ingest/parser detail" disclosure to the session Summary.

### [L] Code-session sub-resource routes are server-derived duplicates (orphan HTTP routes)
- **Backend:** `/api/code-sessions/subagent-roi`, `.../autopsy`, `.../insights`, `.../optimal-files/merge-preview`, `/manifests/[id]`.
- **Frontend:** The pages are server components that re-derive autopsy/ROI/signals via shared repo helpers, so the data shows but the routes are never fetched; `insights` (repeated-runs) and `merge-preview` have no UI at all. **[VERIFY]**
- **User impact:** Low (data is shown); `insights` repeated-runs and in-UI merge-preview are not reachable.
- **Recommended fix:** Document the routes as SDK/machine aliases, or surface `insights` + a merge-preview affordance.

### [L] `agent_connections.auth_type` and `plan_name` are stored but never displayed
- **Backend:** `connections.repository.js:37` `listConnections` returns `auth_type`, `plan_name`, `metadata`, `reported_at`.
- **Frontend:** `app/integrations/page.js` / `IntegrationsCard.js` read only `provider` + `status`.
- **User impact:** Operators can't tell whether an agent's provider connection is a billed subscription, OAuth grant, or raw API key, nor which plan.
- **Recommended fix:** Render `auth_type` + `plan_name` in the integration card/tooltip.

### [L] `/api/agents` `include_connections` and `debug` params are never used
- **Backend:** `app/api/agents/route.js:17-18` support `?include_connections=true` (per-agent connections) and `?debug=true` (org/heartbeat diagnostics meta).
- **Frontend:** Every caller fetches the bare `/api/agents`.
- **User impact:** The fleet can't show per-agent connections inline, and the heartbeat/org-mismatch diagnostics have no surface.
- **Recommended fix:** Have the fleet page request `?include_connections=true`, and expose `?debug=true` meta on a diagnostics surface.

### [L] Swarm graph node `cost` is computed but never displayed; no `swarm_id` scoping
- **Backend:** `app/api/swarm/graph/route.js:77-84` returns per-node `actions`, `risk`, and `cost` (SUM of cost_estimate); accepts `?swarm_id=`.
- **Frontend:** `app/swarm/page.js` uses `risk` only for ring color and never reads `cost`; always fetches with no `swarm_id`. (The panel also shows invented placeholders — see Notes.)
- **User impact:** Per-agent spend the graph already aggregates is hidden, and multi-swarm scoping is unreachable. (`/swarm` is also not in the nav.)
- **Recommended fix:** Show `cost` in the selected-agent panel and add a swarm selector passing `swarm_id`.

### [L] Knowledge item status enum mismatch (success label may not line up)
- **Backend:** Items default to `pending` and are updated by `syncCollection`; the FE expects `indexed`.
- **Frontend:** `app/knowledge/[collectionId]/page.js:11` `statusVariant` maps only `pending`/`indexed`/`failed`; other ingest states fall through to a generic badge. **[VERIFY]** (didn't enumerate every status `knowledge-ingest.js` writes).
- **User impact:** Item-level ingestion states may render with a generic/incorrect badge (cosmetic).
- **Recommended fix:** Confirm the exact statuses written and complete `statusVariant` (align `indexed` vs `synced`).

### [L] Knowledge collection list ignores `created_at`/`updated_at`
- **Backend:** `shapeCollection` (`knowledge.repository.js:19`) returns created_at/updated_at/org_id.
- **Frontend:** The card renders name/description/source_type/status/doc_count/last_synced/tags but no created/updated.
- **User impact:** Users can't see when a collection was created or last modified (informational).
- **Recommended fix:** Optionally surface created/updated timestamps.

### [L] `setup/proof` verification score + per-check breakdown aren't rendered (download-only)
- **Backend:** `app/api/setup/proof/route.js:25` returns a `proofArtifact` with `summary {passed, failed, skipped, score}` + `checks`; `setup/ping` mints the same.
- **Frontend:** `app/settings/page.js:69`/ProofPanel use proof only as a download link; the structured contents are never shown inline. **[VERIFY]**
- **User impact:** Users can only download an opaque proof JSON; the readable score + per-check pass/fail isn't surfaced.
- **Recommended fix:** Render `proofArtifact.summary` + check list inline in ProofPanel.

### [L] Workflow per-step resume (`from_step`) is not exposed
- **Backend:** `.../resume/route.js:56` supports resuming from a specific step id.
- **Frontend:** The Resume button always POSTs an empty body (resumes from first non-completed step).
- **User impact:** Users can't resume a failed run from a chosen step.
- **Recommended fix:** Offer a per-step "resume from here" affordance on the run timeline.

### [L] Drift `drift_type`, `dimension`, and acknowledgement attribution are stored but not shown
- **Backend:** `schema/schema.js:740,716,751-752` — `drift_alerts.driftType`, `dimension`, `acknowledgedBy`, `acknowledgedAt`; baselines store p5/p25/p75/p95/median.
- **Frontend:** `app/drift/page.js` shows severity/metric/z_score/etc. but never drift_type, dimension, who/when acknowledged, or baseline percentiles.
- **User impact:** Operators can't tell the *kind* of drift (shift vs spread), which dimension drifted, or who acknowledged an alert.
- **Recommended fix:** Add `drift_type`/`dimension` badges, show ack attribution, and optionally baseline percentiles.

### [L] `contacts.opportunity_type` is stored but never displayed
- **Backend:** `schema/schema.js:270` — `contacts.opportunityType`.
- **Frontend:** `app/relationships/page.js` renders other contact fields but not `opportunity_type` (nor in the Add-Contact form). (`/relationships` is a non-core CRM surface, not in nav.)
- **User impact:** A contact categorization field is captured but invisible/un-editable.
- **Recommended fix:** Show it as a badge and add it to the Add-Contact form.

### [L] Outcome-sweep job (`lost_confirmation` finality) has no operator surface
- **Backend:** `app/api/cron/outcome-sweep/route.js` sets `lost_confirmation` on timed-out actions; the value is shown per-row via `OutcomeBadge` and is filterable.
- **Frontend:** No indication of *when/whether* the sweep ran or how many actions it swept.
- **User impact:** A stuck/disabled durable-finality sweep is undetectable from the UI (per-row badge still works).
- **Recommended fix:** Add a small "outcome sweep" indicator (last-run time / count in window) to Mission Control.

---

## Partially Wired
*(Endpoint IS called, but part of the response is ignored.)*

### [M] Capability health-summary detail fields fetched but not displayed
- **Backend:** `app/lib/capability-health.js:197` `GET /api/capabilities/{id}/health` returns `last_success_at`, `last_failure_at`, `total/successful/failed_invocations`, `pending_approvals`, `last_test_duration_ms`, `last_test_summary`, `recent_errors[]`.
- **Frontend:** The detail page feeds health into `CapabilityHealthCards` (success rates, p95, stale) only; none of the invocation counts, last success/failure, pending approvals, or recent errors render.
- **User impact:** Diagnostic data the API already computes (invocation volume, last failure, pending approvals, recent error messages) is invisible on the capability detail page.
- **Recommended fix:** Extend the health cards with invocation counts, last success/failure, pending approvals, and a recent-errors list.

### [M] Recommendation metrics response largely ignored (outcomes + most deltas dropped)
- **Backend:** `app/api/learning/recommendations/metrics/route.js:19` returns per-rec `outcomes.applied` vs `outcomes.baseline` and full `deltas` (success_lift, failure_reduction, latency_delta_ms, cost_delta_estimate).
- **Frontend:** `app/learning/page.js:482-495` renders only `adoption_rate` + `deltas.success_lift`; it ignores `outcomes.*` and `failure_reduction`/`latency_delta_ms`/`cost_delta_estimate`.
- **User impact:** The most decision-relevant evidence (latency/cost change, failure reduction, applied-vs-baseline) is fetched but never displayed.
- **Recommended fix:** Expand the per-recommendation row to show outcomes.applied vs baseline and the full deltas set.

### [M] Evidence-bundle generation discards the returned bundle
- **Backend:** `app/api/artifacts/evidence-bundle/route.js:9` — `POST` returns the full assembled bundle (`action`, `steps[]`, `artifacts[]`, `generated_at`).
- **Frontend:** `ArtifactsTab.jsx:72` POSTs then ignores the response (just refetches the list) and swallows errors (`catch {}`).
- **User impact:** The inline evidence summary the endpoint returns is lost; the user gets no confirmation beyond a new collapsed row, and failures show nothing.
- **Recommended fix:** Render the returned bundle (or a success toast + step/artifact counts) and surface errors.

### [M] Workflow run-detail page never refreshes — running runs appear frozen
- **Backend:** `.../runs/[runActionId]/route.js:9` — `GET` returns live `status`, `steps[]`, `steps_completed`.
- **Frontend:** `app/workflows/[templateId]/runs/[runActionId]/page.jsx:18` fetches once in `useEffect` with no polling. **[VERIFY]**
- **User impact:** While a workflow executes (up to 120s), the page shows a static snapshot; status/steps don't advance without a manual reload.
- **Recommended fix:** Poll the run GET while `status === 'running'` (stop on terminal), or add a Refresh button.

### [M] Workflow runs filters (status/agent_id) and `total` are ignored
- **Backend:** `.../runs/route.js:16` — `GET` accepts `status`/`agent_id` and returns `{runs, total}`.
- **Frontend:** The Runs tab fetches `?limit=10` with no filters and ignores `total`.
- **User impact:** Users can't filter a template's runs by status/agent or tell that more than 10 exist.
- **Recommended fix:** Surface `total` ("10 of N") and add status/agent filter controls.

### [L] Cost-alert metadata returned by the action PATCH is dropped
- **Backend:** `app/api/actions/[actionId]/route.js:229` — `PATCH` returns `cost_alert {threshold, severity}` when an action trips the cost threshold.
- **Frontend:** No FE reads the PATCH response (it's an SDK/hook surface); the in-app decision views show no cost-alert badge. **[VERIFY]**
- **User impact:** A cost-threshold breach has no in-app confirmation on the decision record (only reaches users via webhooks).
- **Recommended fix:** Surface cost-threshold breaches on the decision detail (e.g. a "Cost alert" badge driven by a stored signal).

### [L] Recommendation `scored_episode` (single-action scoring) is discarded
- **Backend:** `app/api/learning/recommendations/route.js:160` — `POST` accepts `action_id` and returns `scored_episode` + `episodes_scanned`.
- **Frontend:** `handleRebuildRecommendations` posts only `{lookback_days, min_samples}` and reads only counts. **[VERIFY]**
- **User impact:** Scoring/inspecting a single action's learning episode is unreachable, and `scored_episode` is dropped (bulk rebuild still works).
- **Recommended fix:** Add an `action_id` input and surface `scored_episode`, or leave bulk-only.

### [L] Recommendation telemetry funnel (fetched/applied/overridden/outcomes) collapsed to one number
- **Backend:** events route tracks `fetched/applied/overridden/outcome`; metrics expose each count.
- **Frontend:** `app/learning/page.js` rows show only `adoption_rate` + `success_lift`. **[VERIFY]**
- **User impact:** Users can't see how often a recommendation was fetched vs applied vs overridden vs produced an outcome.
- **Recommended fix:** Show the funnel counts per recommendation in a detail popover.

### [L] Prompt stats `by_version` breakdown is fetched but never rendered
- **Backend:** `app/lib/prompt.js:282` `getPromptStats` returns `by_version` (per-version usage).
- **Frontend:** `app/prompts/page.js` renders `overall` + `by_template` but not `by_version`.
- **User impact:** Users can't see which prompt *version* is actually used — undercutting the versioning feature.
- **Recommended fix:** Add a "Usage by version" card iterating `stats.by_version`.

### [L] Prompt runs list can't be filtered by template/version
- **Backend:** `app/api/prompts/runs/route.js:14` accepts `template_id`/`version_id`.
- **Frontend:** `app/prompts/page.js:57` fetches `?limit=30` only, even when a template is selected.
- **User impact:** Users can't scope the runs log to the template/version they're inspecting.
- **Recommended fix:** Pass `template_id` when a template is selected, or add filter controls.

### [L] Score Explorer hides `raw_value` and `weight` per dimension score
- **Backend:** `app/lib/scoringProfiles.js:304-307` persists each dimension score's `raw_value` and `weight`.
- **Frontend:** `app/scoring/page.js:363-391` renders composite + dimension name/score/label only.
- **User impact:** Users can't see the raw measured value or weight behind each dimension score.
- **Recommended fix:** Show `raw_value`/`weight` in the dimension breakdown.

### [L] `messages/threads/[threadId]` GET is used only by the decisions page
- **Backend:** `app/api/messages/threads/[threadId]/route.js:9` — single-thread GET.
- **Frontend:** Only `app/decisions/[actionId]/page.js:73` fetches it; the Messages page filters from its list. **[VERIFY]**
- **User impact:** Negligible (noted for completeness).
- **Recommended fix:** None required.

---

## Notes

**Stale frontend (FE calls dead/mismatched endpoints — real bugs, separate from this audit's "missing UI" scope):**
- `app/workspace/page.js:560` (HandoffsTab) calls `GET /api/handoffs`, but `app/api/handoffs/route.js` only exports **POST** (GETs are `/latest` and `/[id]`). The request 405s, so the Handoffs tab always renders empty; it also reads fields (`key_decisions`, `open_tasks`, `next_priorities`, `mood_notes`) that don't match the stored bundle shape. **Human decision:** add a `GET /api/handoffs` list endpoint or repoint the tab at `/latest`.
- `app/routing/page.js` calls `/api/routing/*`, but the entire routing API is archived under `app/api/_archive/routing/**`. The `/routing` page is dead. **[VERIFY]**
- `/feedback` is a Labs nav item (`Sidebar.js:59`) but its backend lives under `app/api/_archive/feedback/**` — the page targets an archived endpoint.
- FE literally calls `/api/actions/assumptions/<id>` and `/api/actions/signals` (e.g. `app/actions/[actionId]/page.js:114`, `app/security/page.js:99`); these resolve only via `next.config.js` rewrites to `/api/assumptions` and `/api/signals`. There is no such directory under `app/api/actions/` — if a rewrite is removed, those calls 404.
- Demo fixtures reference non-existent routes: `app/lib/demo/fixtures/persona-agents.js:76` → `/api/agents/pair` (actual: `/api/pairings`); `:176` → `/api/workflows/run` (no such route); `app/lib/org.js:33` → `workflows/templates/execute` in prose. Stale demo prose, worth cleanup.

**Inverse gap — UI shows invented data the backend never produces (misleading):**
- The swarm selected-agent panel hardcodes "Stability 99.8%", "Sync Latency 12ms", "Drift State Nominal", and an "AGENT_CLASS_V2" badge (`app/swarm/page.js:749-815`).
- Decision-replay "Drift Detection" cards show a hardcoded "0.02 (Nominal)" instead of the real computed `drift_score` (see the assumption-drift gap). These can mislead operators into thinking drift is monitored when the displayed number is static.

**Discoverability (information-architecture, adjacent to sync gaps):** Functional pages exist but are absent from the sidebar nav, so several of the gaps above are *double*-hidden: `/scoring` (reached only via the unlabeled `/quality`→`/scoring` redirect), `/evaluations`, `/swarm`, `/relationships`, `/team`, `/tokens`, `/usage`, `/notifications`, `/downloads`, `/goals`, and the never-built `/secrets`/`/skills`/`/doctor`/`/billing`. The main `/compliance` control-map page is also one indirect hop from nav (the nav "Compliance" item points at `/compliance/exports`).

**Machine-facing endpoints (legitimately UI-less for end users — not counted as gaps):** all 12 `/api/cron/*` schedulers; `/api/oauth/*` (OIDC/MCP); `/api/mcp`, `/api/discord/interactions`, `/api/telegram/webhook`, `/api/webhooks/stripe`, `/api/marketing/event`; `/api/integrity/jwks`; `/api/agents/heartbeat`, `/api/stream` (SSE, correctly wired); `/api/code-sessions/ingest-jsonl|ingest-live`; `/api/handoffs/*` consume flow; `/api/setup/migrate`, `/api/setup/live-proof` (the live-proof *mint* button is flagged L above); `/api/health`. `POST /api/evaluations` (single score) is intentionally SDK-only per its own empty-state copy.

**Inventory/contract gap:** `app/api/oauth/*` routes exist on disk but do **not** appear in `docs/api-inventory.md` (which lists 261 routes, none under `/api/oauth/`) — the inventory generator appears to miss them. Separately, an automated background security review during this session flagged two pre-existing issues in those files (CSRF on the OAuth consent POST in `app/api/oauth/authorize/route.js`; Host-header injection in `app/api/oauth/metadata/authorization-server/route.js`). Both are unrelated to this audit and untouched — flagged here for a separate security pass.

**Ambiguities / human decisions:**
- Several code-sessions read routes (`/sessions/:id`, `/autopsy`, `/insights`, `/subagent-roi`) have **no browser consumer** because the pages are server components calling the repo helpers directly. Decide whether to keep them as SDK aliases or have the pages fetch them (single source of truth).
- `app/api/keys` POST returns a `storageWarning` the FE ignores (it hardcodes its own copy) — cosmetic.
- The two pairing-approval paths differ (`PATCH /api/pairings/{id}` from `/identities` vs `POST /api/pairings/{id}/approve` from Settings); the PATCH path skips the explicit expiry/409 guards. Worth a consistency glance.

**Audit method / confidence caveat:** Findings come from 14 subagents reading actual source. The cross-cut orphan/schema/enum sweeps deliberately overlap the domain sweeps for recall; duplicates were merged here. One workflow run (12 of the scopes) was re-run after an initial parallel-overload failure, so those scopes reflect a second pass. Items tagged **[VERIFY]** are where an agent could not fully confirm intent (e.g. SDK-only-by-design vs genuine gap) — treat them as leads, not verdicts.
