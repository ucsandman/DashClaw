# RFC 0001: Generative UI Governance for DashClaw and Practical Systems

> **Superseded 2026-07-06 by [`THESIS.md`](../../../THESIS.md).** Archived: this RFC presumed a three-product company, a different product from the enforcement runtime the thesis commits to. Retained for history.

- Title: Generative UI Governance for the DashClaw + Practical Systems Stack
- Status: Draft
- Date: 2026-06-04 (drafted; revised same day after design review)
- Author: Bellows (Forge governance group)

## 1. Summary and Decision

When an AI agent produces user-interface output, the screen itself becomes an action. The agent can pick a pre-approved component and fill it, describe a UI for a trusted renderer to draw, or emit raw markup. Each of those carries a different risk of showing a person something wrong, unsafe, or fabricated. This RFC sets the rule for how that output is governed before a human sees it. The decision: we build exactly one Controlled component first, the Governance Approval Card, governed end to end inside mission-control using the existing DashClaw SDK loop, on the stack that already exists. The card splits into two parts: the approval chrome (the frame and the approve or deny affordance) renders right away, and the sensitive payload it proposes stays hidden until the governance loop clears it, so the human is never asked to approve something they cannot yet see. The governance loop and the evidence write run server side, never in the browser, because they carry a DashClaw API key. We reject adopting CopilotKit + AG-UI as the foundation for v1. The shared-state behavior those frameworks provide is already covered by the DashClaw Server-Sent Events broker and the mission-control WebSocket + Zustand layer we own (C:/projects/dashclaw/app/api/stream/route.js, C:/Projects/Practical Systems/mission-control/hooks/useWebSocket.ts). We will not introduce a monorepo, a new state framework, or any payment plumbing in v1.

## 2. Ground-Truth Stack Table

Every cell traces to the package.json named in the Evidence path. Versions are quoted from the verified findings.

| Surface | Language | Framework + version | React | State | Data fetching | Charting / diagram / grid / markdown | Test runner | Evidence path |
|---|---|---|---|---|---|---|---|---|
| DashClaw app | JavaScript (no tsconfig.json) | Next.js ^16.2.6 | ^18 | none | none | recharts ^3.8.1, @xyflow/react ^12.10.2, d3-drag/d3-force/d3-selection ^3.0.0, react-grid-layout ^2.2.3, react-markdown ^10.1.0 | vitest ^4.1.0 + @playwright/test ^1.60.0 | C:/projects/dashclaw/package.json |
| mission-control | TypeScript | Next.js ^16.1.6 | ^18.3.1 | Zustand ^4.5.7 | @tanstack/react-query ^5.90.19 (present; not used via useQuery, polling via setInterval) | recharts ^3.7.0, react-markdown ^10.1.0, MDX (@next/mdx ^16.1.4) | vitest ^4.0.18 (no playwright) | C:/Projects/Practical Systems/mission-control/package.json |
| practical-systems-website | TypeScript | Next.js ^16.1.6 | ^18.3.1 | none | none (no swr or react-query) | react-markdown ^10.1.0, MDX (@next/mdx ^14.2.16); no charting/diagram/grid | vitest ^4.0.18 (no playwright) | C:/Projects/Practical Systems/practical-systems-website/package.json |

Notes traced to evidence: the absence of a tsconfig.json in DashClaw and the .js file extensions confirm JavaScript (C:/projects/dashclaw/package.json). mission-control's Zustand stores are TypeScript .ts files (C:/Projects/Practical Systems/mission-control/stores/agentStore.ts). The react-query "present but unused" note is verified: the dependency exists but stores show no useQuery, only manual fetch + setInterval (C:/Projects/Practical Systems/mission-control/package.json, C:/Projects/Practical Systems/mission-control/app/(private)/agents/page.tsx).

## 3. Pattern Reconciliation

Three patterns describe how an agent can produce UI.

- Controlled: the agent selects from a pre-approved component catalog and fills the props. The renderer only ever draws components we shipped. This is the safest pattern because the surface area is fixed and reviewable.
- Declarative (also called A2UI style): the agent emits a UI description or tree, and a trusted client renderer turns that description into real components. More flexible than Controlled, but the renderer must defend against unexpected trees.
- Open-ended: the agent emits raw HTML or markup that is rendered directly. Most flexible, highest risk, because arbitrary markup can carry script, styling, and layout attacks.

