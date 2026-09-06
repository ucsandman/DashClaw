# RFC: Graded Clearance — earned autonomy bound to model and harness

- **Status:** DRAFT — awaiting owner acceptance. Proposed 2026-09-06 by Wes ("the nuanced layer of approvals for all agentic actions").
- **Date:** 2026-09-06
- **Relation to THESIS.md:** EXTENDS, does not replace. The thesis product ("give unattended AI agents useful work while keeping consequential calls subject to policy and remote human approval") is unchanged. This RFC adds one primitive to step 2 of the loop and one derived signal to step 4. The Approvals inbox stays the one front-door surface.
- **Constrained by:** `docs/architecture/enforcement-boundary.md`. Clearance changes what the guard *decides*; it does not extend where DashClaw can *enforce*. A level is worth exactly as much as the seam it rides on.
- **Depends on:** an outcome signal that is not the acting agent's own word (§4). Without it the ladder promotes on volume, which is the farmable failure. **This RFC should not be implemented level-first.**

---

## 1. Summary

Today a policy verdict is a function of the act and the org's policy set. An agent either has a capability or does not, and that does not change with the agent's record.

This RFC makes the verdict also a function of a **clearance level** held not by "the agent" but by a tuple:

```
clearance( principal, model, harness attestation, capability class, context conditions ) -> level
```

Levels raise the bar an act must clear before it interrupts a human. Promotion is a **human click on a system-authored proposal with evidence attached**. Demotion is automatic and immediate. A ceiling of catastrophe-class acts is never opened by any level, at any tenure.

The reason to build this is not nuance. It is **approval fatigue** — the failure mode already in this project's record (2026-08-16: every policy disabled at once because the interruption volume was intolerable; the interruption budget was the patch). A clearance ladder is the principled version of that patch: it shrinks the *hold* set over time without lowering the ceiling.

## 2. The badge metaphor, and where it breaks

The intuition is an employee badge: it opens some doors on day one, more after the person has been around and has a record. Two things about that do not survive contact with agents.

**A badge belongs to a person; an agent is not a person.** Humans have persistent identity, memory of consequences, and a career they do not want to end. An agent instance is forkable, re-promptable, and one untrusted web page away from being a different principal in the same process. Trust earned by agent `A` does not safely transfer to `A`-after-untrusted-input. This is the same trifecta rule already in the working agreement (private data + untrusted content + outbound channel), expressed as a demotion condition rather than a prohibition.

**Tenure is a farmable signal.** Promotion on a clean streak is exactly what an attacker (or an unlucky run) grinds out: a few hundred boring approved actions, promotion, then the one act that matters. Volume of approvals is weak evidence. The load-bearing evidence is whether the *outcome held*, and §4 is honest about the fact that we do not have that today.

## 3. What actually determines whether an agent can be trusted

The owner's framing, recorded verbatim because it is the design constraint:

> "The underlying model and surrounding harness to me is what will drastically impact whether or not an agent can be trusted. Right now I'm having Claude delete some old things on my computer because I'm running out of storage. The only model I trust to do this is Fable 5.1, I would never let Opus 5 or Sonnet 5 do this task. I need the model that truly grasps what it's doing and the consequences of its actions. I also would only do it with a harness I have vetted and built myself — if I was on my friend's laptop and he wanted me to do it for him to clear up space, I would have to first implement my harness with all its hooks, rules, skills, etc."

Two consequences, and they are the most important part of this RFC.

### 3.1 The model is a term in the trust function, not metadata

The same capability class (`delete files on a personal machine, irreversibly`) is a different risk at a different model. The operator's real policy is not "Claude may delete files." It is "**Fable 5.1** may delete files; Opus 5 and Sonnet 5 may propose a deletion and wait." That distinction is unrepresentable in DashClaw today.

**Current state (verified 2026-09-06):** `hooks/dashclaw_pretool.py` sends `enforcement_mode`, `ungoverned_categories`, `harness_session_id`, `client_capabilities`, and subagent provenance. **It does not send the acting model.** `guard_decisions` has no model column. `action_records.model` and `usage_rollups.model_primary` exist for *cost* attribution, not for the decision. So the single term the owner says dominates his trust judgment is invisible to the guard at decide time.

### 3.2 The harness is the other term, and it is the one that carries the hooks

