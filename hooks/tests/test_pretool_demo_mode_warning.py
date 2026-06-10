"""Regression tests for the demo-mode startup warning (todo-001).

When DASHCLAW_BASE_URL points at an instance whose /api/health returns
{"mode": "demo"}, the pretool hook prints a one-shot stderr warning so
the operator notices a misrouted env var before debugging fixture
decisions as if they were real policies.

Cache miss -> probe + (warning if demo). Cache hit -> silent.
Switching BASE_URL forces a fresh probe because the cache key is per-URL.

Uses only the Python standard library. Spins up a tiny localhost HTTP
server fixture that returns a configurable health payload.
"""

import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest


_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")


_GOVERNED_BASH_INPUT = {
    "tool_name": "Bash",
    "tool_input": {"command": "echo demo-warning-test"},
    "tool_use_id": "tu-demo-warning-test",
}


class _HealthHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP server that returns the configured payload at /api/health
    and refuses everything else with 503.

    The class-level `_payload` lets tests swap the response without restarting
    the server. /api/guard returns 503 so the hook short-circuits to
    handle_guard_unavailable -> exit 2 quickly (we only care about stderr)."""

    _payload = {"status": "healthy", "mode": "live"}

    def do_GET(self):
        if self.path == "/api/health":
            body = json.dumps(self._payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(503)
            self.end_headers()

    def do_POST(self):
        # /api/guard, /api/actions — fail fast so the hook reaches its
        # guard-unavailable branch without waiting on retries.
        self.send_response(503)
        self.end_headers()

    def log_message(self, format, *args):
        return  # Quiet test output


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_server(payload, port=None):
    _HealthHandler._payload = payload
    if port is None:
        port = _free_port()
    server = http.server.HTTPServer(("127.0.0.1", port), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def _run_hook(home_dir, tmp_dir, base_url, timeout=15):
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
    env["DASHCLAW_API_KEY"] = "test-key-demo-warning"
    env["DASHCLAW_AGENT_ID"] = "test-agent"
    env["DASHCLAW_WORKSPACE"] = tmp_dir
    env["DASHCLAW_PERMISSION_MODE"] = "danger"
    env["DASHCLAW_GUARD_TIMEOUT"] = "0.5"
    # Block-on-unavailable so the run terminates fast with exit 2 — we only
    # care about the demo warning emitted earlier in main().
    env["DASHCLAW_GUARD_UNAVAILABLE_POLICY"] = "block"

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(_GOVERNED_BASH_INPUT).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


class DemoModeWarningTest(unittest.TestCase):
    def setUp(self):
        self._home = tempfile.mkdtemp(prefix="dashclaw-test-home-")
        self._tmp = tempfile.mkdtemp(prefix="dashclaw-test-tmp-")
        self._server = None

    def tearDown(self):
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        shutil.rmtree(self._home, ignore_errors=True)
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_demo_mode_warning_appears(self):
        """Health endpoint returning {"mode": "demo"} triggers the stderr warning."""
        server, port = _start_server({"status": "healthy", "mode": "demo"})
        self._server = server
        base_url = "http://127.0.0.1:" + str(port)

        _, _, stderr = _run_hook(self._home, self._tmp, base_url)

        self.assertIn("demo-mode instance", stderr)
        self.assertIn(base_url, stderr)
        self.assertIn("Set DASHCLAW_BASE_URL", stderr)

    def test_live_mode_no_warning(self):
        """Health endpoint returning {"mode": "live"} produces no demo warning."""
        server, port = _start_server({"status": "healthy", "mode": "live"})
        self._server = server
        base_url = "http://127.0.0.1:" + str(port)

        _, _, stderr = _run_hook(self._home, self._tmp, base_url)

        self.assertNotIn("demo-mode instance", stderr)

    def test_warning_skipped_on_cache_hit(self):
        """Second invocation against the same demo URL is cached -> no re-warn."""
        server, port = _start_server({"status": "healthy", "mode": "demo"})
        self._server = server
        base_url = "http://127.0.0.1:" + str(port)

        _, _, stderr1 = _run_hook(self._home, self._tmp, base_url)
        _, _, stderr2 = _run_hook(self._home, self._tmp, base_url)

        self.assertIn("demo-mode instance", stderr1)
        self.assertNotIn("demo-mode instance", stderr2)

    def test_probe_failure_writes_negative_cache_and_skips_reprobe(self):
        """A failed probe is negative-cached (short TTL) so consecutive tool
        calls against a dead instance don't re-pay the probe on every call."""
        port = _free_port()
        base_url = "http://127.0.0.1:" + str(port)

        # Run 1: nothing listening — probe fails silently, negative entry cached.
        rc1, _, stderr1 = _run_hook(self._home, self._tmp, base_url)
        self.assertEqual(rc1, 2)
        self.assertNotIn("demo-mode instance", stderr1)
        cache_files = [f for f in os.listdir(self._tmp) if f.startswith("dashclaw_health_check_")]
        self.assertEqual(len(cache_files), 1, "expected one negative cache entry")
        with open(os.path.join(self._tmp, cache_files[0]), encoding="utf-8") as f:
            self.assertIn("unreachable", f.read())

        # Run 2: a DEMO server now listens on the same port, but the fresh
        # negative cache suppresses the re-probe — no demo warning surfaces.
        server, _ = _start_server({"status": "healthy", "mode": "demo"}, port=port)
        self._server = server
        _, _, stderr2 = _run_hook(self._home, self._tmp, base_url)
        self.assertNotIn("demo-mode instance", stderr2)

    def test_warning_does_not_block_enforcement(self):
        """Demo warning is informational; the hook still exits 2 in block-on-unavailable mode."""
        server, port = _start_server({"status": "healthy", "mode": "demo"})
        self._server = server
        base_url = "http://127.0.0.1:" + str(port)

        rc, _, stderr = _run_hook(self._home, self._tmp, base_url)

        # Warning is present...
        self.assertIn("demo-mode instance", stderr)
        # ...but enforcement still happened (guard refused -> blocked).
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
