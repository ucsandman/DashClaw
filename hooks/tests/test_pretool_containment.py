"""Integration tests for Containment Verdicts (allow_contained) in
dashclaw_pretool.py — capability advertisement + handle_allow_contained.

Follows the mock-HTTP-server + subprocess pattern from
test_pretool_integration.py. Each test that needs a real git repo creates one
in a fresh temp directory (via `git init` + an initial commit) so
`git worktree add` has a HEAD to branch from; tests are torn down by removing
the whole temp directory (which contains the worktree, since it lives at
<repo>/.dashclaw/contained/<seg>).

Uses only the Python standard library.
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
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")


# ---------------------------------------------------------------------------
# Mock HTTP server (guard + actions)
# ---------------------------------------------------------------------------

class _RequestLog:
    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self.guard_response: dict = {"decision": "allow"}

    def add(self, method, path, body):
        bare, _, query = path.partition("?")
        with self._lock:
            self.requests.append({"method": method, "path": bare, "query": query, "body": body})

    def get_all(self):
        with self._lock:
            return list(self.requests)

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log: _RequestLog):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            log.add("POST", self.path, body)

            if self.path.partition("?")[0] == "/api/guard":
                resp = json.dumps(log.guard_response).encode()
            elif self.path == "/api/actions":
                resp = json.dumps({"action_id": "test-action-fallback"}).encode()
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def do_GET(self):
            log.add("GET", self.path, None)
            resp = json.dumps({"status": "running"}).encode()
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


def _run_hook(stdin_data, env_overrides=None, timeout=15):
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


def _git(args, cwd, check=True):
    proc = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise AssertionError("git %s failed: %s" % (args, proc.stderr))
    return proc


def _make_repo():
    """Create a fresh temp git repo with one commit. Returns the repo dir."""
    repo_dir = tempfile.mkdtemp(prefix="dashclaw-containment-test-")
    _git(["init"], cwd=repo_dir)
    _git(["config", "user.email", "test@dashclaw.local"], cwd=repo_dir)
    _git(["config", "user.name", "DashClaw Test"], cwd=repo_dir)
    readme = os.path.join(repo_dir, "README.md")
    with open(readme, "w", encoding="utf-8") as f:
        f.write("test repo\n")
    _git(["add", "README.md"], cwd=repo_dir)
    _git(["commit", "-m", "init"], cwd=repo_dir)
    return repo_dir


def _worktree_list(repo_dir):
    return _git(["worktree", "list", "--porcelain"], cwd=repo_dir).stdout


def _cleanup_tempstate(*paths):
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


class TestPretoolContainment(unittest.TestCase):
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
        self._repos = []
        self._tool_use_ids = []

    def tearDown(self):
        for repo in self._repos:
            shutil.rmtree(repo, ignore_errors=True)
        for tool_use_id in self._tool_use_ids:
            _cleanup_tempstate(os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id))

    def _new_repo(self):
        repo = _make_repo()
        self._repos.append(repo)
        return repo

    def _env(self, workspace, **extra):
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": "test-agent",
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": workspace,
            "DASHCLAW_PERMISSION_MODE": "danger",
        }
        env.update(extra)
        return env

    def _action_state_path(self, tool_use_id):
        self._tool_use_ids.append(tool_use_id)
        return os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)

    # -----------------------------------------------------------------------
    # 1. Worktree created + exclude line + instructive deny (Write, rewrite off)
    # -----------------------------------------------------------------------

    def test_worktree_created_exclude_line_instructive_deny(self):
        repo = self._new_repo()
        session_id = "sess-" + uuid.uuid4().hex[:8]
        tool_use_id = "tu-1-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)

        self.log.guard_response = {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": "act-contained-1",
            "containment": {"status": "contained", "basis": "file"},
        }

        code, stdout, stderr = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": os.path.join(repo, "foo.txt"), "content": "hello"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._env(repo, DASHCLAW_CONTAINMENT_REWRITE="0"),
        )

        self.assertEqual(code, 2, "instructive deny exits 2; stderr=%s" % stderr)
        self.assertIn("containment ref", stderr)

        expected_worktree = os.path.join(repo, ".dashclaw", "contained", session_id)
        self.assertIn(expected_worktree, stderr)
        self.assertTrue(os.path.isdir(expected_worktree), "worktree directory should exist on disk")

        wt_list = _worktree_list(repo)
        self.assertIn(expected_worktree.replace("\\", "/"), wt_list.replace("\\", "/"))
        self.assertIn("dashclaw/contained-" + session_id, wt_list)

        exclude_path = os.path.join(repo, ".git", "info", "exclude")
        self.assertTrue(os.path.isfile(exclude_path))
        with open(exclude_path, encoding="utf-8") as f:
            exclude_content = f.read()
        self.assertIn(".dashclaw/", exclude_content)

        # .gitignore must never be touched.
        self.assertFalse(os.path.exists(os.path.join(repo, ".gitignore")))

        # PostToolUse state (Task 10 consumes this): action_id + containment_ref.
        with open(self._action_state_path(tool_use_id), encoding="utf-8") as f:
            state = json.loads(f.read())
        self.assertEqual(state["action_id"], "act-contained-1")
        self.assertEqual(state["containment_ref"], "dashclaw/contained-" + session_id)
        self.assertEqual(state["containment_worktree"], expected_worktree)

    # -----------------------------------------------------------------------
    # 2. Second contained call, same session -> worktree reused
    # -----------------------------------------------------------------------

    def test_second_contained_call_reuses_worktree(self):
        repo = self._new_repo()
        session_id = "sess-" + uuid.uuid4().hex[:8]

        self.log.guard_response = {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": "act-contained-2a",
            "containment": {"status": "contained", "basis": "file"},
        }

        tool_use_id_1 = "tu-2a-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id_1)
        code1, _, stderr1 = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": os.path.join(repo, "one.txt"), "content": "one"},
                "tool_use_id": tool_use_id_1,
                "session_id": session_id,
            },
            self._env(repo, DASHCLAW_CONTAINMENT_REWRITE="0"),
        )
        self.assertEqual(code1, 2)

        wt_list_after_first = _worktree_list(repo)
        # Exactly one contained worktree line beyond the main repo worktree.
        self.assertEqual(wt_list_after_first.count("worktree "), 2)

        self.log.guard_response = {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": "act-contained-2b",
            "containment": {"status": "contained", "basis": "file"},
        }
        tool_use_id_2 = "tu-2b-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id_2)
        code2, _, stderr2 = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": os.path.join(repo, "two.txt"), "content": "two"},
                "tool_use_id": tool_use_id_2,
                "session_id": session_id,
            },
            self._env(repo, DASHCLAW_CONTAINMENT_REWRITE="0"),
        )
        self.assertEqual(code2, 2)

        expected_worktree = os.path.join(repo, ".dashclaw", "contained", session_id)
        self.assertIn(expected_worktree, stderr1)
        self.assertIn(expected_worktree, stderr2, "second call must reuse the SAME worktree path")

        # No second `git worktree add` happened: still exactly one contained worktree.
        wt_list_after_second = _worktree_list(repo)
        self.assertEqual(wt_list_after_second.count("worktree "), 2)
        self.assertEqual(wt_list_after_first, wt_list_after_second)

    # -----------------------------------------------------------------------
    # 3. Not a git repo -> fail toward interruption, no worktree
    # -----------------------------------------------------------------------

    def test_not_a_git_repo_fails_toward_interruption(self):
        plain_dir = tempfile.mkdtemp(prefix="dashclaw-containment-nongit-")
        self._repos.append(plain_dir)
        session_id = "sess-" + uuid.uuid4().hex[:8]
        tool_use_id = "tu-3-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)

        self.log.guard_response = {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": "act-contained-3",
            "containment": {"status": "contained", "basis": "shell_file_ops"},
        }

        code, _, stderr = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi > out.txt"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._env(plain_dir),
        )

        self.assertEqual(code, 2)
        lowered = stderr.lower()
        self.assertTrue("interrupt" in lowered or "fail" in lowered, stderr)
        self.assertFalse(os.path.isdir(os.path.join(plain_dir, ".dashclaw")))

    # -----------------------------------------------------------------------
    # 4. Capability advertisement gating matrix
    # -----------------------------------------------------------------------

    def test_capability_advertised_when_enforce_git_repo_containable_tool(self):
        repo = self._new_repo()
        tool_use_id = "tu-4a-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": "sess-4a",
            },
            self._env(repo),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][-1]["body"]
        self.assertEqual(body.get("client_capabilities"), ["allow_contained"])

    def test_capability_absent_when_containment_disabled(self):
        repo = self._new_repo()
        tool_use_id = "tu-4b-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": "sess-4b",
            },
            self._env(repo, DASHCLAW_CONTAINMENT="0"),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][-1]["body"]
        self.assertNotIn("client_capabilities", body)

    def test_capability_absent_in_observe_mode(self):
        repo = self._new_repo()
        tool_use_id = "tu-4c-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": "sess-4c",
            },
            self._env(repo, DASHCLAW_HOOK_MODE="observe"),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][-1]["body"]
        self.assertNotIn("client_capabilities", body)

    def test_capability_absent_when_not_git_repo(self):
        plain_dir = tempfile.mkdtemp(prefix="dashclaw-containment-nongit2-")
        self._repos.append(plain_dir)
        tool_use_id = "tu-4d-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)
        code, _, _ = _run_hook(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "echo hi"},
                "tool_use_id": tool_use_id,
                "session_id": "sess-4d",
            },
            self._env(plain_dir),
        )
        self.assertEqual(code, 0)
        body = [r for r in self.log.get_all() if r["path"] == "/api/guard"][-1]["body"]
        self.assertNotIn("client_capabilities", body)

    # -----------------------------------------------------------------------
    # 5. Rewrite path: updatedInput hookSpecificOutput, exit 0
    # -----------------------------------------------------------------------

    def test_rewrite_emits_hook_specific_output_and_exits_zero(self):
        repo = self._new_repo()
        session_id = "sess-" + uuid.uuid4().hex[:8]
        tool_use_id = "tu-5-" + uuid.uuid4().hex[:8]
        self._action_state_path(tool_use_id)

        self.log.guard_response = {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": "act-contained-5",
            "containment": {"status": "contained", "basis": "file"},
        }

        target = os.path.join(repo, "sub", "bar.txt")
        code, stdout, stderr = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": target, "content": "hi there"},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._env(repo, DASHCLAW_CONTAINMENT_REWRITE="1"),
        )

        self.assertEqual(code, 0, "rewrite path must exit 0; stderr=%s" % stderr)
        payload = json.loads(stdout)
        out = payload["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "PreToolUse")
        self.assertEqual(out["permissionDecision"], "allow")
        self.assertIn("permissionDecisionReason", out)

        expected_worktree = os.path.join(repo, ".dashclaw", "contained", session_id)
        expected_path = os.path.join(expected_worktree, "sub", "bar.txt")
        updated = out["updatedInput"]
        self.assertEqual(updated["file_path"], expected_path)
        # All original fields preserved (complete replacement object).
        self.assertEqual(updated["content"], "hi there")

        self.assertTrue(os.path.isdir(expected_worktree))


if __name__ == "__main__":
    unittest.main()
