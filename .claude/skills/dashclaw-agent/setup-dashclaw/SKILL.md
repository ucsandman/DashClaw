---
name: setup-dashclaw
description: Set up a DashClaw instance, install the CLI tool, and configure Claude Code hooks
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: setup
---

# Set Up DashClaw

Three ways to get DashClaw running, plus CLI and Claude Code hook setup.

---

## Instance Setup

### Option 1: Local Development

```bash
# Clone the repo
git clone git@github.com:ucsandman/DashClaw.git
cd DashClaw

# Install dependencies
npm install

# Run interactive setup (creates .env, initializes database)
node scripts/setup.mjs

# Start dev server
npm run dev
# → http://localhost:3000
```

**Required environment variables (.env):**
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/dashclaw
ENCRYPTION_KEY=<32-char-random-string>
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<32-char-random-string>
DASHCLAW_API_KEY=<your-api-key>
DASHCLAW_MODE=self_host
```

### Option 2: Cloud (Vercel + Neon)

1. Fork the DashClaw repo on GitHub
2. Deploy to Vercel (connect the fork)
3. Create a free Neon Postgres database
4. Set `DATABASE_URL` in Vercel environment variables
5. Run `node scripts/setup.mjs` locally pointing to your cloud instance
6. Grab your API key from the dashboard

### Option 3: Demo Mode

```bash
npx dashclaw-demo
# Runs a local demo instance with fixture data
# Opens Decision Replay automatically
# Agent attempts risky deployment, DashClaw blocks it
```

Demo mode is read-only — no writes allowed. Good for exploring the UI.

### Verify Setup

```bash
# Health check
curl http://localhost:3000/api/health

# Expected response:
# { "status": "ok", "database": "connected", "version": "2.x.x" }
```

Visit `http://localhost:3000/setup` for the instance readiness verification page.

---

## CLI Installation

The `@dashclaw/cli` provides terminal-based approval workflows.

### Install

```bash
npm install -g @dashclaw/cli
```

### Configure

```bash
export DASHCLAW_BASE_URL=http://localhost:3000
export DASHCLAW_API_KEY=your-api-key
# Optional: export DASHCLAW_AGENT_ID=cli-operator
```

### Commands

```bash
# Interactive approval inbox (TUI with live updates)
dashclaw approvals

# Approve a specific action
dashclaw approve act_abc123 --reason "Reviewed and safe"

# Deny a specific action
dashclaw deny act_abc123 --reason "Risk too high for current sprint"

# Help
dashclaw help
```

### Interactive Mode Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑/↓` | Navigate approvals |
| `A` | Approve selected |
| `D` | Deny selected |
| `R` | Refresh list |
| `O` | Open replay link in browser |
| `Q` | Quit |

Risk scores are color-coded: green (<40), yellow (40-70), red (70+).

---

## Claude Code Hooks

DashClaw provides pre/post tool hooks for Claude Code that create a policy-enforced execution pipeline. Hooks v2 govern 40+ tool types (not just Bash/Edit/Write/MultiEdit) with semantic classification via the bundled `dashclaw_agent_intel` module.

### How It Works

```
Claude Code Tool Call (Bash/Edit/Write/MultiEdit)
        ↓
[PreToolUse: dashclaw_pretool.py]
   → Classify action (type, risk, systems)
   → POST to /api/guard
   → Allow / Warn / Block / Require Approval
   → Store action_id in temp file
        ↓
[Tool Executes] (unless blocked)
        ↓
[PostToolUse: dashclaw_posttool.py]
   → Read action_id from temp file
   → Determine outcome (completed/failed)
   → PATCH /api/actions/:id with result
        ↓
Full audit trail in DashClaw dashboard
```

### Install Hooks

**Recommended:** use the one-command installer from your DashClaw checkout:

```bash
node /path/to/DashClaw/scripts/install-hooks.mjs --target=.
```

This copies all three governance hooks (`dashclaw_pretool.py`, `dashclaw_posttool.py`, `dashclaw_stop.py`) and the `dashclaw_agent_intel/` Python module into `.claude/hooks/`, then merges the `PreToolUse` / `PostToolUse` / `Stop` blocks into `.claude/settings.json`. Idempotent — safe to re-run after each `git pull`.

