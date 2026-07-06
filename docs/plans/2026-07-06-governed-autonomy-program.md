# Governed Autonomy Program — build plan for three features

> **For the executing session:** each feature has a full RFC in `docs/rfcs/`. Read the RFC first, then derive your own task-level TDD plan against the THEN-CURRENT code using superpowers:writing-plans — do not treat this file as the plan. This file owns sequencing, gates, and coordination.

**Date:** 2026-07-06 · **Author:** principal-engineer session (feature exploration → top-3 selection, approved by Wes)

**Goal:** make long-horizon and multi-agent autonomy governable without drowning the one human operator — by amortizing approvals (plans), bounding subagent authority (delegation), and converting risk into reversibility (containment).

| # | Feature | RFC | New tables | Guard seam | Risk |
|---|---------|-----|-----------|------------|------|
| 1 | Preflight Plan Authorization | `docs/rfcs/2026-07-06-preflight-plan-authorization.md` | 2 | new grant post-pass after `applyOperatorApprovalGrant` | Medium |
| 2 | Scoped Delegation Constraints | `docs/rfcs/2026-07-06-scoped-delegation-grants.md` | 0 | 18th policy type in `POLICY_EVALUATOR_MAP` | Low-Medium |
| 3 | Containment Verdicts | `docs/rfcs/2026-07-06-containment-verdicts.md` | 0 (columns + 1 route) | new severity rung + capability negotiation + hook mechanics | High |

## Build order and why

**1 → 2 → 3, one feature per session, shipped independently.** Never build two concurrently — all three touch `app/lib/guard/evaluate.ts` and the approvals surface.

