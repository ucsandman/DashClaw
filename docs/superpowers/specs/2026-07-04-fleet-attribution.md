# v4.3 — Fleet attribution: parent → subagent → workflow lineage (spec)

Roadmap: `docs/plans/owner-roadmap.md` v4.3. Drafted 2026-07-04 from code
recon (identity plumbing map) + live ledger evidence. Extends v2.2
(`docs/rfcs/2026-06-01-subagent-fleet-identities.md`).

## What the evidence says

- **Composed identity works and is live.** `<parent>:<subagent_type>` ids
  are 24% of real 7d traffic; the server-side family fallbacks
  (`baseAgentId` at guard policy scoping, pairing/permission, x402 budget,
  tenant ownership, trust posture) are all in place and smoke L1–L3 pin
  them. The roadmap's "policies and budgets can target a family" line is
  **already true** — `guard_policies.agent_ids` listing a parent matches
  every composed child (`app/lib/guard.ts` `loadApplicablePolicies`), and
  the x402 family budget sums `base` + `base:%` spend.
- **`swarm_id` is the harness session uuid** and is stamped on spawn calls
  and subagent leaf calls only (41% of rows) — it groups a session's
  fan-out coarsely. `GET /api/swarm/graph?swarm_id=` already scopes to it
  server-side, but no UI ever passes the param — the fan-out view exists
  and is unreachable by humans.
- **`parent_action_id` is dead** (0 rows ever; no writer in hooks or
  repositories). The per-leaf → spawn link cannot be stamped client-side
  without a heuristic: the subagent uuid on hook stdin is not the spawn's
  `tool_use_id`, and the spawn's PostToolUse (whose tool_response carries
  the uuid, e.g. `agentId: a0e9...`) fires only when a synchronous
  subagent *completes* — after its leaf calls already recorded. Lineage
  must therefore be *persisted evidence joined at read time*, not a
  client-side guess.
- **`action_records.session_id` must not carry the harness uuid.**
  It belongs to the `sess_*` DashClaw-session namespace;
  `sessionActionMatchSql`'s window-fallback would double-count a
  harness-stamped row into overlapping `sess_*` aggregates (v4.2 deferred
  this here for exactly that reason). A separate column is required —
  `coverage_reports.harness_session_id` already set the precedent.
- **Workflow fan-outs are ungoverned at the spawn layer.** `Workflow` is
  not in the hook matcher; a 110-agent fan-out starts with no guard
  evaluation and no orchestration record. Leaf calls inside
  workflow-spawned agents do land governed (composed ids), but nothing
  identifies *which* fan-out run — and no run identifier exists on hook
  stdin or env (verified: hook input carries only session_id, tool_name,
  tool_input, tool_use_id, agent_id, agent_type). Per-run granularity
  below the session is an **upstream gap**, recorded as such.
- **JWKS key lookup (`app/lib/identity.ts`) is exact-match, no family
  fallback** — flagged since the v2.2 RFC. This is *correct*: signing
  keys are per-identity credentials; a subagent silently inheriting the
  parent's key verification would weaken attribution. Kept exact,
  recorded as a deliberate decision.

## Verdicts

1. **BUILD — `harness_session_id` on `action_records`** (drizzle/0049,
   nullable text; index `(org_id, harness_session_id)`). The pretool hook
   stamps it on **every** record (guard `?record=true` payload and
   `POST /api/actions` fallback), not just swarm calls; the Stop hook
   stamps it on text-turn actions. Server validates (≤ 200 chars) and
   persists; `session_id` and its `sess_*` semantics are untouched.
   `swarm_id` keeps its current writers (back-compat; it remains the
   "spawn-ish" marker) — new consumers key on `harness_session_id`.
2. **BUILD — spawn linkage as persisted evidence, joined at read time.**
   (a) Leaf rows: pretool already receives the subagent instance uuid on
   stdin (`intel.subagent.agent_id`) — persist it to a new
   `action_records.subagent_uuid` column (same migration).
   (b) Spawn rows: posttool extracts the spawned `agentId` from the
   Agent/Task tool_response and sends it as
   `outcome_metadata.spawned_agent_uuid` (works for sync spawns because
   the patch lands at spawn completion; async spawns patch at launch).
   Build finding: the outcome whitelist has always **dropped**
   `outcome_metadata` server-side — so the server selectively persists
   this one key into the row's `outcome_progress` jsonb (the rest of
   `outcome_metadata` stays dropped), and the stamp is not gated on the
   row still being `running` (a sync spawn's patch can land after the
   Stop hook auto-closed the spawn row; lineage is not a close field).
   (c) The lineage tree is a read-time join:
   `leaf.subagent_uuid = spawn.outcome_metadata->>'spawned_agent_uuid'`,
   scoped inside one `harness_session_id`. `parent_action_id` may be
   backfilled from that join by the read path opportunistically, but no
   client ever guesses it. If the uuid never appears in tool_response for
   some harness version, those leaves still attribute via composed id +
   harness session — degradation is visible, not silent.
