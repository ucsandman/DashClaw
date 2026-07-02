"""Tool surface recognizer for dashclaw-agent-intel.

Catalogs 40+ agent tools with category, permission requirements,
risk profiles, and governance flags.

Uses only the Python standard library.
"""

import os
from typing import Any

# ---------------------------------------------------------------------------
# Permission levels (ordered from least to most permissive)
# ---------------------------------------------------------------------------

PERMISSION_LEVELS: list[str] = [
    "readonly",
    "workspace_write",
    "danger",
    "prompt",
    "allow",
]

# ---------------------------------------------------------------------------
# Risk profile helpers
# ---------------------------------------------------------------------------

def _risk(
    base_risk: int,
    *,
    spawn: bool = False,
    network: bool = False,
    modify: bool = False,
    escalate: bool = False,
) -> dict:
    """Build a risk_profile dict with concise kwargs."""
    return {
        "base_risk": base_risk,
        "can_spawn_processes": spawn,
        "can_access_network": network,
        "can_modify_files": modify,
        "can_escalate_permissions": escalate,
    }


def _tool(
    category: str,
    permission: str,
    risk_profile: dict,
) -> dict:
    """Build a catalog entry."""
    return {
        "category": category,
        "required_permission": permission,
        "risk_profile": risk_profile,
    }


# ---------------------------------------------------------------------------
# Tool catalog (40+ tools)
# ---------------------------------------------------------------------------

TOOL_CATALOG: dict[str, dict] = {
    # --- execution (danger) ---
    "Bash": _tool(
        "execution", "danger",
        _risk(70, spawn=True, network=True, modify=True, escalate=True),
    ),
    "REPL": _tool(
        "execution", "danger",
        _risk(65, spawn=True, network=True, modify=True, escalate=True),
    ),
    "PowerShell": _tool(
        "execution", "danger",
        _risk(70, spawn=True, network=True, modify=True, escalate=True),
    ),

    # --- file_io (workspace_write) ---
    "Write": _tool(
        "file_io", "workspace_write",
        _risk(40, modify=True),
    ),
    "Edit": _tool(
        "file_io", "workspace_write",
        _risk(35, modify=True),
    ),
    "MultiEdit": _tool(
        "file_io", "workspace_write",
        _risk(40, modify=True),
    ),
    "NotebookEdit": _tool(
        "file_io", "workspace_write",
        _risk(35, modify=True),
    ),
    "TodoWrite": _tool(
        "file_io", "workspace_write",
        _risk(20, modify=True),
    ),

    # --- search (readonly) ---
    "Read": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "Glob": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "Grep": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "WebSearch": _tool(
        "search", "readonly",
        _risk(10, network=True),
    ),
    "WebFetch": _tool(
        "search", "readonly",
        _risk(15, network=True),
    ),
    "ToolSearch": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "LSP": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "TaskGet": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "TaskList": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "TaskOutput": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "CronList": _tool(
        "search", "readonly",
        _risk(5),
    ),
    "NotebookRead": _tool(
        "search", "readonly",
        _risk(5),
    ),

    # --- orchestration ---
    "Agent": _tool(
        "orchestration", "danger",
        _risk(75, spawn=True, network=True, modify=True, escalate=True),
    ),
    # `Task` is the pre-2.1.63 name for the sub-agent spawn tool (renamed to
    # `Agent`); older Claude Code still emits it. Same governance profile.
    "Task": _tool(
        "orchestration", "danger",
        _risk(75, spawn=True, network=True, modify=True, escalate=True),
    ),
    "Skill": _tool(
        "orchestration", "danger",
        _risk(60, spawn=True, modify=True, escalate=True),
    ),
    "RemoteTrigger": _tool(
        "orchestration", "danger",
        _risk(70, spawn=True, network=True, modify=True, escalate=True),
    ),
    "TaskCreate": _tool(
        "orchestration", "workspace_write",
        _risk(25, spawn=True),
    ),
    "TaskStop": _tool(
        "orchestration", "workspace_write",
        _risk(30, spawn=True),
    ),
    "TaskUpdate": _tool(
        "orchestration", "workspace_write",
        _risk(25),
    ),
    "CronCreate": _tool(
        "orchestration", "danger",
        _risk(55, spawn=True, modify=True),
    ),
    "CronDelete": _tool(
        "orchestration", "danger",
        _risk(50, modify=True),
    ),
    "TeamCreate": _tool(
        "orchestration", "danger",
        _risk(65, spawn=True, network=True, modify=True, escalate=True),
    ),
    "TeamDelete": _tool(
        "orchestration", "danger",
        _risk(60, modify=True),
    ),
    "EnterWorktree": _tool(
        "orchestration", "danger",
        _risk(45, spawn=True, modify=True),
    ),
    "ExitWorktree": _tool(
        "orchestration", "danger",
        _risk(30),
    ),

    # --- system (allow) ---
    "EnterPlanMode": _tool(
        "system", "allow",
        _risk(0),
    ),
    "ExitPlanMode": _tool(
        "system", "allow",
        _risk(0),
    ),
    "Config": _tool(
        "system", "allow",
        _risk(5),
    ),
    "Sleep": _tool(
        "system", "allow",
        _risk(0),
    ),
    "StructuredOutput": _tool(
        "system", "allow",
        _risk(0),
    ),

    # --- interactive (prompt) ---
    "AskUserQuestion": _tool(
        "interactive", "prompt",
        _risk(10),
    ),
    "SendUserMessage": _tool(
        "interactive", "prompt",
        _risk(10),
    ),
    "SendMessage": _tool(
        "interactive", "prompt",
        _risk(10),
    ),
}


