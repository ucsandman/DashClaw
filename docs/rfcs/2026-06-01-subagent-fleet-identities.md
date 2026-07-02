# RFC: Distinct sub-agent fleet identities

- **Status:** **COMPLETE** (roadmap v2.2, 2026-07-02). Step 1 (server fallback + hook flag) shipped 2026-06; step 3 shipped with v2.2: default flipped to `distinct`, `/agents` groups composed ids under their parent, `agentExistsInOrg` + agent-targeted policy matching gained the base fallback, and agent-scoped x402 budgets roll composed ids up to the family base. Live pins: policy-smoke I1–I3. Rollback: `DASHCLAW_SUBAGENT_IDENTITY=provenance`. See `docs/plans/2026-07-02-agent-identity-attribution.md`.
- **Date:** 2026-06-01
- **Depends on:** `feat(governance): govern + record Claude Code sub-agents` (commit `a7bbcbc9`)

## Summary

Make Claude Code sub-agents appear as **distinct agents** in DashClaw (`/agents` fleet, decision history, signals, spend) — not just as provenance on the parent — **without breaking the permission/identity model**. Sub-agents must still *inherit* the parent's pairing and permissions (Claude Code's own model: "each subagent inherits the parent conversation's permissions").

## Background — what already shipped

`a7bbcbc9` governs the spawn (`Agent|Task` in the matcher) and records sub-agent **provenance** while keeping the governed `agent_id` = the parent. So today a sub-agent's actions are logged under `claude-code` with `agent_name = claude-code/Explore`, `swarm_id`, and `intel.subagent`. That's correct and safe, but the fleet still shows one agent.

Verified upstream facts (docs, 2026-06-01): `PreToolUse` fires for the `Agent` spawn (`Task` before CC 2.1.63) and *inside* sub-agents (hook stdin carries `agent_id` + `agent_type`).

## Decision

1. **Identity = `{parent}:{agent_type}`**, grouped by sub-agent **type**, not per-spawn. e.g. `claude-code:explore`. All `Explore` runs collapse to one fleet identity (avoids a new identity per spawn). The per-spawn CC `agent_id` (a UUID) stays in `intel.subagent` for instance-level traceability. `agent_type` is lowercased/slugified to a safe id segment; `:` is the reserved parent delimiter.
2. **Always-on safe fallback.** Every per-`agent_id` pairing/identity lookup falls back to the base parent when the composed id has no row of its own. This is what preserves permission inheritance. The fallback is harmless when composed ids aren't in use (it only triggers on an id containing `:` with no exact row).
3. **Hook flag** `DASHCLAW_SUBAGENT_IDENTITY = provenance | distinct` controls whether the hook *emits* composed ids. The server fallback ships regardless (safe). See Rollout for the default.

## Detailed design

### Hook (`dashclaw_pretool.py`)

When `DASHCLAW_SUBAGENT_IDENTITY == "distinct"` and the call is inside a sub-agent (`agent_type` present on stdin), set the governed identity to the composed id:

```python
def _slug(s):  # safe id segment
    return re.sub(r"[^a-z0-9_-]+", "-", (s or "").lower()).strip("-")[:64]

agent_id_to_send = AGENT_ID
if SUBAGENT_IDENTITY == "distinct" and subagent_type:
    agent_id_to_send = "%s:%s" % (AGENT_ID, _slug(subagent_type))
context["agent_id"] = agent_id_to_send
```

Provenance fields (`agent_name`, `swarm_id`, `intel.subagent`) stay exactly as shipped — they still carry the human label, the session swarm grouping, and the per-spawn UUID. In `provenance` mode the behaviour is unchanged from `a7bbcbc9`.

### Server — the fallback (the correctness core)

Add one shared helper and route the governance-critical lookups through it. A composed id `parent:type` resolves to its own row if present, else the base `parent` row.

```js
// app/lib/agent-identity-resolve.js  (new)
export function baseAgentId(agentId) {
  const i = (agentId || '').indexOf(':');
  return i > 0 ? agentId.slice(0, i) : null;
}
// SQL pattern: prefer the exact row, fall back to the base parent.
//   WHERE org_id = $org AND agent_id IN ($id, $base) ... ORDER BY (agent_id = $id) DESC LIMIT 1
```

Sites to convert (each: try exact `agent_id`, else `baseAgentId(agent_id)`):

