"""Regression test for the guard-401 misreport bug (issue #145).

Before the fix, api_request swallowed urllib's HTTPError into `return None`,
so a 401 (bad/missing DASHCLAW_API_KEY) was indistinguishable from a dead
host — the hook told the user "Guard unreachable" when the real cause was an
invalid API key.

This test stands up a local HTTP server that answers every request with 401
and points the hook at it. The hook must now report an "unauthorized / invalid
API key" message (not "unreachable") and record the orphan reason as
"guard_unauthorized". A genuine connection failure is covered by
test_pretool_guard_unavailable.py and must still say "unreachable".

Stdlib only. Subprocess + threaded http.server, no third-party deps.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer


_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")

_GOVERNED_BASH_INPUT = {
    "tool_name": "Bash",
    "tool_input": {"command": "rm -rf /tmp/dashclaw-145-test-fixture"},
    "tool_use_id": "tu-145-guard-unauthorized",
}


class _UnauthorizedHandler(BaseHTTPRequestHandler):
    """Answers every request with HTTP 401 + a JSON body, like a real API
    rejecting a bad key."""

    def _respond_401(self):
        body = json.dumps({"error": "Invalid or missing API key"}).encode("utf-8")
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._respond_401()

    def do_POST(self):
        # Drain the request body so the client write completes cleanly.
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length:
            self.rfile.read(length)
        self._respond_401()

    def log_message(self, *args):
        pass  # keep the test output quiet


def _run_hook(home_dir, tmp_dir, base_url, env_overrides=None, timeout=15):
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    env["HOME"] = home_dir
    env["USERPROFILE"] = home_dir
    env["TEMP"] = tmp_dir
    env["TMP"] = tmp_dir
    env["TMPDIR"] = tmp_dir
    env["DASHCLAW_BASE_URL"] = base_url
    env["DASHCLAW_API_KEY"] = "wrong-key-145"
    env["DASHCLAW_AGENT_ID"] = "test-agent-145"
    env["DASHCLAW_WORKSPACE"] = tmp_dir
    env["DASHCLAW_PERMISSION_MODE"] = "danger"
    env["DASHCLAW_GUARD_TIMEOUT"] = "2"
    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(_GOVERNED_BASH_INPUT).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return (
        proc.returncode,
        proc.stdout.decode("utf-8", errors="replace"),
        proc.stderr.decode("utf-8", errors="replace"),
    )


def _read_orphan_log(home_dir):
    path = os.path.join(home_dir, ".dashclaw", "orphan-actions.jsonl")
    if not os.path.exists(path):
        return []
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


class TestGuardUnauthorized(unittest.TestCase):
    """A 401 from the API must be reported as an auth failure, not unreachable."""

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _UnauthorizedHandler)
        cls.base_url = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self._home_ctx = tempfile.TemporaryDirectory()
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.home_dir = self._home_ctx.name
        self.tmp_dir = self._tmp_ctx.name

    def tearDown(self):
        self._home_ctx.cleanup()
        self._tmp_ctx.cleanup()

    def test_401_reports_unauthorized_not_unreachable(self):
        """Default block policy: a 401 blocks (exit 2) with an 'unauthorized /
        invalid API key' message — never 'unreachable' — and an orphan record
        tagged guard_unauthorized."""
        code, _out, err = _run_hook(self.home_dir, self.tmp_dir, self.base_url)

        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("Blocked", err)
        lowered = err.lower()
        self.assertIn("unauthorized", lowered)
        self.assertIn("api key", lowered)
        self.assertNotIn(
            "unreachable", lowered,
            "A 401 must NOT be reported as 'unreachable'. stderr=" + err,
        )

        records = _read_orphan_log(self.home_dir)
        self.assertEqual(len(records), 1, "Expected one orphan record. Got: " + str(records))
        self.assertEqual(records[0].get("reason"), "guard_unauthorized")

    def test_401_observe_mode_proceeds_but_names_the_real_cause(self):
        """Observe mode proceeds (exit 0) but still names the auth failure."""
        code, _out, err = _run_hook(
            self.home_dir, self.tmp_dir, self.base_url,
            env_overrides={"DASHCLAW_HOOK_MODE": "observe"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        lowered = err.lower()
        self.assertIn("unauthorized", lowered)
        self.assertNotIn("unreachable", lowered)


if __name__ == "__main__":
    unittest.main()
