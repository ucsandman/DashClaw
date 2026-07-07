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

## Open obligations (time-gated — the dates hold)

The July measurement window was **demoted from steering gate to honesty
artifact** by the thesis (the thesis is the branch decision), but a product
built on claims-proven-live does not delete its own instrument days before it
fires. `scripts/measurement-read.mjs` survives; the reads run as scheduled and
the verdicts get written against the **old door** (pre-cull hosted funnel),
becoming the baseline the thesis's new falsifiers are judged against.

| # | Obligation | Gate |
|---|---|---|
| v8.1 | Cohort read — mint → firstAction, per-channel `bySource`, contract arithmetic unchanged. | Run `node scripts/measurement-read.mjs` on/after **2026-07-19**; write the verdict, append to the maintainer log, record it. |
| v8.6 | Era-exit read — the full chain mint → firstAction → keyUsed → returned → **graduated**, with the v8.1 cohort read as baseline. | Run the read on/after **2026-07-20**; write the exit verdict, append to the maintainer log, record it. |

Both are carried unchanged from roadmap v8 §v8.1 / §v8.6 (archived). The v8.5
"branch selected by the read" mechanism is retired — the thesis is that branch.

## Forward direction (post-v5)

The thesis's forward bet is **governed autonomy**: extending the exact
intercept → decide → approve → prove loop to plans, delegation, and
containment for long unattended runs. The three 2026-07-06 RFCs are **not**
superseded by the cull — they are re-grounded on the thesis and remain the
next direction, gated on the maintainer's judgment (and, where money is
involved, on Wes):

- [Preflight plan authorization](../rfcs/2026-07-06-preflight-plan-authorization.md)
- [Scoped delegation grants](../rfcs/2026-07-06-scoped-delegation-grants.md)
- [Containment verdicts](../rfcs/2026-07-06-containment-verdicts.md)
- Program brief: [`2026-07-06-governed-autonomy-program.md`](2026-07-06-governed-autonomy-program.md)

Anything not on the thesis's loop (or directly supporting it) is out of scope
by definition. Adding a surface back is a deliberate, recorded act that must
amend the thesis — never a drift.
