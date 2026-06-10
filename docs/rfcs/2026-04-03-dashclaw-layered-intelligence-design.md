# DashClaw Layered Intelligence — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Approach:** C — Layered Intelligence (fast local classification + smart server governance)

---

## Problem

DashClaw's Claude Code hooks currently govern only 4 tools (Bash, Edit, Write, MultiEdit) using regex-based action classification. The claw-code-parity project contains deep semantic understanding of 40+ agent tools, multi-stage bash validation, file security guards, worker lifecycle tracking, and recovery automation — all of which can be ported into DashClaw to make it the only governance platform that *understands* what coding agents are doing at a semantic level.

## Solution

Split intelligence across two layers:

- **Local:** A new `dashclaw-agent-intel` Python module (stdlib only) that runs alongside the agent and performs fast, deterministic classification of tool calls.
- **Server:** Expanded DashClaw guard API that consumes enriched classification context and enables new policy types, signal types, and recovery recipes.

## Architecture

```
Agent Tool Call
    |
[Local] dashclaw-agent-intel module
    - Bash intent classifier (6 submodules)
    - File security scanner
    - Tool surface recognizer (40+ tools)
    - Session state tracker
    - MCP health monitor
    |  enriched context
    v
[Remote] POST /api/guard (enriched context)
    - Permission escalation model
    - Green contract verification
    - Branch freshness policies
    - Recovery recipe suggestions
    - MCP health awareness
    |
    v
Decision + enrichment returned to hook
```

**Key principle:** Classification is deterministic and fast — it belongs local. Governance is organizational and auditable — it belongs on the server.

---

## Layer 1: `dashclaw-agent-intel` Python Module

Zero external dependencies (stdlib only). Five submodules.

### 1.1 Bash Intent Classifier

Ported from claw-code-parity's `bash_validation.rs`. Parses commands structurally instead of regex matching.

**API:**

```python
from dashclaw_agent_intel import classify_bash

result = classify_bash("sudo rm -rf /var/log/app/*", mode="workspace_write", workspace="/home/user/project")

# Returns:
{
    "intent": "destructive",        # readonly|write|destructive|network|process_management|package_management|system_admin|unknown
    "risk_score": 92,
    "reversible": False,
    "validations": [
        {"check": "destructive_command", "result": "block", "reason": "rm -rf with wildcard on system path"},
        {"check": "path_validation", "result": "warn", "reason": "target outside workspace boundary"},
        {"check": "mode_validation", "result": "block", "reason": "destructive command in workspace_write mode"}
    ],
    "parsed": {
        "base_command": "rm",
        "flags": ["-rf"],
        "wrapper": "sudo",
        "targets": ["/var/log/app/*"],
        "pipes": [],
        "redirections": []
    }
}
```

**Six validation submodules** (pipeline — first non-allow stops):

1. **readOnlyValidation** — Blocks writes, state-modifying commands, redirections. Maintains allowlist of ~45 safe commands (cat, grep, find, git status, cargo check, etc.).
2. **destructiveCommandWarning** — Detects `rm -rf /`, `mkfs`, `dd if=`, fork bombs, `DROP TABLE`.
3. **modeValidation** — Warns when workspace_write agent targets system paths (`/etc/`, `/usr/`, `/var/`).
4. **sedValidation** — Blocks `sed -i` in read-only mode, allows `sed` stdout-only.
5. **pathValidation** — Warns on `../` traversal, `~` references, absolute paths outside workspace.
6. **commandSemantics** — Intent classification. Knows 50+ commands, 20+ git subcommands (e.g., `git log` = readonly, `git push` = write, `git reset --hard` = destructive).

**Key difference from today's hook:** Instead of `"git push" -> deploy (risk 80)`, this produces `intent: "write", parsed.base_command: "git", parsed.subcommand: "push", targets: ["origin", "main"]` — the guard can write policies like "block git push to main but allow git push to feature branches."

### 1.2 File Security Scanner

Ported from claw-code-parity's `file_ops.rs`.

**API:**

```python
from dashclaw_agent_intel import scan_file_operation

result = scan_file_operation(
    path="/home/user/project/../../../etc/passwd",
    content="malicious content",
    workspace="/home/user/project"
)

# Returns:
{
    "binary_detected": False,
    "size_bytes": 17,
    "size_exceeds_limit": False,
    "symlink_escape": False,
    "traversal_detected": True,
    "outside_workspace": True,
    "resolved_path": "/etc/passwd",
    "sensitive_path": True,
    "sensitive_pattern": "system_config"
}
```

