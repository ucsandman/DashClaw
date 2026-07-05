# v4.5 — Loosening direction: proposals that relax (spec)

Roadmap: `docs/plans/owner-roadmap.md` §v4.5. Thesis: v3.2 built tightening;
precision requires the mirror or the June disable-pattern returns — v4.1 is
the live proof that over-interrupting policies get bulk-disabled or
bulk-accepted, not tuned.

## What the evidence says

- The tuning engine's **only actionable loosening rule** is
  `raise_risk_threshold`, gated to `policy_type === 'risk_threshold'` with
  `rules.action === 'require_approval'`
  (`app/lib/policy-tuning/engine.ts:279-307`). Every other
  interrupt-producing policy type — `require_approval` keyed by an
  `action_types` envelope (**the type every tightening ratify creates**,
  `app/api/policies/tightening/route.ts:224-257`), `protected_path`,
  `rate_limit` — has **no relaxation path at all**. When those
  over-interrupt, the only lever a human has is the June disable-pattern:
  bulk-disable the policy or bulk-accept the interrupts.
- v4.1's recorded verdict names the live evidence class: *"100%-approved
  protected-path `apply` interrupts = v4.5 loosening evidence (§2 — not
  self-tuned)."* Exactly the class the tuning engine cannot touch.
- **Gap found during diagnosis (ride-along fix, v4.1 pattern):**
  `app/lib/repositories/policy-tuning.repository.ts` applies **no synthetic
  exclusion** — `smoke-*`/`loadtest-*` agents and
  `smoke.%`/`loadtest.%`/`liveproof.%` action types count as tuning evidence
  today, unlike `tightening.repository.ts:75-78` and
  `posture.repository.ts:168-169`, which filter in SQL before any
  LIMIT/aggregation (the v3.1 lesson). A loosening engine reading approval
  outcomes through the same queries would mine relaxation proposals out of
  harness traffic — the exact failure v4.1 diagnosed, pointed the other way.
  The fix lands here because v4.5's evidence quality depends on it.

## Design decisions

Autonomous-session note: these are the decisions the roadmap's constraints
("same proposal shape and surface as tightening, through v4.4's spine;
human-ratified only, same undo") force or strongly imply; alternatives
weighed are recorded inline.

**1. A sibling engine mirroring tightening — not new tuning rules.**
Alternative weighed: extend `deriveProposals` with relax rules so proposals
surface in the existing tuning queue. Declined: tuning's decision grammar is
wrong for the mandate — its accept is a client-side PATCH with dismiss-only
persistence (`app/api/policies/proposals/route.ts:98-104`), no ratify
snapshot validation, no decisions ledger, no undo-of-accept. The roadmap
mandates tightening's grammar (content-stable ids, decisions-only table,
server-side snapshot validation on ratify, undo deletes the judgment row).
Mirror architecture:

- `app/lib/posture/loosening.ts` — pure derivation engine (tests inject rows).
- `app/lib/repositories/loosening.repository.ts` — evidence loader +
  decision CRUD, synthetic exclusion in SQL before LIMIT.
- `app/api/policies/loosening/route.ts` — GET (any role) / POST (admin:
  `ratify` | `dismiss` with required reason ≤500 redacted | `undo`).
- `loosening_proposal_decisions` table (drizzle/0051), mirroring 0042:
  `id, org_id, proposal_id, rule, decision('ratified'|'dismissed'),
  policy_id, action_type (nullable), snapshot jsonb, reason, decided_by,
  decided_at`, unique `(org_id, proposal_id)`.
- `app/policies/lib/looseningClient.ts` + a fifth `JudgmentSpine` adapter.

**2. Two rules, two grains — the roadmap's two evidence classes.**

- `relax_policy_scope` — *(policy, action_type)* grain: "patterns with
  sustained ~100% approve rate." Within one policy's `require_approval`
  interrupts, a specific action type's resolved outcomes are ≥95% approved
  with sufficient volume, **and** that action type is literally present in
  the policy's `rules.action_types` (exact-match semantics,
  `app/lib/guard.ts:1377-1395` — no wildcards exist) **and** removing it
  leaves the envelope non-empty. Patch: splice the action type out of
  `action_types`.
