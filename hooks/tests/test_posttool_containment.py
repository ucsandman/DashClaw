"""Tests for the PostToolUse hook's containment diff artifact (Task 10).

When PreToolUse (Task 9) redirects a contained mutation into a per-session
git worktree, its state file carries a non-None containment_ref. PostToolUse
must then: compute the worktree's staged diff, upload it as a `patch`
artifact (POST /api/artifacts), and PATCH the action with its containment_ref
(the server only accepts containment_ref together with
containment_status='awaiting_promotion' -- see app/api/actions/[actionId]/route.ts).

Mirrors the subprocess + mock-HTTP-server harness of test_posttool_integration.py.
"""

import hashlib
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

def _instance_suffix(base_url, agent_id="claude-code"):
    # Mirrors dashclaw_posttool.py's _INSTANCE_STATE_SUFFIX: sha256(BASE_URL +
    # "|" + AGENT_ID)[:12]. Tests never set DASHCLAW_AGENT_ID, so posttool.py
    # resolves it to the "claude-code" default unless a test overrides it.
    return hashlib.sha256((base_url + "|" + agent_id).encode("utf-8")).hexdigest()[:12]


def _action_state_path(tool_use_id, base_url, agent_id="claude-code"):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_last_action_" + _instance_suffix(base_url, agent_id) + "_" + tool_use_id,
    )


def _write_plain_action(tool_use_id, action_id, base_url, agent_id="claude-code"):
    """Mimic the ordinary (non-contained) pretool write: a bare action_id."""
    with open(_action_state_path(tool_use_id, base_url, agent_id), "w", encoding="utf-8") as f:
        f.write(action_id)


def _write_contained_action(tool_use_id, action_id, ref, worktree, base_url, agent_id="claude-code", base_sha=None):
    """Mimic Task 9's _write_containment_action_state JSON shape."""
    payload = {
        "action_id": action_id,
        "containment_ref": ref,
        "containment_worktree": worktree,
        "containment_base_sha": base_sha,
    }
    with open(_action_state_path(tool_use_id, base_url, agent_id), "w", encoding="utf-8") as f:
        f.write(json.dumps(payload))


def _cleanup_temp_action(tool_use_id, base_url, agent_id="claude-code"):
    try:
        os.remove(_action_state_path(tool_use_id, base_url, agent_id))
    except FileNotFoundError:
        pass


def _contained_turn_path(session_id, base_url, agent_id="claude-code"):
    # Mirrors dashclaw_agent_intel.stop_state.contained_turn_path, which
    # _append_contained_turn_action calls directly (test_stop_containment.py
    # has the identical helper for the Stop-hook side of this same file).
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_contained_turn_" + _instance_suffix(base_url, agent_id) + "_" + session_id,
    )


def _read_contained_turn_actions(session_id, base_url, agent_id="claude-code"):
    try:
        with open(_contained_turn_path(session_id, base_url, agent_id), "r", encoding="utf-8") as f:
            return [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        return []


def _safe_remove_path(path):
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


def _git_output(args, cwd):
    proc = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, check=True, text=True)
    return proc.stdout.strip()


