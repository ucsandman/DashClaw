# Governance Core Theory

**Status:** Accepted 2026-07-06 · **Author:** Claude (maintainer), under the MAINTAINER.md delegation
**Companions:** `enforcement-boundary.md`, `trust-and-failure-model.md`, `durable-execution-finality.md`, `runtime-api.md`
**Implemented component:** the calibrated interruption controller (§1) — `app/lib/guard/calibration.ts`, shipped shadow-mode-first, default off.

This document rebuilds the theory under DashClaw's governance runtime so its
guarantees are provable rather than heuristic, section by section. Each section
states definitions, the exact guarantee a construction buys, a proof sketch,
complexity, failure modes, and — where the mapping is a stretch — says so
plainly. §1 is implemented; §§2–7 are design with explicit verdicts on what is
worth building and when.

---

## 0. Ground truth: what the code actually does

Everything below is grounded in the code as of this commit. Four places where
the code corrects the natural framing of the problem:

1. **There is no numeric score→decision band in the engine.** Decisions come
   entirely from policies. The only score-driven decision surface is the
   `risk_threshold` policy type (`app/lib/guard/policy.ts:460-469`): score ≥
   `rules.threshold` (default 80) → `rules.action` (default `block`). The
   40/70 "bands" in `app/lib/riskThresholds.ts` are UI coloring only.
2. **The scope hierarchy is two levels, not a deep tree.** Policies are scoped
   by `org_id` and optionally by `agent_ids` (with composed sub-agent ids
   folding into their base identity family, `app/lib/guard/caches.ts:123-144`).
   There is no workspace or session scope. "Policy modes" are compile-time
   macros that expand into ordinary policies (`app/lib/policy-modes/compile.ts`);
   the evaluator never reads the `_mode` tag.
3. **Decision composition is already a join-semilattice.** `DECISION_SEVERITY =
   {allow:0, warn:1, allow_contained:2, require_approval:3, block:4}` with
   `raiseDecision` as join (`app/lib/guard/internal.ts:6-10`,
   `app/lib/guard/evaluate.ts:102-104`). `allow_contained` (added v5.6,
   `docs/rfcs/2026-07-06-containment-verdicts.md`) is a capability-negotiated
   fifth element between `warn` and `require_approval`; it does not change the
   downgrade analysis below. Exactly two sanctioned downgrades exist —
   `allow_grant` and the single-use operator-approval grant — and both are
   structurally unable to touch `block` (`evaluate.ts:271`, `evaluate.ts:331`).
4. **The feedback stream for calibration already exists.** Every
   `require_approval` interruption resolves to `approved` (status `running`,
   `approved_by` stamped), `denied` (status `failed`), or `expired` (no human
   verdict) — `app/api/approvals/[actionId]/route.ts`,
   `app/lib/repositories/actions.repository.ts:104-125` — and
   `action_records.guard_decision_id` links each verdict back to the scored
   decision. Two human-ratified adaptation rails already consume this stream
   heuristically: the tuning engine (`app/lib/policy-tuning/engine.ts`,
   `raise_risk_threshold` at override rate ≥ 0.9) and the loosening engine
   (`app/lib/posture/loosening.ts`, carve-out/deactivate at ≥ 0.95). Neither
   carries a statistical guarantee; nothing in the system adapts automatically.

The risk pipeline (`app/lib/guard/risk.ts`): server heuristic (action-type base
+ additive modifiers) folded via **max** with the org risk-template score, the
client-declared score, and the evidence-derived score, then a predictive
adjustment, clamped to [0,100]. The max-fold is a *floor*, not fact-checking
(trust-model D1) — inputs are attestations from an authenticated caller.

---

## 1. Calibrated interruption — the core problem, and the implemented piece

### 1.1 The problem, stated exactly

DashClaw's central failure mode is the *precision of interruption*: a false
block teaches operators to switch governance off; a missed dangerous action
defeats the point. Today the interruption boundary is a hand-set constant
(`threshold: 80`) plus hand-ratified proposal heuristics. Nothing guarantees
any error rate, under any assumption.

We want: an operator sets a target error rate α; the system holds it,
**distribution-free** (agent behavior is nonstationary and adversarially
weird), **online** (it must hold under drift, not just on a held-out set), with
**anytime-valid escalation** (an alarm the operator can watch continuously
without inflating false alarms), and **honestly under selective labeling** —
the label "was this interruption correct?" is only observed when (a) the
system interrupted and (b) a human adjudicated.

### 1.2 Definitions

- **Score** `s_t ∈ [0,100]`: the persisted effective risk of an action
  (`guard_decisions.risk_score`).
- **Adjudication stream**: the sequence of resolved approvals, in resolution
  order. Each carries `(s_t, y_t, a_t)`: score, label
  `y_t ∈ {benign, dangerous}` (approved → benign, denied → dangerous), owning
  agent family `a_t`. Expired approvals are **not** in the stream — no verdict,
  no label. This is the entire feedback model; it is what the product actually
  collects (`app/lib/guard/calibration-feedback.ts`).