- `deactivate_policy` — *policy* grain: "policies whose interrupts are
  always overridden." All of a policy's resolved interrupts ≥95% approved
  with sufficient volume, and no carve-out applies (no `action_types`
  envelope — `protected_path`, `rate_limit` — or the envelope would empty).
  Patch: `active: false`.

Evidence per grain comes from `guard_decisions`
(`decision='require_approval'`, `matched_policies` unnested) joined to
`action_records` via `guard_decision_id`, with the approved/denied
predicates `policy-tuning.repository.ts:88-129` established
(`approved_by IS NOT NULL` / `reasoning LIKE '%[HITL Decision: DENY%'`),
the `NOT_DEGRADED` filter, `updated_at` window clipping (a config change
resets evidence), and the shared synthetic predicates from
`app/lib/calibration-mining.js:60-75`.

**3. Ownership boundary: `risk_threshold` policies are excluded.**
Tuning owns that direction (`raise_risk_threshold`); double-queueing the
same policy to one human contradicts the v4.4 thesis. Mirror of tuning's
own comment ("no tightening — the review feed owns that direction",
`engine.ts:251-257`). The at-cap case (threshold pinned at 95, still 100%
overridden, tuning has nothing left to propose) is a recorded non-goal
with a revival trigger below.

**4. Thresholds.** `relaxOverrideRate 0.95` (roadmap says "~100%"; stricter
than tuning's 0.9 raise bar because these patches remove governance rather
than move a dial), `minFired 10`, `minResolved 5`, window default 30d
(clamped 7–90) — tuning's proven defaults. Smoke-only overrides
`?min_fired=`/`?min_resolved=`/`?include_synthetic=1`, mirroring
tightening's.

**5. Proposal shape and ids.** Same shape as tightening proposals: `id`,
`rule`, `policy_id`, `policy_name`, `policy_type`, `action_type` (carve-out
only), `title`, `summary`,
`evidence { window_days, window_started_at, fired, approvals,
override_rate, example_decision_ids }`, `patch` (display only — never
trusted on POST). Content-stable ids, no counts in the fingerprint:
`lp_<sha256("relax_policy_scope\n<policyId>\n<actionType>")[:16]>` /
`lp_<sha256("deactivate_policy\n<policyId>")[:16]>`.

**6. Ratify rebuilds server-side from the validated snapshot.** Snapshot =
`{ rule, policy_id, action_type? }`; the server verifies integrity (recompute
the id from the snapshot, compare), re-reads the policy row, recomputes the
patch from **current** rules (404/409 if the policy is gone, inactive, or
the action type is no longer in the envelope), applies it through the same
update path the policies PATCH route uses (guard policy cache invalidation +
`POLICY_UPDATED` org event + audit log `loosening_proposal.ratified`).
Ratify is self-suppressing: the policy's `updated_at` bump resets the
evidence window, so the pattern stops re-mining without bookkeeping —
tightening's own suppression mechanism, mirrored.