# ---------------------------------------------------------------------------
# Default governance configuration
# ---------------------------------------------------------------------------

_DEFAULT_GOVERNED_CATEGORIES = frozenset({
    "execution",
    "orchestration",
    "file_io",
    "interactive",
    "mcp",
})

_DEFAULT_UNGOVERNED_CATEGORIES = frozenset({
    "search",
    "system",
})

# All valid categories for the "all" override.
_ALL_CATEGORIES = frozenset({
    "execution",
    "orchestration",
    "file_io",
    "interactive",
    "mcp",
    "search",
    "system",
    "unknown",
})


def _governed_categories() -> frozenset[str]:
    """Return the set of governed categories, respecting the env override."""
    env_val = os.environ.get("DASHCLAW_GOVERNED_CATEGORIES", "").strip()
    if not env_val:
        return _DEFAULT_GOVERNED_CATEGORIES
    if env_val.lower() == "all":
        return _ALL_CATEGORIES
    return frozenset(c.strip() for c in env_val.split(",") if c.strip())


def _is_governed(category: str) -> bool:
    """Determine whether *category* is governed."""
    governed = _governed_categories()
    if category in governed:
        return True
    # Unknown tools default to governed (fail-safe), unless
    # the env override explicitly excludes unknown.
    if category == "unknown":
        env_val = os.environ.get("DASHCLAW_GOVERNED_CATEGORIES", "").strip()
        if env_val and env_val.lower() != "all":
            # Explicit list — unknown is governed only if listed.
            return "unknown" in governed
        # No env override or "all" — unknown is governed.
        return True
    return False


# ---------------------------------------------------------------------------
# MCP fallback entry
# ---------------------------------------------------------------------------

_MCP_DEFAULT = _tool(
    "mcp", "workspace_write",
    _risk(30, network=True, modify=True),
)

# ---------------------------------------------------------------------------
# Unknown fallback entry
# ---------------------------------------------------------------------------

_UNKNOWN_DEFAULT = _tool(
    "unknown", "workspace_write",
    _risk(30, modify=True),
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_tool(tool_name: str, tool_input: dict[str, Any]) -> dict:
    """Classify an agent tool by name and input parameters.

    Parameters
    ----------
    tool_name:
        The tool name as reported by the agent harness (e.g. "Bash").
    tool_input:
        The tool's input parameters dict.

    Returns
    -------
    dict with keys:
        tool_name, category, required_permission, governed, risk_profile
    """
    # --- Look up in the static catalog ---
    if tool_name in TOOL_CATALOG:
        entry = TOOL_CATALOG[tool_name]
    elif tool_name.startswith("mcp__"):
        entry = _MCP_DEFAULT
    else:
        entry = _UNKNOWN_DEFAULT

    category = entry["category"]
    governed = _is_governed(category)

    return {
        "tool_name": tool_name,
        "category": category,
        "required_permission": entry["required_permission"],
        "governed": governed,
        "risk_profile": dict(entry["risk_profile"]),  # defensive copy
    }