**Manual install** (if you need to control file placement):

1. Copy hook files into your project's `.claude/hooks/` directory:

```bash
mkdir -p .claude/hooks
cp /path/to/DashClaw/hooks/dashclaw_pretool.py .claude/hooks/
cp /path/to/DashClaw/hooks/dashclaw_posttool.py .claude/hooks/
cp /path/to/DashClaw/hooks/dashclaw_stop.py    .claude/hooks/
cp -r /path/to/DashClaw/hooks/dashclaw_agent_intel .claude/hooks/
```

The `dashclaw_agent_intel/` module is required — `dashclaw_pretool.py` imports it for semantic tool classification, so omitting it raises `ImportError` on the first governed tool call.

2. Add hook configuration to `.claude/settings.json` — three entries are needed: `PreToolUse` (governance gate), `PostToolUse` (outcome recorder), and `Stop` (LLM token + cost capture, plus auto-close fallback for any actions that PostToolUse missed):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_pretool.py",
            "timeout": 3600000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_posttool.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_stop.py"
          }
        ]
      }
    ]
  }
}
```

3. Set environment variables:

```bash
export DASHCLAW_BASE_URL=http://localhost:3000
export DASHCLAW_API_KEY=your-api-key
export DASHCLAW_AGENT_ID=claude-code
export DASHCLAW_HOOK_MODE=observe    # Start with observe, switch to enforce later
export DASHCLAW_RISK_THRESHOLD=60    # Default risk threshold
export DASHCLAW_GOVERNED_CATEGORIES=all  # Comma-separated tool categories or "all"
export DASHCLAW_PERMISSION_MODE=standard # standard | elevated | admin
```

### Hook Modes

- **`observe`** — Logs all decisions but never blocks. Use this first to understand what would be caught.
- **`enforce`** — Blocks tool execution when guard returns `block` or approval is denied/times out.

### Action Type Mapping (Pretool)

The pretool automatically classifies tool calls:

**Bash commands:**
| Pattern | Action Type | Risk | Reversible |
|---------|------------|------|------------|
| `git push`, `git merge`, `git rebase` | deploy | 80 | false |
| `npm run deploy`, `vercel deploy` | deploy | 75-85 | false |
| `terraform apply` | deploy | 85 | false |
| `rm -rf`, `DROP TABLE` | security | 90 | false |
| `.env`, `secret`, `key` file access | security | 85 | false |
| `npm install`, `pip install` | build | 30 | true |
| `curl`, `wget` | api | 40 | true |

**File operations (Edit/Write/MultiEdit):**
| File Pattern | Action Type | Risk |
|-------------|------------|------|
| `.env`, `secrets`, `credentials` | security | 85 |
| `migration`, `schema` | migrate | 70 |
| `auth`, `middleware` | security | 75 |
| Other files | file_write | 15 |

### Approval Timeout

When the guard returns `require_approval`, the pretool polls for 30 seconds. If no decision is made, the tool is blocked (enforce mode) or allowed (observe mode).

Use `dashclaw approvals` in another terminal to approve in real-time.

### Graceful Degradation

If DashClaw is unreachable (missing env vars, server down, network error), hooks exit 0 and allow tool execution. The hooks never break your development workflow.

### New Signal Types

Hooks v2 emit 4 additional signal types during guard evaluation:

- **`permission_escalation`** — triggered when the action requires elevated permissions
- **`green_contract`** — triggered when test verification is required before execution
- **`branch_freshness`** — triggered when the target branch is stale relative to its remote
- **`recovery_recipe`** — returned with blocked decisions, providing actionable remediation steps

Monitor these signals in the DashClaw dashboard or via the `/api/signals` endpoint.

### Session Setup (Recommended)

For long-running Claude Code sessions, create a session to enable lifecycle tracking and recovery:

```bash
# Sessions are created automatically by hooks when DASHCLAW_SESSION_TRACKING=true
export DASHCLAW_SESSION_TRACKING=true
```

Session tracking is optional. When enabled, the pretool hook creates a session on first invocation and reports status updates throughout the session. If a session is interrupted, DashClaw records the last checkpoint for recovery.
