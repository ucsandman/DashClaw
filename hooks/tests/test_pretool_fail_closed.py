"""Regression tests for the pretool hook's fail-OPEN holes (client review 2026-08-11).

Three paths in dashclaw_pretool.py let a governed tool call execute with no
verdict enforced and no ledger row — the exact hole handle_guard_unavailable is
written to close:

1. `require_approval` with no obtainable action_id (server 5xx/timeout on the
   create — api_request collapses both to None) logged "proceeding" and exited 0.
2. An unrecognised verdict fell through to handle_allow, so any verdict a newer
   server adds — or a garbled response body — executed ungoverned.
3. A stdin payload that was PRESENT but unparseable exited 0, indistinguishable
   from "this tool isn't governed".

All three now fail closed under the SAME escape hatch the guard-outage path
already honors (DASHCLAW_GUARD_UNAVAILABLE_POLICY), and observe mode still never
blocks.

Uses only the Python standard library. Follows the mock-server + subprocess
pattern from test_handle_block_audit.py.
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

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")


class _ServerState:
    """Thread-safe knobs for the mock API."""

    def __init__(self):
        self._lock = threading.Lock()
        self.guard_response = {"decision": "allow"}
        # When True, POST /api/actions answers 503 — the transient failure that
        # makes _extract_action_id yield "".
        self.actions_fail = False
        self.requests = []

    def add(self, method, path):
        with self._lock:
            self.requests.append({"method": method, "path": path.partition("?")[0]})

    def paths(self):
        with self._lock:
            return [r["path"] for r in self.requests]

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(state: _ServerState):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            if length:
                self.rfile.read(length)
            state.add("POST", self.path)
            bare = self.path.partition("?")[0]

            if bare == "/api/guard":
                self._json(200, state.guard_response)
                return
            if bare == "/api/actions":
                if state.actions_fail:
                    self._json(503, {"error": "database unavailable"})
                else:
                    self._json(200, {"action_id": "act_failclosed_001"})
                return
            self.send_response(404)
            self.end_headers()

        def do_GET(self):
            state.add("GET", self.path)
            # Pending forever: the approval wait must time out and block.
            self._json(200, {"action": {"action_id": "act_failclosed_001",
                                        "status": "pending_approval"}})

        def _json(self, code, payload):
            resp = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def log_message(self, fmt, *args):
            pass

    return Handler


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


_GOVERNED_BASH_INPUT = {
    "tool_name": "Bash",
    "tool_input": {"command": "rm -rf /tmp/dashclaw-failclosed-fixture"},
    "tool_use_id": "tu-failclosed-001",
}


class _HookRunner(unittest.TestCase):
    """Shared mock server + subprocess runner."""

    @classmethod
    def setUpClass(cls):
        cls.state = _ServerState()
        port = _find_free_port()
        cls.server = HTTPServer(("127.0.0.1", port), _make_handler(cls.state))
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = "http://127.0.0.1:%d" % port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server_thread.join(timeout=5)

    def setUp(self):
        self.state.clear()
        self.state.actions_fail = False
        self.state.guard_response = {"decision": "allow"}
        self._home_ctx = tempfile.TemporaryDirectory()
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.home_dir = self._home_ctx.name
        self.tmp_dir = self._tmp_ctx.name

    def tearDown(self):
        self._home_ctx.cleanup()
        self._tmp_ctx.cleanup()

    def run_hook(self, stdin_bytes=None, env_overrides=None, timeout=20):
        env = os.environ.copy()
        for key in list(env.keys()):
            if key.startswith("DASHCLAW_"):
                del env[key]
        env["DASHCLAW_DISABLE_DOTENV"] = "1"
        env["HOME"] = self.home_dir
        env["USERPROFILE"] = self.home_dir
        env["TEMP"] = self.tmp_dir
        env["TMP"] = self.tmp_dir
        env["TMPDIR"] = self.tmp_dir
        env["DASHCLAW_BASE_URL"] = self.base_url
        env["DASHCLAW_API_KEY"] = "test-key-failclosed"
        env["DASHCLAW_AGENT_ID"] = "test-agent-failclosed"
        env["DASHCLAW_HOOK_MODE"] = "enforce"
        env["DASHCLAW_WORKSPACE"] = self.tmp_dir
        env["DASHCLAW_PERMISSION_MODE"] = "danger"
        env["DASHCLAW_APPROVAL_TIMEOUT"] = "1"
        if env_overrides:
            env.update(env_overrides)

        if stdin_bytes is None:
            stdin_bytes = json.dumps(_GOVERNED_BASH_INPUT).encode("utf-8")

        proc = subprocess.run(
            [sys.executable, _PRETOOL_SCRIPT],
            input=stdin_bytes,
            capture_output=True,
            timeout=timeout,
            env=env,
        )
        return (
            proc.returncode,
            proc.stdout.decode("utf-8", errors="replace"),
            proc.stderr.decode("utf-8", errors="replace"),
        )


class TestRequireApprovalWithoutActionId(_HookRunner):
    """Finding 1: require_approval + un-creatable approval request must block."""

    def setUp(self):
        super().setUp()
        # recorded absent => the hook falls back to create_action, which 503s.
        self.state.guard_response = {
            "decision": "require_approval",
            "matched_policies": ["gp_failclosed"],
        }
        self.state.actions_fail = True

    def test_enforce_blocks_when_approval_request_cannot_be_created(self):
        code, _out, err = self.run_hook()

        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("Blocked", err)
        self.assertNotIn("proceeding", err.lower())
        self.assertIn("DASHCLAW_GUARD_UNAVAILABLE_POLICY", err)

    def test_policy_allow_is_the_only_way_through(self):
        code, _out, err = self.run_hook(
            env_overrides={"DASHCLAW_GUARD_UNAVAILABLE_POLICY": "allow"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow", err)

    def test_observe_mode_still_never_blocks(self):
        code, _out, err = self.run_hook(
            env_overrides={"DASHCLAW_HOOK_MODE": "observe"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("[observe]", err)


class TestUnknownVerdict(_HookRunner):
    """Finding 2: a verdict this hook does not know must land on a human."""

    def test_unknown_verdict_asks_for_approval_instead_of_allowing(self):
        self.state.guard_response = {"decision": "quarantine_and_review"}

        code, _out, err = self.run_hook()

        # Approval never arrives within DASHCLAW_APPROVAL_TIMEOUT=1 => block.
        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("quarantine_and_review", err)
        self.assertIn("Approval required", err)
        self.assertIn("/api/actions", self.state.paths())

    def test_response_without_a_decision_field_is_not_an_allow(self):
        """A truncated/garbled body that parses but carries no verdict."""
        self.state.guard_response = {"reasons": ["truncated body"]}

        code, _out, err = self.run_hook()

        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("Approval required", err)

    def test_allow_still_allows(self):
        self.state.guard_response = {"decision": "allow"}

        code, _out, err = self.run_hook()

        self.assertEqual(code, 0, "stderr=" + err)


class TestUnparseableHookInput(_HookRunner):
    """Finding 3: present-but-malformed stdin is a fail-open, empty stdin is not."""

    def test_malformed_payload_blocks(self):
        code, _out, err = self.run_hook(stdin_bytes=b"{not json at all")

        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("Blocked", err)
        self.assertIn("could not parse", err)

    def test_malformed_payload_proceeds_under_the_escape_hatch(self):
        code, _out, err = self.run_hook(
            stdin_bytes=b"{not json at all",
            env_overrides={"DASHCLAW_GUARD_UNAVAILABLE_POLICY": "warn"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("could not parse", err)

    def test_malformed_payload_in_observe_mode_proceeds(self):
        code, _out, err = self.run_hook(
            stdin_bytes=b"{not json at all",
            env_overrides={"DASHCLAW_HOOK_MODE": "observe"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("[observe]", err)

    def test_empty_stdin_stays_silent(self):
        """No payload at all means the hook was not invoked by Claude Code —
        exit 0 with no noise is correct there."""
        code, _out, err = self.run_hook(stdin_bytes=b"")

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertEqual(err.strip(), "")


if __name__ == "__main__":
    unittest.main()
