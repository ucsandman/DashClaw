# RFC: Scoped Delegation Constraints (authority attenuation for subagent fleets)

- **Status:** PROPOSED (program: governed-autonomy, build order 2 of 3 — see `docs/plans/2026-07-06-governed-autonomy-program.md`)
- **Date:** 2026-07-06
- **Depends on:** composed fleet identities (`docs/rfcs/2026-06-01-subagent-fleet-identities.md`, COMPLETE — identity = `{parent}:{agent_type}`, base-fallback lookups, `swarm_id`/`intel.subagent` provenance). The calibration controller WIP must be landed first (shared `evaluate.ts`/`policy.ts` seams).
- **Trust model:** ADR D1 (`docs/architecture/trust-and-failure-model.md`) — guard inputs are attestations; per-agent DENY rules already require verified identity and fail closed for unverified callers. This RFC follows that exact precedent.

## Summary

Today a subagent inherits its parent's **full** authority — fleet identities give children *names* but not *boundaries*. This RFC adds a new guard policy type, `delegation_constraint`, that makes a child's effective authority a provable subset of its parent's: risk ceiling, action-type allow/block lists, path scope, and spawn depth, enforced server-side on every guard call from a composed identity. Monotonic attenuation: constraints can only tighten, never widen.

## Motivation

- The marginal risk in 2026-27 multi-agent topologies is the subagent two levels down doing something only its grandparent was trusted to do. Nothing in the platform can express "Explore subagents may read anything but never write outside `docs/`" today.
- The two hard prerequisites competitors lack are already shipped here: verified agent identity (JWKS) and composed fleet identities. The attenuation layer is a thin, high-leverage addition.
- Deliberate v1 modesty: **server-side constraint policies, not cryptographic delegation tokens.** Signed spawn-time macaroons are the v2 upgrade path; v1 rides the same attestation trust model as everything else (D1), with the same verified-identity fail-closed escape hatch for callers who want it hard.

## Non-goals (v1)

- No cryptographic delegation tokens minted at spawn (v2; leave a `token` field out entirely rather than half-designing it).
- No per-spawn-instance constraints — constraints bind to the composed *family* id (`parent:agent_type`), matching how identities collapse by design.
- No changes to how hooks compose identities (`DASHCLAW_SUBAGENT_IDENTITY=distinct` behavior is untouched).
- No team/RBAC (explicitly deferred on the owner roadmap watch-list; do not drift into it).

## Design

### It's a policy type, not a new subsystem

`delegation_constraint` becomes the 18th entry in `POLICY_EVALUATOR_MAP` (`app/lib/guard/policy.ts`). This means it automatically rides every existing rail: policy CRUD (`/api/policies`), YAML import, policy modes/packs, `/api/policies/simulate`, the contract view, tightening/loosening proposal surfaces, and the `/policies` UI. **No new tables. No migration.** That is the headline economy of this design — cite it in the ship notes.

### Rules schema (the `rules` JSON of a `delegation_constraint` policy)

```json
{
  "parent": "claude-code",            // base agent id this constrains, or "*"
  "child_types": ["explore", "*"],    // slugified agent_type segments, or "*"
  "max_risk_score": 60,                // over ceiling → escalate
  "allowed_action_types": null,        // null = no allowlist; else exhaustive list
  "blocked_action_types": ["deploy", "payment"],
  "blocked_path_globs": ["**/.env*", "prod/**"],  // reuse protected_path matching helpers — do NOT write a second glob matcher
  "max_depth": 1,                      // max ':'-separated child segments
  "escalate_action": "require_approval",  // or "block"
  "require_verified_parent": false     // true → unverified caller = violation (fail closed, D1 precedent)
}
```

