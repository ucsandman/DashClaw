# Decision: DashClaw governs fleets and teams of agents, not one agent (2026-07-09)

**Status:** Adopted. Owner decision (Wes), recorded verbatim intent; amends
[`THESIS.md`](../../THESIS.md) (see its "Owner amendment — 2026-07-09" section).

## The decision

DashClaw's subject is the **fleet and the team of agents**, not a single
coding agent in isolation. Collaboration between agents is a necessity for a
great team — and governed collaboration is approval-layer work, not
agent-platform work. A **Team Tasks** surface (task + inter-agent event
timeline: who leads, who delegated what, which governed actions and approvals
each exchange produced) is therefore in scope.

## Why

- The wedge user was always plural: THESIS.md's "For whom" already names
  "background fleets" and unattended multi-session runs. One human governing
  several cooperating agents is the normal case this product exists for, and
  that human needs to see the collaboration, not just the individual tool
  calls.
- The first sustained real-world traffic is exactly this shape: the owner's
  Claude Code + OpenClaw two-agent team (Team Protocol, spec in the operator
  workspace at `clawd/docs/superpowers/specs/2026-07-09-team-protocol-design.md`),
  where the two agents delegate to each other, peer-review each other's
  external actions, and route approvals through DashClaw. Dogfooding this is
  how the v5 loop gets exercised by more than one agent at a time.
- Approval context is the product metric. An approval for "post to X" is
  judged in the context of the task that produced it — who asked, who
  reviewed, what the stop condition was. Team Tasks is that context, rendered.

## What this does NOT reverse

- The v5 cull's kills stand. `work_orders`, `routing_tasks`,
  `message_threads`, handoffs, loops, and the agent-platform tier stay dead;
  Team Tasks is built fresh and small, on the loop
  (intercept → decide → approve → prove), as *context for approvals and
  audit* — not a task-execution engine, not a marketplace, not routing.
- The anti-regrowth brake stands. The Team Tasks surfaces (tables, routes,
  SDK methods, MCP tools, one page) raise `contracts/surface-budget.json`
  ceilings **in the same commit that adds them**, per the brake's own rule,
  citing this decision.
- Team/RBAC stays declined (the trigger is still "a second human governing
  an org" — this decision is about a second *agent*, which is already the
  product's subject).

## Alternatives rejected

- **Reuse cull survivors only** (model tasks as parent `action_records` +
  `agent_messages`): considered and rejected by the owner — the collaboration
  timeline is a first-class product surface, worth a clean data model, not a
  view bolted onto action rows.
- **Keep the timeline outside DashClaw** (standalone local board): rejected —
  splits the operator's attention across two surfaces and forfeits the
  dogfood signal.
