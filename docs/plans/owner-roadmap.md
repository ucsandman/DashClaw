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

## Open item — silent-lane witness alarm (qualified under (a), 2026-08-06)

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
saw it." No commitment to shape or date — needs a short spec first; the
detection inputs (liveness probes, witness stamps, action recency per
agent) all exist server-side today.
