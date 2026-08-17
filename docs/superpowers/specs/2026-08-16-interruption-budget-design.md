# Interruption budget — relief that does not require the drowning operator to reach up

Adopted 2026-08-16, by Wes's direction ("implement all 3 and we'll see if it helps
and what can be removed, kept, promoted or made stronger").

This supersedes nothing. It is the recon the
[2026-08-11 calibration decision](2026-08-11-approval-calibration-decision.md)
asked for when it wrote its own falsifier:

> **Falsifier 4 (the thesis one):** the PostureHero 7-day interruption count for
> Wes's org does not drop by at least half within 30 days of slice 1, **or he
> disables any enforcement in that window**. Then the miscalibration was never
> the S1 label class, and this decision document is evidence for the next recon,
> not a foundation to extend.

He disabled every policy in the org on 2026-08-16, five days after that document
was written. Falsifier 4 fired. What follows is the reopened recon.

---

## What actually happened

Measured against the live org (`getGuardrailStats`, 7-day window):

| Metric | Value |
|---|---|
| `require_approval` decisions, 7 days | **1,759** (~251/day) |
| `warn` decisions, 7 days | 3,857 |
| `block` decisions, 7 days | 2 |
| Resolved (approved or denied) | effectively **zero** |

Every one of 30 sampled interruptions was the same thing:

```
risk_score: 100
action_type: apply
declared_goal: PowerShell: git -C "C:/Projects/audit" log --since=24.hours
               --format=%ad --date=format:%H:%M
reason: Block mass-destructive commands (rm -rf class): Risk score 100 >= threshold 100
```

A read-only `git log`, scored identically to `rm -rf /`.

### Cause 1 — the 2026-07-01 fix was incomplete

`DESTRUCTIVE_GOAL_PATTERNS` (`app/lib/guard/risk.ts`) contained
`(?<!-)\bformat\b`. That lookbehind rejects `--format=`, which is the case the
2026-07-01 session fixed. It does **not** reject `--date=format:`, because the
character before `format` there is `=`, not `-`. Every git-log invocation in the
ledger carries `--date=format:`. `npm run format` matched too.

`security` base 80 + destructive 20 = the 100 clamp.
`apply` base 60 + destructive 20 + irreversible 15 + shell 5 = the 100 clamp.

The client (Python) classifier is **not** implicated — it has no goal-regex and
grades `format` as a readonly PowerShell verb. Unlike the 2026-08-11 case, the
`max()` fold does not defeat a one-sided fix, so this lands server-side only.

### Cause 2 — five relief mechanisms, all structurally excluded

The org's rule is `{threshold: 100, action: require_approval, ungrantable: true}`.

| Mechanism | Why it could not fire |
|---|---|
| `allow_grant` / "don't ask again" | `ungrantable: true` → `applyAllowGrants` returns early (`evaluate.ts`) |
| Approval pause | same gate (`applyApprovalPause`) |
| Precedent grant | it *is* an `allow_grant` → same gate |
| `relax_policy_scope` / `deactivate_policy` | `loosening.ts` skipped all `risk_threshold` ("tuning owns it") |
| `raise_risk_threshold` — the supposed owner | `next = min(100 + 10, 95) = 95`; `95 > 100` is false → never proposes |

`thresholdCap: 95` means a policy sitting at 100 is permanently past the point
tuning's arithmetic can reach, and loosening had deferred to tuning. The policy
fell in the seam between two engines, each believing the other owned it.

**The only action the product left the operator was the one he took.**

### Cause 3 — the feedback loop runs backwards

This is the general defect, and the reason a third label fix would not have held.

Every relaxation rule gates on **adjudicated** outcomes: `resolved >= 5` plus an
override rate. But the operator who is drowning in interruptions is exactly the
operator who stops resolving them. 1,759 interruptions produced ~zero
resolutions, so every rule read "no evidence" when the truth was "maximum
evidence". **The harder the system interrupts, the less evidence it earns to
stop.**

A relief valve that requires the drowning person to reach up and open it is not
a relief valve.

---

## The decision

Three changes, deliberately kept separable so each can be judged and removed on
its own merits.

### B — Fix the label, and close the ownership seam

1. `DESTRUCTIVE_GOAL_PATTERNS` requires `format` to take a **device object**
   (`format c:`, `format /dev/sda`, `format the disk`) rather than merely
   rejecting one flag spelling. Narrowing only ever removes +20, so it cannot
   raise any existing score. Pinned by three golden vectors, and the fix was
   **verified by revert-to-red**: with the old regex, `git-log-date-format-flag`
   fails `30 <= 15` and `npm-run-format-script` fails `45 <= 30`.
2. `tuningCanMove(policyType, rules)` replaces the blanket
   `TUNING_OWNED_POLICY_TYPES` skip. Loosening now defers to tuning only where
   tuning has an arithmetic move available, and claims anything stranded at or
   above `thresholdCap`.

### A — Interruption budget (policy grain)