"I would have to first implement my harness with all its hooks, rules, skills" is the sharpest statement of DashClaw's own boundary anyone has made in this repo. The friend's laptop is not less trustworthy because the friend is; it is less trustworthy because **the interception layer is not there**. On that laptop the same model with the same instructions has no PreToolUse seam, no rm-guard, no scope-lock, no skills, no rules file. The act is identical and the containment around it is absent.

So harness is not a nice-to-have dimension of the tuple. **Harness attestation is the precondition for a level existing at all.** An unrecognized harness is level 0 by construction, forever, no matter what its record says. This is also what keeps the feature from contradicting the enforcement-boundary ADR: clearance can only ever *loosen* on a seam DashClaw is actually sitting in.

### 3.3 Attestation honesty (a standing rule for this feature)

The client declares its model and its harness fingerprint. **A declaration is attribution, not proof.** A compromised or hostile client can lie about both.

This is not a new problem here, and the repo already has the honest pattern: `enforcement_mode` is documented as "attribution-only server-side, but it is the ONLY way the dashboard can show that an agent's blocks are not actually enforced." Model and harness attestation get exactly that treatment, plus three hardenings that make lying expensive rather than free:

1. A clearance above the floor **requires `verification_status = verified`** — the JWKS-signed identity path, not body attribution. An unsigned caller can never be above level 0.
2. The attested `(model, harness_fingerprint)` is **bound into the act-binding claim** (`act_hash`), so it cannot be swapped between claim and execution.
3. Any *change* in the attested pair for a live principal is a **demotion event**, logged and surfaced, not a silent re-evaluation.

Outward copy for this feature never says "DashClaw verifies which model acted." It says: the agent declares its model and harness, the declaration is signed and bound, and a change in either drops the clearance.

## 4. The dependency: an outcome signal we do not have

`action_records.outcome_status` (`pending | completed | partial | failed | lost_confirmation`) is **reported by the acting agent**. Promoting on agent-self-reported success is promoting on the defendant's testimony.

Usable independent signals available today, in rough order of strength:

| Signal | Source | Strength |
|---|---|---|
| Operator denied this class | approvals ledger | strong, sparse |
| Operator approved, then reverted / rolled back within the window | git + containment discard | strong |
| Containment `discarded` vs `promoted` | `allow_contained` lifecycle | strong, and already a clean human verdict |
| Plan deviation fired | deviation events | medium |
| Assumption later contradicted | assumptions table | medium |
| Agent self-reported `completed` | action_records | weak — never sufficient alone |

**Recommendation: build the outcome signal first, as its own change, and let it run without any level attached to it.** A promotion proposal is only honest once there is a column that says what happened that the agent did not write. The containment `promoted`/`discarded` pair is the best starting point because it is already a human's judgment on a specific act, recorded, with no self-report in the path.

## 5. Design

### 5.1 The level

Four levels per `(principal, capability class)`. Deliberately few — a ladder nobody can hold in their head is a policy engine with extra steps.

| Level | Meaning |
|---|---|
| `0 · unknown` | Default. Unattested harness, unverified identity, or no record. Full policy set applies. |
| `1 · working` | Attested + verified. Routine acts in this class stop interrupting; consequential ones still hold. |
| `2 · trusted` | A human has promoted this tuple on evidence. The hold set narrows to the class's genuinely consequential acts. |
| `3 · standing` | Narrow, expiring, explicitly scoped. Behaves like a leased grant, not a permanent state. |

Level enters `evaluateGuard` as one more input to the accumulator. It **cannot** clear a rule marked `ungrantable` (the existing F1 flag already carries control-plane and catastrophe lines) and it **cannot** cross the evidence-gated catastrophe line. That is the whole safety story: the ladder moves the floor, never the ceiling.

### 5.2 Promotion is a click, not a learner

This is the difference from Behavior Learning v1 (simulate-before-adopt) and it is intentional.

The system **proposes**. It never promotes. A proposal names: the tuple (including model and harness), the capability class, the evidence window, how many independent acts, how varied they were, what the outcome signal said, and what the promotion would stop interrupting on. The operator clicks Promote or Dismiss.

Proposal eligibility requires **variety, not volume** — N distinct act shapes (`commandShapeKey` already exists for this), not N repetitions of one shape. A hundred identical `git status` calls propose nothing.

### 5.3 Demotion is automatic, immediate, and cheap

Any one of these drops the tuple one level, with no human in the path:

- an operator denial in that class;
- a containment `discarded`;
- a negative outcome signal (§4);
- the attested model or harness fingerprint changes;
- a context-taint condition — untrusted content entered this session's context and the act reaches an outbound channel (the trifecta, as a demotion trigger);
- the lease on a level-3 grant expires.

Asymmetry is the point. Promotion is slow, evidenced and human. Demotion is fast, automatic and machine.

### 5.4 What this is *not*

Not a replacement permission system. DashClaw does not want to compete with Claude Code's permission modes, Codex's, or cloud IAM — that is a losing fight against every runtime's built-in, multiplied by the plugin-parity treadmill (Claude Code / Codex / Hermes) already flagged in this repo.

The defensible position: **DashClaw is the trust ledger that permission systems read from.** It supplies a graded, evidenced verdict to whoever holds the enforcement point. Enforcement depth stays on the seams we actually own; the model is expressed generically.

The positioning line "the nuanced approval layer for **all** agentic actions" should not ship as written. It claims enforcement coverage we do not have and the enforcement-honesty rule in THESIS.md forbids it. The claim that survives: *approvals that get out of your way as the record justifies it, on the runtimes we actually sit inside.*

## 6. Human surface (HUMAN-EXPERIENCE.md, the four answers)

1. **Where does a human SEE it?** A **Clearance** section on `/policies` — not a new front-door surface. One row per `(principal, model, harness)`, its level per capability class, and any pending promotion proposal. Promotion proposals also appear as cards in the Approvals inbox, because that is where the operator already is.
2. **Is it discoverable?** Yes: proposals arrive in the inbox unprompted, and each links to the Clearance section. The operator never has to go looking.
3. **Is every human step a CLICK?** Promote, Dismiss, Demote, and Revoke-lease are buttons. No CLI path is required for any human judgment in this feature.
4. **Was it verified rendered?** Gate at ship time: drive `/policies` and the inbox, confirm a real proposal card renders with its evidence and that Promote moves the level.

## 7. Surface budget

- Routes: reuse. Promotion/demotion ride the existing approvals resolution path where possible.
- Pages: **zero new pages.** One section on `/policies`, one card type in the inbox.
- Policy types: **zero new types.** Clearance is an input to evaluation, not a new policy type. (A new type would put it on the operator's authoring surface, which is the wrong place for a thing the system proposes.)
- Schema: one clearance table, one outcome-signal column set, `model` + `harness_fingerprint` on `guard_decisions`.
- Hook: extend the existing context attachment (`_attach_client_capabilities` sits right next to where this goes).

## 8. Sequencing

1. **Attestation.** Hook sends attested model + harness fingerprint; server persists them on `guard_decisions`; `/decisions` renders them. No behavior change. Immediately useful on its own: the operator can finally see which model did what.
2. **Outcome signal.** Independent outcome column, starting from containment promote/discard and operator reversals. No levels yet. Runs long enough to check it says something true.
3. **Levels, read-only.** Compute and display clearance; the guard ignores it. Compare what would have been suppressed against what the operator actually approved.
4. **Levels, live.** Clearance enters the accumulator. Ceiling rules untouched. Demotion paths shipped in the same change as promotion, never after.

Steps 1 and 2 are worth shipping even if the owner later rejects the ladder.

## 9. Open questions for the owner

1. **Is the principal the paired agent id, or the session?** A long unattended run is one session; a fleet is many. Levels held per agent id are stable but coarse; per session they reset every run, which may be the safer default.
2. **Does a level survive a model upgrade?** Fable 5.1 → 5.2 is a different attested string. Strictly, demote and re-earn. Practically, that may re-earn constantly. Proposal: same family and version-or-newer keeps the level, anything else demotes.
3. **Should level 3 exist at all in v1?** It is the one that looks most like standing autonomy and least like an approval layer.
4. **Does the ladder apply to spend?** Spend has its own bypass history (2026-09-04). Recommend spend is excluded from clearance in v1 and stays on the existing rail.

## 10. Not in v1 (recorded so they are not silently promised)

- Any claim that DashClaw verifies which model executed an act. It records a signed declaration.
- Clearance on non-seam runtimes (bare SDK/MCP/desktop). Level 0 only, by construction.
- Cross-org or cross-machine reputation. Clearance is org-local and does not travel.
- Automatic promotion of any kind, at any level.
- Clearance over the catastrophe line, at any level, ever.