Mapping onto the real stack:

- Controlled fits all three surfaces today. DashClaw already renders rich components (recharts, @xyflow/react, react-grid-layout) and could host a catalog (C:/projects/dashclaw/package.json). mission-control has the state and live-event plumbing to drive a Controlled component from agent events (C:/Projects/Practical Systems/mission-control/stores/agentStore.ts, C:/Projects/Practical Systems/mission-control/hooks/useWebSocket.ts). The website has react-markdown + MDX but no charting, so its catalog would be content-shaped (C:/Projects/Practical Systems/practical-systems-website/package.json).
- Declarative is feasible but requires building and hardening a tree renderer we do not have today. No A2UI renderer is present in any of the three package manifests (C:/projects/dashclaw/package.json, C:/Projects/Practical Systems/mission-control/package.json, C:/Projects/Practical Systems/practical-systems-website/package.json).
- Open-ended has no safe home yet. react-markdown exists on all three surfaces but raw HTML rendering needs a sandbox and Content Security Policy that is not specified here. This pattern stays out of scope until that sandbox exists.

The live-state need: a generative UI must update as the agent works and as a human approves. That need is already met by infrastructure we own. DashClaw ships a Server-Sent Events broker with org-scoped channels, event replay via Last-Event-ID, a shared EventSource per browser tab, and heartbeats (C:/projects/dashclaw/app/api/stream/route.js, C:/projects/dashclaw/app/hooks/useRealtime.js, C:/projects/dashclaw/app/lib/events.js). mission-control has a WebSocket client with auto-reconnect, typed message handling, and Zustand stores that deduplicate events by event_id and cap history at 200 (C:/Projects/Practical Systems/mission-control/hooks/useWebSocket.ts, C:/Projects/Practical Systems/mission-control/stores/agentStore.ts).

The CopilotKit + AG-UI decision: REJECT for v1.

- What they offer: a ready-made agent-to-UI streaming protocol and shared-state runtime, which is industry context only and carries no repo citation here.
- Why reject: the shared live-state behavior is the main thing those frameworks sell, and we already have two working implementations of it that we control and can audit (SSE broker and WebSocket + Zustand, cited above). Adopting a new framework means a second event model to reconcile, a new dependency in surfaces that are deliberately lean (the website has no state library and no data-fetching library, C:/Projects/Practical Systems/practical-systems-website/package.json), and a governance gap because the framework would render before our SDK guard runs.
- The tradeoff we accept: we write the catalog-and-renderer glue ourselves instead of getting it from a library. That is a bounded, one-component cost in v1, and it keeps the pre-render guard squarely in our control.
- The cost we avoid: unifying two distinct event envelope formats under a third-party runtime. The DashClaw envelope is id, org_id, event, timestamp, version, payload (C:/projects/dashclaw/docs/rfcs/2026-02-13-sse-broker-design.md); mission-control consumes a different set of message types over WebSocket (C:/Projects/Practical Systems/mission-control/hooks/useWebSocket.ts). Reconciling those is its own project and is listed as an open question, not a v1 dependency.

Verdict, stated plainly: build on the SSE + WebSocket/Zustand foundation we already own. Do not adopt CopilotKit + AG-UI in v1.

## 4. JavaScript and TypeScript Strategy

The DashClaw app is JavaScript with no tsconfig.json (C:/projects/dashclaw/package.json). Both front ends, mission-control and the website, are TypeScript with a tsconfig.json each (C:/Projects/Practical Systems/mission-control/tsconfig.json, C:/Projects/Practical Systems/practical-systems-website/tsconfig.json).

Recommendation for shared rendering and contract code: TypeScript-surfaces-first, no shared package in v1.

- v1 lives entirely inside mission-control, which is TypeScript, so the component catalog contract (the list of allowed components and their prop shapes) is authored as TypeScript types there. This gives compile-time safety on the surface that ships first.
- We do not create a shared package, because that forces a monorepo decision and a JavaScript/TypeScript interop boundary into v1 for no v1 benefit. A monorepo is an explicit non-goal below.
- When a second surface needs the same catalog contract later, the cheapest correct step is to publish the contract as a small typed schema (for example a JSON Schema generated from the TypeScript types) that the JavaScript DashClaw app can validate against at runtime, rather than importing TypeScript into a JavaScript codebase. That choice is deferred to a later phase, not decided here.

