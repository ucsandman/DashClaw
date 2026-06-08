"""dashclaw-agent-intel: semantic classification of agent tool calls."""

from .bash_classifier import classify_bash
from .file_scanner import scan_file_operation
from .tool_recognizer import classify_tool, TOOL_CATALOG, PERMISSION_LEVELS
from .session_tracker import SessionTracker
from .mcp_monitor import McpHealthMonitor

__all__ = [
    "classify_bash",
    "scan_file_operation",
    "classify_tool",
    "TOOL_CATALOG",
    "PERMISSION_LEVELS",
    "SessionTracker",
    "McpHealthMonitor",
]

__version__ = "1.0.0"
