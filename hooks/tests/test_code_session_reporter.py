"""Integration tests for hooks/dashclaw_code_session_reporter.py.

Starts a mock HTTP server on a random port, prepares a fake transcript,
runs the Stop hook as a subprocess with DASHCLAW_CODE_SESSIONS_ENABLED=1,
and asserts the POST /api/code-sessions/ingest-jsonl body shape.
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
# Mock HTTP server (records every POST/PATCH/GET).
# ---------------------------------------------------------------------------

class _RequestLog:
    def __init__(self):
        self.requests = []
        self._lock = threading.Lock()

    def add(self, method, path, body):
        with self._lock:
            self.requests.append({"method": method, "path": path, "body": body})

    def get_all(self):
        with self._lock:
            return list(self.requests)


def _make_handler(log):
    class Handler(BaseHTTPRequestHandler):
        def _read_body(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            try:
                return json.loads(raw) if raw else None
            except Exception:
                return raw.decode("utf-8", errors="replace")

        def do_POST(self):
            log.add("POST", self.path, self._read_body())
            resp = json.dumps({"ok": True, "project": {"id": "cp_test", "slug": "demo"},
                               "session": {"id": "cs_test", "skipped": False}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_PATCH(self):
            log.add("PATCH", self.path, self._read_body())
            resp = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_GET(self):
            log.add("GET", self.path, None)
            if self.path.startswith("/api/code-sessions/sessions/"):
                payload = {"session": {"id": "cs_test", "cost_usd": "0.84", "cache_savings_usd": "0.31"}}
            else:
                action_id = self.path.rsplit("/", 1)[-1]
                payload = {"action": {"action_id": action_id, "status": "completed"}}
            resp = json.dumps(payload).encode()
            self.send_response(200)
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


def _write_transcript_under_slug(slug, entries):
    """Lay out a transcript at <tmp>/<slug>/<file>.jsonl so the reporter's
    project.slug derivation (basename of parent dir) gets a deterministic
    value to compare in assertions."""
    parent = tempfile.mkdtemp(prefix="dashclaw_test_proj_")
    # rename the leaf dir to the desired slug
    new_parent = os.path.join(os.path.dirname(parent), slug)
    if os.path.exists(new_parent):
        # ensure uniqueness — append the pid
        new_parent = os.path.join(os.path.dirname(parent), slug + "_" + str(os.getpid()))
    os.rename(parent, new_parent)
    fd, path = tempfile.mkstemp(suffix=".jsonl", prefix="session_", dir=new_parent)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return path, new_parent


def _write_session_tool_map(session_id, pairs):
    """Pre-seed the per-session tool_use -> action_id log. Pairs is a dict."""
    path = os.path.join(tempfile.gettempdir(),
                        "dashclaw_session_tool_map_" + session_id)
    with open(path, "w", encoding="utf-8") as f:
        for tu, aid in pairs.items():
            f.write(tu + "\t" + aid + "\n")
    return path


def _turn_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + session_id)


def _cursor_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_stop_cursor_" + session_id)


def _safe_remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _run_hook(stdin_data, env_overrides=None, timeout=10):
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
# Fixture turn — one assistant message with a tool_use whose id maps to an
# action_id in the pre-seeded session map.
# ---------------------------------------------------------------------------

def _fixture_entries(session_id):
    usage = {"input_tokens": 100, "output_tokens": 50,
             "cache_creation_input_tokens": 0,
             "cache_read_input_tokens": 0}
    return [
        {"type": "user", "sessionId": session_id, "uuid": "u-prompt",
         "timestamp": "2026-05-13T12:00:00Z",
         "message": {"role": "user", "content": "Hello"}},
        {"type": "assistant", "sessionId": session_id, "uuid": "u-1",
         "requestId": "R1", "timestamp": "2026-05-13T12:00:01Z",
         "cwd": "C:/Projects/DemoSlug",
         "message": {
             "role": "assistant",
             "model": "claude-sonnet-4-6",
             "id": "M1",
             "content": [{"type": "tool_use", "name": "Read", "id": "tu_42",
                          "input": {"file_path": "a.js"}}],
             "usage": usage,
         }},
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCodeSessionReporter(unittest.TestCase):
    def setUp(self):
        self.log = _RequestLog()
        port = _find_free_port()
        handler = _make_handler(self.log)
        self.server = HTTPServer(("127.0.0.1", port), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{port}"
        self.session_id = "s-test-" + str(port)
        # Pre-seed pretool's mapping log so the reporter has something to attach.
        self.tool_map_path = _write_session_tool_map(self.session_id, {"tu_42": "ar_governed_1"})
        # Pre-seed pretool's turn-action log so _apply doesn't go down the
        # text-only branch.
        with open(_turn_path(self.session_id), "w", encoding="utf-8") as f:
            f.write("ar_governed_1\n")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        _safe_remove(self.tool_map_path)
        _safe_remove(_turn_path(self.session_id))
        _safe_remove(_cursor_path(self.session_id))

    def test_reports_jsonl_slice_with_tool_use_action_map(self):
        transcript_path, project_dir = _write_transcript_under_slug(
            "DemoSlug", _fixture_entries(self.session_id),
        )
        try:
            code, _, _ = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                    "DASHCLAW_CODE_SESSIONS_ENABLED": "1",
                },
            )
            self.assertEqual(code, 0)
            ingest_calls = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_calls), 1,
                             f"expected exactly one ingest POST, got {self.log.get_all()}")
            body = ingest_calls[0]["body"]
            self.assertEqual(body["project"]["source_host"], "hook")
            self.assertEqual(body["project"]["slug"], os.path.basename(project_dir))
            self.assertEqual(body["session_uuid"], self.session_id)
            self.assertEqual(body["source_file"], transcript_path)
            self.assertEqual(body["tool_use_action_map"], {"tu_42": "ar_governed_1"})
            self.assertGreaterEqual(len(body["jsonl_lines"]), 1)
            # The lines must be RAW JSON strings, not parsed.
            self.assertTrue(all(isinstance(ln, str) for ln in body["jsonl_lines"]))
        finally:
            _safe_remove(transcript_path)

    def test_default_on_posts_without_flag(self):
        """Ingest defaults ON (metadata-only) — no flag needed."""
        transcript_path, _ = _write_transcript_under_slug(
            "DemoSlug2", _fixture_entries(self.session_id),
        )
        try:
            code, _, _ = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                    # Flag intentionally absent → default ON.
                },
            )
            self.assertEqual(code, 0)
            ingest_calls = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_calls), 1)
        finally:
            _safe_remove(transcript_path)

    def test_opt_out_env_disables_ingest(self):
        """DASHCLAW_CODE_SESSIONS_ENABLED=0 is the documented opt-out."""
        transcript_path, _ = _write_transcript_under_slug(
            "DemoSlug2b", _fixture_entries(self.session_id),
        )
        try:
            code, _, _ = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                    "DASHCLAW_CODE_SESSIONS_ENABLED": "0",
                },
            )
            self.assertEqual(code, 0)
            ingest_calls = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_calls), 0)
        finally:
            _safe_remove(transcript_path)

    def test_payload_is_metadata_only_by_default(self):
        """The default payload must carry NO prompt/file/tool text — only
        structure, usage, models, tool names/ids, and safe path metadata."""
        secret_prompt = "SECRET-PROMPT-do-not-ship"
        secret_text = "SECRET-ASSISTANT-TEXT"
        secret_tool_content = "SECRET-FILE-CONTENT-12345"
        usage = {"input_tokens": 100, "output_tokens": 50,
                 "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
        entries = [
            {"type": "user", "sessionId": self.session_id, "uuid": "u-prompt",
             "timestamp": "2026-05-13T12:00:00Z",
             "message": {"role": "user", "content": secret_prompt}},
            {"type": "assistant", "sessionId": self.session_id, "uuid": "u-1",
             "requestId": "R1", "timestamp": "2026-05-13T12:00:01Z",
             "message": {"role": "assistant", "model": "claude-sonnet-4-6", "id": "M1",
                         "content": [
                             {"type": "text", "text": secret_text},
                             {"type": "tool_use", "name": "Write", "id": "tu_42",
                              "input": {"file_path": "a.js", "content": secret_tool_content}},
                         ],
                         "usage": usage}},
        ]
        transcript_path, _ = _write_transcript_under_slug("DemoSlugRedact", entries)
        try:
            code, _, _ = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                },
            )
            self.assertEqual(code, 0)
            ingest_calls = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_calls), 1)
            serialized = json.dumps(ingest_calls[0]["body"])
            # No prompt / assistant / tool text leaves the machine.
            self.assertNotIn(secret_prompt, serialized)
            self.assertNotIn(secret_text, serialized)
            self.assertNotIn(secret_tool_content, serialized)
            # Metadata the server parser needs survives.
            lines = [json.loads(ln) for ln in ingest_calls[0]["body"]["jsonl_lines"]]
            assistant = [ln for ln in lines if ln.get("type") == "assistant"][0]
            self.assertEqual(assistant["message"]["usage"]["input_tokens"], 100)
            self.assertEqual(assistant["message"]["model"], "claude-sonnet-4-6")
            tool_use = [b for b in assistant["message"]["content"] if b.get("type") == "tool_use"][0]
            self.assertEqual(tool_use["name"], "Write")
            self.assertEqual(tool_use["id"], "tu_42")
            self.assertEqual(tool_use["input"], {"file_path": "a.js"})
        finally:
            _safe_remove(transcript_path)

    def test_full_content_mode_is_explicit_opt_in(self):
        """DASHCLAW_CODE_SESSIONS_CONTENT=full restores raw-line shipping."""
        entries = _fixture_entries(self.session_id)
        transcript_path, _ = _write_transcript_under_slug("DemoSlugFull", entries)
        try:
            code, _, _ = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                    "DASHCLAW_CODE_SESSIONS_CONTENT": "full",
                },
            )
            self.assertEqual(code, 0)
            ingest_calls = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_calls), 1)
            serialized = json.dumps(ingest_calls[0]["body"])
            self.assertIn("Hello", serialized)  # the fixture's user prompt ships in full mode
        finally:
            _safe_remove(transcript_path)

    def test_recap_line_prints_with_governed_actions_and_matches_session_cost(self):
        """One stderr recap line after a governed turn, quoting the server's
        own code_sessions cost row (the same row /api/finops/spend sums)."""
        transcript_path, _ = _write_transcript_under_slug(
            "DemoSlugRecap", _fixture_entries(self.session_id),
        )
        try:
            code, _, stderr = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                },
            )
            self.assertEqual(code, 0)
            recap_lines = [ln for ln in stderr.splitlines() if "[DashClaw] Governed" in ln]
            self.assertEqual(len(recap_lines), 1, "exactly ONE recap line. stderr=" + stderr)
            self.assertIn("Governed 1 action(s) this session", recap_lines[0])
            self.assertIn("$0.84", recap_lines[0])
            self.assertIn("caching saved $0.31", recap_lines[0])
            self.assertIn(self.base_url + "/decisions", recap_lines[0])
        finally:
            _safe_remove(transcript_path)

    def test_no_recap_when_nothing_governed(self):
        """A turn with zero governed actions stays completely silent."""
        _safe_remove(_turn_path(self.session_id))  # no governed actions this turn
        transcript_path, _ = _write_transcript_under_slug(
            "DemoSlugSilent", _fixture_entries(self.session_id),
        )
        try:
            code, stdout, stderr = _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides={
                    "DASHCLAW_BASE_URL": self.base_url,
                    "DASHCLAW_API_KEY": "test-key",
                },
            )
            self.assertEqual(code, 0)
            self.assertNotIn("[DashClaw] Governed", stderr)
            self.assertEqual(stdout, "")
        finally:
            _safe_remove(transcript_path)

    def test_idempotent_on_re_run_with_same_cursor(self):
        transcript_path, _ = _write_transcript_under_slug(
            "DemoSlug3", _fixture_entries(self.session_id),
        )
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key",
            "DASHCLAW_CODE_SESSIONS_ENABLED": "1",
        }
        try:
            # First run posts the whole transcript. Stop writes a cursor at the
            # last assistant uuid.
            _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides=env,
            )
            ingest_first = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_first), 1)
            first_lines = ingest_first[0]["body"]["jsonl_lines"]
            self.assertGreater(len(first_lines), 0)

            # Re-pre-seed the turn-actions log (Stop cleared it after the first
            # run). Transcript hasn't grown — the reporter should see zero new
            # lines and skip the POST.
            with open(_turn_path(self.session_id), "w", encoding="utf-8") as f:
                f.write("ar_governed_1\n")
            _run_hook(
                {"session_id": self.session_id, "transcript_path": transcript_path},
                env_overrides=env,
            )
            ingest_after = [r for r in self.log.get_all()
                            if r["method"] == "POST" and r["path"] == "/api/code-sessions/ingest-jsonl"]
            self.assertEqual(len(ingest_after), 1,
                             "second run with unchanged transcript should not POST again")
        finally:
            _safe_remove(transcript_path)


if __name__ == "__main__":
    unittest.main()