## 5. Governance Model

Risk tiers for generative UI output:

- Tier 0, ungoverned: static, developer-authored UI with no agent-chosen content. No guard, no log. Most of each app's existing pages.
- Tier 1, log-only: agent fills a low-risk Controlled component with non-sensitive data (for example a status chip). Record the action for the audit trail, no human approval, no pre-render block.
- Tier 2, guard + approval before render: agent output that drives a human decision or shows sensitive or externally-bound data. This is the governed path. The component must pass a guard check and, when the server requires it, wait for human approval before it is shown.
- Tier 3, out of scope for v1: Open-ended raw markup. Requires a sandbox and CSP that this RFC does not define.

Surface mapping:

- mission-control: hosts the Tier 2 governed path in v1 (the Governance Approval Card). Other agent-driven widgets there are Tier 1 log-only until promoted.
- DashClaw app: Tier 1 log-only for its agent-driven visualizations in v1; it is the governance plane, so its own surfaces are reviewed by humans by design.
- practical-systems-website: Tier 0 ungoverned for static content. Any future agent-authored content block would enter at Tier 1.

The governed path runs server side (a mission-control API route or the company_os backend), never in the browser, because guard, createAction, the artifact write, and waitForApproval all send a DashClaw API key in an x-api-key header (C:/projects/dashclaw/sdk/README.md) and that key must not reach the client. The approval chrome renders in the browser immediately; only the proposed payload waits on the loop below. The path maps onto the real SDK loop (function names and call shapes from the SDK findings):

1. Identity is set once at construction. The client is built with agentId (required) and agentName (optional), per the Node.js constructor (C:/projects/dashclaw/sdk/dashclaw.js) and the Python constructor DashClaw(base_url, api_key, agent_id, agent_name=None, auth_token=None) (C:/projects/dashclaw/sdk-python/dashclaw/client.py).
2. guard(context) is called per render with action_type, declared_goal, and risk_score; agent_id is auto-injected from the constructor unless overridden (C:/projects/dashclaw/sdk/dashclaw.js). The decision object returns decision (allow / block / require_approval / warn) plus verification_status and a server-computed risk_score (C:/projects/dashclaw/sdk/README.md). guard() is advisory.
3. createAction({ action_type, declared_goal, risk_score, ... }) records intent and returns { action, action_id }. The server re-evaluates policy here and action.status is authoritative: even if guard() returned allow, the server may set status to pending_approval (C:/projects/dashclaw/sdk/dashclaw.js, C:/projects/dashclaw/sdk/README.md). Trust action.status, not the guard decision.
4. waitForApproval(action_id, { timeout, interval }) is called only when status is pending_approval. It polls via SSE first (action.updated on /api/stream), falls back to HTTP GET, resolves when action.approved_by is set, and throws ApprovalDeniedError when status becomes failed or cancelled (C:/projects/dashclaw/sdk/dashclaw.js). It must be called with the action_id from createAction (prefix act_), not the decision_id from guard (prefix act_gd_) (C:/projects/dashclaw/sdk/README.md).
5. updateOutcome(action_id, { status, ... }) records finality after the card is shown or the decision is recorded; the server derives cost from tokens + model when not supplied (C:/projects/dashclaw/sdk/dashclaw.js, C:/projects/dashclaw/sdk/README.md). A one-shot terminal report is also available via reportActionOutcome(action_id, { status, ... }) which cannot be rewritten once non-pending (C:/projects/dashclaw/sdk/dashclaw.js, C:/projects/dashclaw/drizzle/0004_action_outcome_finality.sql).

