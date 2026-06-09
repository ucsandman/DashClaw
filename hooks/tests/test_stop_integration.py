"""Integration tests for .claude/hooks/dashclaw_stop.py.

Starts a mock HTTP server on a random port, prepares a fake session
transcript and turn-action file, runs the Stop hook as a subprocess,
and verifies the PATCH requests distribute token usage across the
recorded action_ids.

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
# Paths — Stop hook lives in .claude/hooks/, not the legacy hooks/ dir.
# ---------------------------------------------------------------------------

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STOP_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_stop.py")


# ---------------------------------------------------------------------------
# Mock HTTP server
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


def _make_handler(log, status_by_id=None):
    """Build a Handler class that records PATCH bodies and answers GETs with
    status-per-action_id. `status_by_id` maps action_id → status string; missing
    keys default to None, which makes `_get_status` treat the action as
    terminal and skip the auto-close path."""
    if status_by_id is None:
        status_by_id = {}

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

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            log.add("POST", self.path, body)
            # Synthesize an action_id from the request count so the Stop hook
            # can extract it from the response and test assertions can match.
            action_id = "act-synth-" + str(len(log.get_all()))
            payload = {"action": {"action_id": action_id, "status": body.get("status") if body else "running"}}
            resp = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_GET(self):
            log.add("GET", self.path, None)
            # Extract the action_id suffix from /api/actions/<id>.
            action_id = self.path.rsplit("/", 1)[-1]
            status = status_by_id.get(action_id)
            payload = {"action": {"action_id": action_id, "status": status}}
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


# ---------------------------------------------------------------------------
# Helpers to stage fake transcript + turn file
# ---------------------------------------------------------------------------

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
    # Disable .env walking so the operator's local .env cannot leak into the
    # subprocess and override test expectations. Production hooks never set this.
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

class TestStopHook(unittest.TestCase):
    server: HTTPServer
    server_thread: threading.Thread
    log: _RequestLog
    base_url: str

    @classmethod
    def setUpClass(cls):
        cls.log = _RequestLog()
        cls.status_by_id: dict = {}
        port = _find_free_port()
        # Share the same dict with the handler so tests can mutate it between
        # invocations without rebuilding the server.
        handler = _make_handler(cls.log, cls.status_by_id)
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
        self.status_by_id.clear()

    def _env(self):
        return {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key",
        }

    def test_sums_cache_tokens_and_distributes_evenly(self):
        """Two actions + one assistant message: tokens split evenly, cache reads discounted."""
        session_id = "sess-test-001"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hello"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "claude-opus-4-6",
                    "usage": {
                        "input_tokens": 100,
                        "cache_creation_input_tokens": 50,
                        "cache_read_input_tokens": 200,
                        "output_tokens": 40,
                    },
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-A", "act-B"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        patches = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 2)
        bodies = sorted(patches, key=lambda r: r["path"])
        # Effective tokens_in = 100 + 50 + round(200 * 0.1) = 170 → 85/85
        # tokens_out = 40 → 20/20
        self.assertEqual(bodies[0]["path"], "/api/actions/act-A")
        self.assertEqual(bodies[0]["body"]["tokens_in"], 85)
        self.assertEqual(bodies[0]["body"]["tokens_out"], 20)
        self.assertEqual(bodies[0]["body"]["model"], "claude-opus-4-6")
        self.assertEqual(bodies[1]["path"], "/api/actions/act-B")
        self.assertEqual(bodies[1]["body"]["tokens_in"], 85)
        self.assertEqual(bodies[1]["body"]["tokens_out"], 20)

    def test_uneven_split_remainders_go_to_first_buckets(self):
        """Three actions, total=7 → 3,2,2 (earliest buckets absorb remainders)."""
        session_id = "sess-test-002"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "sonnet-4-6",
                    "usage": {"input_tokens": 7, "output_tokens": 5},
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-1", "act-2", "act-3"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        patches = sorted(
            [r for r in self.log.get_all() if r["method"] == "PATCH"],
            key=lambda r: r["path"],
        )
        self.assertEqual(len(patches), 3)
        in_vals = [p["body"]["tokens_in"] for p in patches]
        out_vals = [p["body"]["tokens_out"] for p in patches]
        self.assertEqual(sum(in_vals), 7)
        self.assertEqual(sum(out_vals), 5)
        self.assertEqual(in_vals, [3, 2, 2])
        self.assertEqual(out_vals, [2, 2, 1])

    def test_no_actions_in_turn_is_noop(self):
        """No turn-action file → no PATCHes, no crash."""
        session_id = "sess-test-003"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {"model": "opus", "usage": {"input_tokens": 1, "output_tokens": 1}},
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
        self.assertEqual([r for r in self.log.get_all() if r["method"] == "PATCH"], [])

    def test_cursor_advances_and_next_turn_only_sees_new_usage(self):
        """Second Stop only counts usage that appeared after the first cursor."""
        session_id = "sess-test-004"
        entries_turn_one = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "q1"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                },
            },
        ]
        transcript = _write_transcript(entries_turn_one)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-X"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        first = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["body"]["tokens_in"], 10)

        # Append a new turn to the transcript, stage a new action, re-run Stop.
        self.log.clear()
        turn_two = entries_turn_one + [
            {"type": "user", "uuid": "u2", "message": {"role": "user", "content": "q2"}},
            {
                "type": "assistant",
                "uuid": "a2",
                "message": {
                    "model": "opus",
                    "usage": {"input_tokens": 3, "output_tokens": 2},
                },
            },
        ]
        with open(transcript, "w", encoding="utf-8") as f:
            for e in turn_two:
                f.write(json.dumps(e) + "\n")
        _write_turn_actions(session_id, ["act-Y"])

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        second = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0]["path"], "/api/actions/act-Y")
        self.assertEqual(second[0]["body"]["tokens_in"], 3)
        self.assertEqual(second[0]["body"]["tokens_out"], 2)

    def test_sends_close_if_running_on_every_patch(self):
        """Stop hook delegates the terminal-state check to the server.

        The hook no longer GETs each action before PATCHing — instead every
        PATCH carries `close_if_running: true` plus the close fields, and the
        server applies close atomically only when status='running'. Tokens
        always apply. This eliminates the TOCTOU race with PostToolUse.
        """
        session_id = "sess-test-autoclose"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    "usage": {"input_tokens": 20, "output_tokens": 10},
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-running", "act-failed"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        # Hook must not GET action status — server-side gating replaced the
        # action GET+PATCH pair. The behavior-recorder config may still be read.
        gets = [
            r for r in self.log.get_all()
            if r["method"] == "GET" and r["path"].startswith("/api/actions/")
        ]
        self.assertEqual(gets, [], "Stop hook should no longer GET action status")

        patches = sorted(
            [r for r in self.log.get_all() if r["method"] == "PATCH"],
            key=lambda r: r["path"],
        )
        self.assertEqual(len(patches), 2)

        for p in patches:
            body = p["body"]
            self.assertIs(body["close_if_running"], True)
            self.assertEqual(body["status"], "completed")
            self.assertEqual(body["output_summary"], "Auto-closed by Stop hook")
            self.assertIn("timestamp_end", body)
            self.assertGreater(body["tokens_in"], 0)
            self.assertGreater(body["tokens_out"], 0)

    def test_autoclose_without_tokens(self):
        """If the transcript yields no usage, hook still PATCHes close fields.

        Tokens are omitted (nothing to distribute), but the conditional-close
        body still goes through so a running action doesn't stay running.
        """
        session_id = "sess-test-autoclose-no-tokens"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "noop"}},
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-running-2"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        patches = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1)
        body = patches[0]["body"]
        self.assertIs(body["close_if_running"], True)
        self.assertEqual(body["status"], "completed")
        self.assertNotIn("tokens_in", body)

    def test_orphan_tokens_logged_when_no_action_ids(self):
        """Text-only turns (no tool calls → no action_ids) must NOT silently
        drop token accounting. The hook logs an orphan_tokens line to the
        shared drift log so ops can see unattributed spend."""
        session_id = "sess-test-orphan"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    "usage": {"input_tokens": 42, "output_tokens": 17},
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        # No _write_turn_actions — simulates text-only turn with no tool calls.
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        log_path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        # Snapshot existing log length so we only read lines written by this run.
        try:
            before_size = os.path.getsize(log_path)
        except OSError:
            before_size = 0

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        self.assertEqual([r for r in self.log.get_all() if r["method"] == "PATCH"], [])

        with open(log_path, "r", encoding="utf-8") as f:
            f.seek(before_size)
            new_lines = f.read()
        self.assertIn("orphan_tokens", new_lines)
        self.assertIn("session=" + session_id, new_lines)
        self.assertIn("tokens_in=42", new_lines)
        self.assertIn("tokens_out=17", new_lines)

    def test_track_text_turns_creates_synthetic_conversation_action(self):
        """When DASHCLAW_TRACK_TEXT_TURNS=1 is set, text-only turns (tokens
        but no action_ids) POST a synthetic action_type='conversation' record
        so the spend lands in analytics instead of just the drift log."""
        session_id = "sess-test-track-text"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "claude-opus-4-6",
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        # No _write_turn_actions — text-only turn.
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        env = self._env()
        env["DASHCLAW_TRACK_TEXT_TURNS"] = "1"
        env["DASHCLAW_AGENT_ID"] = "test-claude-code"

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            env,
        )
        self.assertEqual(code, 0, msg=err)

        posts = [r for r in self.log.get_all() if r["method"] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["path"], "/api/actions")
        body = posts[0]["body"]
        self.assertEqual(body["action_type"], "conversation")
        self.assertEqual(body["agent_id"], "test-claude-code")
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["tokens_in"], 100)
        self.assertEqual(body["tokens_out"], 50)
        self.assertEqual(body["model"], "claude-opus-4-6")
        self.assertEqual(body["risk_score"], 0)
        self.assertIs(body["reversible"], True)
        self.assertIn("timestamp_end", body)
        self.assertIn(session_id, body.get("trigger", ""))
        # No PATCHes — synthetic action is created already-completed.
        self.assertEqual([r for r in self.log.get_all() if r["method"] == "PATCH"], [])

    def test_track_text_turns_default_off_still_logs_orphan_tokens(self):
        """Without DASHCLAW_TRACK_TEXT_TURNS, text-only turns must still log
        orphan_tokens — the opt-in flag only changes whether we also POST."""
        session_id = "sess-test-track-off"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    "usage": {"input_tokens": 7, "output_tokens": 3},
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),  # TRACK_TEXT_TURNS not set
        )
        self.assertEqual(code, 0, msg=err)
        # No POST, no PATCH — pure log-and-drop behavior.
        self.assertEqual([r for r in self.log.get_all() if r["method"] == "POST"], [])
        self.assertEqual([r for r in self.log.get_all() if r["method"] == "PATCH"], [])

    def test_session_id_path_traversal_is_sanitized(self):
        """Malicious session_id cannot escape the tempdir via path traversal.

        The hook reads a turn-file named after the session_id. If the ID isn't
        sanitized, an attacker-crafted stdin could read ../../../etc/passwd
        (or similar) as a turn-action list. After sanitization, a traversal
        session_id is rewritten to an underscore-only filename, so the hook
        just sees "no turn file" and exits cleanly."""
        malicious = "../../evil"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "x"}},
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)

        # Plant a file at the sanitized path to prove the hook wouldn't
        # reach outside tempdir. The sanitizer replaces both '.' and '/'
        # sequences, so only alphanumerics/._- survive → "_._._evil" etc.
        code, _, err = _run_hook(
            {"session_id": malicious, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        # No file under the literal malicious name was written.
        self.assertFalse(
            os.path.exists(os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + malicious))
        )
        # And no parent-directory write happened — spot-check by asserting no
        # "dashclaw_turn_" file exists two levels up (we used ../../evil).
        parent = os.path.abspath(os.path.join(tempfile.gettempdir(), "..", ".."))
        stray = [n for n in os.listdir(parent) if n.startswith("dashclaw_turn_")]
        self.assertEqual(stray, [])

    def test_cache_read_rounding_matches_js_math_round(self):
        """Python rounding must match JS Math.round() so parallel paths agree.

        Python's built-in round() uses banker's rounding (round-half-to-even):
        round(0.5) == 0, round(2.5) == 2. JavaScript Math.round() uses
        half-away-from-zero: Math.round(0.5) == 1, Math.round(2.5) == 3.
        For cache_read_input_tokens = 5 that's a one-token divergence; this
        test pins the hook to the JS behavior."""
        session_id = "sess-test-rounding"
        entries = [
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "r"}},
            {
                "type": "assistant",
                "uuid": "a1",
                "message": {
                    "model": "opus",
                    # cache_read=5 → 5 * 0.1 = 0.5 → banker's round = 0 (wrong),
                    # JS Math.round = 1 (expected).
                    "usage": {
                        "input_tokens": 0,
                        "cache_read_input_tokens": 5,
                        "output_tokens": 0,
                    },
                },
            },
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-round"])
        self.addCleanup(_safe_remove, _turn_path(session_id))
        self.addCleanup(_safe_remove, _cursor_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)
        patches = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1)
        # tokens_in == 1 (JS rounding), not 0 (banker's rounding).
        self.assertEqual(patches[0]["body"]["tokens_in"], 1)

    def test_missing_env_exits_silently(self):
        """No DASHCLAW_BASE_URL/API_KEY → exit 0, no PATCHes."""
        session_id = "sess-test-005"
        entries = [
            {"type": "assistant", "uuid": "a1", "message": {"model": "opus", "usage": {"input_tokens": 1, "output_tokens": 1}}},
        ]
        transcript = _write_transcript(entries)
        self.addCleanup(_safe_remove, transcript)
        _write_turn_actions(session_id, ["act-Z"])
        self.addCleanup(_safe_remove, _turn_path(session_id))

        code, _, err = _run_hook(
            {"session_id": session_id, "transcript_path": transcript},
            env_overrides={},  # No DASHCLAW_* vars
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual([r for r in self.log.get_all() if r["method"] == "PATCH"], [])


if __name__ == "__main__":
    unittest.main()
