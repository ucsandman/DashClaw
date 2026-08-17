# Calibration controller: the demote arm

**Date:** 2026-08-17
**Trigger:** Wes — *"let's update the calibration engine so that it loosens as
well as tightens, I'm tired of hitting approve for basic shit."*
**Theory:** `docs/architecture/governance-core-theory.md` §1
**Code:** `app/lib/guard/calibration.ts`, `app/lib/guard/evaluate.ts`

## The defect

The calibrated interruption controller shipped in v4.74.0 with one arm. Above
the calibrated threshold θ it could raise `allow`/`warn` to `require_approval`.
Below θ it could do nothing at all — "tighten-only" was written into the module
header as a charter constraint, and loosening evidence was routed to the
human-ratified proposal rails on `/policies`.

That made the controller's own target unreachable. The ACI loss is
`ℓ_t = 1{score ≥ θ ∧ benign}`, so:

- an approval at or above θ pushes θ **up** — fewer controller interruptions;
- an interruption a *policy* raised below θ contributes `ℓ = 0`, pushing θ
  **down**, and stands regardless of how often the operator waves it through.

So the org's actual interruption load had no upper control: the controller
could add interruptions forever and never remove one. Theorem 1's fixed point
was reachable only from below. Convergence to α was, in the doc's own words,
"conditional on humans ratifying the loosening proposals" — and the 2026-08-16
incident is what that condition costs when the human is exactly the resource
the interruptions have exhausted (1,759 interruptions in seven days, ~none
resolved, then every policy switched off).

The interruption budget shipped the day before handles the *volume-only* case:
drowning, nobody clicking. This handles the complementary one, which is Wes's:
the human **is** clicking, over and over, on the same low-risk work.

## The change

Below θ, the controller demotes a policy's `require_approval` to `warn`. The
interruption set it governs is then genuinely `{score ≥ θ}`, and ℓ is a
function of θ in both directions again.

New state field, `reliefCeiling` — the highest risk score the operator has
personally approved and has not since objected to at or above:

| verdict at score *s* | effect |
|---|---|
| `benign` (approved) | `reliefCeiling = max(reliefCeiling, s)` |
| `dangerous` (denied) | `reliefCeiling = min(reliefCeiling, s − 1)` |

It starts at **−1**, which is the bootstrap guard: a bare `score < θ` test
would relieve everything under 80 the instant the mode was flipped, because
θ starts at 80. Asymmetric on purpose — one approval earns a band, one denial
takes it back on the very next evaluation.

`would_relieve` needs four gates, each closing a different way relief could be
unearned:

1. `labeledTotal ≥ 10` — enough adjudications for the state to carry information;
2. `score < θ` — the calibrated threshold says the interruption is not earned;
3. `score ≤ reliefCeiling` — a human has ruled on a band at least this risky;
4. the owning agent has no standing e-process alarm — the one signal that
   outranks the operator's own click history.

Gates 1 and 2 are disjoint from the raise arm by construction (`score ≥ θ` vs
`score < θ`), so a single evaluation can never both raise and demote.

### Modes

`off | shadow | relief | active`, ordered by enforcement added.

- **`relief`** runs the demote arm only. It strictly *reduces* enforcement, so
  it is one click on `/calibration` with no confirm step. This is the mode for
  the operator the change was asked for.
- **`active`** runs both arms and keeps its two-step confirm, because it can
  still add interruptions.

## What it deliberately does not do

- **Never reaches `allow`.** `warn` still records, still renders on
  `/decisions`, still carries the gating reasons (moved to warnings under
  `uncalibrated past:`). The row says plainly that no human approved it. This
  is the difference between "this interruption is miscalibrated" (what the
  evidence shows) and "this act is safe" (what it does not).
- **Never touches `block`.** MAINTAINER.md §1.
- **Never touches an `ungrantable` rule.** Same F1 carve-out as the budget: a
  rule an attacker could disarm *by firing it* is not a rule. A warning keeps
  the condition visible on the row instead.
- **Never edits a policy row.** Every effect is recomputed from live state on
  the next evaluation, so the prior posture returns on its own with nothing to
  reconcile. Standing policy CHANGES remain human-ratified (§3) — what moved is
  the interruption, not the rule.
- **Never touches an external provider's escalate,** or anything with no gating
  org policy. Same boundary the interruption budget draws.

## Non-erasure

`builtin:calibration_relief` joins `builtin:interruption_budget` and
`builtin:shape_budget` in the loosening evidence queries
(`getInterruptVolumeByPolicy`, `getRecentInterruptGoals`). Without it the
signal self-erases: the demote arm runs *first* and short-circuits the budget
phase entirely, so a relieved decision would drop out of the volume count,
which restores the policy, which raises the count — an oscillator.

The controller's own feedback does not erase either. A relieved action produces
no adjudication, so θ and `reliefCeiling` stop moving for relieved bands — but
interruptions above θ keep being adjudicated. Deny at θ and θ falls, relief
narrows, more actions interrupt again, more labels arrive. A control loop, not
a ratchet.

## Verification

- **Reachability asserted, not inferred** (the 2026-08-16 lesson: five relief
  paths were simultaneously excluded and no test noticed). `guard-calibration.test.js`
  gains a demote-arm suite whose four reachability assertions were confirmed RED
  with the arm disabled, plus negative tests for allow / block / ungrantable /
  alarmed-agent / too-few-labels / past-the-ceiling.
- `calibration-controller.test.ts` pins the bound's earn-and-retract behaviour
  and the raise/demote disjointness across θ ∈ {20, 55, 80, 102}.
- `/calibration` driven headless in demo mode: four mode buttons render, Relief
  is clickable, and the banner reports the bound the fixture's own adjudication
  history supports (θ 68, ceiling 84) rather than a hardcoded number.
- lint, full vitest (4885), `next build`, and the six contract gates.

## Charter note

MAINTAINER.md §3 forbids auto-applied *policy* changes. This is not one: no
policy row is written, and the effect is recomputed per evaluation from state
the operator's own verdicts produced. It takes the same carve-out the
interruption budget took on 2026-08-16, with strictly more evidence behind it
— the budget acts on silence, this acts on clicks. MAINTAINER.md itself is
unchanged (§5).
