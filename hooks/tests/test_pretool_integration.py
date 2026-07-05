"""Integration tests for dashclaw_pretool.py v2.

Starts a mock HTTP server on a random port and runs the pretool hook
as a subprocess, verifying enriched intel is sent to the guard API.

Uses only the Python standard library.
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
# Mock HTTP server
# ---------------------------------------------------------------------------

class _RequestLog:
    """Thread-safe accumulator for incoming requests."""

    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        # Default response for /api/guard
        self.guard_response: dict = {"decision": "allow"}

    def add(self, method: str, path: str, body: dict | None):
        # Store the path WITHOUT its query string (the hook now calls
        # /api/guard?record=true) so path assertions stay stable; the query
        # is recorded separately for tests that care.
        bare, _, query = path.partition("?")
        with self._lock:
            self.requests.append({"method": method, "path": bare, "query": query, "body": body})

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
            log.add("POST", self.path, body)

            if self.path.partition("?")[0] == "/api/guard":
                resp = json.dumps(log.guard_response).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            elif self.path == "/api/actions":
                resp = json.dumps({"action_id": "test-action-001"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            else:
                self.send_response(404)
                self.end_headers()

        def do_GET(self):
            log.add("GET", self.path, None)
            self.send_response(200)
            resp = json.dumps({"status": "running"}).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def log_message(self, fmt, *args):
            # Silence request logging during tests.
            pass

    return Handler


def _find_free_port() -> int:
    """Find a free TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Test helper
# ---------------------------------------------------------------------------

