# Posture Score Plan — Re-baseline Audit (2026-06-12)

**Baseline:** `main` @ `40ad56f0` (v4.17.1).
**Supersedes:** `docs/superpowers/plans/2026-06-05-governance-posture-score.md` (Tasks 8–20) and `docs/superpowers/2026-06-06-posture-score-PROGRESS.md`.
**Spec (still authoritative for design):** `docs/superpowers/specs/2026-06-05-governance-posture-score-design.md`.

**Method:** four read-only Explore agents audited task clusters (8–12, 13–15, 16–17, 18–20) for disposition + functional evidence (named passing test or traced live call path; file existence alone = PARTIAL). Every SHIPPED claim then went through an adversarial verifier prompted to refute (verifiers read the cited lines, ran the cited tests, and traced wiring). 12/13 SHIPPED claims were upheld; 1 was refuted and downgraded.

## Audit table — Tasks 8–20

| Task | Title | Disposition | Evidence (file:line) | Functional evidence | Refute pass |
|------|-------|-------------|----------------------|---------------------|-------------|
| 8 | Migration + schema (`posture_findings_state`, `posture_snapshots`) | **SHIPPED** | `drizzle/0022_posture.sql:1-23`; `schema/schema.js:1468-1492` | `__tests__/unit/posture.repository.test.ts` — `insertPostureSnapshot` (:307), `listPostureSnapshots` (:329); numeric-as-string coercion asserted :308-314. Verifier ran the file: 23/23 pass. | UPHELD |
| 9 | Finding-state repo + merge onto derived findings | **SHIPPED** | `app/lib/repositories/posture.repository.ts:284-410`; `app/lib/posture/signals.ts:288-298` (`applyFindingStates`), live-wired at :335/:367 | `posture.repository.test.ts` :258/:277/:288; `posture-signals.test.ts:56-60` ("carries a stored snooze forward so the finding is no longer open"). Verifier ran both files: 32/32 pass. | UPHELD |
| 10 | `GET /api/posture/findings` (filters + queue) | **SHIPPED** | `app/api/posture/findings/route.ts:30-86` (status/dimension filters, actionable default queue, riskAccepted ledger, counts) | `__tests__/unit/api-posture-findings.test.ts` — 12/12 pass (default queue, filters, counts, 400s, route-sql guardrail) | UPHELD |
| 11 | `POST /api/posture/findings/[key]/resolve` + **honesty property** | **SHIPPED** | `app/api/posture/findings/[key]/resolve/route.ts:88-95` (insert `active: 0`, state `drafted` not `resolved`), honesty note :114 | `api-posture-resolve.test.ts:68-91` (INACTIVE policy, `drafted` NOT `resolved`, honesty note); `posture-page.test.tsx:108-126` (UI honesty). Verifier additionally traced the engine: replay map built only from `getActivePolicies` (`guardrails.repository.ts:66-73`, `WHERE active = 1`) — drafts cannot move the score. 17/17 pass. | UPHELD |
| 12 | `POST /api/posture/scan` (snapshot write) | **SHIPPED** | `app/api/posture/scan/route.ts:19-40` | `api-posture-scan.test.ts:63-70` (`insertPostureSnapshot` called once, computed score + dimensions); 4/4 pass; route→repo→schema traced | UPHELD |
| 13 | `/posture` page shell + data load | **SHIPPED** | `app/posture/page.tsx:392-418` (Promise.all fetch of `/api/posture` + `/api/posture/findings`); ScoreHero :114-160 | `posture-page.test.tsx` "renders the score hero" (:66-71) passes; full path traced page→fetch→route→`computePosturePayload` | UPHELD |
| 14 | Dimension row (six cards, attention treatment) | **SHIPPED** | `app/posture/page.tsx:166-200`; `ATTENTION_THRESHOLD=70` at :54; render site :496 | `posture-page.test.tsx` — six-cards test (:73-81) + "flags only weak dimensions" (:83-92); verifier ran: 2/2 pass | UPHELD |
| 15 | Next queue + resolve flow (UI honesty) | **SHIPPED** | `app/posture/page.tsx:206-254` (FindingRow), :261-358 (ResolvePanel), :364-386 (RiskAcceptedLedger), :432-448 (resolve callback) | 5 named tests across `posture-page.test.tsx`, `api-posture-findings.test.ts`, `api-posture-resolve.test.ts`; verifier ran the three files: 29/29 pass; end-to-end path traced | UPHELD |
| 16 | CLI: `dashclaw posture` / `next` / `posture resolve` (draft-only) | **SHIPPED** | `cli/lib/posture.js:13-45` (draft-only guard); `cli/bin/dashclaw.js:1097-1156`, command table :1267/:1269 | `cli/test/posture.test.js` — 6/6 pass under `node --test`, incl. rejection of non-draft `activate` action before any network call | UPHELD |
| 17 | MCP: `dashclaw_posture` + `dashclaw_posture_next` (read-only) | **SHIPPED** | `mcp-server/src/tools.ts:498-521` (defs), :981-1004 (handlers); compiled `lib/tools.js:446,461,906,923`; **no** posture resolve tool exists (architectural absence = stricter than draft-only) | `__tests__/unit/mcp-tools.test.js` posture tests (4/4 pass — asserts POST/PATCH never called); `mcp-route.test.js:65` (tools/list) | UPHELD |
| 18 | Derived artifacts (OpenAPI + api-inventory + livingcode) | **SHIPPED** | `mcp-server/lib/routes-inventory.generated.json` (all 4 posture routes); `docs/api-inventory.md:257-260`; `package.json:29-32` | Verifier ran `npm run openapi:check` + `npm run api:inventory:check` — both exit 0. Posture absent from `docs/openapi/critical-stable.openapi.json` **by design** (stable-only spec; posture routes are `experimental`). | UPHELD |
| 19 | Hand-authored docs | **SHIPPED** | `sdk/README.md:648,662`; `sdk-python/README.md:18`; `docs/sdk-parity.md:153`; `docs/api-inventory.md:257-260`; `PROJECT_DETAILS.md:65,141`; `app/docs/page.tsx:206-210,2541-2611` | Verifier ran `api:inventory:check` + `node scripts/check-doc-counts.mjs --strict` — pass (MCP tool count 32 verified) | UPHELD |
| 20 | Version bump + release | **PARTIAL** | `package.json:3`, `sdk/package.json:3`, `sdk-python/pyproject.toml:7` all 4.17.1; `version:sync:check` passes live | Bump+sync half verified live by the refuting verifier. **Refuted as SHIPPED:** `npm run release:sdks` never ran for 4.17.1 — npm `dashclaw` = 4.11.0, PyPI `dashclaw` = 4.11.0 vs repo 4.17.1. | **REFUTED → PARTIAL** |

