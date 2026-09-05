# Claude Code Review Agent

A Claude-powered agent that reviews a code file and demonstrates DashClaw
policy, approval, and audit calls around a simulated write.

> **Trust boundary:** This standalone example uses lower-level cooperative SDK
> calls, not the Claude Code interception hook, and does not claim protocol-1
> execution authority. Keep the write simulated, or use `runGoverned` for a real
> file effect.

## What happens

1. The agent runs a guard check to read `sample-auth.js` (low risk, passes)
2. Claude (or a simulated reviewer) identifies a hardcoded secret
3. A second guard check fires before writing the fix (risk 75, `security` action type)
4. DashClaw creates an action record with a replay link
5. If the policy returns `require_approval`, the agent prints the approval block and waits
6. An operator approves or denies from a second terminal (or the browser dashboard)
7. On approval the fix is applied (simulated); on denial the agent exits cleanly

## Why governance fires

The file path `sample-auth.js` matches the `auth` pattern in the DashClaw hooks risk mapping. Combined with `action_type: 'security'` and `risk_score: 75`, this triggers `require_approval` on any DashClaw instance with a standard production guard policy.

## Prerequisites

- Node.js 20+
- A running DashClaw instance (local or cloud)
- `DASHCLAW_API_KEY` from your instance
- (Optional) `ANTHROPIC_API_KEY` for real Claude reviews. Without it, the agent uses a simulated review result.

## Setup

```bash
cd examples/claude-code-review-agent
cp .env.example .env
# Edit .env with your keys
npm install
```

## Run

```bash
node index.js
```

## Approving from a second terminal

When the agent prints the approval block, open a second terminal and run:

```bash
dashclaw approve <actionId shown in the approval block>
```

Or deny:

```bash
dashclaw deny <actionId> --reason "Not during change freeze"
```

The agent detects the decision within 3 seconds and proceeds or exits.

## Replay

Every governed action gets a permanent replay URL:

```
http://localhost:3000/replay/<actionId>
```

This page shows the policy that triggered the gate, the agent's declared goal, the AI review finding, risk score, and final outcome.
