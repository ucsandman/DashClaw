"""LI-2(a) — True end-to-end integration: pretool hook → guard → recovery surfacing.

Runs the REAL dashclaw_pretool.py subprocess against a mock HTTP server
(same harness as test_pretool_integration.py: env vars + mocked HTTP transport,
query strings stripped for path matching).

Tests:
  1. When guard returns warn + a recovery object, the hook completes (exits 0)
     AND surfaces the recovery suggestion in its stderr output to the agent.
  2. When guard returns block + a recovery object, the hook exits 2
     AND surfaces the recovery suggestion in its stderr output.
  3. Session/turn state was recorded for the warn case (action_id persisted
     via ?record=true path — same assertion style as test_pretool_integration).
  4. Session/turn state was recorded for the block case (create_action called
     with status=blocked).

History: the TDD red step here found a true wiring gap — handle_warn() and
handle_block() dropped the `recovery` field from the guard response. The fix
added _log_recovery() to both handlers (dashclaw_pretool.py). Tests 1 and 2
pin that surfacing: they FAIL again if _log_recovery is removed from either
handler. Tests 3 and 4 (session/turn recording) are independent of recovery.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---------------------------------------------------------------------------
# Paths (mirror test_pretool_integration.py)
# ---------------------------------------------------------------------------

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")


# ---------------------------------------------------------------------------
# Mock HTTP server (identical harness to test_pretool_integration.py)
# ---------------------------------------------------------------------------

class _RequestLog:
    """Thread-safe accumulator for incoming requests."""

    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self.guard_response: dict = {"decision": "allow"}

    def add(self, method: str, path: str, body: dict | None, query: str = ""):
        with self._lock:
            self.requests.append({"method": method, "path": path, "query": query, "body": body})

    def get_all(self) -> list[dict]:
        with self._lock:
            return list(self.requests)

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log: _RequestLog):
    """Factory that produces a handler class bound to *log*."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            bare, _, query = self.path.partition("?")
            log.add("POST", bare, body, query)

            if bare == "/api/guard":
                resp = json.dumps(log.guard_response).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            elif bare == "/api/actions":
                resp = json.dumps({"action_id": "test-action-e2e-001"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            else:
                self.send_response(404)
                self.end_headers()

        def do_GET(self):
            bare, _, query = self.path.partition("?")
            log.add("GET", bare, None, query)
            self.send_response(200)
            resp = json.dumps({"status": "running"}).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def log_message(self, fmt, *args):
            pass  # silence request logging

    return Handler


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Test helper
# ---------------------------------------------------------------------------

def _run_hook(stdin_data: dict, env_overrides: dict | None = None, timeout: float = 10) -> tuple[int, str, str]:
    """Run the pretool hook as a subprocess. Returns (exit_code, stdout, stderr)."""
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


# A recovery object that matches the shape in app/lib/recovery.ts
_BRANCH_STALE_RECOVERY = {
    "signal": "branch_stale",
    "agent_id": "test-agent",
    "suggestion": "Branch is behind main. Rebase or merge-forward recommended before proceeding.",
    "auto_action": None,
    "escalation": "warn_only",
    "steps": [{"action": "suggest_rebase"}],
}

_GREEN_INSUFFICIENT_RECOVERY = {
    "signal": "green_insufficient",
    "agent_id": "test-agent",
    "suggestion": "Tests must pass at workspace level before deploy/merge.",
    "auto_action": None,
    "escalation": "block_until_resolved",
    "steps": [{"action": "suggest_test_run", "required_level": "workspace"}],
}

# Governed Bash tool call used by all tests
_GOVERNED_BASH = {
    "tool_name": "Bash",
    "tool_input": {"command": "git push origin main"},
    "tool_use_id": "tu-e2e-001",
}


class TestPretoolE2ERecovery(unittest.TestCase):
    """End-to-end tests: pretool hook → mock guard server → recovery surfacing.

    Tests 1 & 2 pin _log_recovery(): recovery.suggestion must reach hook
    stderr on warn/block. They fail if _log_recovery is removed from
    handle_warn/handle_block (the original LI-2 wiring gap, since fixed).
    Tests 3 & 4 verify session/turn recording.
    """

    server: HTTPServer
    server_thread: threading.Thread
    log: _RequestLog
    base_url: str

    @classmethod
    def setUpClass(cls):
        cls.log = _RequestLog()
        port = _find_free_port()
        handler = _make_handler(cls.log)
        cls.server = HTTPServer(("127.0.0.1", port), handler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = "http://127.0.0.1:%d" % port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server_thread.join(timeout=5)

    def setUp(self):
        self.log.clear()
        self.log.guard_response = {"decision": "allow"}

    def _env(self, **extra) -> dict:
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-e2e",
            "DASHCLAW_AGENT_ID": "test-agent",
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": tempfile.gettempdir(),
            "DASHCLAW_PERMISSION_MODE": "danger",
        }
        env.update(extra)
        return env

    # -----------------------------------------------------------------------
    # Recovery surfacing — pins _log_recovery in handle_warn/handle_block
    # -----------------------------------------------------------------------

    def test_warn_with_recovery_surfaces_suggestion_in_output(self):
        """handle_warn() must surface recovery.suggestion via _log_recovery.

        When the guard returns decision=warn PLUS a recovery object, the hook
        emits the recovery suggestion to stderr so the agent can act on it.
        Fails if _log_recovery is removed from handle_warn.
        """
        self.log.guard_response = {
            "decision": "warn",
            # Use a warning text that does NOT contain any substring of
            # recovery.suggestion so the assertIn below is a strict test of
            # whether the hook surfaces the RECOVERY field, not the warning.
            "warnings": ["Policy warning: stale branch intel detected"],
            "recorded": True,
            "action_id": "act_recorded_e2e_001",
            "recovery": _BRANCH_STALE_RECOVERY,
        }

        code, _stdout, stderr = _run_hook(_GOVERNED_BASH, self._env())

        # Hook must complete (warn exits 0)
        self.assertEqual(code, 0, "warn decision must exit 0; stderr=%r" % stderr)

        # The warning itself must appear
        self.assertIn("Warning", stderr, "warn handler must print 'Warning'")

        self.assertIn(
            "Branch is behind main",  # a substring of recovery.suggestion
            stderr,
            "recovery.suggestion must be surfaced in hook stderr (via "
            "_log_recovery in handle_warn). Current stderr: %r" % stderr,
        )

    def test_block_with_recovery_surfaces_suggestion_in_output(self):
        """handle_block() must surface recovery.suggestion via _log_recovery.

        When the guard returns decision=block PLUS a recovery object, the hook
        emits the recovery suggestion to stderr alongside the block reason.
        Fails if _log_recovery is removed from handle_block.
        """
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Insufficient test coverage before deploy"],
            "matched_policies": ["green-contract-policy"],
            "recovery": _GREEN_INSUFFICIENT_RECOVERY,
        }

        code, _stdout, stderr = _run_hook(_GOVERNED_BASH, self._env())

        # Hook must block (exit 2 in enforce mode)
        self.assertEqual(code, 2, "block decision must exit 2; stderr=%r" % stderr)

        # The block reason must appear
        self.assertIn("Blocked", stderr, "block handler must print 'Blocked'")

        self.assertIn(
            "workspace level",  # a substring of recovery.suggestion
            stderr,
            "recovery.suggestion must be surfaced in hook stderr (via "
            "_log_recovery in handle_block). Current stderr: %r" % stderr,
        )

    # -----------------------------------------------------------------------
    # GREEN: session/turn recording — these PASS on current source
    # -----------------------------------------------------------------------

    def test_warn_with_recovery_records_action_via_single_call_path(self):
        """Governed flow completes and action is recorded for a warn + recovery response.

        Uses the ?record=true single-call path (recorded:true + action_id in the
        response). Asserts: hook exits 0, exactly one POST /api/guard, query
        carries record=true, and no fallback POST /api/actions is made.
        """
        self.log.guard_response = {
            "decision": "warn",
            "warnings": ["Branch is stale"],
            "recorded": True,
            "action_id": "act_recorded_e2e_002",
            "recovery": _BRANCH_STALE_RECOVERY,
        }

        code, _stdout, stderr = _run_hook(_GOVERNED_BASH, self._env())

        self.assertEqual(code, 0, "warn exits 0; stderr=%r" % stderr)

        posts = [r for r in self.log.get_all() if r["method"] == "POST"]
        guard_posts = [r for r in posts if r["path"] == "/api/guard"]
        action_posts = [r for r in posts if r["path"] == "/api/actions"]

        # Single-call path: exactly one guard POST, no fallback actions POST
        self.assertEqual(len(guard_posts), 1, "Expected exactly one guard call")
        self.assertEqual(guard_posts[0]["query"], "record=true",
                         "Guard call must carry ?record=true query param")
        self.assertEqual(len(action_posts), 0,
                         "No fallback /api/actions POST when guard recorded the action")

    def test_block_with_recovery_records_blocked_action(self):
        """Block + recovery: hook exits 2 AND creates a blocked action record.

        handle_block() calls create_action(context, status='blocked') unconditionally.
        Asserts: hook exits 2, POST /api/guard made (guard query), AND a fallback
        POST /api/actions with status=blocked is made (block path always uses the
        legacy create_action, never the single-call recorded path).
        """
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Green contract violated"],
            "matched_policies": ["gp-green-contract"],
            "recovery": _GREEN_INSUFFICIENT_RECOVERY,
        }

        code, _stdout, stderr = _run_hook(_GOVERNED_BASH, self._env())

        self.assertEqual(code, 2, "block exits 2; stderr=%r" % stderr)

        posts = [r for r in self.log.get_all() if r["method"] == "POST"]
        guard_posts = [r for r in posts if r["path"] == "/api/guard"]
        action_posts = [r for r in posts if r["path"] == "/api/actions"]

        # Guard was called
        self.assertEqual(len(guard_posts), 1, "Expected one guard call")

        # Block always creates a blocked action record (BUG-02 fix, Phase 1.5)
        self.assertEqual(len(action_posts), 1,
                         "block handler must POST /api/actions to record the block")
        self.assertEqual(action_posts[0]["body"].get("status"), "blocked",
                         "Blocked action must carry status=blocked")


if __name__ == "__main__":
    unittest.main()
