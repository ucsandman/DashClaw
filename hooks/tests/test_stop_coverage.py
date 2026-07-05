"""Tests for the v4.2 "coverage truth" Stop-hook report.

Per Stop invocation, dashclaw_stop.py computes `expected` (governed
tool_use blocks in the turn's transcript slice) and `recorded` (the subset
with an action_id in the session's tool_use -> action_id map) and POSTs one
fail-silent report to POST /api/coverage. See
docs/superpowers/specs/2026-07-04-coverage-truth.md verdict 2.

Starts a mock HTTP server on a random port, stages a fake transcript + a
partial session tool-use map, runs the Stop hook as a subprocess, and
inspects the captured requests. Mirrors the _RequestLog fixture pattern in
test_stop_integration.py. Stdlib only.
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
_STOP_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_stop.py")


# ---------------------------------------------------------------------------
# Mock HTTP server (same shape as test_stop_integration.py's _RequestLog)
# ---------------------------------------------------------------------------

class _RequestLog:
    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()

    def add(self, method, path, body):
        with self._lock:
            self.requests.append({"method": method, "path": path, "body": body})

    def get_all(self):
        with self._lock:
            return list(self.requests)

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log):
    class Handler(BaseHTTPRequestHandler):
        def _read_body(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            return json.loads(raw) if raw else None

        def _respond_json(self, payload):
            resp = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_PATCH(self):
            body = self._read_body()
            log.add("PATCH", self.path, body)
            self._respond_json({"ok": True})

        def do_POST(self):
            body = self._read_body()
            log.add("POST", self.path, body)
            # Coverage POST doesn't need a specific response shape; the other
            # POST paths (actions, code-sessions ingest) get a generic-enough
            # body that the hook's fail-silent parsing never raises.
            action_id = "act-synth-" + str(len(log.get_all()))
            self._respond_json({"action": {"action_id": action_id, "status": body.get("status") if body else "running"}})

        def do_GET(self):
            log.add("GET", self.path, None)
            action_id = self.path.rsplit("/", 1)[-1]
            self._respond_json({"action": {"action_id": action_id, "status": None}})

        def log_message(self, fmt, *args):
            pass

    return Handler


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _tool_use_block(tool_use_id, name):
    return {"type": "tool_use", "id": tool_use_id, "name": name, "input": {}}


def _write_transcript(entries):
    fd, path = tempfile.mkstemp(suffix=".jsonl", prefix="dashclaw_coverage_test_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return path


def _session_tool_map_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_session_tool_map_" + session_id)


def _write_session_tool_map(session_id, pairs):
    """pairs: iterable of (tool_use_id, action_id)."""
    with open(_session_tool_map_path(session_id), "w", encoding="utf-8") as f:
        for tool_use_id, action_id in pairs:
            f.write(tool_use_id + "\t" + action_id + "\n")


def _cursor_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_stop_cursor_" + session_id)


def _turn_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + session_id)


def _safe_remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _run_hook(stdin_data, env_overrides=None, timeout=15):
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)
    proc = subprocess.run(
        [sys.executable, _STOP_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestStopCoverageReport(unittest.TestCase):
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

    def _env(self, extra=None):
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key",
            # Isolate the assertions to the coverage POST — code-session
            # ingest is ON by default and would add unrelated POSTs.
            "DASHCLAW_CODE_SESSIONS_ENABLED": "0",
        }
        if extra:
            env.update(extra)
        return env

    def _coverage_posts(self):
        return [r for r in self.log.get_all() if r["method"] == "POST" and r["path"] == "/api/coverage"]

    def test_mixed_governed_and_ungoverned_reports_correct_counts(self):
        """A turn with governed + ungoverned tool_use blocks, and a session
        tool map that only covers some of the governed ones, POSTs exactly
        one coverage report with expected=3 (Bash, Write, mcp__...) and
        recorded=2 (Bash + mcp__... were mapped; Write was not)."""
        session_id = "sess-cov-mixed"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "claude-opus-4-6",
                    "content": [
                        _tool_use_block("tu-bash", "Bash"),
                        _tool_use_block("tu-write", "Write"),
                        _tool_use_block("tu-read", "Read"),
                        _tool_use_block("tu-mcp", "mcp__dashclaw-local__dashclaw_guard"),
                    ],
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        self.addCleanup(_safe_remove, _cursor_path(session_id))
        _write_session_tool_map(session_id, [("tu-bash", "act-A"), ("tu-mcp", "act-B")])
        self.addCleanup(_safe_remove, _session_tool_map_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._coverage_posts()
        self.assertEqual(len(posts), 1)
        body = posts[0]["body"]
        self.assertEqual(body["harness"], "claude-code")
        self.assertEqual(body["harness_session_id"], session_id)
        self.assertEqual(body["expected"], 3)
        self.assertEqual(body["recorded"], 2)
        self.assertIn("agent_id", body)

    def test_no_governed_tool_use_sends_no_report(self):
        """A turn with zero governed tool_use blocks (or none at all) must
        not POST /api/coverage — the quiet path stays quiet."""
        session_id = "sess-cov-none"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    "content": [
                        _tool_use_block("tu-read", "Read"),
                        _tool_use_block("tu-grep", "Grep"),
                    ],
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._coverage_posts(), [])

    def test_text_only_turn_sends_no_report(self):
        """A pure text turn (no tool_use blocks at all) must not POST."""
        session_id = "sess-cov-text-only"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {"model": "opus", "content": [{"type": "text", "text": "hello"}]},
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._coverage_posts(), [])

    def test_server_unreachable_is_fail_silent_and_logs_breadcrumb(self):
        """An unreachable DASHCLAW_BASE_URL must never raise or non-zero exit;
        the coverage POST failure is logged with the "coverage" tag so ops
        can distinguish it from the other Stop-hook HTTP calls."""
        session_id = "sess-cov-unreachable"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    "content": [_tool_use_block("tu-bash", "Bash")],
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        log_path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        try:
            before_size = os.path.getsize(log_path)
        except OSError:
            before_size = 0

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            # Port 1 is reserved and refuses connections immediately (same
            # convention as test_stop_fail_silent.py's unreachable-URL test).
            self._env({"DASHCLAW_BASE_URL": "http://127.0.0.1:1"}),
        )
        self.assertEqual(code, 0, msg=err)
        self.assertNotIn("Traceback", err)

        with open(log_path, "r", encoding="utf-8") as f:
            f.seek(before_size)
            new_lines = f.read()
        self.assertIn("coverage", new_lines)

    def test_matcher_counts_mcp_and_excludes_read_grep_glob(self):
        """Every governed-matcher tool name is counted as expected; Read,
        Grep, and Glob (not in the harness matcher) are excluded."""
        session_id = "sess-cov-matcher"
        governed_names = [
            "Agent", "Task", "Workflow", "Bash", "Edit", "Write", "MultiEdit", "Skill",
            "mcp__some-server__some_method",
        ]
        ungoverned_names = ["Read", "Grep", "Glob"]
        blocks = [
            _tool_use_block("tu-g-%d" % i, name) for i, name in enumerate(governed_names)
        ] + [
            _tool_use_block("tu-u-%d" % i, name) for i, name in enumerate(ungoverned_names)
        ]
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            {"type": "assistant", "uuid": "a1", "message": {"model": "opus", "content": blocks}},
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        self.addCleanup(_safe_remove, _cursor_path(session_id))
        # No session tool map file at all — every governed block is unrecorded.

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._coverage_posts()
        self.assertEqual(len(posts), 1)
        body = posts[0]["body"]
        self.assertEqual(body["expected"], len(governed_names))
        self.assertEqual(body["recorded"], 0)


if __name__ == "__main__":
    unittest.main()
