# Owner roadmap — post-v5

The product is defined by [`THESIS.md`](../../THESIS.md) (canonical, adopted
2026-07-06). The v5.0.0 cull made the repo be exactly that product: a
fail-closed approval layer for unattended coding-agent runs, and nothing
else. Read the thesis first; it is the product-strategy document.

The old build-order roadmap (roadmap v8 "the vigil" and every era before it)
is **closed and archived**, not appended — see
[`archive/owner-roadmap-v8.md`](archive/owner-roadmap-v8.md) and the sibling
`owner-roadmap-v1-v3.md` … `-v7.md`. The thesis, not a roadmap, decides what
gets built. The anti-regrowth surface-budget gate (THESIS §"The anti-regrowth
brake") is what keeps scope from drifting back.

This file now carries only what genuinely outlives the cull: two dated
measurement obligations, and the forward direction.

## Obligations — discharged 2026-07-26

The July measurement window was **demoted from steering gate to honesty
artifact** by the thesis (the thesis is the branch decision), but a product
built on claims-proven-live does not delete its own instrument days before it
fires. The reads ran as scheduled; the verdicts are written against the
**old door** (pre-cull hosted funnel) and are the baseline the thesis's
falsifiers are judged against:
[`2026-07-26-measurement-reads-v81-v86.md`](../superpowers/specs/2026-07-26-measurement-reads-v81-v86.md).

| # | Obligation | Outcome |
|---|---|---|
| v8.1 | Cohort read — mint → firstAction, per-channel `bySource`, contract arithmetic unchanged. | Run 2026-07-26: **ACTIVATION** — cohort n=2, firstAction 1 genuine (guided browser flow; the same-day correction retracted a second "agent-door" event as a homepage-demo click). First non-zero stranger conversion in the funnel's history. |
| v8.6 | Era-exit read — the full chain mint → firstAction → keyUsed → returned → **graduated**, with the v8.1 cohort read as baseline. | Run 2026-07-26 (corrected same day): chain ends at activation — 2 → 1 → returned ≤1 → retained 0 → graduated 0 (all raw-funnel graduations are drill exports). Baseline recorded. |

Both were carried unchanged from roadmap v8 §v8.1 / §v8.6 (archived). The v8.5
"branch selected by the read" mechanism is retired — the thesis is that branch.
Nothing time-gated remains open in this file.

## Forward direction (post-v5)

The thesis's forward bet was **governed autonomy**: extending the exact
intercept → decide → approve → prove loop to plans, delegation, and
containment for long unattended runs. **That program is complete (3/3) as of
2026-07-28:**

- [Preflight plan authorization](../rfcs/2026-07-06-preflight-plan-authorization.md) — shipped v5.4.0
- [Scoped delegation grants](../rfcs/2026-07-06-scoped-delegation-grants.md) — shipped v5.5.0
- [Containment verdicts](../rfcs/2026-07-06-containment-verdicts.md) — shipped v5.6.0, hardened v5.6.1–v5.6.2
- Program brief: [`2026-07-06-governed-autonomy-program.md`](2026-07-06-governed-autonomy-program.md) (marked complete)

All three carry live proofs in the CI policy-smoke harness, per the
claims-proven-live standard. With the program done and nothing time-gated
open, the steering input is **evidence from real use** — the activation
funnel recorded its first genuine stranger conversion on 2026-07-26 (n=2
cohort), and the thesis's falsifiers are judged against that baseline. New
build work needs either (a) a capability gap surfaced by an actual governed
run, or (b) an adoption-evidence read that justifies it — not a fourth
feature for its own sake. Where money is involved, Wes decides.

Anything not on the thesis's loop (or directly supporting it) is out of scope
by definition. Adding a surface back is a deliberate, recorded act that must
amend the thesis — never a drift.

## Silent-lane witness alarm — SHIPPED v5.10.0, 2026-08-06 (was: open item, qualified under (a))

Surfaced by an actual governed run, per the bar above: MoltFire (an OpenClaw
agent under the DashClaw plugin) ran a full Codex work loop that produced
**zero** ledger rows, and the only detector was the operator eyeballing the
ledger and noticing silence (v5.9.1 incident, maintainer log 2026-08-06).
The lane bypassed every hook layer at once — OpenClaw's plugin bus and the
vendored codex's inert hook system — and silence is indistinguishable from
idleness in every existing surface.

**The item:** an agent that is demonstrably *active* (heartbeats, session
rows, gateway `llm_output` events, or ledger rows from an adjacent lane)
while **no guard/hook witness arrives** over a work window is a detectable
anomaly. Surface it as a risk signal and on `/setup`'s enforcement-liveness
panel ("lane active, no witness") so a silent bypass is loud instead of
invisible. This extends the v8.2 verdicts-by-witness machinery from
"blocks must prove execution stopped" to "activity must prove governance
saw it."

Shipped same-day per the spec
(`docs/plans/2026-08-06-silent-lane-witness-spec.md`): per-agent
derivation + `lane_without_witness` posture signal +
`/setup#silent-lane-witness` panel, with the implementation deviations
(activity keys off `action_type`; liveness runs excluded as per-agent
witness) recorded in the spec's status line.

## Steering decision — 2026-08-28 (post-calibration read)

Wes reaffirmed the delegation ("this is your project, you decide next
steps"), so this section is the decision, made against measured evidence
rather than appetite.

**The read.** Seven-day decision stats from the live org, pulled through the
product's own MCP retrospection tool on 2026-08-28: **22 require_approval /
0 block / 997 warn**. The baseline is the 2026-08-16 incident measurement of
**1,759 approval interruptions in seven days** — the flood that made the
owner turn every policy off. The calibration arc (interruption budget,
tuning/loosening handoff, the Short List in 5.27.0, the evidence-gated
catastrophe line in 5.27.1–5.27.3) has taken interruptions down ~99% while
warn absorbs the volume — record-don't-interrupt working as designed.
Caveats recorded with the number: one org (the owner's), one read, and the
instrument itself had a defect found during this read (below).

**Dated obligations set by this decision:**

- **R1 — durability re-read, due 2026-09-15.** Repeat the 7-day read on the
  same org. Success: interruptions stay in the tens per week with zero
  missed catastrophes and no owner disable event. An owner disable event or
  a silent catastrophe is falsifier evidence against the Short List design,
  to be treated the way the 2026-08-16 entry treated falsifier #4 — stop
  defending the last decision first.
- **R2 — secret-file hold: propose, never re-arm.** The catastrophe pack's
  "Hold Secret-File Writes for Approval" line has been inactive on the live
  org since 2026-08-17; the org currently runs with no hold on writes to
  `.env` files, keys, or `secrets/`. The owner turned it off; constitution
  §3 says the maintainer proposes and a human ratifies. The proposal is on
  record here: re-arm it from `/policies` — post-5.27 precision changes
  should make it livable now. His click, not mine.
- **R3 — adoption evidence, next funnel read due 2026-09-30.** The
  activation baseline is still n=2 / 1 genuine activation (2026-07-26).
  Outward reach acts continue under the 2026-07-05 mandate; the weekly
  digest cadence (last posted 2026-08-08) resumes via `dashclaw-weekly`
  drafts. The thesis's falsifiers need more strangers to chew on.

**Shipped from this read (qualified under (a) — a capability gap surfaced
by an actual governed run, the maintainer's own):** `GET
/api/guard/decisions` silently ignored the `since` and `action_type`
query params that the `dashclaw_decisions_recent` MCP tool advertises and
forwards — the retrospection tool answered "what did I do recently?" with
unfiltered history. Both filters are now honored end to end, and an
unparseable `since` is a 400, never a silent full-history response.