**Checks:**

- Binary detection (NUL byte scan of first 8KB)
- Size limit (10MB default, configurable)
- Symlink escape (resolve symlinks, check if result leaves workspace)
- Path traversal (`../` sequences)
- Workspace boundary (canonical path starts_with workspace)
- Sensitive path patterns (`.env`, credentials, system files)

### 1.3 Tool Surface Recognizer

Catalog of 40+ tools with permission requirements. Replaces the hardcoded 4-tool check in the current hook.

**API:**

```python
from dashclaw_agent_intel import classify_tool

result = classify_tool("Agent", {"prompt": "research competitors", "subagent_type": "general-purpose"})

# Returns:
{
    "tool_name": "Agent",
    "category": "orchestration",
    "required_permission": "danger",
    "governed": True,
    "risk_profile": {
        "base_risk": 60,
        "can_spawn_processes": True,
        "can_access_network": True,
        "can_modify_files": True,
        "can_escalate_permissions": True
    }
}
```

**Tool categories and permission levels:**

| Category | Tools | Default Permission |
|----------|-------|--------------------|
| search | Glob, Grep, Read, WebSearch, WebFetch, ToolSearch | readonly |
| file_io | Write, Edit, NotebookEdit | workspace_write |
| execution | Bash, REPL, PowerShell | danger |
| orchestration | Agent, Skill, RemoteTrigger | danger |
| system | EnterPlanMode, ExitPlanMode, Config, Sleep | allow |
| interactive | AskUserQuestion, SendUserMessage | prompt |
| mcp | Any `mcp__*` tool | varies (default: workspace_write) |

### 1.4 Session State Tracker

Local state machine for agent session lifecycle. Ported from claw-code-parity's `worker_boot.rs`.

**API:**

```python
from dashclaw_agent_intel import SessionTracker

session = SessionTracker(agent_id="claude-code", workspace="/home/user/project")
session.observe("spawning")
session.observe("ready")
session.transition("running")
session.transition("blocked", reason="MCP server disconnected")

# Returns current state + event log:
{
    "session_id": "sess_abc123",
    "agent_id": "claude-code",
    "status": "blocked",
    "status_since": "2026-04-03T15:30:00Z",
    "blocked_reason": "MCP server disconnected",
    "events": [
        {"seq": 1, "kind": "spawning", "at": "..."},
        {"seq": 2, "kind": "ready", "at": "..."},
        {"seq": 3, "kind": "running", "at": "..."},
        {"seq": 4, "kind": "blocked", "at": "...", "detail": "MCP server disconnected"}
    ]
}
```

**States:** `spawning -> ready -> running -> blocked -> finished | failed`

### 1.5 MCP Health Monitor

Tracks MCP server connection state locally. Ported from claw-code-parity's `mcp_tool_bridge.rs`.

**API:**

```python
from dashclaw_agent_intel import McpHealthMonitor

mcp = McpHealthMonitor()
mcp.register("agentcash", status="connected")
mcp.register("chrome-devtools", status="error", error="connection refused")

result = mcp.check("chrome-devtools")
# Returns:
{
    "server": "chrome-devtools",
    "status": "error",
    "error": "connection refused",
    "healthy": False
}
```

**Statuses:** `disconnected | connecting | connected | auth_required | error`

State is persisted to a temp file so it survives across hook invocations within a session.

### Governance Decision Logic

The `governed` flag on `classify_tool()` output is determined by:

1. Look up tool category (execution, orchestration, file_io, search, etc.)
2. Check if category is in `DASHCLAW_GOVERNED_CATEGORIES` env var
3. Default governed categories: `execution, orchestration, file_io, interactive, mcp`
4. Default ungoverned: `search` (Read, Glob, Grep, WebSearch, WebFetch, ToolSearch), `system` (EnterPlanMode, ExitPlanMode, Config, Sleep)
5. `DASHCLAW_GOVERNED_CATEGORIES=all` overrides and governs everything

If a tool is not in the known catalog (e.g., a new tool added to Claude Code), it defaults to `governed: True, category: "unknown", required_permission: "workspace_write"` — fail-safe toward governance.

