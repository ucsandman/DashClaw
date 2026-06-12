# Close the Loop: quiet distribution + dogfood value loop

- **Date:** 2026-06-11
- **Status:** Approved (design), pending implementation plan
- **Owner:** Wes Sander
- **Context:** v4.12.0 just shipped (session digest hook, OpenClaw marketing, platform salvage). Repo has 274 stars / 48 forks. Issue #146 holds the researched distribution playbook; issue #147 holds the two verified-live gaps. Operator survey result: all four dogfood frictions confirmed broken — data is wrong/incomplete, agents under-feed it, value isn't pushed to the operator, and setup costs attention.

## Goal

Convert existing attention (stars, finished product) into users via low-risk compounding channels, while making DashClaw trustworthy and automatic enough that its own operator relies on it daily. The two tracks compound: dogfooding produces the authentic launch story; distribution without a working daily-driver story burns the one-shot channels.

**Explicitly deferred:** the public launch one-shot (Show HN / Reddit, #146 Phase 4) until the dogfood loop is closed; ClawHub signing pipeline (Phase 5); Claude.ai Connectors Directory (Phase 6, needs a Team org); the layered-intelligence plan (`docs/plans/2026-04-03-dashclaw-layered-intelligence.md`) — queued as the next big bet after this sprint.

## Track 1 — Quiet distribution (operational, this week)

Execute #146 Phases 1–3, skipping what is already done (GitHub topics ✓, npm keywords ✓, `mcpName` in `mcp-server/package.json` ✓). Source of truth for channel details: issue #146 (corrected 2026-06-11).

| Step | Action | Who |
|---|---|---|
| T1.1 | MCP Registry publish via the official `mcp-publisher` **Go binary** (the npm package of that name is squatted — never `npm i -g mcp-publisher`). `init` / `login github` / `publish`. Auto-feeds PulseMCP. | `login github` is interactive → Wes (single step); everything around it scripted + verified by the agent |
| T1.2 | Glama submit (repo URL). Hard prerequisite for T1.4's punkpeye PR. | Agent (form/web) or Wes if it requires an account |
| T1.3 | Phase-2 directories: PulseMCP direct submit, mcp.so form, Smithery (`smithery mcp publish`), mcp.directory `/submit` + `/submit-skill`. SkillsMP auto-indexes (star requirement met). | Agent where unauthenticated; Wes where an account is needed |
| T1.4 | Awesome-list PRs from the `ucsandman` account via `gh`: punkpeye/awesome-mcp-servers (after Glama), hesreallyhim/awesome-claude-code, rohitg00/awesome-claude-code-toolkit, anthropics `claude-plugins-community`. | Agent |

**Success criteria:** each channel either live-listed or has an open PR/submission; progress recorded as a checklist comment on issue #146.

**Error handling:** a rejected/stalled submission is recorded on #146 with the reason — no retries that could read as spam; awesome-list PRs follow each list's CONTRIBUTING format exactly.

## Track 2 — Dogfood value loop (sequenced; each workstream is its own spec → plan → build cycle)

Ordered so trust lands first: wrong numbers poison every downstream surface.

### W1 (this cycle): OpenClaw cost attribution

**Symptom:** the OpenClaw swarm shows 2,265 actions / 0 tokens (issue #147 gap 1); per-agent cost reads $0 despite the plugin carrying full token-attribution machinery (`TokenTurnState`, `llm_output` → stash → distribute via `updateOutcome`, `agent_end` flush).

**Step 1 — live diagnosis with a hypothesis ledger** (no fix until one hypothesis makes a correct prediction):

| # | Hypothesis | Discriminating prediction |
|---|---|---|
| H1 | Historical artifact: actions predate the attribution code; new ones are fine | Recent OpenClaw actions DO carry tokens |
| H2 | Gateway runs a stale plugin build (loads `packages/openclaw-plugin/src/index.ts` from repo source — verify which checkout) | Gateway's loaded source lacks `registerTokenAttribution` |
| H3 | `llm_output` never fires (OpenClaw version drift / event rename) | Plugin debug logging shows zero `llm_output` events across a live run |
| H4 | Distribution PATCH fails silently (auth, field names, endpoint) | Debug logs show stashed usage but failed/absent `updateOutcome` calls |

Cheapest first test: query the live instance for the newest OpenClaw actions and check `tokens_in/tokens_out`. The existing `diagnose:cost` script (added in `9579ce57`) is the second probe.

**Step 2 — fix the confirmed root cause.** Scope is the OpenClaw plugin and/or its ingestion path only; no schema change expected (token columns exist).

**Step 3 — the leverage add: attribution-coverage signal.** Per-agent % of actions carrying token data, computed server-side and surfaced in the fleet/agent views, so silent attribution failure can never hide for weeks again. This is the prevention half of the fix (detect, not just repair).

**Backfill:** only if the historical usage data still exists somewhere recoverable (gateway logs, session JSONL); otherwise skip — YAGNI.

**Success criteria:** (a) a fresh OpenClaw run produces actions with non-zero tokens and a non-zero cost estimate on the live instance; (b) attribution coverage is visible per agent; (c) the root cause is written down (issue #147 updated, gap 1 closed).

### W2 — agents feed it more (own brainstorm after W1)

Capture that survives imperfect hooks (PostToolUse ~96% miss world): candidates include session-JSONL as the token source of truth and `agent_end` fallbacks. Not specced here.

### W3 — value comes to the operator (own cycle)

Push surfaces: daily fleet digest through the existing notification adapters; the SessionStart digest hook (shipped in 4.12.0) was step one. Not specced here.

**Status: SHIPPED 2026-06-12** — interruption budget + flood guard + bulk resolution + fleet digest + 2 new signals (see docs/superpowers/specs/2026-06-11-w3-push-value-surfaces-design.md).

### W4 — kill the setup tax (own cycle)

`dashclaw doctor --fix` one-command self-repair across projects/machines. Not specced here.

## Testing

- Track 1: verification is external — each listing checked live; no code.
- W1: regression test for the confirmed root cause (plugin-side, in the existing plugin test suite); the coverage signal gets unit tests on the server computation; live smoke = one governed OpenClaw run showing tokens land.

## Non-goals

New governance features, UI redesigns, SDK surface changes (the Node drift-parity gap in #147 stays open and is not part of this sprint), and anything that grows the launch surface before the loop is closed.