1. **Preflight first:** highest leverage-to-complexity; pure server + SDK/MCP + one approval card; generalizes proven grant machinery; produces the plan/step data model later trajectory work builds on.
2. **Delegation second:** smallest footprint (no migration — it's a policy type), independent of v8.2, immediately valuable to every Claude Code fleet already emitting composed identities.
3. **Containment last:** biggest swing, highest blast radius (severity-ladder edit + hook mechanics). It wants (a) the approvals surface patterns from feature 1 already landed, and (b) **owner-roadmap v8.2 (enforcement liveness) shipped** — do not build containment on an unproven hook seam (v4.72.1 lesson).

## HARD GATES — check before starting ANY feature

1. **Calibration controller must be landed.** As of this writing it is uncommitted WIP in another session's working tree (`app/lib/guard/calibration.ts`, `drizzle/0059_calibration_controller.sql`, edits to `evaluate.ts`/`caches.ts`/approvals routes). Verify: `git log --oneline -10` shows it merged AND `git status` shows a clean `app/lib/guard/`. If not landed, STOP and coordinate with Wes — do not build on top of, around, or underneath it.
2. **No other active session in the repo.** `git status` must show no unexpected modified files in `app/`. If parallel work is unavoidable, use scope-lock.
3. **Known WIP gap to flag, not fix silently:** the calibration files cite `docs/architecture/governance-core-theory.md`, which does not exist in the repo. If it still doesn't exist when you start, tell Wes; the RFCs here deliberately do not depend on it.
4. **Migration numbers:** `0059` is claimed by calibration. Always take the next free number at build time; never renumber existing files.
5. **Before feature 3 only:** confirm v8.2 enforcement-liveness has shipped (check `docs/plans/owner-roadmap.md` status ledger). If it hasn't, build features 1–2 and hold 3.

## Shared conventions every feature must honor

(Auto-loaded via CLAUDE.md/MEMORY.md, restated because all three features sit on the guard hot path.)

- GitNexus `impact` before editing any symbol in `evaluate.ts`/`policy.ts`; warn on HIGH/CRITICAL; `detect_changes()` before committing.
- All SQL through `app/lib/repositories/*` — `route-sql:check` gates it.
- Guard-cache tests need `__resetGuardCaches()`; settings keys go through `VALID_SETTING_KEYS`.
- Risk scores are 0–100. `guard_decisions.created_at` is TEXT on fresh schemas — `::timestamptz` in any SQL touching it; local DB is legacy-shaped, "works locally" proves nothing for fresh installs.
- `block` is never downgraded, by anything, ever. Grants only downgrade `require_approval` → `allow`. New logic may only RAISE (tighten-only charter).
- UI: read `.impeccable.md` first; tokens only, never hex; every human step is a click (HUMAN-EXPERIENCE.md's four questions answered in the ship summary).
- Docs/counts drift: grep and update every cited count (routes, SDK methods, MCP tools, policy types) in the same commit; `scripts/check-doc-counts.mjs --strict` before commit.
- Ship gate per feature: `npm run lint` && `npx vitest run` (FULL suite) && `npx next build` && `npm run typecheck`, policy-smoke additions live-proven, frontend-verify on touched pages, then the `dashclaw-ship` skill (version bump, docs realignment, marketing blurb, release).

## Program-level definition of done

- Three independent ships, each with: green gates, live policy-smoke proof, rendered UI proof, docs/counts aligned, marketing updated, CHANGELOG + maintainer-log + GitHub Release (MAINTAINER.md).
- SDK publishes (`npm run release:sdks`) remain Wes's credential-gated tail — flag, never attempt.
- After feature 3: update `docs/architecture/enforcement-boundary.md` (containment paragraph) and propose a one-line roadmap entry so the program is reflected in the owner roadmap ledger.

---

## Kickoff prompts (paste one into a fresh session; run in order; one per session)

### Session 1 — Preflight Plan Authorization

```
Build Preflight Plan Authorization end to end, per the spec in
docs/rfcs/2026-07-06-preflight-plan-authorization.md.

Before anything else, run the HARD GATES in
docs/plans/2026-07-06-governed-autonomy-program.md (calibration controller
landed, clean app/ working tree, migration numbering). Stop and tell me if
any gate fails.

Then: read the RFC in full, read the current applyOperatorApprovalGrant and
the approvals routes (the calibration controller has modified them since the
RFC was written — reconcile against live code, the RFC's invariants win over
its incidental details), run GitNexus impact on evaluateGuard, and use the
superpowers:writing-plans skill to produce your task-level TDD plan. Execute
it with subagent-driven development where tasks are independent. Resolve the
RFC's "Open questions" section against real code — never by guessing.

Definition of done: every verification gate in the RFC green (full vitest,
lint, build, typecheck, db:migrate idempotent, check-doc-counts --strict,
policy-smoke plan section passing live, frontend-verify on /approvals,
/mission-control, /decisions), HUMAN-EXPERIENCE four questions answered in
the ship summary, then run the dashclaw-ship skill to land it on main and
live. Flag the credential-gated SDK publish as my tail; don't attempt it.
```

### Session 2 — Scoped Delegation Constraints

```
Build Scoped Delegation Constraints end to end, per the spec in
docs/rfcs/2026-07-06-scoped-delegation-grants.md.

Before anything else, run the HARD GATES in
docs/plans/2026-07-06-governed-autonomy-program.md, and additionally verify
Preflight Plan Authorization (session 1 of this program) shipped — check the
CHANGELOG. Stop and tell me if any gate fails.

Then: read the RFC in full, read the live POLICY_EVALUATOR_MAP and the
protected_path evaluator (you MUST reuse its path/glob matching — the RFC
forbids a second matcher), read docs/rfcs/2026-06-01-subagent-fleet-identities.md
for the composed-identity contract, run GitNexus impact on runLocalPolicies,
and use superpowers:writing-plans to produce your task-level TDD plan.
Resolve the RFC's risk-ceiling ordering question (option a vs b) against
real code and document the choice in-line.

Remember the headline economy: NO new tables, NO new routes — if your plan
grows either, you've drifted from the design; stop and re-read the RFC.

Definition of done: every verification gate in the RFC green (including the
policy-type count 17→18 updated everywhere check-doc-counts sees),
frontend-verify on /agents/[agentId] and /policies, HUMAN-EXPERIENCE answers
in the ship summary, then dashclaw-ship. SDK publish is my tail.
```

### Session 3 — Containment Verdicts

```
Build Containment Verdicts (allow_contained) end to end, per the spec in
docs/rfcs/2026-07-06-containment-verdicts.md.

Before anything else, run the HARD GATES in
docs/plans/2026-07-06-governed-autonomy-program.md — INCLUDING the
feature-3-specific gate: owner-roadmap v8.2 (enforcement liveness) must be
shipped, and program sessions 1–2 must be on main. Stop and tell me if any
gate fails.

Then: read the RFC in full. Two mandatory verifications before planning:
(1) dispatch a claude-code-guide subagent to confirm whether the installed
Claude Code supports PreToolUse hookSpecificOutput.updatedInput and its
exact schema — the hook strategy choice hangs on this; (2) run GitNexus
impact on sevOf, raiseDecision, DECISION_SEVERITY, and buildGuardResult,
and grep every consumer of the decision-string quartet (SDKs, all three
hook copies, OpenClaw plugin, MCP server, UI badges, OpenAPI, docs) — the
severity-ladder edit is the highest-blast-radius change in this program and
your plan must enumerate every consumer it updates.

The two non-negotiables while planning: capability negotiation means old
clients ALWAYS get require_approval in place of allow_contained (version
skew may only tighten), and the server-side eligibility check means only
provably file-scoped acts in a git repo are ever contained — HTTP, SQL,
payments, deploys stay on the approval rail no matter what any policy says.

Use superpowers:writing-plans for the task plan. Definition of done: every
RFC gate green, the live end-to-end proof (a real enforce-mode Claude Code
session performs a contained edit, the diff renders in /approvals, Promote
lands it via the governed merge), frontend-verify on the Containment tab,
/decisions, and /replay, enforcement-boundary.md updated, HUMAN-EXPERIENCE
answers in the ship summary, then dashclaw-ship. SDK publish is my tail.
```