### Module Packaging

Single directory `dashclaw_agent_intel/` with `__init__.py` + one file per submodule. Stdlib only. Can be vendored into the hooks directory or pip-installed.

---

## Layer 2: Expanded Hooks

### 2.1 Pretool Hook v2

The hook becomes a thin orchestrator that imports `dashclaw-agent-intel` for classification and sends enriched context to the guard API.

**Key changes from v1:**

- Governs all 40+ tools, not just 4
- Classification via `classify_tool()` + `classify_bash()` + `scan_file_operation()` instead of regex
- Enriched `intel` dict sent to guard API
- `derive_action_type()` maps from semantic intent instead of pattern matching
- MCP tools get health context automatically
- `tool_info["governed"]` flag controls which tools pass through

**Flow:**

1. Parse stdin JSON (tool_name, tool_input, tool_use_id)
2. `classify_tool()` — determine category, permission level, governed flag
3. If not governed, exit 0 (pass through)
4. Build intel context — run bash classifier, file scanner, MCP health check as applicable
5. Build guard context from intel (replaces old regex classification)
6. `POST /api/guard` with enriched context
7. Handle decision (same allow/warn/block/require_approval flow as today)

### 2.2 Governance Scope Configuration

New env var controls which tool categories get governed:

```bash
# Default: execution, orchestration, file_io, interactive, mcp
DASHCLAW_GOVERNED_CATEGORIES="execution,orchestration,file_io,interactive,mcp"

# Govern everything:
DASHCLAW_GOVERNED_CATEGORIES="all"
```

### 2.3 Posttool Hook v2

**Key changes:**

- Output summary increased to 500 chars (from 200)
- Structured `outcome_metadata` with exit_code, lines_changed, files_affected, error_type
- Error detection improved: checks exit code, not just "Error:" substring

### 2.4 Session Reporting

Hooks report session state to `/api/sessions`:

- On first tool call: create session
- On every tool call: update last_activity
- On agent exit: mark session finished

Session reporting is fire-and-forget. If session API is unavailable, hooks continue without blocking.

---

## Layer 3: Server-Side Extensions

### 3.1 Enriched Guard Context Schema

The `/api/guard` endpoint accepts new optional `intel` field (backward compatible):

```javascript
POST /api/guard
{
  // Existing fields (unchanged)
  agent_id, action_type, declared_goal, risk_score, reversible, systems_touched,

  // NEW: Intel enrichment
  intel: {
    bash: { intent, parsed, validations },
    file: { traversal_detected, outside_workspace, binary_detected, size_bytes, sensitive_pattern },
    tool: { tool_name, category, required_permission, risk_profile },
    session: { session_id, status, status_since },
    mcp: { server, status, healthy },
    branch: { name, freshness, commits_behind, missing_fixes },
    green: { observed_level, last_verified }
  }
}
```

If `intel` is missing or partial, policies referencing those fields don't match (fail-open).

### 3.2 Permission Escalation Model

New concept on agent pairings: **permission level** (`readonly < workspace_write < danger < prompt < allow`).

When an agent registers, it gets a permission level (default: `danger`). Guard evaluation checks:

```
if tool.required_permission > agent.permission_level:
    escalate to require_approval
```

**Configuration:**

- Set via `PATCH /api/pairings/{id}` with `permission_level` field
- New policy type `permission_escalation` with `enforce: true/false`

### 3.3 Green Contract Verification

New policy type: `green_contract`

```javascript
{
  name: "Require workspace-green before deploy",
  type: "green_contract",
  rules: {
    action_types: ["deploy"],
    required_level: "workspace"   // targeted|package|workspace|merge_ready
  },
  decision: "block"
}
```

Guard checks `intel.green.observed_level` against required level. No green status reported = treated as unknown (matches policy).

**Green levels (ordered):** targeted < package < workspace < merge_ready

### 3.4 Branch Freshness Policies

New policy type: `branch_freshness`

```javascript
{
  name: "Block deploys from stale branches",
  type: "branch_freshness",
  rules: {
    action_types: ["deploy", "merge"],
    max_commits_behind: 0,
    freshness: ["stale", "diverged"]
  },
  decision: "block"
}
```

### 3.5 New Signal Types