def _make_worktree_with_staged_change(marker_line="CONTAINED_CHANGE_MARKER", commit_first=True):
    """Create a temp repo with an initial commit, then an uncommitted change
    (staged when commit_first, since F1 always runs `git add -A` before the
    diff regardless). Returns (tmpdir, base_sha) -- base_sha is the initial
    commit, matching what dashclaw_pretool.py records at worktree creation."""
    tmpdir = tempfile.mkdtemp(prefix="dashclaw_test_containment_")
    _run_git(["init"], tmpdir)
    _run_git(["config", "user.email", "test@dashclaw.test"], tmpdir)
    _run_git(["config", "user.name", "DashClaw Test"], tmpdir)
    file_path = os.path.join(tmpdir, "hello.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("original content\n")
    _run_git(["add", "."], tmpdir)
    _run_git(["commit", "-m", "init"], tmpdir)
    base_sha = _git_output(["rev-parse", "HEAD"], tmpdir)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write("original content\n" + marker_line + "\n")
    if commit_first:
        _run_git(["add", "."], tmpdir)
    return tmpdir, base_sha


def _make_worktree_with_new_file(name="notes.md", content="containment e2e proof\n"):
    """Create a temp repo with an initial commit and a brand-new UNTRACKED
    file (never staged) -- the exact e2e-proof shape (Write creating a file
    that doesn't exist yet). Returns (tmpdir, base_sha)."""
    tmpdir = tempfile.mkdtemp(prefix="dashclaw_test_containment_newfile_")
    _run_git(["init"], tmpdir)
    _run_git(["config", "user.email", "test@dashclaw.test"], tmpdir)
    _run_git(["config", "user.name", "DashClaw Test"], tmpdir)
    readme = os.path.join(tmpdir, "README.md")
    with open(readme, "w", encoding="utf-8") as f:
        f.write("repo\n")
    _run_git(["add", "."], tmpdir)
    _run_git(["commit", "-m", "init"], tmpdir)
    base_sha = _git_output(["rev-parse", "HEAD"], tmpdir)

    with open(os.path.join(tmpdir, name), "w", encoding="utf-8") as f:
        f.write(content)
    return tmpdir, base_sha


def _git_log_count(cwd):
    return len(_git_output(["log", "--format=%H"], cwd).splitlines())


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
        worktree, base_sha = _make_worktree_with_staged_change()
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

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

        # F1: the mutation must actually be committed onto the containment
        # branch, or `git merge --no-ff <ref>` at promotion time has nothing
        # to merge (the 2026-07-27 e2e proof's "Already up to date." finding).
        self.assertEqual(_git_log_count(worktree), 2, "init commit + one contained commit")

        # The ordinary outcome PATCH still fires alongside the containment one.
        outcome_patches = [
            r for r in self.log.get_all()
            if r["method"] == "PATCH" and r["path"] == "/api/actions/" + action_id
            and "status" in r["body"]
        ]
        self.assertEqual(len(outcome_patches), 1)
        self.assertEqual(outcome_patches[0]["body"]["status"], "completed")

    def test_new_untracked_file_gets_a_real_diff_hunk_and_a_commit(self):
        """F1's core regression proof: the e2e-proof shape exactly -- a brand
        new (never `git add`ed) file. Before F1 this produced an empty
        `content.diff` with only an `untracked` list and zero commits on the
        containment branch; after F1 it must produce a proper `+++ b/...`
        diff hunk, an empty (or absent) untracked list, and a real commit."""
        tool_use_id = "post-cont-tu-005"
        action_id = "act-cont-005"
        ref = "dashclaw/contained-sess-005"
        worktree, base_sha = _make_worktree_with_new_file()
        self.addCleanup(_rm_worktree, worktree)
        self.assertEqual(_git_log_count(worktree), 1, "only the init commit before PostToolUse runs")
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, err = _run_hook(
            {"tool_use_id": tool_use_id, "tool_response": {"output": "wrote file"}},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        artifacts = self._artifact_posts()
        self.assertEqual(len(artifacts), 1)
        content = artifacts[0]["body"]["content_json"]
        self.assertIn("+++ b/notes.md", content["diff"], "must be a real diff hunk, not an empty diff")
        self.assertIn("containment e2e proof", content["diff"])
        self.assertNotIn("untracked", content, "git add -A should have staged+committed the new file")

        self.assertEqual(_git_log_count(worktree), 2, "the new file must be committed onto the containment branch")

    def test_second_mutation_same_session_cumulative_diff_spans_base_to_head(self):
        """A second contained mutation in the same session produces a SECOND
        commit, and the artifact diff still spans the fixed base_sha..HEAD
        range -- both files show up, not just the latest one."""
        tool_use_id_1 = "post-cont-tu-006a"
        action_id_1 = "act-cont-006a"
        ref = "dashclaw/contained-sess-006"
        worktree, base_sha = _make_worktree_with_new_file(name="one.txt", content="first file\n")
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id_1, action_id_1, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id_1, self.base_url)
        code1, _, err1 = _run_hook(
            {"tool_use_id": tool_use_id_1, "tool_response": {"output": "wrote one.txt"}},
            self._env(),
        )
        self.assertEqual(code1, 0, msg=err1)
        self.assertEqual(_git_log_count(worktree), 2)

        # Second mutation: another new file, same worktree/branch, same base_sha.
        with open(os.path.join(worktree, "two.txt"), "w", encoding="utf-8") as f:
            f.write("second file\n")
        tool_use_id_2 = "post-cont-tu-006b"
        action_id_2 = "act-cont-006b"
        _write_contained_action(tool_use_id_2, action_id_2, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id_2, self.base_url)
        code2, _, err2 = _run_hook(
            {"tool_use_id": tool_use_id_2, "tool_response": {"output": "wrote two.txt"}},
            self._env(),
        )
        self.assertEqual(code2, 0, msg=err2)
        self.assertEqual(_git_log_count(worktree), 3, "init + two contained commits")

        artifacts = self._artifact_posts()
        self.assertEqual(len(artifacts), 2)
        second_diff = artifacts[1]["body"]["content_json"]["diff"]
        # Cumulative base..HEAD: BOTH files appear in the second artifact's diff.
        self.assertIn("+++ b/one.txt", second_diff)
        self.assertIn("+++ b/two.txt", second_diff)

    def test_rerun_with_nothing_new_to_commit_still_posts(self):
        """Idempotent rerun (e.g. the Stop hook's awaiting-promotion sweep, or
        a duplicated PostToolUse invocation): once the mutation is already
        committed, a second call finds "nothing to commit" -- not a failure --
        and still posts the (unchanged, still non-empty) cumulative diff."""
        tool_use_id = "post-cont-tu-007"
        action_id = "act-cont-007"
        ref = "dashclaw/contained-sess-007"
        worktree, base_sha = _make_worktree_with_new_file()
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code1, _, err1 = _run_hook(
            {"tool_use_id": tool_use_id, "tool_response": {"output": "wrote file"}},
            self._env(),
        )
        self.assertEqual(code1, 0, msg=err1)
        self.assertEqual(len(self._artifact_posts()), 1)
        self.assertEqual(_git_log_count(worktree), 2)

        # Rewrite the same state file (PostToolUse cleans it up after each
        # run) and invoke again with nothing new in the worktree.
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=base_sha)
        code2, _, err2 = _run_hook(
            {"tool_use_id": tool_use_id, "tool_response": {"output": "wrote file"}},
            self._env(),
        )
        self.assertEqual(code2, 0, msg=err2)

        # Honest behavior: "nothing to commit" is not a failure, so the
        # second run still posts an artifact (same cumulative diff) instead
        # of silently skipping.
        self.assertEqual(len(self._artifact_posts()), 2, "idempotent rerun still posts")
        self.assertEqual(_git_log_count(worktree), 2, "no new commit was created")
        self.assertIn("containment e2e proof", self._artifact_posts()[1]["body"]["content_json"]["diff"])

    def test_missing_base_sha_falls_back_and_notes_it(self):
        """Older containment session state (written before F1) has no
        base_sha. The hook must still commit the mutation (unconditional) but
        fall back to `git diff HEAD` for the diff computation and flag the
        fallback in the artifact content instead of silently returning an
        empty diff with no explanation."""
        tool_use_id = "post-cont-tu-008"
        action_id = "act-cont-008"
        ref = "dashclaw/contained-sess-008"
        worktree, _base_sha = _make_worktree_with_new_file()
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=None)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, err = _run_hook(
            {"tool_use_id": tool_use_id, "tool_response": {"output": "wrote file"}},
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        artifacts = self._artifact_posts()
        self.assertEqual(len(artifacts), 1)
        content = artifacts[0]["body"]["content_json"]
        self.assertIn("note", content)
        self.assertIn("base_sha unavailable", content["note"])
        # The commit still happened even though base_sha was missing.
        self.assertEqual(_git_log_count(worktree), 2)

    def test_diff_over_cap_is_truncated(self):
        tool_use_id = "post-cont-tu-002"
        action_id = "act-cont-002"
        ref = "dashclaw/contained-sess-002"
        worktree, base_sha = _make_worktree_with_staged_change(marker_line="X" * 500)
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

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
    # Git failure (not a legitimately empty diff): skip artifact + flip
    # -----------------------------------------------------------------------

    def test_git_diff_failure_skips_artifact_and_flip(self):
        """When the diff subprocess itself fails (bad worktree path here --
        same effect as git being unreachable or timing out), the hook must
        not upload an artifact or flip the action, since no diff was ever
        actually captured for operator review."""
        tool_use_id = "post-cont-tu-004"
        action_id = "act-cont-004"
        ref = "dashclaw/contained-sess-004"
        nonexistent_worktree = os.path.join(tempfile.gettempdir(), "dashclaw_test_no_such_worktree_xyz")
        _write_contained_action(tool_use_id, action_id, ref, nonexistent_worktree, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

        code, _, err = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "tool_response": {"output": "wrote file"},
            },
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        self.assertEqual(self._artifact_posts(), [])
        self.assertEqual(self._containment_patches(), [])

    # -----------------------------------------------------------------------
    # IMPORTANT 3 (final fix wave, 2026-07-27): the turn-action log that
    # feeds the Stop hook's awaiting-promotion backstop sweep must only be
    # written when capture actually succeeded -- otherwise the backstop
    # itself flips a capture-failed action to awaiting_promotion with no
    # diff artifact behind it (a promotable card that merges nothing).
    # -----------------------------------------------------------------------

    def test_forced_commit_failure_leaves_no_turn_action_entry(self):
        """A bad worktree path fails _git_add_and_commit (the same fixture
        test_git_diff_failure_skips_artifact_and_flip uses). The Stop hook's
        awaiting-promotion sweep reads the turn-action log for this session
        -- it must find nothing, or it would flip this action anyway."""
        tool_use_id = "post-cont-tu-007"
        action_id = "act-cont-007"
        ref = "dashclaw/contained-sess-007"
        session_id = "sess-cont-007"
        nonexistent_worktree = os.path.join(tempfile.gettempdir(), "dashclaw_test_no_such_worktree_007")
        _write_contained_action(tool_use_id, action_id, ref, nonexistent_worktree, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)
        self.addCleanup(_safe_remove_path, _contained_turn_path(session_id, self.base_url))

        code, _, err = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "session_id": session_id,
                "tool_response": {"output": "wrote file"},
            },
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        self.assertEqual(self._artifact_posts(), [])
        self.assertEqual(
            _read_contained_turn_actions(session_id, self.base_url), [],
            "a failed commit must never feed the Stop-hook awaiting-promotion backstop",
        )

    def test_successful_capture_appends_the_turn_action_entry(self):
        """The success path (existing behavior) still appends -- this is the
        control proving the assertion above is discriminating, not vacuous."""
        tool_use_id = "post-cont-tu-008"
        action_id = "act-cont-008"
        ref = "dashclaw/contained-sess-008"
        session_id = "sess-cont-008"
        worktree, base_sha = _make_worktree_with_staged_change()
        self.addCleanup(_rm_worktree, worktree)
        _write_contained_action(tool_use_id, action_id, ref, worktree, self.base_url, base_sha=base_sha)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)
        self.addCleanup(_safe_remove_path, _contained_turn_path(session_id, self.base_url))

        code, _, err = _run_hook(
            {
                "tool_use_id": tool_use_id,
                "session_id": session_id,
                "tool_response": {"output": "wrote file"},
            },
            self._env(),
        )
        self.assertEqual(code, 0, msg=err)

        entries = _read_contained_turn_actions(session_id, self.base_url)
        self.assertEqual(entries, [action_id + "\t" + ref])

    # -----------------------------------------------------------------------
    # Non-contained action: zero artifact calls (regression proof)
    # -----------------------------------------------------------------------

    def test_non_contained_action_posts_no_artifact(self):
        tool_use_id = "post-cont-tu-003"
        action_id = "act-cont-003"
        _write_plain_action(tool_use_id, action_id, self.base_url)
        self.addCleanup(_cleanup_temp_action, tool_use_id, self.base_url)

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
