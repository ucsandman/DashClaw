# DashClaw SDK + Dashboard Coverage Pass

You are working in the DashClaw codebase and must perform a full SDK-to-platform coverage pass.

Rules:
- Do NOT ask for raw secrets in chat.
- Use environment variables for auth (for example: `DASHCLAW_API_KEY`).
- Keep changes additive and backward compatible where possible.
- Preserve org isolation and existing auth/role controls.

Goal:
Ensure every meaningful SDK capability is:
1) correctly wired to DashClaw APIs and persistence,
2) visible on dashboards/product surfaces where appropriate,
3) documented for operators and SDK users,
4) covered by tests.

Execution checklist:
1. Inventory SDK capabilities
- Enumerate public methods in:
  - `sdk/dashclaw.js`
  - `sdk-python/dashclaw/client.py`
  - `sdk/legacy/dashclaw-v1.js` (DEPRECATED v1 legacy surface across 30 categories, available via `dashclaw/legacy`; removed in v5.0.0)
- Group by domain (actions, presence, loops, assumptions, approvals, guard, learning, drift, scoring, prompts, feedback, routing, messaging, webhooks, compliance, CLI approval channel, Claude Code hooks, etc.).

2. Build a coverage matrix
- For each method, map:
  - API route(s)
  - DB table(s)
  - dashboard/page visibility
  - docs location
  - tests
  - status: complete | partial | missing

3. Verify ingestion and visibility
- Confirm request/response contracts and persistence fields.
- Confirm org scoping and auth behavior.
- Ensure high-value signals are surfaced in UI (cards/tables/charts/pages).

4. Fill gaps
- Implement missing ingestion/storage/UI coverage.
- Add non-breaking derived summary endpoints if needed for dashboard clarity/performance.
- Align JS/Python SDK behavior where mismatched.

5. Update docs (required)
- Update internal/operator docs with data lineage:
  SDK call -> API -> DB -> Dashboard.
- Update SDK docs with method coverage and visibility notes.
- Add a changelog entry.

6. Add/update tests (required)
- Include happy paths + key edge cases.
- Include org-scoping and visibility assertions.
- Add regressions for dashboard summary counts and states.

Deliverables:
- Code changes
- Updated coverage matrix committed to the repo
- Updated docs/changelog
- Passing tests
- Confirm hooks/ directory scripts are consistent with current guard API response format
- Final summary with:
  - root causes found
  - what changed
  - how to verify via API + dashboard
  - any remaining gaps