Four new signals added to `computeSignals()`:

| Signal | Detection | Severity |
|--------|-----------|----------|
| `branch_stale` | Guard context reports stale branch with commits_behind > threshold | amber 1-5 behind, red 5+ |
| `mcp_degraded` | Guard context reports unhealthy MCP server | amber on error, red on auth_required |
| `session_stalled` | Session API: status=running for >2h with no tool calls | amber 2-4h, red 4h+ |
| `green_insufficient` | Agent attempting deploy/merge without workspace green | red always |

### 3.6 Recovery Recipe Engine

New module: `app/lib/recovery.js`. When a signal fires, check for a matching recipe.

**Six initial recipes:**

| Signal | Steps | Max Attempts | Escalation |
|--------|-------|-------------|------------|
| `session_stalled` | restart_session | 1 | alert_human |
| `branch_stale` | suggest_rebase | 1 | warn_only |
| `mcp_degraded` | retry_mcp_handshake (5s timeout) | 1 | alert_human |
| `repeated_failures` | reduce_autonomy (set permission to readonly) | 1 | alert_human |
| `green_insufficient` | suggest_test_run | 1 | block_until_resolved |
| `assumption_drift` | suggest_assumption_review | 1 | warn_only |

Steps are either suggestions (returned in guard response) or actions (autonomy reduction, session restart). Execution is logged as an activity record.

**Guard response extension:**

```javascript
{
  decision: "warn",
  recovery: {
    signal: "branch_stale",
    suggestion: "Branch is 3 commits behind main. Rebase recommended.",
    auto_action: null,
    escalation: "warn_only"
  }
}
```

### 3.7 Session Lifecycle API

New endpoints:

- `POST /api/sessions` — Create session (returns session_id, status)
- `GET /api/sessions` — Query sessions (filter by agent_id, status)
- `PATCH /api/sessions/{id}` — Update session state (status, green_level, branch_freshness)
- `GET /api/sessions/{id}/events` — Session event log

Session lifecycle is optional. Agents that don't report sessions still get governed on individual tool calls.

---

## Testing Strategy

### Unit Tests (Intel Module)

Each submodule gets its own test suite. Key coverage:

- Bash classifier: 50+ command classifications, wrapper detection, pipe/redirect handling, git subcommand whitelist
- File scanner: traversal detection, symlink escape, binary detection, size limits, sensitive patterns
- Tool recognizer: all 40+ tools classified with correct category and permission level
- Session tracker: state machine transitions, event logging
- MCP health: status tracking, state persistence

### Integration Tests (Server)

- Permission escalation: verify agent permission level checked against tool requirement
- Green contract: verify deploy blocked without sufficient green level
- Branch freshness: verify merge blocked from stale branch
- Recovery recipes: verify signal -> recipe -> suggestion/action flow
- Backward compatibility: verify old hooks (no intel field) still work

### End-to-End Tests (Hooks)

- Mock DashClaw server + real hook execution
- Verify enriched context sent to guard API
- Verify ungoverned tools pass through
- Verify MCP tools include health context
- Verify session creation/update lifecycle
- Verify graceful degradation when server unavailable

---

## Implementation Sequence

1. `dashclaw-agent-intel` Python module (bash classifier first, then file scanner, tool recognizer, session tracker, MCP monitor)
2. Updated pretool/posttool hooks consuming the module
3. Server: enriched guard context schema (backward compatible)
4. Server: permission escalation model
5. Server: green contract + branch freshness policy types
6. Server: new signal types
7. Server: recovery recipe engine
8. Server: session lifecycle API
9. Integration tests across all layers
10. Documentation and skill updates

---

## What This Enables

After implementation, DashClaw becomes the only agent governance platform that:

- Understands bash command *intent*, not just pattern matches
- Governs the full 40+ tool surface, not just 4 tools
- Detects file operation security threats (traversal, symlink escape, binary injection)
- Enforces graduated permission levels per agent
- Gates deploys on verified test status (green contract)
- Detects and blocks stale branch operations
- Monitors MCP server health as a governance dimension
- Tracks agent session lifecycle (not just individual tool calls)
- Suggests and executes recovery recipes for common failures
- Compresses noisy event streams into actionable summaries

DashClaw goes from "tool call cop" to "session-aware, semantically intelligent agent governance."