| File:line | Lookup | Effect of fallback |
|---|---|---|
| `app/lib/guard.js:650` | `permission_escalation` pairing → `permission_level` | **Critical.** Sub-agent inherits parent's permission level (else defaults to `danger` and over-blocks). |
| `app/lib/repositories/agents.repository.js:373` | trust-posture pairing | Sub-agent's Trust Posture shows the inherited level. |
| `app/lib/repositories/agents.repository.js:374` + `:21` | `agent_identities` existence | `identity_verified` inherits the parent's enrolled identity. |
| `app/lib/identity.js:18` | JWKS public key by agent_id | Only matters if a sub-agent presents a JWT (edge case); fallback keeps verification consistent. |
| `app/lib/repositories/agents.repository.js:27` | pairing-exists check | Consistency with the above. |

The fallback is additive and order-preserving (exact match always wins), so an operator can still pair a *specific* sub-agent id (e.g. tighten `claude-code:deploy-bot` to `readonly`) and it takes precedence over the inherited parent level.

### Fleet / UI grouping

`listAgentsForOrg` already `GROUP BY agent_id`, so composed ids appear as rows with **no query change**. Enhancement: in `/agents` and the Mission Control fleet, derive the parent via `baseAgentId()` and render sub-agents indented under their parent (purely presentational). Optional richer model: add a `parent_agent_id` column to `action_records` (migration) for explicit lineage instead of string-splitting — **not required for the MVP**.

### Signals / analytics

Per-`agent_id` signals (e.g. `autonomy_spike`) now get per-sub-agent-type baselines — desirable (a runaway `Explore` is detected independently). Spend/analytics rollups `GROUP BY agent_id`, so they split by sub-agent type for free. Watch for low-volume sub-agent ids tripping per-agent thresholds; tune if observed.

## Correctness analysis

- **Permissions:** preserved via the fallback — sub-agents inherit the parent's `permission_level`. Without the fallback, composed ids would default to `danger` and over-block; **the fallback is mandatory, not optional.**
- **Identity/verification:** hook actions are already `unverified` (no JWT); the identity fallback keeps `identity_verified` consistent with the parent rather than making sub-agents look less trusted.
- **No schema change** required for the MVP (parent derived from `:`).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Composed ids over-block on permission_escalation | The mandatory base fallback (ship + test before emitting composed ids) |
| Fleet composition surprises existing operators | Hook flag, defaulted conservatively (see Rollout) |
| `:` collision with a real agent_id containing `:` | `baseAgentId` only splits parent:type for ids the hook emits; document `:` as reserved |
| Signal threshold noise on low-volume sub-agents | Monitor; per-agent thresholds already configurable |

Rollback = set `DASHCLAW_SUBAGENT_IDENTITY=provenance` (reverts to the shipped behaviour). The server fallback can stay on permanently (no-op without composed ids).

## Test plan

- **Server (JS):** `permission_escalation` — composed id with no pairing inherits the base's `permission_level`; an *exact* composed pairing overrides it. Same for trust-posture and identity lookups. Add to `guard-pipeline.test.js` + `agent-profile-route.test.js`.
- **Hook (Python):** `distinct` mode emits `claude-code:explore` for a sub-agent Bash call (provenance still present); `provenance` mode unchanged; parent (main-thread) calls always emit the base id.
- **Fleet:** a composed id appears in `listAgentsForOrg`; `baseAgentId` grouping is correct.

## Live validation checklist (operator)

On a real instance with the flag `distinct`, spawn an `Explore` sub-agent that runs a Bash command, then confirm in the browser:

1. `/decisions` — the spawn is an `orchestration` action under `claude-code`; the sub-agent's Bash is under `claude-code:explore`.
2. `/agents` — `claude-code:explore` appears (ideally grouped under `claude-code`).
3. A `permission_escalation` policy still resolves the sub-agent to the **parent's** permission level (no spurious block).
4. `/swarm` groups the spawn + delegated work by `swarm_id`.

## Rollout

1. ✅ **Done.** Shipped the **server fallback** (always-on, safe) + the **hook flag** defaulting to `provenance` (no behaviour change for existing instances). Tests green.
2. **← we are here.** Operator opts in: `DASHCLAW_SUBAGENT_IDENTITY=distinct`; run the live checklist above.
3. After validation across a couple of instances, flip the default to `distinct` in a minor release with a CHANGELOG note. (UI grouping of sub-agents under their parent in `/agents` can land here too.)

## Open questions

- Default mode at GA: `distinct` (max visibility, the stated goal) vs `provenance` (no surprise)? Recommendation: ship opt-in, flip to `distinct` default once validated.
- Explicit `parent_agent_id` column now, or keep deriving from `:`? Recommendation: derive for MVP; add the column only if lineage queries need it.
- Group sub-agents by **type** (this RFC) vs per-spawn instance? Recommendation: by type (avoids fleet explosion); per-spawn UUID stays in `intel.subagent`.
