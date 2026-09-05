"""Tests for the Stop hook's assumption auto-capture.

The Stop hook extracts items from "ASSUMPTIONS I'M MAKING:" blocks in the
turn's assistant text and POSTs each to /api/assumptions against the turn's
first action_id. These tests pin: extraction shape (action_id + basis), the
per-turn cap, malformed-transcript fail-silence, and idempotency across hook
re-runs (the posted-keys dedupe file).

Mirrors the subprocess + mock-HTTP-server harness of test_stop_integration.py.
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

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log):
    class Handler(BaseHTTPRequestHandler):
        def _respond(self, payload):
            resp = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_PATCH(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            log.add("PATCH", self.path, json.loads(raw) if raw else None)
            self._respond({"ok": True})

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            log.add("POST", self.path, json.loads(raw) if raw else None)
            self._respond({"assumption_id": "asm_test"})

        def do_GET(self):
            log.add("GET", self.path, None)
            self._respond({})

        def log_message(self, fmt, *args):
            pass

    return Handler


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _write_transcript(entries):
    fd, path = tempfile.mkstemp(suffix=".jsonl", prefix="dashclaw_test_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return path


def _turn_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + session_id)


def _cursor_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_stop_cursor_" + session_id)


def _assumptions_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_assumptions_" + session_id)


def _write_turn_actions(session_id, action_ids):
    with open(_turn_path(session_id), "w", encoding="utf-8") as f:
        for aid in action_ids:
            f.write(aid + "\n")


def _safe_remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _run_hook(stdin_data, env_overrides=None, timeout=10, raw_stdin=None):
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)
    payload = raw_stdin if raw_stdin is not None else json.dumps(stdin_data).encode("utf-8")
    proc = subprocess.run(
        [sys.executable, _STOP_SCRIPT],
        input=payload,
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


def _assistant_entry(uuid, text, tokens_in=10, tokens_out=5):
    return {
        "type": "assistant",
        "uuid": uuid,
        "message": {
            "model": "opus",
            "usage": {"input_tokens": tokens_in, "output_tokens": tokens_out},
            "content": [{"type": "text", "text": text}],
        },
    }


_BLOCK_THREE = (
    "Here's my plan.\n\n"
    "ASSUMPTIONS I'M MAKING:\n"
    "1. The database is Postgres 15+\n"
    "2. The API key has write scope\n"
    "3. Sessions are single-tenant\n"
    "→ Correct me now or I'll proceed with these.\n\n"
    "Proceeding."
)


class TestStopAssumptionCapture(unittest.TestCase):
    server: HTTPServer
    server_thread: threading.Thread
    log: _RequestLog
    base_url: str

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
        cls.server.server_close()

    def setUp(self):
        self.log.clear()

    def _env(self):
        return {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key",
            # Keep the request list to PATCH/POST-assumptions only.
            "DASHCLAW_CODE_SESSIONS_ENABLED": "0",
        }

    def _stage(self, session_id, entries, action_ids):
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        if action_ids:
            _write_turn_actions(session_id, action_ids)
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))
        self.addCleanup(_safe_remove, _assumptions_path(session_id))
        return transcript

    def _assumption_posts(self):
        return [
            r for r in self.log.get_all()
            if r["method"] == "POST" and r["path"] == "/api/assumptions"
        ]

    def test_extracts_block_items_with_action_id_and_basis(self):
        session_id = "sess-asm-001"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", _BLOCK_THREE),
        ]
        transcript = self._stage(session_id, entries, ["act-asm-A", "act-asm-B"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._assumption_posts()
        self.assertEqual(len(posts), 3)
        texts = [p["body"]["assumption"] for p in posts]
        self.assertEqual(texts, [
            "The database is Postgres 15+",
            "The API key has write scope",
            "Sessions are single-tenant",
        ])
        for p in posts:
            # Attached to the turn's FIRST action_id, with the auto basis.
            self.assertEqual(p["body"]["action_id"], "act-asm-A")
            self.assertEqual(p["body"]["basis"], "auto-extracted from session transcript")

    def test_caps_at_five_per_turn(self):
        session_id = "sess-asm-cap"
        block = "ASSUMPTIONS I'M MAKING:\n" + "\n".join(
            "%d. Assumption number %d" % (i, i) for i in range(1, 8)
        )
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", block),
        ]
        transcript = self._stage(session_id, entries, ["act-cap"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._assumption_posts()
        self.assertEqual(len(posts), 5)
        self.assertEqual(posts[-1]["body"]["assumption"], "Assumption number 5")

    def test_no_block_means_no_posts(self):
        session_id = "sess-asm-none"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "No assumptions here. I assume nothing explicitly."),
        ]
        transcript = self._stage(session_id, entries, ["act-none"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._assumption_posts(), [])

    def test_text_only_turn_skips_extraction(self):
        """No action_ids → nothing to attach to → no POSTs (server requires a
        parent action)."""
        session_id = "sess-asm-textonly"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", _BLOCK_THREE),
        ]
        transcript = self._stage(session_id, entries, [])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._assumption_posts(), [])

    def test_malformed_transcript_exits_silently(self):
        session_id = "sess-asm-malformed"
        fd, transcript = tempfile.mkstemp(suffix=".jsonl", prefix="dashclaw_test_")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("{not json at all\n\x00\x01binary garbage\n")
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-mal"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))
        self.addCleanup(_safe_remove, _assumptions_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._assumption_posts(), [])

    def test_rerun_posts_nothing_new(self):
        """Hook re-run for the same turn must not double-post: even with the
        cursor gone (worst case), the per-session posted-keys file dedupes."""
        session_id = "sess-asm-rerun"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", _BLOCK_THREE),
        ]
        transcript = self._stage(session_id, entries, ["act-rerun"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(len(self._assumption_posts()), 3)

        # Simulate a re-run of the same turn: re-stage the turn-actions file
        # (the first run cleared it) and remove the cursor so the turn
        # boundary falls back to the last user prompt — the same assistant
        # text is re-scanned and only the dedupe file stands in the way.
        self.log.clear()
        _write_turn_actions(session_id, ["act-rerun"])
        _safe_remove(_cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._assumption_posts(), [])


if __name__ == "__main__":
    unittest.main()
