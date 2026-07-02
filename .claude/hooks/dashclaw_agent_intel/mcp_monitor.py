"""MCP server health monitor for dashclaw-agent-intel.

Tracks MCP server connection status with state persistence to a
temporary JSON file.  All servers are classified as healthy only
when their status is "connected".

Uses only the Python standard library.
"""

import json
import os
import tempfile
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_STATUSES = frozenset({
    "disconnected",
    "connecting",
    "connected",
    "auth_required",
    "error",
})

_HEALTHY_STATUSES = frozenset({"connected"})

_DEFAULT_STATE_FILE = os.path.join(tempfile.gettempdir(), "dashclaw_mcp_state.json")


# ---------------------------------------------------------------------------
# McpHealthMonitor
# ---------------------------------------------------------------------------

class McpHealthMonitor:
    """Track MCP server health with optional file-based persistence.

    Parameters
    ----------
    state_file:
        Path to the JSON state file.  Defaults to a temp-dir location.
    """

    def __init__(self, state_file: Optional[str] = None) -> None:
        self._state_file = state_file or _DEFAULT_STATE_FILE
        # Internal store: server_name -> {"status": str, "error": str | None}
        self._servers: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register(
        self,
        server: str,
        *,
        status: str = "disconnected",
        error: Optional[str] = None,
    ) -> None:
        """Set or update a server's connection status.

        Parameters
        ----------
        server:
            The MCP server name (e.g. "agentcash").
        status:
            One of: disconnected, connecting, connected, auth_required, error.
        error:
            Error message string.  Only stored when *status* is ``"error"``.

        Raises
        ------
        ValueError
            If *status* is not a recognised value.
        """
        if status not in VALID_STATUSES:
            raise ValueError(
                f"Invalid status {status!r}. "
                f"Must be one of: {', '.join(sorted(VALID_STATUSES))}"
            )
        self._servers[server] = {
            "status": status,
            "error": error if status == "error" else None,
        }

    def check(self, server: str) -> dict:
        """Return a copy of a server's current state.

        Unknown servers are reported as ``disconnected`` and unhealthy.
        """
        entry = self._servers.get(server)
        if entry is None:
            return {
                "server": server,
                "status": "disconnected",
                "error": None,
                "healthy": False,
            }
        return {
            "server": server,
            "status": entry["status"],
            "error": entry["error"],
            "healthy": entry["status"] in _HEALTHY_STATUSES,
        }

    def list_servers(self) -> list[dict]:
        """Return a list of state dicts for every registered server."""
        return [self.check(name) for name in self._servers]

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self) -> None:
        """Write current state to the JSON state file.

        Fire-and-forget: silently catches ``OSError`` so callers never
        need to handle persistence failures.
        """
        try:
            with open(self._state_file, "w", encoding="utf-8") as f:
                json.dump(self._servers, f)
        except OSError:
            pass

    @classmethod
    def from_state_file(cls, path: Optional[str] = None) -> "McpHealthMonitor":
        """Load a monitor from a previously saved state file.

        Returns an empty monitor if the file is missing, unreadable,
        or contains invalid JSON.
        """
        resolved = path or _DEFAULT_STATE_FILE
        monitor = cls(state_file=resolved)
        try:
            with open(resolved, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for name, entry in data.items():
                    if isinstance(entry, dict):
                        monitor._servers[name] = {
                            "status": entry.get("status", "disconnected"),
                            "error": entry.get("error"),
                        }
        except Exception:
            pass
        return monitor