Where the rendered-UI-plus-data evidence snapshot is stored: the artifacts subsystem, not the guard decision row. The snapshot is written as an artifact via POST /api/artifacts with artifact_type set to a snapshot type, name, content_json holding the component name plus the exact data props shown to the human, and source_action_id set to the governed action id (C:/projects/dashclaw/app/api/artifacts/route.js; request body documented at C:/projects/dashclaw/sdk/README.md). Because the evidence bundle endpoint assembles the action plus its steps plus its artifacts for a given action (C:/projects/dashclaw/sdk/README.md, POST /api/artifacts/evidence-bundle), a snapshot linked by source_action_id appears in the compliance export with no extra wiring. We do NOT use guard_decisions.evidence: its own schema comment scopes it to the signed proof receipt and violations for a non_fabrication decision and states it is null for every other decision (C:/projects/dashclaw/schema/schema.js, line 581 to 583; C:/projects/dashclaw/drizzle/0013_non_fabrication_integrity.sql, line 21 to 24). A Governance Approval Card render is not a non_fabrication decision, so that column is the wrong home by design. The summary fields action_records.output_summary and action_records.artifacts_created exist for task outputs but are summary or reference fields, not a payload store (C:/projects/dashclaw/schema/schema.js, lines 137 and 139). What remains to confirm is narrow: the exact Drizzle table name and columns behind the artifacts repository, readable from C:/projects/dashclaw/app/lib/repositories/artifacts.repository.js. The API contract above is sufficient for v1.

## 6. x402 Scope for v1

Decision: x402 is entirely out of scope for v1. We do not add a dependency, a database table, or even an interface or stub, because an always-off interface is still plumbing and v1 ships none. The payment seam is described for a later phase only (see Phase 6, where a forge-themed gate named Tinder would front settlement).

State of the world today, from the findings: no x402 or micropayment implementation exists in either repo. There are no x402 dependencies in any package manifest (C:/projects/dashclaw/package.json, C:/projects/dashclaw/sdk/package.json, C:/Projects/Practical Systems/mission-control/package.json, C:/Projects/Practical Systems/practical-systems-website/package.json). There is no x402 database schema (C:/projects/dashclaw/app/lib/setup/action-records-runtime-schema.mjs). The SDK README mentions x402 only as recorded metadata and states no payment settlement is performed (C:/projects/dashclaw/sdk/README.md). Two planning documents describe a hypothetical capability-acquisition system but ship no runtime code (C:/projects/dashclaw/docs/planning/DashClaw x402 Strategy Doc.txt, C:/projects/dashclaw/docs/planning/dashclaw-x402-capability-acquisition-spec.md).

What v1 contains for payments: nothing. No wallet, no interface, no stub, no method. If a component or data source is gated behind a purchase, it is simply not available in v1.

Later-phase sketch (Phase 6, not v1): if generative UI ever needs to purchase a premium component or data source at render time, a forge-themed gate named Tinder would front a real settlement provider, introduced behind its own RFC and the x402 tables described in the planning spec, which do not exist yet (C:/projects/dashclaw/docs/planning/dashclaw-x402-capability-acquisition-spec.md). Agent Pit (Base, USDC) is named only as separate external prior art for agent-initiated micropayments; it is not available plumbing in these repos and carries no repo citation.

## 7. Pattern Selection Decision Tree

Two axes are in play and should not be confused: the governance tier (how much oversight, from ungoverned up to guard plus approval) and the rendering pattern (Controlled, Declarative, or Open-ended). They are independent. Controlled is the default rendering for both Tier 1 and Tier 2; what changes between those tiers is the governance applied, not the pattern.

```
Start: an agent wants to produce UI output for a human.

1. Is the data static and fully developer-authored (no agent choice)?
   - Yes -> Tier 0, ungoverned. Render directly. No pattern needed.
   - No  -> continue.

2. Does the output drive a human decision, or show sensitive / externally-bound data?
   - No  -> Tier 1, log-only.
            -> Use CONTROLLED (agent fills a pre-approved component).
            -> Record the action; do not block render.
   - Yes -> Tier 2, governed. Continue.

3. Can the need be met by a component already in the approved catalog?
   - Yes -> Use CONTROLLED.
            -> guard -> createAction -> (waitForApproval if pending) -> render -> updateOutcome.
   - No  -> continue.

4. Is the governance cost of building and hardening a tree renderer acceptable,
   and is a trusted renderer available?
   - Yes -> Use DECLARATIVE (agent emits a UI tree the renderer draws).
            -> Same guard loop, plus renderer validates the tree against the schema.
   - No  -> escalate to a human to author the component, or decline.

5. Raw HTML / OPEN-ENDED?
   - Only if a sandbox + CSP is in place (not in v1).
   - Otherwise -> reject. Fall back to CONTROLLED or DECLARATIVE.
```

