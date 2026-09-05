"""Tests for instance-scoped tempdir state (F2, 2026-07-27 e2e proof).

Evidence: on the dogfooding machine, Wes's global ~/.claude DashClaw hooks
fired for the SAME Write tool_use_id as a scratch repo's local hooks --
different agent_id / base URL, but the same tool_use_id (Claude Code assigns
one tool_use_id per tool call regardless of how many hook chains are
registered for it). The two installs shared one
`dashclaw_last_action_<tool_use_id>` file and clobbered each other's
action_id, so the real session's PostToolUse found no state -> no artifact,
no awaiting_promotion flip.

The fix namespaces that file (and the containment session-state file) by a
short hash of (resolved BASE_URL + AGENT_ID), computed independently by
pretool (writer) and posttool (reader) from their own env. These tests prove
two co-installed "instances" (here: same tool_use_id/session_id, different
DASHCLAW_AGENT_ID, one shared mock server) get distinct state files and never
cross-read each other's action_id.

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

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")
_POSTTOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_posttool.py")
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


def _make_handler(log: _RequestLog):
    class Handler(BaseHTTPRequestHandler):
        def _respond(self, payload):
            resp = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else {}
            bare = self.path.partition("?")[0]
            log.add("POST", bare, body)
            if bare == "/api/guard":
                # Each "instance" gets a distinct action_id derived from its
                # own agent_id, so the test can tell whose action landed
                # where without a second mock server.
                agent_id = body.get("agent_id", "unknown")
                self._respond({
                    "decision": "allow",
                    "recorded": True,
                    "action_id": "act-" + agent_id,
                })
                return
            self._respond({"action_id": "test-action-fallback"})

        def do_PATCH(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            log.add("PATCH", self.path, json.loads(raw) if raw else None)
            self._respond({"ok": True})

        def log_message(self, fmt, *args):
            pass

    return Handler


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _run_pretool(stdin_data, env, timeout=15):
    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


def _run_posttool(stdin_data, env, timeout=15):
    proc = subprocess.run(
        [sys.executable, _POSTTOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


def _run_stop(stdin_data, env, timeout=15):
    proc = subprocess.run(
        [sys.executable, _STOP_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


def _instance_suffix(base_url, agent_id):
    return hashlib.sha256((base_url + "|" + agent_id).encode("utf-8")).hexdigest()[:12]


def _expected_state_path(base_url, agent_id, tool_use_id):
    """Mirror of dashclaw_pretool.py/dashclaw_posttool.py's
    _INSTANCE_STATE_SUFFIX + _action_state_path formula."""
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_last_action_" + _instance_suffix(base_url, agent_id) + "_" + tool_use_id
    )


def _expected_contained_turn_path(base_url, agent_id, session_id):
    """Mirror of dashclaw_agent_intel.stop_state.contained_turn_path with the
    instance suffix dashclaw_posttool.py (writer) / dashclaw_stop.py (reader)
    both derive."""
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_contained_turn_" + _instance_suffix(base_url, agent_id) + "_" + session_id,
    )


def _expected_contained_posted_path(base_url, agent_id, session_id):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_contained_posted_" + _instance_suffix(base_url, agent_id) + "_" + session_id,
    )


def _write_transcript(entries):
    fd, path = tempfile.mkstemp(suffix=".jsonl", prefix="dashclaw_instance_state_test_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return path


def _assistant_entry(uuid, text):
    return {
        "type": "assistant",
        "uuid": uuid,
        "message": {
            "model": "opus",
            "usage": {"input_tokens": 1, "output_tokens": 1},
            "content": [{"type": "text", "text": text}],
        },
    }


class TestInstanceScopedActionState(unittest.TestCase):
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
        self._cleanup_paths = []

    def tearDown(self):
        for p in self._cleanup_paths:
            try:
                os.remove(p)
            except OSError:
                pass

    def _base_env(self, agent_id, workspace):
        env = os.environ.copy()
        for key in list(env.keys()):
            if key.startswith("DASHCLAW_"):
                del env[key]
        env["DASHCLAW_DISABLE_DOTENV"] = "1"
        env.update({
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": agent_id,
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": workspace,
            "DASHCLAW_PERMISSION_MODE": "danger",
            # No containment involved in these tests -- keep the plain
            # action-id state-file path (write_action_id), not the
            # containment JSON shape.
            "DASHCLAW_CONTAINMENT": "0",
        })
        return env

    def _track(self, path):
        self._cleanup_paths.append(path)
        return path

    def test_two_installs_same_tool_use_id_get_distinct_state_files(self):
        """Two co-installed hook instances (different agent_id, same
        tool_use_id/session_id -- the actual collision shape from the
        2026-07-27 incident) must write to two different files, each holding
        its OWN action_id."""
        workspace = tempfile.mkdtemp(prefix="dashclaw-instance-state-")
        self.addCleanup(lambda: __import__("shutil").rmtree(workspace, ignore_errors=True))
        tool_use_id = "tu-collide-shared-1"
        session_id = "sess-collide-shared-1"

        path_a = self._track(_expected_state_path(self.base_url, "agent-a", tool_use_id))
        path_b = self._track(_expected_state_path(self.base_url, "agent-b", tool_use_id))
        self.assertNotEqual(path_a, path_b, "different agent_id must hash to different paths")

        code_a, _, err_a = _run_pretool(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._base_env("agent-a", workspace),
        )
        self.assertEqual(code_a, 0, msg=err_a)

        code_b, _, err_b = _run_pretool(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._base_env("agent-b", workspace),
        )
        self.assertEqual(code_b, 0, msg=err_b)

        self.assertTrue(os.path.isfile(path_a), "instance A's state file must exist")
        self.assertTrue(os.path.isfile(path_b), "instance B's state file must exist")

        with open(path_a, encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), "act-agent-a")
        with open(path_b, encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), "act-agent-b")

    def test_posttool_reads_only_its_own_instance_state(self):
        """PostToolUse under instance A's env must PATCH instance A's
        action_id -- never B's -- even though both wrote state for the exact
        same tool_use_id, and instance A's run must not disturb B's file."""
        workspace = tempfile.mkdtemp(prefix="dashclaw-instance-state-")
        self.addCleanup(lambda: __import__("shutil").rmtree(workspace, ignore_errors=True))
        tool_use_id = "tu-collide-shared-2"
        session_id = "sess-collide-shared-2"

        path_a = self._track(_expected_state_path(self.base_url, "agent-a", tool_use_id))
        path_b = self._track(_expected_state_path(self.base_url, "agent-b", tool_use_id))

        for agent_id in ("agent-a", "agent-b"):
            code, _, err = _run_pretool(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "echo hi"},
                    "tool_use_id": tool_use_id,
                    "session_id": session_id,
                },
                self._base_env(agent_id, workspace),
            )
            self.assertEqual(code, 0, msg=err)

        self.log.clear()
        code, _, err = _run_posttool(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "done"},
            },
            self._base_env("agent-a", workspace),
        )
        self.assertEqual(code, 0, msg=err)

        patches = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1, "exactly one PATCH from instance A's PostToolUse")
        self.assertEqual(patches[0]["path"], "/api/actions/act-agent-a")

        # A's PostToolUse consumed (cleaned up) only its OWN file.
        self.assertFalse(os.path.isfile(path_a), "instance A's state file is cleaned up after PostToolUse")
        self.assertTrue(os.path.isfile(path_b), "instance B's state file must be untouched by A's PostToolUse")

        # Now B's PostToolUse still finds its own action_id intact.
        self.log.clear()
        code_b, _, err_b = _run_posttool(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "done"},
            },
            self._base_env("agent-b", workspace),
        )
        self.assertEqual(code_b, 0, msg=err_b)
        patches_b = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(patches_b), 1)
        self.assertEqual(patches_b[0]["path"], "/api/actions/act-agent-b")

    def test_third_instance_finds_no_state_for_others_tool_use_id(self):
        """A third, unrelated instance (different agent_id, never ran
        PreToolUse for this tool_use_id) must find nothing -- proving the
        namespacing doesn't accidentally match across instances."""
        workspace = tempfile.mkdtemp(prefix="dashclaw-instance-state-")
        self.addCleanup(lambda: __import__("shutil").rmtree(workspace, ignore_errors=True))
        tool_use_id = "tu-collide-shared-3"
        session_id = "sess-collide-shared-3"

        self._track(_expected_state_path(self.base_url, "agent-a", tool_use_id))
        code, _, err = _run_pretool(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._base_env("agent-a", workspace),
        )
        self.assertEqual(code, 0, msg=err)

        self.log.clear()
        code_c, _, err_c = _run_posttool(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "done"},
            },
            self._base_env("agent-c", workspace),
        )
        self.assertEqual(code_c, 0, msg=err_c)
        self.assertEqual(self.log.get_all(), [], "instance C must find no state and PATCH nothing")

    def test_unset_agent_id_pairs_across_pretool_and_posttool(self):
        """DASHCLAW_AGENT_ID unset entirely (not even ""), on both the
        pretool call that writes state and the posttool call that reads it --
        both must resolve the same "claude-code" default and derive the
        identical hash, so a completely unconfigured agent_id is still a
        matched pair, not an accidental third "instance"."""
        workspace = tempfile.mkdtemp(prefix="dashclaw-instance-state-")
        self.addCleanup(lambda: __import__("shutil").rmtree(workspace, ignore_errors=True))
        tool_use_id = "tu-collide-shared-4"
        session_id = "sess-collide-shared-4"

        env = self._base_env("agent-a", workspace)
        del env["DASHCLAW_AGENT_ID"]  # not just empty -- entirely absent, like an un-configured install
        expected_path = self._track(_expected_state_path(self.base_url, "claude-code", tool_use_id))

        code, _, err = _run_pretool(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            env,
        )
        self.assertEqual(code, 0, msg=err)
        self.assertTrue(os.path.isfile(expected_path), "pretool must resolve to the 'claude-code' default hash")

        self.log.clear()
        code2, _, err2 = _run_posttool(
            {"tool_use_id": tool_use_id, "tool_response": {"output": "done"}},
            env,
        )
        self.assertEqual(code2, 0, msg=err2)
        patches = [r for r in self.log.get_all() if r["method"] == "PATCH"]
        self.assertEqual(len(patches), 1, "posttool must resolve to the SAME 'claude-code' default hash as pretool")
        self.assertEqual(patches[0]["path"], "/api/actions/act-claude-code")


