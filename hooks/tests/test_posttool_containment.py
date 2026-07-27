"""Tests for the PostToolUse hook's containment diff artifact (Task 10).

When PreToolUse (Task 9) redirects a contained mutation into a per-session
git worktree, its state file carries a non-None containment_ref. PostToolUse
must then: compute the worktree's staged diff, upload it as a `patch`
artifact (POST /api/artifacts), and PATCH the action with its containment_ref
(the server only accepts containment_ref together with
containment_status='awaiting_promotion' -- see app/api/actions/[actionId]/route.ts).

Mirrors the subprocess + mock-HTTP-server harness of test_posttool_integration.py.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_POSTTOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_posttool.py")


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
            self._respond({"artifact": {"artifact_id": "art_test"}})

        def log_message(self, fmt, *args):
            pass

    return Handler


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Temp-file helpers
# ---------------------------------------------------------------------------

def _action_state_path(tool_use_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)


def _write_plain_action(tool_use_id, action_id):
    """Mimic the ordinary (non-contained) pretool write: a bare action_id."""
    with open(_action_state_path(tool_use_id), "w", encoding="utf-8") as f:
        f.write(action_id)


def _write_contained_action(tool_use_id, action_id, ref, worktree):
    """Mimic Task 9's _write_containment_action_state JSON shape."""
    payload = {"action_id": action_id, "containment_ref": ref, "containment_worktree": worktree}
    with open(_action_state_path(tool_use_id), "w", encoding="utf-8") as f:
        f.write(json.dumps(payload))


def _cleanup_temp_action(tool_use_id):
    try:
        os.remove(_action_state_path(tool_use_id))
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
        [sys.executable, _POSTTOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Real temp git repo with a staged change (stands in for a containment worktree)
# ---------------------------------------------------------------------------

def _run_git(args, cwd):
    subprocess.run(["git"] + args, cwd=cwd, capture_output=True, check=True)


def _make_worktree_with_staged_change(marker_line="CONTAINED_CHANGE_MARKER"):
    tmpdir = tempfile.mkdtemp(prefix="dashclaw_test_containment_")
    _run_git(["init"], tmpdir)
    _run_git(["config", "user.email", "test@dashclaw.test"], tmpdir)
    _run_git(["config", "user.name", "DashClaw Test"], tmpdir)
    file_path = os.path.join(tmpdir, "hello.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("original content\n")
    _run_git(["add", "."], tmpdir)
    _run_git(["commit", "-m", "init"], tmpdir)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write("original content\n" + marker_line + "\n")
    _run_git(["add", "."], tmpdir)
    return tmpdir


def _rm_worktree(path):
    shutil.rmtree(path, ignore_errors=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPosttoolContainmentDiff(unittest.TestCase):
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

    def setUp(self):
        self.log.clear()

    def _env(self, **extra):
        env = {"DASHCLAW_BASE_URL": self.base_url, "DASHCLAW_API_KEY": "test-key-123"}
        env.update(extra)
        return env

    def _artifact_posts(self):
        return [r for r in self.log.get_all() if r["method"] == "POST" and r["path"] == "/api/artifacts"]

    def _containment_patches(self):
        return [
            r for r in self.log.get_all()
            if r["method"] == "PATCH" and isinstance(r["body"], dict) and "containment_ref" in r["body"]
        ]

    # -----------------------------------------------------------------------
    # Contained mutation: artifact upload + ref PATCH
    # -----------------------------------------------------------------------

    def test_contained_action_uploads_diff_artifact_and_patches_ref(self):
        tool_use_id = "post-cont-tu-001"
        action_id = "act-cont-001"
        ref = "dashclaw/contained-sess-001"
        worktree = _make_worktree_with_staged_change()
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree)
        self.addCleanup(_cleanup_temp_action, tool_use_id)

        code, _, err = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "wrote file"},
            },
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        artifacts = self._artifact_posts()
        self.assertEqual(len(artifacts), 1, "Expected exactly one artifact POST")
        body = artifacts[0]["body"]
        self.assertEqual(body["artifact_type"], "patch")
        self.assertEqual(body["name"], "containment-diff-" + action_id)
        self.assertEqual(body["source_action_id"], action_id)
        content = body["content_json"]
        self.assertIn("CONTAINED_CHANGE_MARKER", content["diff"])
        self.assertEqual(content["ref"], ref)
        self.assertFalse(content["truncated"])

        patches = self._containment_patches()
        self.assertEqual(len(patches), 1, "Expected exactly one containment-ref PATCH")
        self.assertEqual(patches[0]["path"], "/api/actions/" + action_id)
        self.assertEqual(patches[0]["body"]["containment_ref"], ref)
        self.assertEqual(patches[0]["body"]["containment_status"], "awaiting_promotion")

        # The ordinary outcome PATCH still fires alongside the containment one.
        outcome_patches = [
            r for r in self.log.get_all()
            if r["method"] == "PATCH" and r["path"] == "/api/actions/" + action_id
            and "status" in r["body"]
        ]
        self.assertEqual(len(outcome_patches), 1)
        self.assertEqual(outcome_patches[0]["body"]["status"], "completed")

    def test_diff_over_cap_is_truncated(self):
        tool_use_id = "post-cont-tu-002"
        action_id = "act-cont-002"
        ref = "dashclaw/contained-sess-002"
        worktree = _make_worktree_with_staged_change(marker_line="X" * 500)
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree)
        self.addCleanup(_cleanup_temp_action, tool_use_id)

        cap = 40
        code, _, err = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "wrote file"},
            },
            self._env(DASHCLAW_CONTAINMENT_DIFF_CAP_BYTES=str(cap)),
        )
        self.assertEqual(code, 0, msg=err)

        artifacts = self._artifact_posts()
        self.assertEqual(len(artifacts), 1)
        content = artifacts[0]["body"]["content_json"]
        self.assertTrue(content["truncated"])
        self.assertLessEqual(len(content["diff"].encode("utf-8")), cap)

    # -----------------------------------------------------------------------
    # Non-contained action: zero artifact calls (regression proof)
    # -----------------------------------------------------------------------

    def test_non_contained_action_posts_no_artifact(self):
        tool_use_id = "post-cont-tu-003"
        action_id = "act-cont-003"
        _write_plain_action(tool_use_id, action_id)
        self.addCleanup(_cleanup_temp_action, tool_use_id)

        code, _, err = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "ordinary tool output"},
            },
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        self.assertEqual(self._artifact_posts(), [])
        self.assertEqual(self._containment_patches(), [])


if __name__ == "__main__":
    unittest.main()
