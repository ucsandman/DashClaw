"""Integration tests for dashclaw_posttool.py v2.

Starts a mock HTTP server on a random port and runs the posttool hook
as a subprocess, verifying PATCH requests receive correct body with
structured outcome_metadata and 500-char summaries.

Uses only the Python standard library.
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
_POSTTOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_posttool.py")


# ---------------------------------------------------------------------------
# Mock HTTP server
# ---------------------------------------------------------------------------

class _RequestLog:
    """Thread-safe accumulator for incoming requests."""

    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()

    def add(self, method: str, path: str, body: dict | None):
        with self._lock:
            self.requests.append({"method": method, "path": path, "body": body})

    def get_all(self) -> list[dict]:
        with self._lock:
            return list(self.requests)

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log: _RequestLog):
    """Factory that produces a handler class bound to *log*."""

    class Handler(BaseHTTPRequestHandler):
        def do_PATCH(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            log.add("PATCH", self.path, body)

            resp = json.dumps({"ok": True}).encode()
            self.send_response(200)
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

def _instance_suffix(base_url: str, agent_id: str = "claude-code") -> str:
    # Mirrors dashclaw_posttool.py's _INSTANCE_STATE_SUFFIX: sha256(BASE_URL +
    # "|" + AGENT_ID)[:12] (F2). Tests never set DASHCLAW_AGENT_ID, so the
    # hook resolves it to the "claude-code" default.
    return hashlib.sha256((base_url + "|" + agent_id).encode("utf-8")).hexdigest()[:12]


def _action_state_path(tool_use_id: str, base_url: str, agent_id: str = "claude-code") -> str:
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_last_action_" + _instance_suffix(base_url, agent_id) + "_" + tool_use_id,
    )


def _write_temp_action(tool_use_id: str, action_id: str, base_url: str, agent_id: str = "claude-code"):
    """Write a temp file mimicking what PreToolUse writes."""
    path = _action_state_path(tool_use_id, base_url, agent_id)
    with open(path, "w") as f:
        f.write(action_id)
    return path


def _cleanup_temp_action(tool_use_id: str, base_url: str, agent_id: str = "claude-code"):
    """Remove the temp file if it exists."""
    path = _action_state_path(tool_use_id, base_url, agent_id)
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _run_hook(stdin_data: dict, env_overrides: dict | None = None, timeout: float = 10) -> tuple[int, str, str]:
    """Run the posttool hook as a subprocess.

    Returns (exit_code, stdout, stderr).
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
        [sys.executable, _POSTTOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPosttoolIntegration(unittest.TestCase):
    """Integration tests that run the hook against a mock server."""

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

    def _env(self, **extra) -> dict:
        """Build the base environment dict pointing at our mock server."""
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
        }
        env.update(extra)
        return env

    # -----------------------------------------------------------------------
    # 1. Completed action: output → status=completed, summary ≤ 500 chars
    # -----------------------------------------------------------------------

    def test_completed_action(self):
        """Successful tool response should PATCH with status=completed."""
        tool_use_id = "post-tu-001"
        action_id = "act-001"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "Build succeeded. All 42 tests passed."},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1, "Expected exactly one PATCH")

        body = patches[0]["body"]
        self.assertEqual(patches[0]["path"], "/api/actions/act-001")
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["output_summary"], "Build succeeded. All 42 tests passed.")
        self.assertIn("timestamp_end", body)
        self.assertIn("outcome_metadata", body)
        # Completed actions have no error_type
        self.assertNotIn("error_type", body["outcome_metadata"])

    def test_completed_action_summary_truncated_to_500(self):
        """Output longer than 500 chars should be truncated."""
        tool_use_id = "post-tu-002"
        action_id = "act-002"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        long_output = "x" * 800
        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": long_output},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1)

        body = patches[0]["body"]
        self.assertEqual(body["status"], "completed")
        self.assertEqual(len(body["output_summary"]), 500)

    # -----------------------------------------------------------------------
    # 2. Failed action: error field → status=failed, error_type classified
    # -----------------------------------------------------------------------

    def test_failed_action_with_error_field(self):
        """tool_response with error field should PATCH status=failed with error_type."""
        tool_use_id = "post-tu-003"
        action_id = "act-003"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"error": "Connection timed out after 30s"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1)

        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertIn("timed out", body["output_summary"])
        self.assertEqual(body["outcome_metadata"]["error_type"], "timeout")

    def test_failed_permission_error(self):
        """Permission errors should be classified as 'permission'."""
        tool_use_id = "post-tu-004"
        action_id = "act-004"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"error": "Permission denied: /etc/shadow"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["outcome_metadata"]["error_type"], "permission")

    def test_failed_not_found_error(self):
        """Not-found errors should be classified as 'not_found'."""
        tool_use_id = "post-tu-005"
        action_id = "act-005"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"error": "No such file or directory: /missing/path"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["outcome_metadata"]["error_type"], "not_found")

    def test_failed_runtime_error(self):
        """Generic errors should be classified as 'runtime'."""
        tool_use_id = "post-tu-006"
        action_id = "act-006"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"error": "TypeError: cannot add str and int"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["outcome_metadata"]["error_type"], "runtime")

    # -----------------------------------------------------------------------
    # 3. Failed action: non-zero exit code without error field
    # -----------------------------------------------------------------------

    def test_failed_nonzero_exit_code(self):
        """Non-zero exit_code with no error field should be status=failed."""
        tool_use_id = "post-tu-007"
        action_id = "act-007"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"exit_code": 1, "output": "lint check failed: 3 errors"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1)

        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["outcome_metadata"]["exit_code"], 1)
        self.assertIn("error_type", body["outcome_metadata"])
        self.assertIn("lint check failed", body["output_summary"])

    def test_exit_code_zero_is_completed(self):
        """Exit code 0 should result in status=completed."""
        tool_use_id = "post-tu-008"
        action_id = "act-008"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"exit_code": 0, "output": "OK"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["outcome_metadata"]["exit_code"], 0)
        self.assertNotIn("error_type", body["outcome_metadata"])

    # -----------------------------------------------------------------------
    # 4. Error field takes priority over exit_code
    # -----------------------------------------------------------------------

    def test_error_field_takes_priority_over_exit_code(self):
        """When both error field and exit_code are present, error field wins."""
        tool_use_id = "post-tu-009"
        action_id = "act-009"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {
                    "error": "Command not found: foobar",
                    "exit_code": 127,
                    "output": "some output",
                },
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertIn("Command not found", body["output_summary"])
        self.assertEqual(body["outcome_metadata"]["error_type"], "not_found")
        self.assertEqual(body["outcome_metadata"]["exit_code"], 127)

    # -----------------------------------------------------------------------
    # 5. No temp file → no PATCH (ungoverned tool)
    # -----------------------------------------------------------------------

    def test_no_temp_file_skips_patch(self):
        """If no pretool temp file exists, no PATCH should be sent."""
        tool_use_id = "post-tu-010-no-file"
        # Ensure no temp file exists
        _cleanup_temp_action(tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "hello"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 0, "No PATCH should be sent without a temp file")

    # -----------------------------------------------------------------------
    # 6. No config = silent pass-through
    # -----------------------------------------------------------------------

    def test_no_config_passes_through(self):
        """Without BASE_URL/API_KEY, the hook should exit 0 silently."""
        tool_use_id = "post-tu-011"
        action_id = "act-011"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, stderr = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "hello"},
            },
            {"DASHCLAW_BASE_URL": "", "DASHCLAW_API_KEY": ""},
        )
        self.assertEqual(code, 0)
        self.assertEqual(stderr.strip(), "")

        reqs = self.log.get_all()
        self.assertEqual(len(reqs), 0)

    # -----------------------------------------------------------------------
    # 7. Temp file cleanup
    # -----------------------------------------------------------------------

    def test_temp_file_cleaned_up(self):
        """After processing, the temp file should be removed."""
        tool_use_id = "post-tu-012"
        action_id = "act-012"
        tmp_path = _write_temp_action(tool_use_id, action_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "done"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)
        self.assertFalse(os.path.exists(tmp_path), "Temp file should be cleaned up")

    # -----------------------------------------------------------------------
    # 8. Always exits 0 even on malformed input
    # -----------------------------------------------------------------------

    def test_empty_stdin_exits_0(self):
        """Empty stdin should exit 0 without errors."""
        env = os.environ.copy()
        for key in list(env.keys()):
            if key.startswith("DASHCLAW_"):
                del env[key]
        env["DASHCLAW_DISABLE_DOTENV"] = "1"
        env.update(self._env())

        proc = subprocess.run(
            [sys.executable, _POSTTOOL_SCRIPT],
            input=b"",
            capture_output=True,
            timeout=10,
            env=env,
        )
        self.assertEqual(proc.returncode, 0)

    def test_missing_tool_use_id_exits_0(self):
        """Missing tool_use_id should exit 0 without errors."""
        code, _, _ = _run_hook(
            {"tool_response": {"output": "hello"}},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        self.assertEqual(len(reqs), 0)

    # -----------------------------------------------------------------------
    # 9. PATCH URL includes action_id
    # -----------------------------------------------------------------------

    def test_patch_url_includes_action_id(self):
        """The PATCH request URL should target the correct action_id."""
        tool_use_id = "post-tu-013"
        action_id = "act-specific-id-42"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "ok"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]["path"], "/api/actions/act-specific-id-42")

    # -----------------------------------------------------------------------
    # 10. Error summary truncated to 500 chars
    # -----------------------------------------------------------------------

    def test_error_summary_truncated_to_500(self):
        """Error messages longer than 500 chars should be truncated."""
        tool_use_id = "post-tu-014"
        action_id = "act-014"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        long_error = "Error: " + "z" * 600
        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"error": long_error},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "failed")
        self.assertEqual(len(body["output_summary"]), 500)

    # -----------------------------------------------------------------------
    # 11. stdout fallback when output is absent
    # -----------------------------------------------------------------------

    def test_stdout_fallback(self):
        """tool_response with stdout (no output) should use stdout for summary."""
        tool_use_id = "post-tu-015"
        action_id = "act-015"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"stdout": "tests passed: 15/15"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["output_summary"], "tests passed: 15/15")

    # -----------------------------------------------------------------------
    # 12. timestamp_end is ISO format
    # -----------------------------------------------------------------------

    def test_timestamp_end_is_iso(self):
        """timestamp_end should be present and parseable as ISO datetime."""
        tool_use_id = "post-tu-016"
        action_id = "act-016"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "ok"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        patches = [r for r in reqs if r["method"] == "PATCH"]
        body = patches[0]["body"]
        ts = body["timestamp_end"]
        # Should parse without error; ISO 8601 with timezone
        from datetime import datetime
        parsed = datetime.fromisoformat(ts)
        self.assertIsNotNone(parsed)

    # -----------------------------------------------------------------------
    # 13. v4.3 fleet attribution: spawned_agent_uuid extraction (verdict 2b)
    # -----------------------------------------------------------------------

    def test_agent_spawn_extracts_spawned_agent_uuid_from_text(self):
        """An Agent tool_response with a text line like `agentId: <uuid>`
        gets extracted into outcome_metadata.spawned_agent_uuid so the spawn
        row can be read-time joined against its leaf calls' subagent_uuid."""
        tool_use_id = "post-tu-agent-001"
        action_id = "act-agent-001"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_name": "Agent",
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "Subagent finished.\nagentId: a0e90f949e494f49c\nDone."},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["method"] == "PATCH"][0]["body"]
        self.assertEqual(body["outcome_metadata"]["spawned_agent_uuid"], "a0e90f949e494f49c")

    def test_task_alias_spawn_extracts_spawned_agent_uuid_from_json_shape(self):
        """A JSON-shaped tool_response with a top-level agentId/agent_id key
        is also read (`Task` is the pre-2.1.63 alias for `Agent`)."""
        tool_use_id = "post-tu-agent-002"
        action_id = "act-agent-002"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_name": "Task",
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "ok", "agentId": "b7c1-uuid-002"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["method"] == "PATCH"][0]["body"]
        self.assertEqual(body["outcome_metadata"]["spawned_agent_uuid"], "b7c1-uuid-002")

    def test_workflow_spawn_extracts_spawned_agent_uuid(self):
        """Workflow (dynamic-workflow fan-out) gets the same extraction as
        Agent/Task."""
        tool_use_id = "post-tu-workflow-001"
        action_id = "act-workflow-001"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_name": "Workflow",
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "spawned.\nagentId: c9d2-uuid-003"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["method"] == "PATCH"][0]["body"]
        self.assertEqual(body["outcome_metadata"]["spawned_agent_uuid"], "c9d2-uuid-003")

    def test_no_spawned_agent_uuid_when_absent(self):
        """No agentId anywhere in the response — the field is simply omitted
        (fail-soft), never set to null."""
        tool_use_id = "post-tu-agent-003"
        action_id = "act-agent-003"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_name": "Agent",
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "Subagent finished with no id reported."},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["method"] == "PATCH"][0]["body"]
        self.assertNotIn("spawned_agent_uuid", body["outcome_metadata"])

    def test_spawned_agent_uuid_not_extracted_for_non_spawn_tools(self):
        """Extraction is gated to Agent/Task/Workflow — a Bash output that
        happens to contain the string 'agentId:' must not be mistaken for a
        spawn's outcome."""
        tool_use_id = "post-tu-bash-agentid"
        action_id = "act-bash-agentid"
        _write_temp_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "grep result: agentId: not-a-real-spawn"},
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        body = [r for r in self.log.get_all() if r["method"] == "PATCH"][0]["body"]
        self.assertNotIn("spawned_agent_uuid", body["outcome_metadata"])


if __name__ == "__main__":
    unittest.main()