3. **BUILD — govern the Workflow fan-out.** Add `Workflow` to the
   PreToolUse/PostToolUse matchers (canonical `hooks/settings.json`,
   installer blocks, Codex config template) and classify it as
   `orchestration` (same class as Agent/Task spawns) so a fan-out is
   guard-evaluated and recorded before it runs. Per-leaf workflow-run ids
   remain impossible until the harness exposes a run identifier on hook
   stdin — recorded here as the explicit upstream gap; leaves of a
   workflow run attribute via composed id + `harness_session_id`.
4. **NO CHANGE — family-scoped policies and budgets.** Already shipped
   (v2.2 + x402 family budget) and pinned by smoke L1–L3. v4.3 adds no
   new scoping mechanism; the acceptance's "family-scoped policy fires on
   a leaf" is satisfied by the existing seam and re-proven live.
5. **BUILD — fan-out surface: make the lineage humanly reachable.**
   `/agents` already tree-groups families. What's missing is the
   *session/fan-out* unit: a "Fan-outs" panel on `/agents` (below the
   fleet table) listing recent harness sessions (from
   `action_records.harness_session_id`, synthetic excluded): agents
   involved (parent + composed leaves), spawn count, action count, first/
   last activity — each row deep-links to `/swarm?swarm_id=<id>` and the
   swarm page finally passes the already-supported param to
   `GET /api/swarm/graph`. One new repository read + one route extension
   (`GET /api/agents/fanouts` or folded into an existing agents route via
   repository), no new page.
6. **NO CHANGE — JWKS exact-match (deliberate).** Signing keys never
   inherit across the family; recorded to close the RFC's open flag.
7. **SCOPE — guard_decisions gets no lineage columns.** The composed
   `agent_id` on the decision row is the family lineage; the harness
   session already flows inside the guard `context` JSON for diagnostics.
   Adding indexed lineage columns there is deferred until a consumer
   needs to *query* decisions by session (none does today). Explicit
   decision, not an oversight.

## Human surface (HUMAN-EXPERIENCE gate)

- **See it:** `/agents` — families render as the existing tree; the new
  Fan-outs panel lists recent multi-agent sessions. `/swarm` scoped by
  fan-out via the deep link.
- **Discoverable:** both panels live on pages already in the nav; the
  deep link is a click, not a URL to paste.
- **Clicks only:** the human reads the tree, clicks a fan-out, sees the
  scoped graph. No terminal steps.
- **Rendered proof:** frontend-verify drives `/agents` (tree + fan-outs
  panel with real data) and the scoped `/swarm` view after a real
  multi-agent session.

## Acceptance

- Live proof with a real multi-agent session (this repo's own agent
  traffic qualifies): ledger rows carry `harness_session_id`; leaf rows
  carry `subagent_uuid`; a spawn row carries
  `outcome_metadata.spawned_agent_uuid`; the read-time join renders the
  fan-out as one unit with per-leaf attribution; a family-scoped policy
  interrupt on a composed child re-proven (smoke L1 stays green).
- Hooks pytest: pretool stamps `harness_session_id` on every record and
  `subagent_uuid` on subagent leaf calls; posttool extracts
  `spawned_agent_uuid` from an Agent tool_response fixture; Workflow
  matcher fires (spawn classified `orchestration`).
- Smoke: new `W` section — record two actions under one synthetic
  harness session (parent + composed child with subagent_uuid), verify
  the fan-out read returns them as one unit with the join populated;
  synthetic exclusion holds (smoke fan-outs invisible in the real view).
- Gates: lint, typecheck, full vitest, `next build`, doc counts (route
  count unchanged unless a new route is added — if `/api/agents/fanouts`
  ships, +1 and swept), migration applied locally + fresh-install parity
  (runtime-schema reconcile + contracts declaration for both new
  columns).