class TestInstanceScopedStopSweep(unittest.TestCase):
    """F2 follow-up: the Stop hook's awaiting-promotion sweep reads/clears a
    session-scoped contained-turn log + dedup-keys file. Two co-installed
    instances sharing a session_id (the exact 2026-07-27 incident shape) must
    never sweep, consume, or clear each other's contained actions."""

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
        self._cleanup_paths = []

    def tearDown(self):
        for p in self._cleanup_paths:
            try:
                os.remove(p)
            except OSError:
                pass

    def _track(self, path):
        self._cleanup_paths.append(path)
        return path

    def _stop_env(self, agent_id):
        env = os.environ.copy()
        for key in list(env.keys()):
            if key.startswith("DASHCLAW_"):
                del env[key]
        env["DASHCLAW_DISABLE_DOTENV"] = "1"
        env.update({
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": agent_id,
            "DASHCLAW_CODE_SESSIONS_ENABLED": "0",
        })
        return env

    def _awaiting_patches(self):
        return [
            r for r in self.log.get_all()
            if r["method"] == "PATCH"
            and isinstance(r["body"], dict)
            and r["body"].get("containment_status") == "awaiting_promotion"
        ]

    def test_stop_sweep_reads_only_its_own_instance_turn_log(self):
        session_id = "sess-collide-stop-1"
        transcript = _write_transcript([
            {"type": "user", "uuid": "u1", "message": {"role": "user", "content": "go"}},
            _assistant_entry("a1", "All done."),
        ])
        self.addCleanup(lambda: os.path.exists(transcript) and os.remove(transcript))

        path_a = self._track(_expected_contained_turn_path(self.base_url, "agent-a", session_id))
        path_b = self._track(_expected_contained_turn_path(self.base_url, "agent-b", session_id))
        self._track(_expected_contained_posted_path(self.base_url, "agent-a", session_id))
        self._track(_expected_contained_posted_path(self.base_url, "agent-b", session_id))
        self.assertNotEqual(path_a, path_b)

        with open(path_a, "w", encoding="utf-8") as f:
            f.write("act-stop-a\tdashclaw/contained-a\n")
        with open(path_b, "w", encoding="utf-8") as f:
            f.write("act-stop-b\tdashclaw/contained-b\n")

        code_a, _, err_a = _run_stop(
            {"session_id": session_id, "transcript_path": transcript}, self._stop_env("agent-a")
        )
        self.assertEqual(code_a, 0, msg=err_a)

        patches_a = self._awaiting_patches()
        self.assertEqual(len(patches_a), 1, "instance A's sweep must PATCH only its own contained action")
        self.assertEqual(patches_a[0]["path"], "/api/actions/act-stop-a")

        # A's sweep consumed (cleared) only its OWN contained-turn log.
        self.assertFalse(os.path.isfile(path_a), "instance A's contained-turn log is cleared after its sweep")
        self.assertTrue(os.path.isfile(path_b), "instance B's contained-turn log must be untouched by A's sweep")
        with open(path_b, encoding="utf-8") as f:
            self.assertEqual(f.read(), "act-stop-b\tdashclaw/contained-b\n", "B's log content must be unchanged")

        # B's own sweep still finds (and flips) its own action.
        self.log.clear()
        code_b, _, err_b = _run_stop(
            {"session_id": session_id, "transcript_path": transcript}, self._stop_env("agent-b")
        )
        self.assertEqual(code_b, 0, msg=err_b)
        patches_b = self._awaiting_patches()
        self.assertEqual(len(patches_b), 1)
        self.assertEqual(patches_b[0]["path"], "/api/actions/act-stop-b")


if __name__ == "__main__":
    unittest.main()
