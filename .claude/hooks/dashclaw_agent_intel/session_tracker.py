"""Agent session lifecycle state machine for dashclaw-agent-intel.

Tracks session state, enforces valid transitions, and maintains an
append-only event log.  Uses only the Python standard library.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional


# ---------------------------------------------------------------------------
# State machine definition
# ---------------------------------------------------------------------------

VALID_STATUSES = frozenset({
    "spawning", "ready", "running", "blocked", "finished", "failed",
})

TERMINAL_STATUSES = frozenset({"finished", "failed"})

# Maps current status -> set of statuses it may transition to.
TRANSITIONS: dict[str, frozenset[str]] = {
    "spawning": frozenset({"ready", "running", "blocked", "failed"}),
    "ready":    frozenset({"running", "blocked", "failed"}),
    "running":  frozenset({"blocked", "finished", "failed"}),
    "blocked":  frozenset({"ready", "running", "finished", "failed"}),
    # Terminal — no outgoing edges.
    "finished": frozenset(),
    "failed":   frozenset(),
}


def _generate_session_id() -> str:
    """Return ``sess_`` followed by 12 lowercase hex characters."""
    return "sess_" + uuid.uuid4().hex[:12]


def _now_iso() -> str:
    """UTC now as an ISO-8601 string with timezone info."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class SessionTracker:
    """Lifecycle state machine for a single agent session.

    Args:
        agent_id: Identifier of the agent that owns this session.
        workspace: Filesystem path the agent is working in.
    """

    def __init__(self, agent_id: str, workspace: str) -> None:
        self._session_id: str = _generate_session_id()
        self._agent_id: str = agent_id
        self._workspace: str = workspace
        self._status: str = "spawning"

        now = _now_iso()
        self._status_since: str = now
        self._blocked_reason: Optional[str] = None
        self._seq: int = 1
        self._events: list[dict] = [
            {"seq": 1, "kind": "spawning", "at": now},
        ]

    # ------------------------------------------------------------------
    # Transitions
    # ------------------------------------------------------------------

    def transition(self, target: str, *, reason: Optional[str] = None) -> None:
        """Move the session to *target* status.

        Raises:
            ValueError: If *target* is not a recognised status or the
                transition from the current status is not allowed.
        """
        if target not in VALID_STATUSES:
            raise ValueError(
                f"Unknown status {target!r}; "
                f"valid statuses are {sorted(VALID_STATUSES)}"
            )

        allowed = TRANSITIONS[self._status]
        if target not in allowed:
            raise ValueError(
                f"Cannot transition from {self._status!r} to {target!r}; "
                f"allowed targets are {sorted(allowed) if allowed else '(none — terminal state)'}"
            )

        now = _now_iso()
        self._status = target
        self._status_since = now

        # blocked_reason: set for blocked/failed with a reason, else clear.
        if target in ("blocked", "failed") and reason is not None:
            self._blocked_reason = reason
        else:
            self._blocked_reason = None

        # Append event.
        self._seq += 1
        event: dict = {"seq": self._seq, "kind": target, "at": now}
        if reason is not None:
            event["detail"] = reason
        self._events.append(event)

    # ------------------------------------------------------------------
    # Read access
    # ------------------------------------------------------------------

    def get_state(self) -> dict:
        """Return a snapshot of the current session state."""
        return {
            "session_id": self._session_id,
            "agent_id": self._agent_id,
            "workspace": self._workspace,
            "status": self._status,
            "status_since": self._status_since,
            "blocked_reason": self._blocked_reason,
            "events": list(self._events),  # shallow copy
        }
