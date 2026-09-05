"""Tests for the Stop hook's containment awaiting-promotion sweep (Task 10).

PostToolUse (dashclaw_posttool.py) appends "<action_id>\\t<containment_ref>"
to a per-session contained-turn log for every contained mutation it processes.
This Stop hook sweep reads that log and PATCHes containment_status to
'awaiting_promotion' for each action -- a backstop in case PostToolUse's own
flip never landed. Idempotent across hook re-runs via a per-session
posted-keys file, mirroring _capture_deviations.

Mirrors the subprocess + mock-HTTP-server harness of test_stop_deviations.py.
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
            self._respond({"action": {"action_id": "act_test"}})

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


def _instance_suffix(base_url, agent_id="claude-code"):
    # Mirrors dashclaw_stop.py's _INSTANCE_STATE_SUFFIX: sha256(BASE_URL + "|"
    # + AGENT_ID)[:12] (F2 follow-up). Tests never set DASHCLAW_AGENT_ID, so
    # the hook resolves it to the "claude-code" default.
    return hashlib.sha256((base_url + "|" + agent_id).encode("utf-8")).hexdigest()[:12]


def _contained_turn_path(session_id, base_url, agent_id="claude-code"):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_contained_turn_" + _instance_suffix(base_url, agent_id) + "_" + session_id,
    )


def _contained_posted_path(session_id, base_url, agent_id="claude-code"):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_contained_posted_" + _instance_suffix(base_url, agent_id) + "_" + session_id,
    )


def _write_turn_actions(session_id, action_ids):
    with open(_turn_path(session_id), "w", encoding="utf-8") as f:
        for aid in action_ids:
            f.write(aid + "\n")


def _write_contained_turn_actions(session_id, pairs, base_url, agent_id="claude-code"):
    """pairs: list of (action_id, ref)."""
    with open(_contained_turn_path(session_id, base_url, agent_id), "w", encoding="utf-8") as f:
        for action_id, ref in pairs:
            f.write(action_id + "\t" + ref + "\n")


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


class TestStopContainmentSweep(unittest.TestCase):
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

    def _stage(self, session_id, entries, action_ids, contained_pairs=None):
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        if action_ids:
            _write_turn_actions(session_id, action_ids)
        if contained_pairs:
            _write_contained_turn_actions(session_id, contained_pairs, self.base_url)
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))
        self.addCleanup(_safe_remove, _contained_turn_path(session_id, self.base_url))
        self.addCleanup(_safe_remove, _contained_posted_path(session_id, self.base_url))
        return transcript

    def _awaiting_patches(self):
        return [
            r for r in self.log.get_all()
            if r["method"] == "PATCH"
            and isinstance(r["body"], dict)
            and r["body"].get("containment_status") == "awaiting_promotion"
        ]

    def test_contained_action_gets_flipped_to_awaiting(self):
        session_id = "sess-cont-001"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "All done."),
        ]
        transcript = self._stage(
            session_id, entries, ["act-cont-A"],
            contained_pairs=[("act-cont-A", "dashclaw/contained-sess-001")],
        )

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        patches = self._awaiting_patches()
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]["path"], "/api/actions/act-cont-A")
        self.assertEqual(patches[0]["body"]["containment_ref"], "dashclaw/contained-sess-001")

    def test_no_contained_actions_means_no_awaiting_patches(self):
        session_id = "sess-cont-none"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "All done."),
        ]
        transcript = self._stage(session_id, entries, ["act-cont-plain"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._awaiting_patches(), [])

    def test_multiple_contained_actions_each_flipped_once(self):
        session_id = "sess-cont-multi"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "All done."),
        ]
        transcript = self._stage(
            session_id, entries, ["act-cont-B1", "act-cont-B2"],
            contained_pairs=[
                ("act-cont-B1", "dashclaw/contained-sess-multi"),
                ("act-cont-B2", "dashclaw/contained-sess-multi"),
            ],
        )

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)

        patches = self._awaiting_patches()
        self.assertEqual(len(patches), 2)
        action_ids = {p["path"].rsplit("/", 1)[-1] for p in patches}
        self.assertEqual(action_ids, {"act-cont-B1", "act-cont-B2"})

    def test_idempotent_across_two_consecutive_runs(self):
        """The same contained action_id must be flipped exactly once across
        two consecutive Stop hook runs -- the posted-keys file dedupes."""
        session_id = "sess-cont-rerun"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "All done."),
        ]
        transcript = self._stage(
            session_id, entries, ["act-cont-rerun"],
            contained_pairs=[("act-cont-rerun", "dashclaw/contained-sess-rerun")],
        )

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(len(self._awaiting_patches()), 1)

        # Simulate a second Stop invocation for the same turn (worst case: the
        # per-turn contained log was re-populated, e.g. a retried hook run).
        self.log.clear()
        _write_turn_actions(session_id, ["act-cont-rerun"])
        _write_contained_turn_actions(session_id, [("act-cont-rerun", "dashclaw/contained-sess-rerun")], self.base_url)
        _safe_remove(_cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript}, self._env()
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._awaiting_patches(), [])


if __name__ == "__main__":
    unittest.main()