Rule of thumb: pick the most restrictive pattern that still meets the need. Controlled is the default. Declarative is a deliberate upgrade. Open-ended is opt-in behind a sandbox.

## 8. Phased Plan

### v1: One Controlled component, the Governance Approval Card

Scope: a single Controlled component, the Governance Approval Card, governed end to end inside mission-control. The agent selects this component from a typed catalog and fills its props (the proposed action, the declared goal, the risk score, the data being shown), constrained so it can only emit a catalog choice (see criterion 2). The card renders in two parts: the approval chrome (frame, status, approve or deny) appears immediately, and the proposed payload is withheld until the governance loop clears it. The governance loop runs server side, never in the browser. No monorepo, no second surface, no Declarative renderer, no payments, no payment stub.

Acceptance criteria (each is testable):

1. The agent can only fill the Governance Approval Card from a typed catalog defined in mission-control; an unknown component name is rejected before any guard call (verify with a vitest test that passes a bogus component name and asserts a catalog-mismatch error).
2. The agent is constrained to emit only a catalog component and its props, using the model's structured output or tool-use with the catalog contract as the schema; off-catalog or free-form output is refused, not coerced (verify a vitest test that feeds an off-schema model output and asserts it is rejected). The generation SDK follows mission-control's existing assistant: both @anthropic-ai/sdk and openai are present (C:/Projects/Practical Systems/mission-control/package.json), and v1 uses the one already wired for the assistant rather than adding a new client.
3. The guard loop and the artifact write run server side; no DashClaw API key (x-api-key) is ever sent to the browser (verify a vitest test asserts the client path calls a mission-control server route and never attaches an x-api-key header, consistent with the x-api-key requirement at C:/projects/dashclaw/sdk/README.md).
4. The approval chrome renders before and independent of the guard loop; the proposed payload renders only after the loop clears it (verify a vitest test asserts the chrome mounts while the payload is still in a pending state).
5. Rendering the payload calls guard(context) with action_type, declared_goal, and risk_score, and agent identity comes from the constructor (verify the outgoing request body in a vitest test with a mocked SDK transport, matching the call shape in C:/projects/dashclaw/sdk/dashclaw.js).
6. createAction is called and the code branches on action.status, not on the guard decision (verify a vitest test where guard returns allow but createAction returns status pending_approval, and assert the payload waits, per C:/projects/dashclaw/sdk/README.md).
7. When status is pending_approval, waitForApproval(action_id) is called with the act_ action_id, not the act_gd_ decision_id (verify a vitest test asserts the id passed has the act_ prefix, per C:/projects/dashclaw/sdk/README.md).
8. On approval the payload reveals; on ApprovalDeniedError the payload shows a blocked state and is never drawn, while the approval chrome stays mounted (verify a vitest test for both branches, per C:/projects/dashclaw/sdk/dashclaw.js).
9. After reveal or block, updateOutcome (or reportActionOutcome) records a terminal status once (verify a vitest test asserts the outcome call fires once, per C:/projects/dashclaw/sdk/dashclaw.js).
10. The rendered snapshot (component name plus the exact data props shown) is written as an artifact via POST /api/artifacts with source_action_id set to the governed action id, and is retrievable in that action's evidence bundle; it is not written to guard_decisions.evidence (verify a vitest test asserts the artifact POST body carries source_action_id and content_json, per C:/projects/dashclaw/app/api/artifacts/route.js and C:/projects/dashclaw/sdk/README.md).

### Later phases (generalize)

- Phase 2, catalog growth: add more Controlled components to the mission-control catalog (status widgets, summary cards), still single-surface, still Controlled.
- Phase 3, contract sharing: publish the catalog contract as a typed schema so the JavaScript DashClaw app can validate against it at runtime (per Section 4), enabling a second governed surface.
- Phase 4, Declarative: introduce a trusted tree renderer with schema validation for agent-emitted UI trees, governed by the same SDK loop.
- Phase 5, Open-ended (only if justified): raw markup behind a sandbox and CSP, with its own RFC.
- Phase 6, payments (only if justified): introduce a forge-themed payment gate named Tinder and wire it to a real settlement provider, behind its own RFC. This is the first point at which any payment interface exists.

### v1 Non-Goals