**7. Undo keeps the change — `change_kept`.** Undo deletes the judgment row
only; a relaxation a prior ratify applied **stays** (the policy is a
first-class row managed at `/policies`). Response echoes
`change_kept: <policy_id>`; the UI says so truthfully. This is tightening's
`policy_kept` precedent, generalized by the v4.4 spec (§"Undo of an
adoption… keeps the draft policy").

**8. The spine gets a fifth queue.** `QueueKey` gains `'loosening'`,
`QUEUE_LABELS` and the header sentence ("tuning, tightening, calibration,
and behavior") update, `#loosening` anchor, `<ProposalGroup
adapter={looseningAdapter}>` between Tightening and Calibration (the two
policy-mutation queues sit adjacent). The adapter is the tightening adapter
with `primaryVerb: 'Ratify'`, badge = rule, mono = the patch summary
(`remove <type> · <policy>` / `deactivate · <policy>`), evidence line =
approved/resolved counts + override rate + window + `/decisions` link.

**9. Ride-along: synthetic exclusion lands in the tuning repository.**
`getDecisionMixByPolicy`, `getApprovalOutcomesByPolicy` (and
`getDegradationStats` if it reads the same stream) gain the same SQL
predicate; `/api/policies/proposals` gains smoke-only
`?include_synthetic=1`; the existing tuning smoke block updates to pass it.
Behavior change is deliberate and directional: harness traffic stops
minting tuning evidence.

## Human surface (HUMAN-EXPERIENCE gate)

1. **Where does a human SEE it?** `/policies` → Judgment spine → the
   Loosening group (`#loosening`). Same click path that already carries the
   other four queues; the spine header count row gains `Loosening n`.
2. **Discoverable?** Yes — inside the surface where all pending judgments
   already live; no new page, no deep URL.
3. **Every human step a CLICK?** Ratify / Dismiss (reason field) / Undo are
   buttons on the row — the identical decision UX the human already uses
   for tightening. Zero terminal steps.
4. **Verified rendered?** Ship gate: build + local server + rendered proof
   of the Loosening group with a live proposal (dev-server workaround per
   `reference_dashclaw_dev_server_spawn_panic.md`), plus the marketing
   surface sweep in the same ship (HUMAN-EXPERIENCE clause 4).

## Acceptance (from the roadmap, made concrete)

- **Live round-trip:** seed an over-interrupting pattern (smoke-scoped
  `require_approval` policy with a two-type envelope; fire ≥minFired
  interrupts on one type; approve them all through the approvals route) →
  the loosening proposal renders in the spine → ratify → the same guard
  call now passes without interruption (the interrupt-volume drop, proven
  mechanically) → undo → `change_kept`, relaxation survives.
- **Smoke (next free letter block, Z):**
  - Z1 seed + mine: proposal appears with correct rule, grain, evidence
    counts, `lp_` id shape (`?include_synthetic=1&min_fired=…`).
  - Z2 synthetic bar: the **default** GET never contains the smoke agent or
    action type anywhere in the response (tightening S3's bar).
  - Z3 ratify round-trip: POST ratify with the validated snapshot → re-fire
    the carved-out action type → `allow`; the other envelope type still
    interrupts (the relaxation is surgical).
  - Z4 self-suppression + undo: re-GET → the pattern no longer mines
    (window reset by the policy update); undo → `change_kept` echoes the
    policy id; the relaxed rules survive.
  - Z5 integrity: ratify with a tampered snapshot → 400; non-admin POST →
    403; dismiss without reason → 400.
  - Tuning block updated for the ride-along (`?include_synthetic=1`).
- **Unit tests:** pure-engine derivation — both rules, threshold
  boundaries (0.949 vs 0.95), minFired/minResolved gates, envelope-empty
  fallthrough to deactivate, `risk_threshold` exclusion, updated_at
  clipping, id stability.
- Existing tightening S1–S5, tuning, spine X1–X3/Y1 stay green.

## Non-goals (recorded, with revival triggers)

- **No LLM, no auto-apply** (constitution §3 — the engine proposes; a human
  ratifies; nothing changes until the click).
- **No agent-scoped relaxations** in v1 (org-wide policy mutations only) —
  same v1 boundary tightening drew.
- **No per-path carve-outs for `protected_path`** — the matched path is not
  queryably persisted on `guard_decisions`. Policy-grain deactivation only.
  Revival trigger: persist the matched path (or rule fragment) on the
  decision row.
- **No `rate_limit` limit-raising patch** — a 100%-overridden rate_limit
  policy surfaces as a *deactivate* proposal and the human judges the
  valve; auto-computing a "safe" higher limit is false precision. Revival
  trigger: a live valve proposal a human wants to partially accept.
- **No `risk_threshold` coverage** — tuning owns the type. Revival trigger:
  a cap-pinned (≥95) policy with sustained ~100% override observed live.
- **No posture-finding mirror** — tightening proposals mirror v3.1
  findings; loosening evidence has no finding today. If a posture finding
  for over-interruption ships later, wire `finding_key` then.
