"""Regression tests for handle_block audit trail behavior (BUG-02).

Verifies that handle_block() calls create_action(status="blocked") before
exiting, both in enforce mode and observe mode.

Prior to the Phase 1.5 fix, handle_block() logged to stderr and called
sys.exit(2) without ever posting to /api/actions, so blocked commands
vanished from the decisions ledger with zero audit trail.

Uses only the Python standard library. Follows the same mock-server
pattern as test_pretool_integration.py.
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
# Paths
# ---------------------------------------------------------------------------

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")


# ---------------------------------------------------------------------------
# Minimal mock HTTP server
# ---------------------------------------------------------------------------

class _RequestLog:
    """Thread-safe accumulator for incoming HTTP requests."""

    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self.guard_response: dict = {"decision": "allow"}

    def add(self, method: str, path: str, body: dict | None):
        # Strip the query string (the hook calls /api/guard?record=true) so
        # path assertions stay stable.
        bare = path.partition("?")[0]
        with self._lock:
            self.requests.append({"method": method, "path": bare, "body": body})

    def get_all(self) -> list[dict]:
        with self._lock:
            return list(self.requests)

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log: _RequestLog):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            log.add("POST", self.path, body)

            if self.path.partition("?")[0] == "/api/guard":
                resp = json.dumps(log.guard_response).encode()
            elif self.path.partition("?")[0] == "/api/actions":
                resp = json.dumps({"action_id": "act_block_test_001"}).encode()
            else:
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def log_message(self, fmt, *args):
            pass  # Silence server-side logging during tests.

    return Handler


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _run_hook(
    stdin_data: dict,
    env_overrides: dict | None = None,
    timeout: float = 10,
) -> tuple[int, str, str]:
    """Run the pretool hook as a subprocess. Returns (exit_code, stdout, stderr)."""
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    # Disable .env walking so the operator's local .env cannot leak into the
    # subprocess and override test expectations. Production hooks never set this.
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
    return (
        proc.returncode,
        proc.stdout.decode("utf-8", errors="replace"),
        proc.stderr.decode("utf-8", errors="replace"),
    )


# Synthetic Bash input that represents the originally-blocked gsd-tools call.
_BLOCKED_BASH_INPUT = {
    "tool_name": "Bash",
    "tool_input": {
        "command": "node $HOME/.claude/get-shit-done/bin/gsd-tools.cjs init progress"
    },
    "tool_use_id": "tu-block-audit-001",
}


class TestHandleBlockAuditTrail(unittest.TestCase):
    """Regression tests: handle_block must record the action before exiting."""

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
        # Default: guard returns block so handle_block() is invoked.
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Test: block reason"],
            "matched_policies": ["gp_test123"],
        }

    def _env(self, **extra) -> dict:
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-audit",
            "DASHCLAW_AGENT_ID": "test-agent",
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": tempfile.gettempdir(),
            "DASHCLAW_PERMISSION_MODE": "danger",
        }
        env.update(extra)
        return env

    # -----------------------------------------------------------------------
    # Core regression: handle_block must POST to /api/actions with status=blocked
    # -----------------------------------------------------------------------

    def test_handle_block_enforce_mode_records_action(self):
        """In enforce mode, handle_block posts status=blocked to /api/actions before exit."""
        code, _out, _err = _run_hook(_BLOCKED_BASH_INPUT, self._env())

        # Hook must exit with code 2 (block in enforce mode).
        self.assertEqual(code, 2, "Expected exit code 2 for block in enforce mode")

        all_reqs = self.log.get_all()

        # Must have called /api/guard.
        guard_calls = [r for r in all_reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_calls), 1, "Expected exactly one /api/guard call")

        # Must have called /api/actions with status=blocked (the regression fix).
        action_calls = [r for r in all_reqs if r["path"] == "/api/actions"]
        self.assertGreaterEqual(
            len(action_calls), 1,
            "handle_block must POST to /api/actions — no action call found (BUG-02 regression)"
        )

        blocked_calls = [
            r for r in action_calls
            if isinstance(r.get("body"), dict) and r["body"].get("status") == "blocked"
        ]
        self.assertEqual(
            len(blocked_calls), 1,
            "handle_block must set status='blocked' in the /api/actions payload. "
            f"Actual action calls: {[r['body'] for r in action_calls]}"
        )

    def test_handle_block_observe_mode_records_action_exits_0(self):
        """In observe mode, handle_block still records the action and exits 0 (not 2)."""
        code, _out, _err = _run_hook(
            _BLOCKED_BASH_INPUT,
            self._env(DASHCLAW_HOOK_MODE="observe"),
        )

        # In observe mode the hook does NOT block — it exits 0.
        self.assertEqual(code, 0, "Expected exit code 0 for block in observe mode")

        all_reqs = self.log.get_all()

        # Must still have recorded the action even in observe mode.
        action_calls = [r for r in all_reqs if r["path"] == "/api/actions"]
        self.assertGreaterEqual(
            len(action_calls), 1,
            "handle_block must POST to /api/actions even in observe mode"
        )

        blocked_calls = [
            r for r in action_calls
            if isinstance(r.get("body"), dict) and r["body"].get("status") == "blocked"
        ]
        self.assertEqual(
            len(blocked_calls), 1,
            "handle_block must set status='blocked' in observe mode too"
        )

    def test_allow_decision_does_not_post_blocked_status(self):
        """Sanity check: an allow decision posts status=running, not blocked."""
        self.log.guard_response = {"decision": "allow"}
        code, _out, _err = _run_hook(_BLOCKED_BASH_INPUT, self._env())

        self.assertEqual(code, 0, "Expected exit code 0 for allow decision")

        action_calls = [r for r in self.log.get_all() if r["path"] == "/api/actions"]
        self.assertEqual(len(action_calls), 1, "Expected one /api/actions call for allow")
        self.assertEqual(
            action_calls[0]["body"].get("status"), "running",
            "Allow path must post status=running, not blocked"
        )

    def test_handle_block_exits_2_when_action_record_fails(self):
        """Block enforcement is authoritative even when the audit write fails.

        If /api/actions returns an error, handle_block must still exit 2
        so the governance decision holds regardless of recording success.
        """
        # Override the handler to return 500 for /api/actions.
        class FailingActionsLog(_RequestLog):
            pass

        failing_log = FailingActionsLog()
        failing_log.guard_response = {
            "decision": "block",
            "reasons": ["Test: block reason for failure test"],
            "matched_policies": ["gp_fail_test"],
        }

        def _make_failing_handler(flog):
            class FailHandler(BaseHTTPRequestHandler):
                def do_POST(self):
                    length = int(self.headers.get("Content-Length", 0))
                    raw = self.rfile.read(length) if length else b""
                    body = json.loads(raw) if raw else None
                    flog.add("POST", self.path, body)

                    if self.path.partition("?")[0] == "/api/guard":
                        resp = json.dumps(flog.guard_response).encode()
                        self.send_response(200)
                    else:
                        # Simulate /api/actions server error.
                        resp = json.dumps({"error": "server error"}).encode()
                        self.send_response(500)

                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(resp)))
                    self.end_headers()
                    self.wfile.write(resp)

                def log_message(self, fmt, *args):
                    pass

            return FailHandler

        fail_port = _find_free_port()
        fail_server = HTTPServer(("127.0.0.1", fail_port), _make_failing_handler(failing_log))
        fail_thread = threading.Thread(target=fail_server.serve_forever, daemon=True)
        fail_thread.start()
        try:
            env = self._env()
            env["DASHCLAW_BASE_URL"] = "http://127.0.0.1:%d" % fail_port

            code, _out, _err = _run_hook(_BLOCKED_BASH_INPUT, env)
            self.assertEqual(
                code, 2,
                "Block must still exit 2 even when /api/actions write fails — "
                "governance decision is authoritative"
            )
        finally:
            fail_server.shutdown()
            fail_thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