## Executable backlog (PARTIAL/MISSING only)

**Zero code backlog.** The only PARTIAL item is dispositioned below; no posture code, test, page, CLI, or MCP work remains from Tasks 8–20.

### Task 20 (release tail) — DESCOPED→ABSORBED into this run's Phase 3 ship

- **Spec ref:** plan Phase 5 / Task 20 (release process; no spec § — §4–§7 are fully shipped above).
- **Reason:** Task 20 is a per-release recurring item, not a one-time gap. The version bump + sync half re-runs as part of this run's Phase 3 `dashclaw-ship` release (next minor) and again at Phase 7. The unfinished half — `npm run release:sdks` — is **credential-gated and owner-owed** (standing item; SDK source must also have changed for a republish per the conditional-publish policy of 2026-06-08). An autonomous run cannot complete it; it stays on the owner's standing list rather than this backlog.
- **Failing-test-first:** N/A (release process, not code). Verification instead: `npm run version:sync:check` green at ship; `npm view dashclaw version` / PyPI check after the owner publishes.
- **Gates:** `npm run lint` · `npm run typecheck` · `npx vitest run` · `npx next build` · `npm run route-sql:check` · `node scripts/check-doc-counts.mjs --strict` · `npm run version:sync:check` (all run at Phase 3 ship).

## Honesty property status (plan Tasks 11/15 invariant)

Verified in three layers, all with passing tests: API (`api-posture-resolve.test.ts` — draft is `active: 0`, state `drafted`), UI (`posture-page.test.tsx:108-126` — on-page score unchanged after Create draft), and engine (replay map built exclusively from `WHERE active = 1` policies, so a draft cannot change coverage). Drafting a policy never raises the score.

## Disposition ledger (updated per run phase)

| Task | Final state |
|------|-------------|
| 8–19 | DONE (shipped pre-run; functionally verified 2026-06-12, commits in 4.x history) |
| 20 | DESCOPED→ABSORBED into Phase 3 ship of the 2026-06-12 run (publish tail owner-owed) |