def _run_hook(stdin_data: dict, env_overrides: dict | None = None, timeout: float = 10, argv: list[str] | None = None) -> tuple[int, str, str]:
    """Run the pretool hook as a subprocess.

    `argv` appends extra command-line arguments (e.g. the per-harness
    `--agent-id` flag installers write). Returns (exit_code, stdout, stderr).
    """
    env = os.environ.copy()
    # Remove any real DashClaw config so the hook uses our overrides.
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    # Disable .env walking so the operator's local .env cannot leak into the
    # subprocess and override test expectations. Production hooks never set this.
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT, *(argv or [])],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPretoolIntegration(unittest.TestCase):
    """Integration tests that run the hook against a mock guard server."""

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
        """Build the base environment dict pointing at our mock server."""
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": "test-agent",
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": tempfile.gettempdir(),
            "DASHCLAW_PERMISSION_MODE": "danger",
        }
        env.update(extra)
        return env

    # -----------------------------------------------------------------------
    # 1. Bash sends enriched intel with bash.intent
    # -----------------------------------------------------------------------

    def test_bash_sends_enriched_intel(self):
        """Bash tool calls should include bash intel with intent in the guard request."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls -la"}, "tool_use_id": "tu-001"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Expected exactly one guard call")

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertIn("bash", body["intel"])
        self.assertIn("intent", body["intel"]["bash"])
        self.assertEqual(body["intel"]["bash"]["intent"], "readonly")
        self.assertEqual(body["tool"]["name"], "Bash")
        self.assertEqual(body["tool"]["category"], "execution")

    def test_bash_destructive_sends_high_risk(self):
        """Destructive bash commands should produce high risk scores."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /tmp/stuff"}, "tool_use_id": "tu-002"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertEqual(body["intel"]["bash"]["intent"], "destructive")
        self.assertGreaterEqual(body["risk_score"], 70)

    # -----------------------------------------------------------------------
    # 2. Read tool is ungoverned (no guard call)
    # -----------------------------------------------------------------------

    def test_read_tool_ungoverned(self):
        """Read is a 'search' category tool, which is ungoverned. No guard call should be made."""
        code, _, _ = _run_hook(
            {"tool_name": "Read", "tool_input": {"file_path": "/tmp/test.txt"}, "tool_use_id": "tu-003"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 0, "Read should not trigger a guard call")

    def test_glob_tool_ungoverned(self):
        """Glob is a 'search' category tool, which is ungoverned."""
        code, _, _ = _run_hook(
            {"tool_name": "Glob", "tool_input": {"pattern": "*.py"}, "tool_use_id": "tu-004"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 0, "Glob should not trigger a guard call")

    # -----------------------------------------------------------------------
    # 3. Write sends file intel with traversal_detected
    # -----------------------------------------------------------------------

    def test_write_sends_file_intel(self):
        """Write tool calls should include file intel in the guard request."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "/tmp/output.txt", "content": "hello"},
                "tool_use_id": "tu-005",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertIn("file", body["intel"])
        self.assertIn("traversal_detected", body["intel"]["file"])
        self.assertEqual(body["tool"]["name"], "Write")

    def test_write_traversal_detected(self):
        """Write with path traversal should set traversal_detected=True and boost risk."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "../../../etc/passwd", "content": "evil"},
                "tool_use_id": "tu-006",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertTrue(body["intel"]["file"]["traversal_detected"])
        # Traversal adds +20 to base risk of 40
        self.assertGreaterEqual(body["risk_score"], 55)

    def test_write_sensitive_path(self):
        """Write to a .env file should flag sensitive_path."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "/tmp/.env", "content": "SECRET=123"},
                "tool_use_id": "tu-007",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertTrue(body["intel"]["file"]["sensitive_path"])
        self.assertEqual(body["action_type"], "security")

    # -----------------------------------------------------------------------
    # 4. mcp__ tools include MCP health
    # -----------------------------------------------------------------------

    def test_mcp_tool_includes_health(self):
        """MCP tool calls should include mcp health info in the guard request."""
        code, _, _ = _run_hook(
            {
                "tool_name": "mcp__agentcash__get_balance",
                "tool_input": {},
                "tool_use_id": "tu-008",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertIn("mcp", body["intel"])
        self.assertEqual(body["intel"]["mcp"]["server"], "agentcash")
        self.assertIn("healthy", body["intel"]["mcp"])
        self.assertIn("status", body["intel"]["mcp"])
        self.assertEqual(body["tool"]["category"], "mcp")
        self.assertEqual(body["action_type"], "api")

    # -----------------------------------------------------------------------
    # 5. Unknown tools are governed
    # -----------------------------------------------------------------------

    def test_unknown_tool_governed(self):
        """Unknown tools (not in catalog, not mcp__) should be governed."""
        code, _, _ = _run_hook(
            {
                "tool_name": "SomeNewTool",
                "tool_input": {"data": "test"},
                "tool_use_id": "tu-009",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Unknown tools should be governed")

        body = guard_reqs[0]["body"]
        self.assertEqual(body["tool"]["category"], "unknown")

    # -----------------------------------------------------------------------
    # 6. Block decision returns exit code 2
    # -----------------------------------------------------------------------

    def test_block_decision_exits_2(self):
        """When guard returns 'block', the hook should exit with code 2."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Dangerous operation not allowed"],
            "matched_policies": ["no-destructive"],
        }
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}, "tool_use_id": "tu-010"},
            self._env(),
        )
        self.assertEqual(code, 2)
        self.assertIn("Blocked", stderr)

    # -----------------------------------------------------------------------
    # 7. Warn decision prints warning and exits 0
    # -----------------------------------------------------------------------

    def test_warn_decision_exits_0(self):
        """When guard returns 'warn', the hook should print warning and exit 0."""
        self.log.guard_response = {
            "decision": "warn",
            "warnings": ["This operation is risky"],
        }
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "npm install foo"}, "tool_use_id": "tu-011"},
            self._env(),
        )
        self.assertEqual(code, 0)
        self.assertIn("Warning", stderr)

    # -----------------------------------------------------------------------
    # 8. No config = silent pass-through
    # -----------------------------------------------------------------------

    def test_no_config_passes_through(self):
        """Without BASE_URL/API_KEY, the hook should exit 0 silently."""
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_use_id": "tu-012"},
            # Explicitly set empty values to override anything from .env
            {"DASHCLAW_BASE_URL": "", "DASHCLAW_API_KEY": ""},
        )
        self.assertEqual(code, 0)
        self.assertEqual(stderr.strip(), "")

    # -----------------------------------------------------------------------
    # 9. Edit tool is governed and sends file intel
    # -----------------------------------------------------------------------

    def test_edit_tool_sends_file_intel(self):
        """Edit tool calls should include file intel in the guard request."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Edit",
                "tool_input": {"file_path": "/tmp/code.py", "old_string": "a", "new_string": "b"},
                "tool_use_id": "tu-013",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("file", body["intel"])
        self.assertEqual(body["tool"]["name"], "Edit")
        self.assertEqual(body["tool"]["category"], "file_io")

    # -----------------------------------------------------------------------
    # 9b. Evidence-first guard: `act` attached in _build_guard_context
    # (docs/superpowers/specs/2026-07-05-evidence-first-guard.md)
    # -----------------------------------------------------------------------

    def test_bash_act_evidence_attached(self):
        """Bash calls attach act: {kind: shell, command}."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls -la"}, "tool_use_id": "tu-act-001"},
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["act"], {"kind": "shell", "command": "ls -la"})

    def test_powershell_act_evidence_attached(self):
        """PowerShell rides the same shell act path as Bash."""
        code, _, _ = _run_hook(
            {"tool_name": "PowerShell", "tool_input": {"command": "Get-ChildItem"}, "tool_use_id": "tu-act-002"},
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["act"], {"kind": "shell", "command": "Get-ChildItem"})

    def test_bash_act_command_capped_at_8192(self):
        """A command longer than 8192 chars is truncated in the act payload."""
        long_command = "echo " + ("a" * 9000)
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": long_command}, "tool_use_id": "tu-act-003"},
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(len(body["act"]["command"]), 8192)
        self.assertEqual(body["act"]["command"], long_command[:8192])

    def test_write_act_evidence_attached(self):
        """Write calls attach act: {kind: file, file: {path, content_excerpt, bytes}}."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "/tmp/output.txt", "content": "hello world"},
                "tool_use_id": "tu-act-004",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["act"], {
            "kind": "file",
            "file": {"path": "/tmp/output.txt", "content_excerpt": "hello world", "bytes": 11},
        })

    def test_edit_act_uses_new_string(self):
        """Edit calls attach act.file.content_excerpt from new_string."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Edit",
                "tool_input": {"file_path": "/tmp/code.py", "old_string": "a", "new_string": "b = 2"},
                "tool_use_id": "tu-act-005",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["act"]["kind"], "file")
        self.assertEqual(body["act"]["file"]["content_excerpt"], "b = 2")
        self.assertEqual(body["act"]["file"]["path"], "/tmp/code.py")

    def test_multiedit_act_joins_edits(self):
        """MultiEdit joins each edit's new_string, mirroring _outbound_content."""
        code, _, _ = _run_hook(
            {
                "tool_name": "MultiEdit",
                "tool_input": {
                    "file_path": "/tmp/multi.py",
                    "edits": [{"old_string": "a", "new_string": "one"}, {"old_string": "b", "new_string": "two"}],
                },
                "tool_use_id": "tu-act-006",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["act"]["file"]["content_excerpt"], "one\ntwo")

    def test_file_act_content_excerpt_capped_but_bytes_reflect_full_size(self):
        """content_excerpt is capped at 4096 chars; bytes reflects the full content length."""
        content = "x" * 5000
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "/tmp/big.txt", "content": content},
                "tool_use_id": "tu-act-007",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(len(body["act"]["file"]["content_excerpt"]), 4096)
        self.assertEqual(body["act"]["file"]["bytes"], 5000)

    def test_write_without_a_path_omits_act(self):
        """A file tool call with no resolvable path must not send a malformed
        act.file (server requires a non-empty path) — omit act instead."""
        code, _, _ = _run_hook(
            {"tool_name": "Write", "tool_input": {"content": "hello"}, "tool_use_id": "tu-act-009"},
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertNotIn("act", body)

    def test_mcp_tool_has_no_act(self):
        """Tools outside shell/file (e.g. mcp__) get no act — additive, not universal."""
        code, _, _ = _run_hook(
            {"tool_name": "mcp__agentcash__get_balance", "tool_input": {}, "tool_use_id": "tu-act-008"},
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertNotIn("act", body)

    # -----------------------------------------------------------------------
    # 10. System tools (EnterPlanMode) are ungoverned
    # -----------------------------------------------------------------------

    def test_system_tool_ungoverned(self):
        """System tools like EnterPlanMode should be ungoverned."""
        code, _, _ = _run_hook(
            {"tool_name": "EnterPlanMode", "tool_input": {}, "tool_use_id": "tu-014"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 0, "System tools should not trigger guard calls")

    # -----------------------------------------------------------------------
    # 11. Observe mode lets blocked actions through
    # -----------------------------------------------------------------------

    def test_observe_mode_allows_blocks(self):
        """In observe mode, blocked decisions should log a warning and exit 0."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Not allowed"],
            "matched_policies": ["strict-policy"],
        }
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}, "tool_use_id": "tu-015"},
            self._env(DASHCLAW_HOOK_MODE="observe"),
        )
        self.assertEqual(code, 0)
        self.assertIn("[observe]", stderr)

    # -----------------------------------------------------------------------
    # 12. Guard context includes tool metadata
    # -----------------------------------------------------------------------

    def test_guard_context_has_tool_metadata(self):
        """Guard requests should include tool name, category, and permission."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "echo hello"}, "tool_use_id": "tu-016"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        body = guard_reqs[0]["body"]

        self.assertIn("tool", body)
        self.assertEqual(body["tool"]["name"], "Bash")
        self.assertEqual(body["tool"]["category"], "execution")
        self.assertEqual(body["tool"]["required_permission"], "danger")
        self.assertEqual(body["agent_id"], "test-agent")

    # -----------------------------------------------------------------------
    # 13. Bash network intent maps to api action_type
    # -----------------------------------------------------------------------

    def test_bash_network_maps_to_api(self):
        """Bash command with network intent should map to 'api' action_type."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "curl https://example.com"}, "tool_use_id": "tu-017"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        body = guard_reqs[0]["body"]

        self.assertEqual(body["action_type"], "api")
        self.assertEqual(body["intel"]["bash"]["intent"], "network")

    def test_bash_node_inline_eval_warns_not_blocks(self):
        """`node -e` must classify as interpreter (action_type build) and land
        in the warn band — not inherit the Bash tool's blunt 70 base via the
        unknown-command fallback, which put it in the block band by accident."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "node -e \"console.log(require('./package.json').version)\""},
                "tool_use_id": "tu-017b",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        body = guard_reqs[0]["body"]

        self.assertEqual(body["intel"]["bash"]["intent"], "interpreter")
        self.assertEqual(body["action_type"], "build")
        self.assertGreaterEqual(body["risk_score"], 40)
        self.assertLess(body["risk_score"], 70)

    def test_bash_node_script_is_low_risk(self):
        """Running a named script file is routine agent work — allow band."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "node scripts/build.js"}, "tool_use_id": "tu-017c"},
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["intel"]["bash"]["intent"], "interpreter")
        self.assertLess(body["risk_score"], 40)

    # -----------------------------------------------------------------------
    # 14. NotebookEdit is governed as file_io
    # -----------------------------------------------------------------------

    def test_notebook_edit_governed(self):
        """NotebookEdit should be governed and classified as file_io."""
        code, _, _ = _run_hook(
            {
                "tool_name": "NotebookEdit",
                "tool_input": {"file_path": "/tmp/nb.ipynb", "content": "{}"},
                "tool_use_id": "tu-018",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertEqual(body["tool"]["category"], "file_io")
        self.assertIn("file", body["intel"])


    # -----------------------------------------------------------------------
    # 15. Readonly bash is low-risk (no blanket 70 floor)
    # -----------------------------------------------------------------------

    def test_bash_readonly_is_low_risk(self):
        """A readonly command like `echo hello` must not inherit the Bash tool's
        70 base_risk — the per-command classifier scores it low."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "echo hello"}, "tool_use_id": "tu-019"},
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["intel"]["bash"]["intent"], "readonly")
        self.assertLess(body["risk_score"], 20)

    def test_bash_redirect_counts_as_write(self):
        """A redirection is a write even when the command is readonly — score it
        at least at write level, not the readonly base, but below the danger floor."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "echo data > /tmp/out.txt"}, "tool_use_id": "tu-020"},
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertGreaterEqual(body["risk_score"], 35)
        self.assertLess(body["risk_score"], 70)

    def test_bash_redirect_to_system_path_is_high_risk(self):
        """Redirecting INTO a protected system path stays high-risk even though
        `echo` classifies as readonly (the old 70 floor used to mask this)."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "echo pwned > /etc/passwd"}, "tool_use_id": "tu-021"},
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertGreaterEqual(body["risk_score"], 70)


    # -----------------------------------------------------------------------
    # 16. Sub-agent governance + tracking
    # -----------------------------------------------------------------------

    def test_agent_spawn_is_governed_and_tagged(self):
        """Spawning a sub-agent via the Agent tool is itself a governed action,
        classified as orchestration and tagged into the session swarm."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "Explore", "prompt": "find X"},
                "tool_use_id": "tu-022",
                "session_id": "sess-spawn",
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        guard_reqs = [r for r in self.log.get_all() if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Agent spawn should be governed")
        body = guard_reqs[0]["body"]
        self.assertEqual(body["tool"]["category"], "orchestration")
        self.assertEqual(body["action_type"], "orchestration")
        self.assertEqual(body["swarm_id"], "sess-spawn")

    def test_task_alias_spawn_is_governed(self):
        """`Task` (pre-2.1.63 name for Agent) is still governed as orchestration."""
        code, _, _ = _run_hook(
            {"tool_name": "Task", "tool_input": {"description": "do Y"}, "tool_use_id": "tu-023", "session_id": "s"},
            self._env(),
        )
        self.assertEqual(code, 0)
        guard_reqs = [r for r in self.log.get_all() if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Task spawn should be governed")
        self.assertEqual(guard_reqs[0]["body"]["tool"]["category"], "orchestration")

    def test_subagent_provenance_mode_keeps_parent_agent_id(self):
        """In provenance mode (legacy, pre-v2.2 default) a tool call from inside a
        sub-agent (agent_id/agent_type on stdin) keeps the governed agent_id = the
        parent, but records the sub-agent as provenance: agent_name, swarm_id, and
        intel.subagent."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_use_id": "tu-024",
                "session_id": "sess-sub",
                "agent_id": "subagent-abc",
                "agent_type": "Explore",
            },
            self._env(DASHCLAW_SUBAGENT_IDENTITY="provenance"),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["agent_id"], "test-agent")            # governed identity stays the parent
        self.assertEqual(body["agent_name"], "test-agent/Explore")  # sub-agent surfaced for the ledger
        self.assertEqual(body["swarm_id"], "sess-sub")
        self.assertEqual(body["intel"]["subagent"], {"agent_id": "subagent-abc", "agent_type": "Explore"})


    def test_subagent_default_emits_composed_agent_id(self):
        """Default mode is `distinct` (flipped in roadmap v2.2, RFC rollout step 3):
        a sub-agent's call is attributed to a composed agent_id (<parent>:<agent_type>)
        so it is a first-class fleet identity; the server falls back to the parent's
        pairing for permissions. Provenance fields still ride along."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_use_id": "tu-025",
                "session_id": "sess-d",
                "agent_id": "subagent-xyz",
                "agent_type": "Explore",
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["agent_id"], "test-agent:explore")
        self.assertEqual(body["agent_name"], "test-agent/Explore")
        self.assertEqual(body["swarm_id"], "sess-d")
        self.assertEqual(body["intel"]["subagent"]["agent_type"], "Explore")

    def test_argv_agent_id_beats_env(self):
        """Per-harness identity (roadmap v2.2): the `--agent-id` flag written by
        the harness installer beats a machine-ambient DASHCLAW_AGENT_ID export,
        so two harnesses sharing one environment report two identities."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_use_id": "tu-argv-1", "session_id": "s"},
            self._env(),  # env carries DASHCLAW_AGENT_ID=test-agent (the ambient export)
            argv=["--agent-id", "codex"],
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["agent_id"], "codex")

    def test_argv_agent_id_equals_form(self):
        """--agent-id=<id> (single-token form) resolves identically."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_use_id": "tu-argv-2", "session_id": "s"},
            self._env(),
            argv=["--agent-id=hermes"],
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["agent_id"], "hermes")

    def test_argv_agent_id_composes_with_subagent_identity(self):
        """The argv identity is the parent segment for composed sub-agent ids."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_use_id": "tu-argv-3",
                "session_id": "s",
                "agent_id": "subagent-argv",
                "agent_type": "Explore",
            },
            self._env(),
            argv=["--agent-id", "codex"],
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["agent_id"], "codex:explore")
        self.assertEqual(body["agent_name"], "codex/Explore")

    # -----------------------------------------------------------------------
    # 17. v4.3 fleet attribution: harness_session_id, subagent_uuid, Workflow
    # -----------------------------------------------------------------------

    def test_harness_session_id_stamped_on_every_record(self):
        """harness_session_id rides EVERY record payload, not just swarm or
        subagent calls (verdict 1) — unlike swarm_id, this is unconditional."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_use_id": "tu-harness-plain",
                "session_id": "sess-harness-plain",
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["harness_session_id"], "sess-harness-plain")
        self.assertNotIn("swarm_id", body)  # plain (non-spawn, non-subagent) call

    def test_harness_session_id_truncated_to_200_chars(self):
        """The server contract caps harness_session_id at 200 chars."""
        long_session_id = "s" * 300
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_use_id": "tu-harness-long",
                "session_id": long_session_id,
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(len(body["harness_session_id"]), 200)

    def test_subagent_leaf_call_stamps_subagent_uuid(self):
        """A subagent leaf call (agent_id/agent_type on stdin) persists the
        stdin agent_id as subagent_uuid (verdict 2a) alongside the existing
        intel.subagent/swarm_id/composed-id fields, unchanged."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "tool_use_id": "tu-subagent-uuid",
                "session_id": "sess-subagent-uuid",
                "agent_id": "subagent-xyz",
                "agent_type": "Explore",
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertEqual(body["subagent_uuid"], "subagent-xyz")
        self.assertEqual(body["harness_session_id"], "sess-subagent-uuid")
        # Existing behavior unchanged
        self.assertEqual(body["agent_id"], "test-agent:explore")
        self.assertEqual(body["swarm_id"], "sess-subagent-uuid")
        self.assertEqual(body["intel"]["subagent"], {"agent_id": "subagent-xyz", "agent_type": "Explore"})

    def test_spawn_call_has_no_subagent_uuid(self):
        """The spawn call itself (Agent/Task/Workflow) carries no agent_id on
        stdin — only leaf calls inside the spawned subagent do — so it must
        not get a subagent_uuid."""
        code, _, _ = _run_hook(
            {"tool_name": "Agent", "tool_input": {"prompt": "do X"}, "tool_use_id": "tu-spawn-no-uuid", "session_id": "s"},
            self._env(),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][0]["body"]
        self.assertNotIn("subagent_uuid", body)

    def test_workflow_spawn_is_governed_and_tagged(self):
        """Workflow (Claude Code dynamic-workflow fan-out) is governed as
        orchestration and tagged into the session swarm, same as Agent/Task."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Workflow",
                "tool_input": {"prompt": "fan out"},
                "tool_use_id": "tu-workflow-1",
                "session_id": "sess-workflow",
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        guard_reqs = [r for r in self.log.get_all() if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Workflow spawn should be governed")
        body = guard_reqs[0]["body"]
        self.assertEqual(body["tool"]["category"], "orchestration")
        self.assertEqual(body["action_type"], "orchestration")
        self.assertEqual(body["swarm_id"], "sess-workflow")
        self.assertEqual(body["harness_session_id"], "sess-workflow")


class TestPretoolSingleCall(unittest.TestCase):
    """Phase-3 fast path: guard+record collapsed into ONE HTTP call via
    ?record=true, with a version-tolerant fallback against older servers."""

    GOVERNED_BASH = {"tool_name": "Bash", "tool_input": {"command": "rm -rf /tmp/x"}, "tool_use_id": "tu-single-1"}

    @classmethod
    def setUpClass(cls):
        cls.log = _RequestLog()
        port = _find_free_port()
        cls.server = HTTPServer(("127.0.0.1", port), _make_handler(cls.log))
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
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": "test-agent",
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": tempfile.gettempdir(),
            "DASHCLAW_PERMISSION_MODE": "danger",
        }
        env.update(extra)
        return env

    def _posts(self):
        """POST requests only — the one-shot demo-mode health probe (GET,
        cached 15 min) is not part of the per-call governance flow."""
        return [r for r in self.log.get_all() if r["method"] == "POST"]

    def test_happy_path_single_request(self):
        """New server (returns recorded:true + action_id): exactly 1 governed request."""
        self.log.guard_response = {"decision": "allow", "recorded": True, "action_id": "act_recorded_001"}
        code, _, err = _run_hook(self.GOVERNED_BASH, self._env())
        self.assertEqual(code, 0, "stderr=" + err)

        posts = self._posts()
        self.assertEqual(len(posts), 1, "Expected exactly ONE request, got: " + str(posts))
        self.assertEqual(posts[0]["path"], "/api/guard")
        self.assertEqual(posts[0]["query"], "record=true")

    def test_old_server_fallback_two_call_flow(self):
        """Older server ignores ?record=true (no `recorded` field): the hook
        completes the legacy two-call flow (guard, then POST /api/actions)."""
        self.log.guard_response = {"decision": "allow"}
        code, _, err = _run_hook(self.GOVERNED_BASH, self._env())
        self.assertEqual(code, 0, "stderr=" + err)

        posts = self._posts()
        self.assertEqual([r["path"] for r in posts], ["/api/guard", "/api/actions"])
        # The legacy create carries status=running like before.
        self.assertEqual(posts[1]["body"].get("status"), "running")

    def test_recorded_false_falls_back(self):
        """recorded:false (e.g. quota refused server-side) → fallback create."""
        self.log.guard_response = {"decision": "allow", "recorded": False, "recorded_error": "Monthly action limit exceeded"}
        code, _, err = _run_hook(self.GOVERNED_BASH, self._env())
        self.assertEqual(code, 0, "stderr=" + err)
        self.assertEqual([r["path"] for r in self._posts()], ["/api/guard", "/api/actions"])

    def test_warn_decision_uses_recorded_action(self):
        """warn decision with a server-recorded action: single request, exit 0."""
        self.log.guard_response = {
            "decision": "warn", "warnings": ["Rate limit approaching"],
            "recorded": True, "action_id": "act_recorded_002",
        }
        code, _, err = _run_hook(self.GOVERNED_BASH, self._env())
        self.assertEqual(code, 0)
        self.assertIn("Warning", err)
        self.assertEqual(len(self._posts()), 1)

    def test_require_approval_uses_recorded_action_in_observe(self):
        """require_approval + recorded id: no extra create_action call
        (observe mode so the test does not wait on the approval poll)."""
        self.log.guard_response = {
            "decision": "require_approval", "matched_policies": ["gp_1"],
            "recorded": True, "action_id": "act_recorded_003",
        }
        code, _, err = _run_hook(self.GOVERNED_BASH, self._env(DASHCLAW_HOOK_MODE="observe"))
        self.assertEqual(code, 0, "stderr=" + err)
        self.assertEqual([r["path"] for r in self._posts()], ["/api/guard"])


if __name__ == "__main__":
    unittest.main()