Validation on write (in the policies route's existing validation seam): `escalate_action` ∈ {require_approval, block}; `max_risk_score` ∈ 0–100 (risk is 0–100 in this codebase, not 0–1); globs validated by the same validator `protected_path` uses.

### Evaluator semantics

The evaluator fires only when the caller is a **composed identity** (`agent_id` contains the reserved `:` delimiter) or when `intel.subagent` provenance is present with a composed name; plain parent agents are never affected (zero risk to existing fleets — the evaluator is a no-op for them).

Matching: split `agent_id` on `:` → base parent + child segments. A policy applies when `parent` matches the base (or `*`) and any child segment matches `child_types` (or `*`).

Checks, each producing a violation reason when tripped:

1. **Depth:** child segment count > `max_depth`.
2. **Risk ceiling:** the adjusted risk score for this call > `max_risk_score`. (Evaluator ordering note below.)
3. **Action type:** in `blocked_action_types`, or `allowed_action_types` is non-null and the type is absent.
4. **Path scope:** the evidence-derived or declared paths match `blocked_path_globs` — reuse the exact path-extraction the `protected_path` evaluator uses; do not invent a parallel extraction.
5. **Verification:** `require_verified_parent: true` and `verification_status` is not verified → violation (fail closed; identical posture to per-agent DENY rules under D1).

Any violation → `applyResult` with `escalate_action` and reason `Delegation constraint '<policy name>': <specifics>`, then `raiseDecision`. **Tighten-only by construction**: the evaluator can only raise; it never grants, never lowers, and `block` remains undowngradable by any later pass.

**Ordering caveat (resolve at build time):** if the risk-ceiling check needs the *final* adjusted risk (post-predictive), the check cannot run inside `runLocalPolicies` where per-policy evaluators live. Options: (a) evaluate risk ceiling against the pre-adjustment blended score available at local-policy time (simpler, slightly weaker), or (b) split: structural checks (1,3,4,5) run as a normal evaluator, the risk-ceiling check runs as a small dedicated pass right after `computePredictiveRisk` folds in. Prefer (b) only if (a) provably misses real cases; document the choice in the code comment. Run GitNexus `impact` on `runLocalPolicies` and `computePredictiveRisk` before deciding.

### Base-fallback interaction (subtle, test it)

Fleet-identity RFC rule: per-`agent_id` lookups fall back to the base parent when the composed id has no row. Delegation constraints must NOT be defeated by this: the evaluator matches on the *composed* id string itself, independent of whether an `agent_identities` row exists for the composed id. Add an explicit test: unpaired composed id still gets constrained.

### Settings / caches

None needed — policies already flow through the guard's policy fetch, which is already cached. No new hot-path cost for non-composed callers (early return).

### SDK / MCP / plugin parity

- Policy CRUD already covers create/list/update — **no new routes**. Add one convenience helper per SDK: Node `createDelegationConstraint(rules)`, Python `create_delegation_constraint(rules)` (thin wrappers over the existing policy-create method), so the docs have a first-class verb.
- MCP: `dashclaw_policies_list` already surfaces it. No new tools.
- Hooks: **no changes.** Identities are already composed; enforcement is server-side. (Optionally, the pretool block message for a delegation violation should name the constraint so the parent agent can adapt — that comes free through the existing reason plumbing.)
- Update the guard-policy-type count everywhere it is cited (17 → 18): README, PROJECT_DETAILS, docs, the platform-intelligence skill snapshot. `scripts/check-doc-counts.mjs --strict` before commit.

### UI surface (HUMAN-EXPERIENCE.md — answered in writing)

1. **Where does a human SEE it?** Two places. (a) `/agents/[agentId]`: a **Delegation** panel on the parent's detail page — lists observed subagent families from the ledger (they already render grouped under the parent per the fleet-identity ship), shows any constraint policy covering each family, and offers a `Constrain this family` button that opens a pre-filled policy form (parent + child_type pre-populated from the observed family). (b) `/policies`: `delegation_constraint` appears in the policy list like any other type, and the "Add protection" shield gallery gains a **Subagent Constraint** template.
2. **Discoverable?** The Delegation panel sits on the agent detail page operators already visit, seeded from *observed* families — the UI shows real spawned subagents and asks "constrain?", not an empty form.
3. **Every human step a CLICK?** Yes: create/edit/delete constraints are forms and buttons on existing policy surfaces; the pre-filled path means zero identifier typing.
4. **Verified rendered?** frontend-verify drives `/agents/[agentId]` with a seeded composed-identity ledger and asserts the panel + pre-filled form; drives `/policies` and asserts the new shield template renders.

`/swarm` graph: render a small constraint badge on edges into constrained families (token colors; orange only if a constraint was violated recently). Nice-to-have — cut it from v1 if it threatens the ship, but say so in the ship summary.

## Invariants (charter compliance)

1. Tighten-only: the evaluator can only raise decisions. No grant path exists in this policy type.
2. No-op for non-composed callers: zero behavior change for every existing single-agent fleet.
3. Fail closed on unverified identity **only when** `require_verified_parent` is set — opt-in hard mode, matching the D1 verified-identity precedent exactly.
4. Constraints are ordinary policies: human-created, human-edited, visible in the contract view, simulatable before adoption.

## Testing & verification gates

- Unit (vitest): evaluator matrix — parent/child_type matching incl. `*`; depth counting (`a`, `a:b`, `a:b:c`); risk ceiling at/above boundary; allow/block action-type lists; glob reuse (one test proving it matches `protected_path` behavior byte-for-byte on shared fixtures); verified/unverified × `require_verified_parent`; escalate_action both values; composed id with no identity row (fallback interaction); non-composed caller no-op.
- Policy route validation tests for the rules schema.
- `scripts/policy-smoke.mjs`: live section — create constraint, guarded call as `parent:child` trips it, call as bare parent does not.
- Full gates: `npm run lint`, `npx vitest run`, `npx next build`, `npm run typecheck`, `scripts/check-doc-counts.mjs --strict`. No migration to verify (no new tables — assert this stayed true at review).
- frontend-verify on `/agents/[agentId]` and `/policies`.

## Documentation contract (same ship)

Policy-type count 17→18 everywhere cited. `docs/architecture/runtime-api.md` policy-type table + one worked example. SDK READMEs gain the convenience helper. A policy-modes pack entry is optional v1 (a "Claude Code subagents" starter constraint in the Claude Code mode is a natural fit — decide at build time, count implications included). Marketing site feature blurb in the same ship. Version bump via `npm run version:set`.

## Open questions (resolve at build time, do not guess)

1. Risk-ceiling ordering: option (a) vs (b) above — decide against real code, document in-line.
2. Should the Claude Code policy mode ship a default constraint template (observe-grade, `escalate_action: require_approval`)? Recommend yes if mode-pack plumbing makes it a one-liner.
3. Does `intel.subagent` provenance ever carry composition the `agent_id` string lacks (provenance mode)? If yes, decide explicitly whether provenance-only callers are in scope for v1 or documented out.