A policy exceeding `DASHCLAW_INTERRUPTION_BUDGET` interruptions per 24h
(default **50**) is treated as a defect:

- **Reported** on `/policies` as a loosening proposal built from volume alone —
  no adjudication input of any kind. Ratify = permanent deactivation.
- **Enforced** by `applyInterruptionBudget` (`guard/evaluate.ts`), which
  downgrades that policy's `require_approval` verdicts to `warn`.

What it never does, and why:

- **Never reaches `allow`.** `warn` still records and still renders. Volume
  proves a rule is miscalibrated; it does not prove the act is safe. That
  distinction is the whole design.
- **Never touches `block`.** Blocks are absolute (MAINTAINER.md §1).
- **Never demotes an `ungrantable` rule.** A rule an attacker can disarm *by
  firing it* is not a rule. Those are reported with one-click deactivation
  instead — which is also the only route out for such a rule today.
- **Never demotes when any gating policy is under budget.** Relief is only ever
  as wide as the defect.
- **Never edits a policy row.** The demotion expires from the rolling window on
  its own, restoring the exact prior posture with nothing to reconcile.

### C — Interruption budget (command-shape grain)

The surgical sibling. `commandShapeKey()` reduces a `declared_goal` to a coarse
verb identity — `rtk proxy npx biome check .` and `biome check src/` both key to
`biome check`; every `git log` variant across every repo and flag keys to
`git log`. A shape over `shapePerWindow` (default **10**) in 24h stops
interrupting **while its policy keeps enforcing everything else**.

Deliberately coarse: the operator's judgment "I do not need to approve git log"
is about the verb, and a key that changed with every `--since` value would never
reach a budget.

`deriveOverBudgetShapes()` is shared by the guard (which enforces) and the
`/policies` payload (which explains), so the two can never bucket differently.

---

## Rejected

- **Attendance signals** (interrupt less when a human is at the keyboard).
  Rejected on the evidence: Wes reported the pain as *mostly unattended*, which
  is also THESIS.md's subject. The 2026-08-11 document rejected these as
  forgeable; that reasoning stands and is now moot.
- **Auto-allow on repeat.** C could have auto-allowed the 2nd..Nth identical
  shape. `warn` gets the same relief without ever letting an unapproved act
  through unrecorded.
- **A fourth label fix alone.** 2026-07-01 fixed `--format=`; 2026-08-11 fixed
  `node_modules/.cache`; each was followed by a new firehose. Fixing the current
  false positive without fixing the feedback loop loses the same game a third
  time.

## Cost

- **Migrations: 0.** The budget is a `settings` row
  (`DASHCLAW_INTERRUPTION_BUDGET`, registered in `VALID_SETTING_KEYS`); evidence
  is computed from `guard_decisions`.
- **Surface budget: 0 of every ceiling.** No new route, page, policy type, SDK
  method, MCP tool, or CLI command. The proposals ride the existing
  `/api/policies/loosening` contract and the existing TriageInbox queue.
- **Guard hot path: at most one extra aggregate per org per 60s per instance**,
  behind its own cache (longer TTL than every other guard cache, because it is
  the only rolling aggregate rather than a config row). Both loaders fail to an
  empty set — the fail direction is more interruptions, never fewer.

## Verified

- Full suite `4855 passed`, lint clean, `tsc --noEmit` clean, `next build` clean,
  Python hook suite `133 passed`.
- **Revert-to-red** on the regex (both incident vectors go red on the old pattern).
- **Rendered** on `/policies` against seeded data: both cards draw in the LOOSEN
  queue, showing `now warning only` for the grantable rule and
  `still interrupting (ungrantable)` for the protected one.
- **Enforcement, policy grain:** isolated over-budget rule → `warn` +
  `builtin:interruption_budget`, original gating reason preserved as
  `over-budget past: …`.
- **Enforcement, blocks:** a co-gating block rule keeps `block`, no marker.
- **Enforcement, shape grain:** same policy, same action type —
  `git log` → `warn` + `builtin:shape_budget`; `cowsay` → `require_approval`.

## What would prove this wrong

1. **The budget never fires for anyone in 30 days** while interruption volume
   stays high → the default of 50/24h is set wrong, not the mechanism.
2. **A demotion is implicated in a real incident** → the `warn`-not-`allow`
   boundary was too weak; the correct next move is proposal-only, no enforcement.
3. **Wes disables policies again** with the budget live and firing → the problem
   was never interruption volume, and both this document and the 2026-08-11 one
   are evidence for a third recon rather than foundations to extend.
4. **Shape keys collide destructively** — one `commandShapeKey` bucket covering
   acts an operator would judge differently → the key is too coarse and needs
   the target back in it.

## Known gap, not fixed here

The live hook classified read-only `git log` as `action_type: apply` (base 60)
rather than `review` (base 10). That is a second, independent miscalibration in
the hook's action-type mapping. It is recorded in the golden vector's `source`
and left alone — fixing it belongs with the hook classifier, not this change.
