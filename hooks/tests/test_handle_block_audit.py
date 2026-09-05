"""Regression tests for handle_block audit trail behavior (BUG-02).

Verifies that handle_block() calls create_action(status="blocked") before
exiting, both in enforce mode and observe mode.

Prior to the Phase 1.5 fix, handle_block() logged to stderr and called
sys.exit(2) without ever posting to /api/actions, so blocked commands
vanished from the decisions ledger with zero audit trail.

Also covers the F0 unenforced-verdict state (governance gap audit
2026-08-05): in observe mode a block does not stop the tool call, so the
pretool must leave {"action_id", "unenforced_verdict"} state for PostToolUse
to stamp `executed_despite` on the row.

Uses only the Python standard library. Follows the same mock-server
pattern as test_pretool_integration.py.
"""

import hashlib
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
                code = 200
            elif self.path.partition("?")[0] == "/api/actions":
                # Mirror the real route: a blocked create answers HTTP 403
                # with the created action in the body (the observe-mode
                # executed-despite witness depends on reading that body —
                # a 200 here masked exactly that bug on 2026-08-06).
                if isinstance(body, dict) and body.get("status") == "blocked":
                    resp = json.dumps({
                        "error": "Action blocked by policy",
                        "action": {"action_id": "act_block_test_001", "status": "blocked"},
                    }).encode()
                    code = 403
                else:
                    resp = json.dumps({"action_id": "act_block_test_001"}).encode()
                    code = 200
            else:
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(code)
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
        cls.server.server_close()

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

    def _state_path(self, tool_use_id: str) -> str:
        # Mirrors the hooks' _INSTANCE_STATE_SUFFIX: sha256(BASE_URL + "|" +
        # AGENT_ID)[:12]. _env() sets DASHCLAW_AGENT_ID=test-agent.
        suffix = hashlib.sha256((self.base_url + "|test-agent").encode("utf-8")).hexdigest()[:12]
        return os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + suffix + "_" + tool_use_id)

    def test_handle_block_observe_mode_writes_unenforced_state(self):
        """F0: an observe-mode block leaves {"action_id", "unenforced_verdict"}
        state so PostToolUse can stamp executed_despite on the blocked row."""
        # Distinct tool_use_id: other tests in this class share the default id
        # and the allow path legitimately writes state for it.
        stdin = dict(_BLOCKED_BASH_INPUT, tool_use_id="tu-block-audit-f0-observe")
        state_path = self._state_path(stdin["tool_use_id"])
        self.addCleanup(lambda: os.path.exists(state_path) and os.remove(state_path))

        code, _out, _err = _run_hook(
            stdin,
            self._env(DASHCLAW_HOOK_MODE="observe"),
        )
        self.assertEqual(code, 0)

        self.assertTrue(
            os.path.exists(state_path),
            "Observe-mode block must write the pretool->posttool state file "
            "(the executed-despite witness depends on it)"
        )
        with open(state_path, "r", encoding="utf-8") as f:
            state = json.loads(f.read())
        self.assertEqual(state["action_id"], "act_block_test_001")
        self.assertEqual(state["unenforced_verdict"], "block")

    def test_handle_block_enforce_mode_writes_no_state(self):
        """In enforce mode the tool never runs — no posttool state, no stamp."""
        stdin = dict(_BLOCKED_BASH_INPUT, tool_use_id="tu-block-audit-f0-enforce")
        state_path = self._state_path(stdin["tool_use_id"])
        self.addCleanup(lambda: os.path.exists(state_path) and os.remove(state_path))

        code, _out, _err = _run_hook(stdin, self._env())
        self.assertEqual(code, 2)
        self.assertFalse(
            os.path.exists(state_path),
            "Enforce-mode block must NOT leave posttool state — the tool call is stopped"
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

    # -----------------------------------------------------------------------
    # Duplicate-decision regression (2026-08-06): a 5.10.1+ server records the
    # blocked action inside the ?record=true guard call. The hook must then
    # SKIP create_action — the fallback POST /api/actions re-evaluates guard
    # server-side and wrote a second guard_decisions row for every block.
    # -----------------------------------------------------------------------

    def test_handle_block_server_recorded_skips_create_action(self):
        """recorded:true in the guard response means no /api/actions call."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Test: block reason"],
            "matched_policies": ["gp_test123"],
            "recorded": True,
            "action_id": "act_server_recorded_001",
        }
        code, _out, _err = _run_hook(_BLOCKED_BASH_INPUT, self._env())

        self.assertEqual(code, 2, "Expected exit code 2 for block in enforce mode")
        action_calls = [r for r in self.log.get_all() if r["path"] == "/api/actions"]
        self.assertEqual(
            len(action_calls), 0,
            "Server already recorded the blocked action — a create_action call "
            "here re-evaluates guard and duplicates the guard_decisions row"
        )

    def test_handle_block_server_recorded_observe_uses_server_action_id(self):
        """Observe mode: the executed-despite witness state must carry the
        server-recorded action_id, still without a second /api/actions call."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Test: block reason"],
            "matched_policies": ["gp_test123"],
            "recorded": True,
            "action_id": "act_server_recorded_002",
        }
        stdin = dict(_BLOCKED_BASH_INPUT, tool_use_id="tu-block-audit-recorded-observe")
        state_path = self._state_path(stdin["tool_use_id"])
        self.addCleanup(lambda: os.path.exists(state_path) and os.remove(state_path))

        code, _out, _err = _run_hook(stdin, self._env(DASHCLAW_HOOK_MODE="observe"))

        self.assertEqual(code, 0, "Expected exit code 0 for block in observe mode")
        action_calls = [r for r in self.log.get_all() if r["path"] == "/api/actions"]
        self.assertEqual(len(action_calls), 0, "No create_action fallback when server recorded")
        self.assertTrue(os.path.exists(state_path), "Observe-mode block must write posttool state")
        with open(state_path, "r", encoding="utf-8") as f:
            state = json.loads(f.read())
        self.assertEqual(state["action_id"], "act_server_recorded_002")
        self.assertEqual(state["unenforced_verdict"], "block")

    def test_handle_block_recorded_false_falls_back_to_create_action(self):
        """A pre-5.10.1 server answers recorded:false on block — the hook must
        keep the legacy create_action fallback so the blocked row still exists."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Test: block reason"],
            "matched_policies": ["gp_test123"],
            "recorded": False,
            "recorded_error": "decision is block",
        }
        code, _out, _err = _run_hook(_BLOCKED_BASH_INPUT, self._env())

        self.assertEqual(code, 2)
        blocked_calls = [
            r for r in self.log.get_all()
            if r["path"] == "/api/actions"
            and isinstance(r.get("body"), dict) and r["body"].get("status") == "blocked"
        ]
        self.assertEqual(len(blocked_calls), 1, "recorded:false must fall back to create_action")

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
            fail_server.server_close()


if __name__ == "__main__":
    unittest.main()