- No monorepo and no shared npm package.
- No CopilotKit, no AG-UI, no new state-management or data-fetching library.
- No Declarative tree renderer and no Open-ended raw HTML.
- No second surface: not the DashClaw app, not the website.
- No x402 or payment functionality, and no payment interface or stub of any kind.
- No new event envelope or unification of the SSE and WebSocket models.

## 9. Open Questions, Risks, Error Handling, and Testing

Error handling:

- Catalog mismatch: when the agent names a component that is not in the approved catalog, the renderer must reject it before any guard call and surface a clear "unknown component" error. The catalog is the allowlist; nothing outside it can render. This is acceptance criterion 1 above.
- Guard-block UX: when guard or the server returns block, or waitForApproval throws ApprovalDeniedError, the approval chrome stays on screen and swaps its payload area to an explicit blocked state with the reason from the decision (the decision object carries reason and verification_status, C:/projects/dashclaw/sdk/README.md). The proposed payload is never drawn. The chrome and the blocked state are developer-authored Tier 0 UI, so they are always safe to show, which is the point of keeping them separate from the gated payload.
- Pending and timeout: while waitForApproval polls, the payload area shows a pending state inside the already-mounted chrome; on timeout it resolves to a blocked state rather than revealing optimistically (C:/projects/dashclaw/sdk/dashclaw.js).
- Sandbox CSP for future Open-ended HTML: any future raw-markup pattern must render inside a sandbox with a Content Security Policy that blocks inline script and external loads. The exact policy is unverified and out of scope for v1; it would be specified in the Phase 5 RFC.

Risks:

- The id mix-up risk (passing act_gd_ where act_ is required) is real and is covered by acceptance criterion 7 (C:/projects/dashclaw/sdk/README.md).
- Trusting guard() instead of createAction().status would defeat the gate; criterion 6 guards against it (C:/projects/dashclaw/sdk/README.md).
- Leaking the DashClaw API key to the browser would be a critical exposure; v1 avoids it by running guard, createAction, the artifact write, and waitForApproval server side (criterion 3; the x-api-key requirement is shown at C:/projects/dashclaw/sdk/README.md).
- Event-model divergence between DashClaw SSE and mission-control WebSocket is a known unification cost; v1 avoids it by staying single-surface.

Open questions (carried from the findings):

- Resolved during review: the canonical storage for a rendered-UI snapshot is the artifacts subsystem (POST /api/artifacts with source_action_id), surfaced via the evidence bundle, not guard_decisions.evidence (see Section 5). The only residual is the exact Drizzle table name and columns behind the artifacts repository, readable at C:/projects/dashclaw/app/lib/repositories/artifacts.repository.js.
- What are the exact non-fabrication evidence JSON shape and the act_status / actHash binding semantics? Confirm via C:/projects/dashclaw/schema/schema.js and C:/projects/dashclaw/drizzle/0013_non_fabrication_integrity.sql.
- Does the Python company_os backend behind the mission-control WebSocket implement its own broker, and what ordering guarantees does events_batch provide? Confirm via the WebSocket server source referenced by C:/Projects/Practical Systems/mission-control/hooks/useWebSocket.ts.
- Has mission-control adopted any react-query useQuery patterns since the dependency was added, or is it still polling-only? Confirm via C:/Projects/Practical Systems/mission-control/package.json and the page components.
- Unrelated to generative UI, surfaced during stack review: the website pins @next/mdx ^14.2.16 while running Next ^16.1.6 (C:/Projects/Practical Systems/practical-systems-website/package.json), a peer-version skew worth a separate ticket. It does not affect this RFC.

Testing:

- mission-control: vitest is the runner today (test is "vitest run", C:/Projects/Practical Systems/mission-control/package.json). All seven v1 acceptance criteria are vitest tests. There is no playwright in mission-control, so any end-to-end browser test of the card would need to add it; v1 stays at the vitest level and does not add playwright.
- DashClaw app: vitest plus playwright are both present (test is "vitest", test:smoke is "playwright test", C:/projects/dashclaw/package.json). When a DashClaw-side governed surface arrives in a later phase, its smoke test is playwright there.
- practical-systems-website: vitest is the runner (test is "vitest run", C:/Projects/Practical Systems/practical-systems-website/package.json); no playwright. The website is Tier 0 in v1, so no generative-UI tests are required there yet.
