# Governed Chat Harness

A small Node runtime that drives Claude through the Anthropic Messages API and
routes every single tool call through DashClaw first. Each call becomes a row in
your Decisions Ledger, exactly like the Claude Code hooks do, because this
process owns the tool loop.

It is the generalized version of `../anthropic-governed-agent`. That example
governs one hardcoded tool. This one governs all of them automatically.

> **Trust boundary:** This harness owns the tool loop but uses lower-level
> cooperative guard and record calls. It does not claim protocol-1 execution
> authority. Its local and network tools are real, so do not treat it as an
> enforcement boundary for consequential effects. Put those effects behind
> `runGoverned`, a host interception hook, or `dashclaw_invoke` for a registered
> capability.

## Why this exists (read this first)

Your Claude.ai chat actions never show up in DashClaw, and the reason is
structural. The Claude.ai web and desktop apps do not expose a tool
interception layer the way Claude Code (the CLI) does. Built in tools like web
search and the code sandbox run inside Anthropic infrastructure, and connector
calls are dispatched by Anthropic servers. Nothing you deploy can sit in that
path and record those calls. There is no PreToolUse or PostToolUse hook for the
consumer chat product.

So the lasting fix is to run conversations through a process you control. That
is what this harness is. When you talk to Claude here instead of the web UI, the
harness sees every tool_use block, guards it, runs it, and writes the outcome to
your ledger. Same governance surface as Claude Code, driven from your machine.

If you want to keep using the web UI for chat and only govern external system
calls, the alternative is to register those APIs as DashClaw capabilities and
call them through `claw.invokeCapability(...)`, which guards and records server
side. The harness supports that path too (see tools.js).

## What gets recorded

For each tool the model calls, the harness:

1. classifies the call into an action_type and a risk_score, using the same
   intent vocabulary as `hooks/dashclaw_pretool.py`
2. POSTs to `/api/guard` and reads the decision
3. on block, records the action with status `blocked` and returns the policy
   reason to the model instead of running the tool
4. on require_approval, records `pending_approval`, waits for you to approve in
   the dashboard or with `dashclaw approve`, then runs or reports the denial
5. on allow or warn, records `running`, runs the tool, then PATCHes the action
   to `completed` (or `failed` if it threw)

Everything lands in `/decisions` with a replayable trace at `/replay/<id>`.

## Setup

```bash
cd examples/governed-chat-harness
cp .env.example .env
# edit .env: DASHCLAW_BASE_URL, DASHCLAW_API_KEY, ANTHROPIC_API_KEY
npm install
npm run chat
```

`npm install` pulls the Anthropic SDK and links the local DashClaw SDK from
`../../sdk` through a file dependency, the same way the sibling example does.

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| DASHCLAW_BASE_URL | yes | http://localhost:3000 | Your instance, e.g. https://my-dashclaw.vercel.app |
| DASHCLAW_API_KEY | yes | none | Operator API key (sent as x-api-key) |
| ANTHROPIC_API_KEY | yes | none | Your Anthropic key |
| DASHCLAW_AGENT_ID | no | claude-chat-harness | Identity shown in Fleet and the ledger |
| ANTHROPIC_MODEL | no | claude-sonnet-4-5-20250929 | Model the harness drives |
| DASHCLAW_GUARD_UNAVAILABLE_POLICY | no | warn | block, warn, or allow when the guard cannot be reached |

The guard unavailable default here is `warn`, so the assistant stays usable if
DashClaw is briefly down. The Claude Code hooks default to `block` (fail
closed). Set it to `block` if you want the same strict posture for tool calls.

## Adding your own tools

Tools live in `tools.js`. Each entry has a `definition` (the schema sent to the
model), an optional `governance` block (overrides for the classifier), and a
`run` function. The harness governs and records whatever you add. Two sketches
sit at the bottom of that file: one wraps an MCP server method, the other
invokes a registered DashClaw capability so even the inner HTTP call is governed.

Give external tools an honest `governance` block. A send or a charge should
carry a high `risk_score` and `reversible: false` so your existing
require_approval and block policies catch it. Naming a tool with the `mcp__`
prefix makes the classifier treat it as an external call by default.

## Files

```
classify.js   tool -> action_type, risk_score, reversible (mirrors the hook)
tools.js      example tool registry (calculator, web_fetch, write_note)
harness.js    GovernedAgent: the guard + record + execute loop
index.js      interactive CLI
```

## Relationship to your policies

This harness is a client. It does not define policy. Your existing policies in
`/policies` decide every verdict. The `claude-code` scoped approval policy, the
risk thresholds, the Stripe and outreach approval gates, and the destructive
filesystem block all apply here once a tool maps to a matching action_type. To
get coverage for a new external tool, set its `governance.action_type` to one
your policies already target.
