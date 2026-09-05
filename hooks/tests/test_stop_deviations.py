"""Tests for the Stop hook's deviation auto-capture.

The global working agreement mandates a "DEVIATIONS FROM PLAN:" block in
every post-modification summary. The Stop hook extracts its items from the
turn's assistant text and POSTs each to /api/actions as a first-class
`action_type='deviation'` governance event (no parent action required —
deviations are events in their own right, unlike assumptions).

These tests pin: extraction shape (bulleted and numbered items), the "none"
filter (a held plan records nothing), the per-turn cap, capture on text-only
turns, and idempotency across hook re-runs (the posted-keys dedupe file).

Mirrors the subprocess + mock-HTTP-server harness of test_stop_assumptions.py.
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
            self._respond({"action": {"action_id": "act_dev_test"}})

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


def _deviations_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_deviations_" + session_id)


def _write_turn_actions(session_id, action_ids):
    with open(_turn_path(session_id), "w", encoding="utf-8") as f:
        for aid in action_ids:
            f.write(aid + "\n")


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


_BLOCK_TWO = (
    "CHANGES MADE:\n"
    "- api.py: added retry\n\n"
    "DEVIATIONS FROM PLAN:\n"
    "- Used PATCH instead of PUT because the server rejects full replaces\n"
    "- Skipped the cache layer: the endpoint is already memoized upstream\n\n"
    "VERIFICATION:\n"
    "- pytest passed\n"
)

_BLOCK_NONE = (
    "CHANGES MADE:\n"
    "- api.py: added retry\n\n"
    "DEVIATIONS FROM PLAN:\n"
    "- none\n\n"
    "VERIFICATION:\n"
    "- pytest passed\n"
)


class TestStopDeviationCapture(unittest.TestCase):
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
            "DASHCLAW_CODE_SESSIONS_ENABLED": "0",
        }

    def _stage(self, session_id, entries, action_ids):
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        if action_ids:
            _write_turn_actions(session_id, action_ids)
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))
        self.addCleanup(_safe_remove, _deviations_path(session_id))
        return transcript

    def _deviation_posts(self):
        return [
            r for r in self.log.get_all()
            if r["method"] == "POST"
            and r["path"] == "/api/actions"
            and isinstance(r["body"], dict)
            and r["body"].get("action_type") == "deviation"
        ]

    def test_extracts_bulleted_items_as_deviation_actions(self):
        session_id = "sess-dev-001"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", _BLOCK_TWO),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-A"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript, "cwd": "C:/Projects/Demo"},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._deviation_posts()
        self.assertEqual(len(posts), 2)
        goals = [p["body"]["declared_goal"] for p in posts]
        self.assertEqual(goals, [
            "Used PATCH instead of PUT because the server rejects full replaces",
            "Skipped the cache layer: the endpoint is already memoized upstream",
        ])
        for p in posts:
            body = p["body"]
            self.assertEqual(body["status"], "completed")
            self.assertEqual(body["trigger"], "session:" + session_id)
            self.assertIn("C:/Projects/Demo", body["output_summary"])

    def test_none_item_records_nothing(self):
        session_id = "sess-dev-none"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", _BLOCK_NONE),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-none"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._deviation_posts(), [])

    def test_none_variants_filtered_but_real_items_kept(self):
        session_id = "sess-dev-mixed"
        block = (
            "DEVIATIONS FROM PLAN:\n"
            "- None. The plan held for the API layer.\n"
            "- Renamed the helper because the planned name collided\n"
        )
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", block),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-mixed"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._deviation_posts()
        self.assertEqual(len(posts), 1)
        self.assertEqual(
            posts[0]["body"]["declared_goal"],
            "Renamed the helper because the planned name collided",
        )

    def test_numbered_items_also_accepted(self):
        session_id = "sess-dev-numbered"
        block = (
            "DEVIATIONS FROM PLAN:\n"
            "1. Dropped the migration step; schema already matched\n"
        )
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", block),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-num"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._deviation_posts()
        self.assertEqual(len(posts), 1)
        self.assertEqual(
            posts[0]["body"]["declared_goal"],
            "Dropped the migration step; schema already matched",
        )

    def test_caps_at_five_per_turn(self):
        session_id = "sess-dev-cap"
        block = "DEVIATIONS FROM PLAN:\n" + "\n".join(
            "- Deviation number %d" % i for i in range(1, 8)
        )
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", block),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-cap"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        posts = self._deviation_posts()
        self.assertEqual(len(posts), 5)
        self.assertEqual(posts[-1]["body"]["declared_goal"], "Deviation number 5")

    def test_text_only_turn_still_captures(self):
        """Deviations are first-class events — unlike assumptions they need no
        parent action, so a summary-only turn (no tool calls) still records."""
        session_id = "sess-dev-textonly"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "summarize"}},
            _assistant_entry("a1", _BLOCK_TWO),
        ]
        transcript = self._stage(session_id, entries, [])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(len(self._deviation_posts()), 2)

    def test_no_block_means_no_posts(self):
        session_id = "sess-dev-noblock"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "All done. No deviations worth mentioning in prose."),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-nb"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._deviation_posts(), [])

    def test_rerun_posts_nothing_new(self):
        """Hook re-run for the same turn must not double-post: even with the
        cursor gone (worst case), the per-session posted-keys file dedupes."""
        session_id = "sess-dev-rerun"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", _BLOCK_TWO),
        ]
        transcript = self._stage(session_id, entries, ["act-dev-rerun"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(len(self._deviation_posts()), 2)

        self.log.clear()
        _write_turn_actions(session_id, ["act-dev-rerun"])
        _safe_remove(_cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._deviation_posts(), [])


if __name__ == "__main__":
    unittest.main()