- **Calibrated threshold** `θ_t ∈ [a,b]`, a = 20, b = 102 (chosen so the upper
  projection provably never binds, see Theorem 1), θ_1 = 80.
- **Loss** `ℓ_t = 1{ s_t ≥ θ_t ∧ y_t = benign }` — *a false interruption at
  the current calibrated threshold*.
- **Update** (online adaptive conformal, the Gibbs–Candès ACI recursion applied
  to a monotone decision loss):

      θ_{t+1} = Π_{[a,b]}( θ_t + γ·(ℓ_t − α) ),   γ = 2.

### 1.3 Theorem 1 (deterministic false-interruption control)

*Let b ≥ 100 + γ(1−α) and θ_1 ∈ [a,b]. Then for EVERY adjudication sequence —
arbitrary drift, arbitrary dependence, adversarially chosen — and every T ≥ 1:*

    (1/T) · Σ_{t≤T} ℓ_t  ≤  α + (b − θ_1) / (γT).

*Proof sketch.* Write the unprojected update θ'_{t+1} = θ_t + γ(ℓ_t − α), so
ℓ_t − α = (θ'_{t+1} − θ_t)/γ. A loss event requires θ_t ≤ s_t ≤ 100, hence
θ'_{t+1} ≤ 100 + γ(1−α) ≤ b: the upper projection never binds. The lower
projection only *raises* θ_{t+1} relative to θ'_{t+1}, so replacing θ' by θ in
the telescoping sum only *subtracts*:
Σ(ℓ_t − α) = (1/γ)[(θ_{T+1} − θ_1) − Σ(θ_{t+1} − θ'_{t+1})] ≤ (θ_{T+1} − θ_1)/γ
≤ (b − θ_1)/γ. ∎

With the shipped constants (γ=2, θ_1=80, b=102) the excess above α is ≤ 11/T:
after ~110 labeled adjudications the realized false-interruption rate is within
0.1 of target, after ~1100 within 0.01 — **no distributional assumptions at
all**. This is the decisive property for a governance runtime: the guarantee is
a consequence of the update's arithmetic, so no drift, feedback loop, or
adversarial agent can break it; drift only moves *where* θ sits, not whether
the average loss is controlled.

The floor side is deliberately asymmetric: when θ pins at a = 20 the controller
is interrupting *more* than the α budget requires (observed rate runs under
target) — the floor is a safety choice, and running under budget is the safe
direction.

Empirical demonstration (CI-pinned): `__tests__/unit/calibration-controller.test.ts`
runs the controller over streams seeded from the golden-vector corpus
(`__tests__/fixtures/risk-calibration-golden-vectors.json`, scored by the real
`computeRiskScore`) — stationary, under an induced +18 mid-stream score shift
(the bound re-attained measuring the post-drift half alone), and under
adversarial all-benign / all-dangerous streams.

### 1.4 What the guarantee does and does not cover (ruthless version)

- **It controls the loss ℓ as defined**, over the *labeled subsequence*. In
  active mode the controller's own added interruptions are exactly the region
  s ≥ θ, so "fraction of controller interruptions the human waves through"
  converges to α. Interruptions fired by non-score policies (action-type
  envelopes, protected paths) also enter the stream; when their scores fall
  below θ they contribute ℓ = 0, which *dilutes* the average toward the
  controller's own region. The guarantee is exact for the stream and loss as
  defined; it is not a per-policy FDR.
- **A missed dangerous action produces no label.** An allowed action that was
  actually dangerous never enters the adjudication stream. No guarantee on the
  miss rate is *identifiable* from approve/deny feedback alone — any claim
  otherwise would be dishonest. What the design does instead: (i) the
  automated direction is **tighten-only**, so acting on the feedback can only
  reduce misses relative to the human-set baseline; (ii) the per-agent
  e-process (§1.5) turns the dangerous labels we *do* see into escalation;
  (iii) the future label source for misses is the outcome axis
  (`outcome_status ∈ {failed, lost_confirmation}` on allowed actions,
  `durable-execution-finality.md`) — a weak proxy, listed under migration
  (§9), not claimed now.
- **Blocked actions are censored** — a block hides its own counterfactual.
  The controller never touches `block` (charter §1), so it neither learns from
  nor influences that region. Its statement is about the score-driven
  warn/approval region only.
- **Approved ≠ certainly-benign.** An operator may approve while still valuing
  the check ("good that it asked"). We inherit the same label semantics the
  existing tuning/loosening engines already use (override rate); α should be
  read as "target rate of interruptions the human overrides", which is
  precisely the quantity that drives governance fatigue.
- **Expiry is informative censoring.** Expired approvals (operator absent)
  yield no label; if expiry correlates with benignness the labeled rate is
  biased. Mitigation is exposure, not math: the /calibration page shows labeled
  counts, and the expiry rate is visible on /approvals.

### 1.5 Theorem 2 (anytime-valid per-agent escalation)

Per agent family, on its adjudication substream with denial indicator
`d_t ∈ {0,1}`: fix p₀ = 0.25, λ = 2 (λ ≤ 1/p₀), E_0 = 1,

    E_t = E_{t−1} · (1 + λ·(d_t − p₀)).

*If, conditionally on the past, E[d_t | F_{t−1}] ≤ p₀ (the agent's denial
propensity is at baseline), then (E_t) is a nonnegative supermartingale with
E[E_t] ≤ 1, and by Ville's inequality P(∃t: E_t ≥ 1/δ) ≤ δ.*

The alarm fires at E ≥ 20 (δ = 0.05) and is **sticky** — the crossing is the
certificate; only a human reset clears it (`resetAgentAlarm`, audit-logged).
Validity holds at every data-dependent stopping time: the operator can watch
the dashboard continuously, and the false-alarm probability over the agent's
entire lifetime stays ≤ 5%. Under a real shift (denial rate 0.8) the e-value's
expected log-growth is ≈ 0.59/adjudication → alarm in ~5 adjudications
(pinned empirically in the test suite).

Honest caveats: (i) λ, p₀ are fixed, not data-adaptive — a mixture e-process
would detect small shifts faster at the same validity; deliberately deferred
for simplicity. (ii) Alarms are per-agent; over K agents the family-wise false
alarm is ≤ Kδ. With fleets of hundreds, an e-BH pass over the per-agent
e-values would give FDR control — migration item, not implemented.

### 1.6 The charter constraint shapes the controller (this is a feature)

MAINTAINER.md §3: automation may propose, only humans ratify policy change;
adaptivity may tighten automatically but never loosen; §1: blocks are absolute.
The two-sided ACI ideal wants to move θ freely in both directions. The shipped
resolution splits it along the charter's asymmetry:

- **Tightening (θ moving down, more interruptions) is automatic in active
  mode.** The controller raises `allow`/`warn` to `require_approval` when
  s ≥ θ — implemented as one more raising phase in the evaluator
  (`runCalibrationController`, `app/lib/guard/evaluate.ts`), running after the
  last policy phase and *before* the grant post-passes, so a fresh operator
  approval still covers a controller-raised interruption. Because it can only
  call `raiseDecision` toward `require_approval`, it structurally cannot
  downgrade anything and cannot touch or duplicate `block`.
- **Loosening is evidence, never action.** When θ climbs above the org's
  active `risk_threshold`, the operator page says so and routes to the
  existing human-ratified rails (`/policies` tuning proposals —
  `raise_risk_threshold`). No third ratification path was built; the
  calibrated θ makes the existing rails *quantitative*.
- **Shadow mode records, active mode enforces, off is the default.** Every
  decision carries the assessment as a `_calibration` sibling in the persisted
  context (same pattern as `_risk_breakdown`) so shadow mode accumulates an
  auditable would-have-done trail before anyone flips it on. Activation is an
  admin click on /calibration, audit-logged (`calibration.controller_updated`).

Consequence for the guarantee, stated plainly: with tighten-only automation,
the *upper* bound of Theorem 1 binds through the controller's own region, and
convergence of the org's total false-interruption rate to α **is conditional
on humans ratifying the loosening proposals** the controller surfaces. If the
human ignores them, the org keeps its (over-tight) baseline and the observed
rate sits above target — visibly, on the page. That is the correct shape for
a constitutional system: the math narrows the human decision; it does not
absorb it.

### 1.7 Implementation, complexity, hot-path budget

Files (all shipped, default off):

| Piece | File |
|---|---|
| Pure math (update, e-process, assessment, coercion) | `app/lib/guard/calibration.ts` |
| Durable state + event ledger | `app/lib/repositories/calibration-state.repository.ts`, `drizzle/0059_calibration_controller.sql`, `schema/schema.js` |
| Label ingestion (single + batch) | `app/lib/guard/calibration-feedback.ts`, wired in `app/api/approvals/[actionId]/route.ts` and `app/api/approvals/bulk/route.ts` (via `after()`, best-effort by contract) |
| Hot-path read | `getCalibrationRuntime` in `app/lib/guard/caches.ts` (settings ride the existing single settings query; θ-state has its own 30s cache, loaded only when mode ≠ off; covered by `__resetGuardCaches`) |
| Guard wiring | `runCalibrationController` in `app/lib/guard/evaluate.ts` |
| Operator API | `app/api/calibration/controller/route.ts` (GET snapshot; POST mode/target/resets, admin-gated, audit-logged) |
| Operator page | `app/calibration/page.jsx` (nav: Govern → Calibration) |

Complexity: the update is O(1) per adjudication (plus O(agents) only at the
bounded-map eviction edge, cap 200/org, alarmed entries never evicted). The
hot-path assessment is O(1) arithmetic on cached state. Query budget: mode off
adds **zero** round trips (the settings row was already read for
predictive/halt); shadow/active adds one `guard_calibration_state` read per
org per 30s. The pinned budget test (`guard-hotpath.test.js`: cold ≤ 5, warm
≤ 2) still passes, and `scripts/bench-guard-hotpath.mjs --assert` gates the
end-to-end latency.

Failure modes and their contracts: state-load failure → controller silently
absent for that 30s window (never blocks guard); ingest failure → approval
unaffected (catch-all, warn log); concurrent adjudications → last-writer-wins
on the state row (human-paced writes; the events ledger preserves the full
stream, so state is rebuildable — accepted for v1 and recorded here); missing
tables on a pre-0059 install → reads return null, writes create the tables
(the `settings`-table ensure pattern).

**Established:** ACI/conformal risk control (Gibbs–Candès 2021; Angelopoulos
et al.), test supermartingales and Ville's inequality (Ville 1939; Shafer,
Ramdas et al.). **Novel application:** splitting the two-sided ACI update
along a constitutional tighten/loosen asymmetry; using approve/deny HITL
adjudications as the conformal feedback stream; the sticky e-alarm as a
governance escalation primitive. **Speculative:** none in the shipped piece.

---

## 2. Cross-scope policy consistency via sheaves — the machinery does not pay for itself today

**The honest verdict first:** DashClaw's scope poset is two levels deep and its
composition operator is a lattice join. On that structure the sheaf condition
is satisfied trivially and H¹ carries no information. Building the cohomology
machinery now would be decoration. Here is the precise account of why, and the
exact trigger at which it becomes load-bearing.

Formally: let S be the poset with elements {org} ∪ Agents, agent ≤ org.
Assign to each scope U the set P(U) of active policies applicable at U —
P(agent) = org-wide rows ∪ rows whose `agent_ids` include the agent's family
(`loadApplicablePolicies`); restriction maps are inclusions. The decision
functor D_U(x) = ⋁_{p ∈ P(U)} p(x) in the severity lattice (§6). A "globally
consistent decision" for action x is a choice of d_U compatible with
restrictions. Because ⋁ is monotone and every restriction only *adds* policies
(finer scope ⇒ superset of policies ⇒ D is monotone along restriction), the
family {D_U} always glues: sections exist, uniquely, for every cover. H⁰ is the
whole space of decision assignments; the Čech obstruction H¹ vanishes
identically — not because policies never conflict, but because "conflict" is
*resolved by definition* (most-restrictive-wins), so overlapping prescriptions
never disagree after composition.

The real consistency risks in the current engine are not cohomological, and a
sheaf would not see them:

- **Order-sensitivity of downgrades.** `allow_grant` and the operator-approval
  grant retract warn/require_approval → allow. Retraction is not monotone, so
  it must be *staged* after every raising phase — which the code does
  explicitly (`evaluate.ts`: grants run after webhooks; the calibration phase
  was inserted before grants for exactly this reason). The invariant worth
  checking is temporal (§5), not topological.
- **Fail-direction of parse failures.** Malformed `agent_ids` skips the policy
  (fails closed, `caches.ts:137-142`); malformed rules mark the policy
  unenforceable and surface a warning. These are engineering contracts.

**When sheaf machinery earns its cost:** the moment scopes become a genuine
tree (org > team > project > agent > session) *and* semantics acquire
non-monotone local overrides ("this project relaxes the org rule for action
type X"). Then restriction no longer merely adds policies; local sections can
genuinely disagree on overlaps (two teams sharing an agent prescribe
incompatible exceptions), a global section can fail to exist, and the minimal
witness of failure is exactly a Čech 1-cocycle on the cover by maximal scopes:
computable, for finite posets, as a constraint-satisfaction problem — for each
action shape, propagate interval constraints down the tree and report the
first pair of overlapping scopes whose constraints have empty intersection.
That solver is a few hundred lines and gives the same certificate ("consistent,
or here is the exact cover where it breaks") without the cohomological
vocabulary; if DashClaw ever grows override semantics, build the solver and
*document* it as computing H¹ of the policy presheaf — the framing buys
intuition for why the failure is irreducible to any single scope.

**Established:** sheaves/Čech cohomology. **Novel application:** none shipped —
deliberately. **Speculative:** the override-semantics trigger above.

---

## 3. Tamper-evident audit ledger — design accepted, implementation deferred

### 3.1 What exists today (verified)

- `guard_decisions` is append-only **by convention**: no UPDATE/DELETE path
  exists in application code, but nothing prevents one. `action_records` is
  routinely UPDATEd (lifecycle, approvals, outcomes); admin DELETE exists with
  a write-ahead audit row (`app/api/actions/route.ts:509-616`).
  `parent_action_id` has no FK — the causal chain is app-enforced text.
- The one real hash chain covers **compliance export bundles**
  (`app/lib/integrity/bundle.ts`, chained + Ed25519-signed per export,
  best-effort verification of the previous link) — it proves an export
  document wasn't altered after generation; it says nothing about live rows.
- Per-record cryptography exists in spots: Ed25519 non-fabrication receipts on
  `guard_decisions.evidence`, signed reputation vectors (`hashVector` over the
  canonical vector, breakdown deliberately a sibling outside the hash —
  `app/lib/reputation.ts:181-184`), server-computed `act_content_hash` binding
  approvals to exact acts. None link one row to the next.

**What a DB-write attacker can do today without detection:** rewrite any
`action_records` field (including `approved_by`, `risk_score`,
`parent_action_id` — i.e., forge or sever causal lineage), rewrite
`guard_decisions` rows, rewrite terminal outcomes (the one-shot rule is a
repository WHERE-clause, not a trigger). What they cannot do: forge a signed
non-fabrication receipt or reputation receipt without the instance key; alter
an already-generated compliance export without breaking its chain.

### 3.2 The construction (design)

Per org, over `guard_decisions` in insertion order:

1. **Leaf hash** `h_i = H(canonicalJson(row_i))` using the existing
   `digestJson` canonicalization (`app/lib/integrity/canonicalize.ts` — NFC,
   sorted keys). The hashed row excludes nothing: the decision row is already
   immutable-by-intent. Volatile display fields, if ever added, follow the
   reputation rule: **siblings, never in the hashed vector**.
2. **Chain** `c_i = H(c_{i−1} ‖ h_i)` stored on the row; `c_0 = H(org_id)`.
3. **Checkpoints**: every N rows (or every T minutes) sign `(org_id, i, c_i)`
   with the instance Ed25519 key (`app/lib/integrity/server-key.ts`) and (a)
   store it in a `ledger_checkpoints` table, (b) **export it beyond the
   database's trust domain** — into the existing compliance-bundle chain, and
   optionally to the operator via the digest channel. This last step is the
   entire point: a checkpoint that lives only in the same Postgres is
   rewritable by the same attacker.
4. **Proofs.** Inclusion: replay `c_{i−1}, h_i → c_i` up to the nearest signed
   checkpoint (O(distance) — or O(log n) if a Merkle mountain range is built
   over the leaves; the linear chain is enough at DashClaw's volumes).
   Consistency (append-only-ness): checkpoint k is consistent with checkpoint
   k′ > k iff replaying rows (i_k, i_k′] from c_{i_k} yields c_{i_k′} — any
   historical edit, insertion, or deletion before an exported checkpoint
   changes some c and breaks the equation.

**Exact guarantee:** an attacker with full DB write access after time t cannot
alter, reorder, insert, or delete any decision covered by a checkpoint exported
before t without detection by anyone holding that exported checkpoint;
non-repudiation of the *server's* records is anchored to the instance key
(NOT non-repudiation of the agent's intent — inputs remain attestations,
trust-model D1). **Residual powers:** the attacker can still (i) rewrite the
tail after the last exported checkpoint (bound = export cadence), (ii) fork:
serve honest history to the verifier and a doctored one to the app (defeated
only by verifying reads against checkpoints — expensive, out of scope),
(iii) act with the instance key if they also stole it (key custody is the
assumption).

**Causal chain as a content-addressed DAG:** replace the mutable
`parent_action_id` pointer at read time with edges by decision hash
(`parent_decision_hash = h_parent`) so any rewrite of an ancestor breaks every
descendant's edge. Cheap, additive column; pairs with the chain above.

### 3.3 Why deferred, and the migration cost

The chain must be computed inside `persistGuardDecision` — the **mandatory
blocking audit gate on the hot path** (`app/lib/guard/persistence.ts`). Doing
it correctly requires serializing on the previous chain head per org (a
row-lock or single-writer pattern) — measurable contention risk on exactly the
path that just finished a p50 −44% perf pass, and it interacts with the
fallback insert path (42703 column-degradation). It is a well-understood
week-of-work with a real perf gate to re-clear; the calibration controller was
the higher-leverage build (it attacks the failure that turns governance off;
tamper evidence attacks an attacker model — DB-write insider — that
trust-and-failure-model.md currently scopes out). Migration: add columns
nullable → backfill chain org-by-org offline → flip writes to compute-chain
→ start exporting checkpoints → publish the verifier as a CLI
(`dashclaw ledger verify`). Each step is independently shippable.

**Established:** hash chains, Merkle trees / certificate-transparency-style
inclusion+consistency proofs (RFC 6962). **Novel application:** riding
checkpoints on the existing compliance-bundle chain. **Speculative:** none.

---

## 4. Interception semantics via algebraic effects — the formal boundary

`enforcement-boundary.md` already states the honest limit per surface. The
effect formalism adds two things the table cannot say: a *criterion* and a
*composition theorem*. It costs one page.

**Semantics.** An agent is a term M in a language with effectful operations;
its behavior is a sequence of operation calls `op(v; k)` — perform `op` with
payload v, continue as k. A governed runtime is a **handler** G with signature
Σ (the set of operations it intercepts). For `op ∈ Σ`:

    G⟦ op(v; k) ⟧ = case guard(op, v) of
        allow | warn        → effect(op, v); G⟦ k(result) ⟧
        block               → G⟦ k(refused) ⟧          -- continuation runs, effect does NOT
        require_approval    → suspend; on grant → as allow; on deny/expiry → as block

**Known gap: this case statement is four-arm, `allow_contained` (§0.3, §6) has
no arm here.** Its effect model does not fit the two shapes above — it is
neither an immediate `effect(op, v)` nor a `suspend`/resume; it discharges the
effect *and* defers finality (stage now, promote-or-discard later, itself a
second governed operation). Formalizing that arm and its interaction with the
handler-composition theorem below is a dedicated pass, deliberately not
attempted here.

with the side condition that `guard` itself is decided at the audit boundary
(every branch persists a `guard_decisions` row first — the D2 contract: an
unaudited decision is never returned).

**The boundary, exactly.** For `op ∉ Σ` there is no handler frame: the effect
discharges against the ambient runtime (the OS). Hence:

> **Coverage criterion.** DashClaw *mechanically* governs an agent iff the
> agent's reachable effect set is contained in Σ. An agent with raw shell
> access has `exec ∈ effects(M) \ Σ` — it escapes not because enforcement is
> weak but because the operation is outside the handled signature.

This is `enforcement-boundary.md` §per-surface-table, formalized: each table
row is a statement about Σ. Hooks in enforce mode put the harness's tool-call
operation inside Σ (PreToolUse exit-2 *is* the handler clause, fail-closed);
`dashclaw_invoke`/capability routes put the HTTP effect inside Σ (DashClaw is
the executor); SDK `claw.guard()` is the degenerate case Σ = ∅ with an
*advisory* handler — the agent performs `guard` as a pure query and discharges
its real effects unhandled. "Cooperative" = the handler is invoked by the
agent's own code rather than wrapping its effects.

**Composition.** Let A, B be governed subsystems with handlers G_A, G_B over
signatures Σ_A, Σ_B. The composite (A calls B, or A spawns B) is governed iff:

1. **Signature coverage is preserved:** effects(A ∘ B) ⊆ Σ_A ∪ Σ_B — the
   composition introduces no operation neither handler intercepts (the classic
   failure: A's tool starts a subprocess whose effects bypass both).
2. **No inner discharge before the outer decision:** if an operation is in
   both signatures, the inner handler must *forward* (re-perform) rather than
   discharge, or the outer guard sees a fait accompli. In DashClaw terms: a
   sub-agent's identity composes (`<parent>:<type>`, folding into the parent's
   policy scope and budgets, `baseAgentId`) precisely so the *outer* org
   policies keep jurisdiction over inner calls.
3. **Decision joins, never meets:** the composite's decision for an operation
   both would govern is the lattice join of both decisions (§6) — the code's
   webhook-escalation rule ("customer decision can upgrade, never downgrade",
   `policy.ts:632-635`) is this condition for the customer-endpoint handler.

**What this adds beyond the ADR:** the ADR is a table of facts; the criterion
turns "is surface X governed?" into a checkable question about an effect set,
and the composition conditions are the review checklist for every future
connector (the OpenClaw gateway satisfies 1–3; a Desktop connector fails 1,
which is *why* the ADR killed the universal proxy). **Established:** algebraic
effects and handlers (Plotkin–Power, Plotkin–Pretnar). **Novel application:**
reading an enforcement-boundary ADR as a handler-signature statement.
**Speculative:** none — deliberately no implementation; the value is the
criterion.

---

## 5. Constitutional invariants as temporal properties — checked against the code

State: per org, the set of policies P, halt flag H, decision ledger L, action
records A (with `created_by`, `approved_by`, approval grants), controller
state C. Events: guard evaluations, approvals, policy mutations, halt flips,
adjudication ingests. Properties in LTL over this machine, each checked
against the actual paths:

**I1 — Blocks are absolute.**
`G( decision(x) = block → ¬∃ grant g: downgrade(g, x) )`.
Code: both downgrade passes are domain-restricted to warn/require_approval
(`applyAllowGrants` guard at `evaluate.ts:271`; `applyOperatorApprovalGrant`
guard at `evaluate.ts:331`); halt/replay/act-binding overrides are joins with
block; the calibration controller only raises toward require_approval.
**Holds by construction** at the decision layer; *execution* of a block is
mechanical only where §4's Σ covers the surface — on cooperative surfaces I1
is a statement about the recorded decision, not the world. Pinned by tests
(grant tests, `guard-calibration.test.js` block-absolute case).

**I2 — No self-approval (separation of duties).**
`G( approve(a, u) → role(u) = admin ∧ u ≠ ⊥ ∧ (created_by(a) = ⊥ ∨ u ≠ created_by(a) ∨ u = operator) )`.
Code: role gate + `APPROVER_IDENTITY_REQUIRED` + creator check
(`app/api/approvals/[actionId]/route.ts:44-116`); bulk enforces the exclusion
*inside* the atomic UPDATE (`actions.repository.ts:262`); `created_by` is
stamped from the trusted middleware header, never the client body. As
**non-interference**: the approval decision must be independent of the
agent-credential input channel — holds because `x-user-id`/`x-org-role` are
stripped and re-derived by middleware from the authenticated principal
(`middleware.js:1666-1673`), and a `member` key can never reach the role gate.
**Two documented holes, both deliberate or legacy:** the `operator` root
credential is exempt (single-admin self-host bootstrap — if an agent holds
root, the gate was forfeit anyway; charter-accepted), and NULL `created_by`
(pre-0055 rows) is unenforceable. One **finding** from this review: the
approval-*grant* consumption path binds on (agent, goal, action_type,
act_content_hash) but any admin's approval creates the grant — I2 composes
correctly because grant creation itself passed I2; no violation, but the chain
of custody is only as strong as `approved_by` provenance, which is why §3's
ledger work matters.

**I3 — Humans ratify every enforcement change.**
`G( enforce(p) at t ∧ ¬enforce(p) at t−1 → ∃ human admin click(p) )`.
Code: policy CRUD is admin-gated (`app/api/policies/route.ts:57-59,103-105`);
behavior-learning adoption inserts drafts with `active: 0` and requires
`acknowledged_simulation` (never auto-enforced); tuning/loosening proposals are
compute-on-read, apply-on-PATCH. The calibration controller was **designed
into** this invariant: mode is a settings flag flipped only by the admin-gated
controller route (audit-logged), tightening is inside the automation allowance
the charter grants, loosening only ever surfaces as evidence. **One finding:**
`POST /api/behavior/suggestions` creates *inactive drafts* without an admin
role check (any authenticated member) — the enforcement flip is still
admin-gated, so I3 holds, but draft creation is looser than the sibling routes;
worth tightening for hygiene.

**I4 — Degradation is governed (the fail-open incident class).**
`G( evaluation fails ∨ deadline → decision ∈ {resolveDegradedAction()} ∧ audited )` —
one knob for slow and fast failures, fail-closed default, and *an unaudited
decision is never returned* (D2; `persistence.ts` throws
`GUARD_AUDIT_PERSIST_FAILED`). The v4.72.1 incident (hook timeout-seconds
overflow → harness cancelled the hook → **client-side** fail-open while the
server ledger stayed healthy) shows the honest scope: the server automaton's
invariants bind *calls that reach the server*. The client hook is a separate
automaton whose fail-closed property must be pinned by its own tests — which
is exactly what the enforcement-liveness roadmap item (v8) is for. The theory
adds the framing: I4 is a property of the composite system (§4's composition
condition 2), and the hook is the outer handler.

**I5 — Controller-specific invariants (new, pinned by tests).**
`G( mode = shadow → decision unchanged )`;
`G( controller applies → decision' = decision ⊔ require_approval ∧ decision ≠ block )`;
`G( θ ratchets looser only through I3's rails )`.
Pinned by `guard-calibration.test.js` and `calibration-controller.test.ts`.

**Liveness** (the charter's implicit demands): every `require_approval` is
eventually resolved or expired (`sweepExpiredApprovals` + lazy expiry — holds
under the cron assumption documented in durable-execution-finality); every
halt reaches every warm instance within 3s + ε (the dedicated halt cache TTL,
D4). These are the only liveness properties the runtime genuinely promises;
anything stronger (e.g., "every alarm is eventually seen") depends on a human
and is deliberately not claimed.

**Established:** LTL safety/liveness, non-interference, separation of duty.
**Novel application:** none — this section is *verification*, and its value is
the two findings and the precise statement of I4's client/server split.
**Speculative:** model-checking the automaton mechanically (TLA+); plausible
but not obviously worth it while the automaton is this small.

---

## 6. Decision algebra and information flow — formalizing what the code already is

**The decision lattice.** D = {allow < warn < allow_contained < require_approval < block}
is a finite total order, hence a complete lattice; join ⊔ = max. The code's merge
IS this join: `raiseDecision` (`evaluate.ts:102-104`), `moreSevereResult`
(`policy.ts:357-361`), webhook escalation (`isWebhookEscalation`). Since ⊔ is
associative, commutative, idempotent, and block is the top element, policy
composition is order-insensitive and block-dominant **by algebra, not by
convention** — adding any policy can only raise the outcome (monotonicity),
which is also why policy *addition* is safe to automate in the tighten
direction (§1) while *removal* is not. `allow_contained`'s insertion is a pure
relabeling of the total order (§0.3); it introduces no new join behavior —
containment's own capability-negotiation and eligibility gates are evaluated
*before* this lattice is consulted (`app/lib/guard/containment.ts`), never as
part of the join itself.

**Grants as guarded retractions.** The two downgrades are partial functions
g: {warn, require_approval} → {allow}, undefined on block, applied in a fixed
stage after all joins of raisable phases and before block-overrides are
re-asserted (`applyBlockOverride` runs on the replay/act axes after grants).
Formally the evaluator computes:

    final = override_joins ⊔ g*( ⋁ phase_outcomes )

where g* applies at most one applicable grant and is the identity on block.
The staging discipline (grants after the last raising phase; the calibration
phase deliberately inserted *before* grants) is what makes the non-monotone
step sound; §5's I1 is the invariant it preserves. This is the honest algebra:
not a pure semilattice, a semilattice with a single guarded retraction stage —
naming it precisely is what lets a reviewer check any future phase insertion
in seconds ("does it run before the grant stage? does it only join?").

**Cross-tenant isolation as an information-flow lattice.** Labels = orgs
(mutually incomparable) below a system label; the non-interference property:
for any two states differing only in org-B-labeled data, every org-A-labeled
output (decisions, pages, streams) is identical. Mechanisms, verified:
middleware strips and re-derives the org headers from the authenticated
principal (`middleware.js:1666-1673, 1842-1917`); every repository query is
org-scoped; `evaluateGuard` **throws** on a missing orgId rather than let
`WHERE org_id = NULL` silently match nothing and fail open
(`evaluate.ts:660-666`). Verified deviations to keep on the risk register:
`getOrgId` defaults to `org_default` when the header is absent
(`app/lib/org.ts:11`) — safe only because middleware always sets-or-blocks
first, so any route reachable outside the middleware chain would silently
land in the default tenant; the dev-mode no-key fail-open
(`middleware.js:1745-1765`, production-gated); demo forwarding pins
`org_demo`. The operational check is `scripts/cross-org-smoke.mjs` in CI —
the right verification shape for a property that lives in WHERE clauses.

**Established:** lattices, information-flow non-interference (Denning;
Goguen–Meseguer). **Novel application:** the "semilattice + guarded
retraction stage" characterization of the evaluator. **Speculative:** none.

---

## 7. Categorical connective tissue — omitted, with the one exception noted

Governance-as-a-functor (from a category of agent systems to governed
systems), the guard as a natural transformation, policy conversions as
functors: examined and **omitted**. With one object level (the org) and one
composition operator (join), the categorical layer restates §§4–6 without
adding a theorem we would use — every candidate statement (naturality of the
guard across surface embeddings; functoriality of mode compilation) collapses
to facts already stated concretely. The single genuinely clarifying fragment:
**policy-mode compilation is a free construction** — a mode is a presentation,
`compileMode` its induced set of policies, and the UI's grouping-by-`_mode` is
the counit of that adjunction; the practical content ("modes have no runtime
semantics; re-compiling is always safe; deleting a mode's rows loses nothing
but provenance") is fully captured by §0 fact 2. Formalism that only renames
what a sentence already says is decoration; per the mandate, it is left out.

---

## 8. The three-way ledger: established / novel application / speculative

| Claim | Status |
|---|---|
| ACI recursion + deterministic average-loss bound (Thm 1) | **Established** (Gibbs–Candès 2021; conformal risk control, Angelopoulos et al. 2022–24) — proof re-derived here for the clamped, monotone-loss case |
| Test supermartingale + Ville alarm (Thm 2) | **Established** (Ville 1939; Ramdas et al. game-theoretic statistics) |
| HITL approve/deny as the conformal feedback stream; tighten-only ACI split along a constitutional constraint; sticky e-alarm as escalation primitive | **Novel application** (this ship) |
| Outcome-axis labels for the miss direction; e-BH across agents; mixture e-processes | **Speculative / roadmap** |
| Sheaf reading of policy scopes | **Established math, does not pay here** — trigger documented (§2) |
| Hash-chain + exported checkpoints over `guard_decisions` | **Established** (RFC 6962 family); design accepted, deferred (§3) |
| Effects/handlers reading of the enforcement boundary; Σ-coverage criterion; composition conditions | **Novel application** (formalizes the existing ADR; no code) |
| LTL statement + code check of the five charter invariants | **Verification work**; two hygiene findings (§5) |
| Evaluator = join-semilattice + guarded retraction stage; org non-interference | **Formalization of existing code** |

---

## 9. Migration path from heuristics to the rebuilt core

1. **Now (this ship):** controller off by default. Operators turn on **shadow**
   from /calibration; adjudications start calibrating θ; every decision carries
   `_calibration`; nothing changes behavior. The observed-vs-target panel makes
   the org's real false-interruption rate a number for the first time.
2. **After a shadow soak** (enough labels that Theorem 1's 11/T term is small —
   ~100+ adjudications): operator sets α deliberately and activates. The
   controller tightens automatically; loosening evidence flows to the existing
   tuning proposals. The static `risk_threshold` remains the human-set outer
   boundary — the controller calibrates the region *below* it.
3. **Label enrichment:** join `outcome_status` of allowed actions into the
   feedback (weak miss-direction labels); expiry-rate surfaced next to the
   observed rate (censoring visibility).
4. **Fleet-scale alarms:** e-BH over per-agent e-values for FDR-controlled
   escalation when agent counts make Kδ meaningless.
5. **Ledger integrity (§3):** chain columns → offline backfill → checkpoint
   exports riding compliance bundles → `dashclaw ledger verify`.
6. **If scope semantics ever grow overrides:** build the §2 consistency solver
   before shipping the semantics, not after the first cross-scope incident.

---

## 10. What was not verified against a running system

- Theorem 1/2 behavior is pinned by simulation on golden-vector-seeded streams,
  not yet by a production adjudication stream (no org has enough live
  approvals in the local dev DB). The events ledger exists precisely so the
  first real soak is auditable.
- The bench gate (`bench-guard-hotpath.mjs --assert`) was run against a local
  `next start` instance (results in the ship record); serverless (Neon +
  Vercel) latencies differ in absolute terms — the *relative* claim (mode off
  adds zero queries; shadow adds one cached read per 30s) is
  architecture-level and test-pinned.
- §5's client-side hook automaton (fail-closed under harness timeout) is
  asserted from the v4.72.1 fix and its tests, not re-verified end-to-end in
  this session; the v8 enforcement-liveness drill owns that.
- The multi-instance halt/settings convergence windows (3s/30s) are taken from
  the cache design and its unit tests, not measured across real warm lambdas.
