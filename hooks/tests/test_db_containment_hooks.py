"""Integration tests for the db_branch containment basis in the PreToolUse and
PostToolUse hooks (RFC 2026-09-04): capability advertisement, the Neon-branch
redirect, and the evidence artifact.

Follows the mock-HTTP-server + subprocess pattern of test_pretool_containment.py
and test_posttool_containment.py. The SAME mock server stands in for both
DashClaw (`/api/*`) and the Neon control plane (`/neon/*`, reached via
DASHCLAW_NEON_API_BASE) — no test here opens a socket to anything real, and
every inherited DATABASE_URL / NEON_* / PGHOST is stripped from the subprocess
environment so a developer's own Neon setup can never change the result.

Uses only the Python standard library.
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
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")
_POSTTOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_posttool.py")

_PROD_HOST = "ep-cool-frost-12345.us-east-2.aws.neon.tech"
_BRANCH_HOST = "ep-quiet-leaf-98765.us-east-2.aws.neon.tech"
_PROD_URL = "postgresql://neondb_owner:npg_s3cret@" + _PROD_HOST + "/neondb?sslmode=require"
_AGENT_ID = "test-agent"

# Env keys that would otherwise leak in from the developer's shell and change
# what the hook resolves.
_LEAKY_ENV_KEYS = ("DATABASE_URL", "PGHOST", "PGDATABASE", "NEON_API_KEY", "NEON_PROJECT_ID")


# ---------------------------------------------------------------------------
# Mock HTTP server: DashClaw under /api/*, Neon under /neon/*
# ---------------------------------------------------------------------------

class _RequestLog:
    def __init__(self):
        self.requests = []
        self._lock = threading.Lock()
        self.guard_response = {"decision": "allow"}
        self.schema_diff = "ALTER TABLE users ADD COLUMN nickname text;"
        self.compare_schema_status = 200

    def add(self, method, path, body):
        bare, _, query = path.partition("?")
        with self._lock:
            self.requests.append({"method": method, "path": bare, "query": query, "body": body})

    def get_all(self):
        with self._lock:
            return list(self.requests)

    def find(self, method, path):
        return [r for r in self.get_all() if r["method"] == method and r["path"] == path]

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, payload, status=200):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _body(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            return json.loads(raw) if raw else None

        def do_POST(self):
            body = self._body()
            log.add("POST", self.path, body)
            bare = self.path.partition("?")[0]
            if bare == "/api/guard":
                self._send(log.guard_response)
            elif bare == "/api/actions":
                self._send({"action_id": "test-action-fallback"})
            elif bare == "/api/artifacts":
                self._send({"artifact_id": "art-1"})
            elif bare.startswith("/neon/projects/") and bare.endswith("/branches"):
                self._send({
                    "branch": {"id": "br-child"},
                    "endpoints": [{"host": _BRANCH_HOST, "type": "read_write"}],
                })
            else:
                self._send({}, status=404)

        def do_PATCH(self):
            body = self._body()
            log.add("PATCH", self.path, body)
            self._send({"ok": True})

        def do_GET(self):
            log.add("GET", self.path, None)
            bare = self.path.partition("?")[0]
            if bare == "/neon/projects":
                self._send({"projects": [{"id": "proj-1"}]})
            elif bare == "/neon/projects/proj-1/endpoints/ep-cool-frost-12345":
                self._send({"endpoint": {"id": "ep-cool-frost-12345", "branch_id": "br-parent"}})
            elif bare.endswith("/compare_schema"):
                if log.compare_schema_status != 200:
                    self._send({"error": "unavailable"}, status=log.compare_schema_status)
                else:
                    self._send({"diff": log.schema_diff})
            elif bare.startswith("/neon/"):
                self._send({}, status=404)
            else:
                self._send({"status": "running"})

        def log_message(self, fmt, *args):
            pass

    return Handler


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _run_hook(script, stdin_data, env_overrides=None, timeout=20):
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    for key in _LEAKY_ENV_KEYS:
        env.pop(key, None)
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)
    proc = subprocess.run(
        [sys.executable, script],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return (proc.returncode,
            proc.stdout.decode("utf-8", errors="replace"),
            proc.stderr.decode("utf-8", errors="replace"))


def _instance_suffix(base_url, agent_id=_AGENT_ID):
    return hashlib.sha256((base_url + "|" + agent_id).encode("utf-8")).hexdigest()[:12]


class TestDbContainmentHooks(unittest.TestCase):
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
        self.log.guard_response = {"decision": "allow"}
        self.log.compare_schema_status = 200
        # A NON-git temp workspace: database containment must work outside a
        # repo (the file basis needs a worktree; this one does not).
        self.workspace = tempfile.mkdtemp(prefix="dashclaw-dbcontainment-")
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def _env(self, **extra):
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": _AGENT_ID,
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": self.workspace,
            "DASHCLAW_PERMISSION_MODE": "danger",
            "DASHCLAW_NEON_API_BASE": self.base_url + "/neon",
            "NEON_API_KEY": "neon-test-key",
            "NEON_PROJECT_ID": "proj-1",
            "DATABASE_URL": _PROD_URL,
        }
        env.update(extra)
        return env

    def _track_paths(self, *paths):
        for path in paths:
            self.addCleanup(lambda p=path: os.path.exists(p) and os.remove(p))

    def _action_state_path(self, tool_use_id):
        path = os.path.join(
            tempfile.gettempdir(),
            "dashclaw_last_action_" + _instance_suffix(self.base_url) + "_" + tool_use_id,
        )
        self._track_paths(path)
        return path

    def _db_session_state_path(self, session_id):
        path = os.path.join(
            tempfile.gettempdir(),
            "dashclaw_db_containment_session_" + _instance_suffix(self.base_url) + "_" + session_id + ".json",
        )
        self._track_paths(path)
        return path

    def _contained_turn_path(self, session_id):
        path = os.path.join(
            tempfile.gettempdir(),
            "dashclaw_contained_turn_" + _instance_suffix(self.base_url) + "_" + session_id,
        )
        self._track_paths(path)
        return path

    def _guard_capabilities(self):
        guards = self.log.find("POST", "/api/guard")
        self.assertTrue(guards, "the hook must have called the guard")
        return (guards[-1]["body"] or {}).get("client_capabilities")

    def _run_pretool_bash(self, command, env_overrides=None, session_id=None, tool_use_id=None):
        session_id = session_id or ("sess-" + uuid.uuid4().hex[:8])
        tool_use_id = tool_use_id or ("tu-" + uuid.uuid4().hex[:8])
        self._action_state_path(tool_use_id)
        self._db_session_state_path(session_id)
        code, stdout, stderr = _run_hook(
            _PRETOOL_SCRIPT,
            {
                "tool_name": "Bash",
                "tool_input": {"command": command},
                "tool_use_id": tool_use_id,
                "session_id": session_id,
            },
            self._env(**(env_overrides or {})),
        )
        return code, stdout, stderr, session_id, tool_use_id

    # -----------------------------------------------------------------------
    # Capability advertisement
    # -----------------------------------------------------------------------

    def test_db_capability_advertised_for_a_neon_targeting_bash_call(self):
        self._run_pretool_bash('psql -c "insert into t values (1)"')
        capabilities = self._guard_capabilities()
        self.assertIn("allow_contained:db", capabilities)
        # The workspace is not a git repo, so the FILE capability is correctly
        # absent — the two gates are independent.
        self.assertNotIn("allow_contained", capabilities)

    def test_no_neon_api_key_means_no_db_capability(self):
        self._run_pretool_bash('psql -c "select 1"', {"NEON_API_KEY": ""})
        self.assertIsNone(self._guard_capabilities(),
                          "without a Neon key the hook advertises nothing and the "
                          "verdict lands as require_approval, today's behavior")

    def test_db_kill_switch_removes_the_capability(self):
        self._run_pretool_bash('psql -c "select 1"', {"DASHCLAW_DB_CONTAINMENT": "0"})
        self.assertIsNone(self._guard_capabilities())

    def test_non_database_command_never_advertises_the_db_capability(self):
        self._run_pretool_bash("ls -la")
        self.assertIsNone(self._guard_capabilities())

    def test_inline_connection_string_never_advertises_the_db_capability(self):
        # The ledger's sensitive-data scan redacts a connection string inside
        # the recorded act, and promotion replays that act byte-for-byte — so a
        # literal-carrying command stays on the approval rail even with a Neon
        # key set and a resolvable target.
        self._run_pretool_bash("psql " + _PROD_URL + " -c 'select 1'")
        self.assertIsNone(self._guard_capabilities())

    def test_non_neon_database_url_never_advertises_the_db_capability(self):
        self._run_pretool_bash(
            'psql -c "select 1"',
            {"DATABASE_URL": "postgresql://u:p@db.internal.example.com:5432/app"},
        )
        self.assertIsNone(self._guard_capabilities())

    # -----------------------------------------------------------------------
    # handle_allow_contained, basis db_branch
    # -----------------------------------------------------------------------

    def _db_verdict(self, ref="dashclaw/contained-db-sess-1", action_id="act-db-1"):
        return {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": action_id,
            "containment": {"status": "contained", "basis": "db_branch", "ref": ref},
        }

    def test_db_verdict_rewrites_the_command_and_records_branch_state(self):
        self.log.guard_response = self._db_verdict()
        code, stdout, stderr, session_id, tool_use_id = self._run_pretool_bash(
            'psql -c "insert into t values (1)"'
        )
        self.assertEqual(code, 0, "a rewritten contained command proceeds; stderr=%s" % stderr)

        payload = json.loads(stdout)["hookSpecificOutput"]
        self.assertEqual(payload["permissionDecision"], "allow")
        rewritten = payload["updatedInput"]["command"]
        self.assertTrue(rewritten.startswith("DATABASE_URL='postgresql://neondb_owner:npg_s3cret@"
                                             + _BRANCH_HOST))
        self.assertIn("PGHOST='" + _BRANCH_HOST + "'", rewritten)
        self.assertNotIn(_PROD_HOST, rewritten, "the production host must never survive the rewrite")
        self.assertIn(_BRANCH_HOST, payload["permissionDecisionReason"])

        # Neon: one branch created off the endpoint's branch, with an expiry.
        created = self.log.find("POST", "/neon/projects/proj-1/branches")
        self.assertEqual(len(created), 1)
        branch = created[0]["body"]["branch"]
        self.assertEqual(branch["parent_id"], "br-parent")
        self.assertEqual(branch["name"], "dashclaw-contained-db-sess-1")
        self.assertTrue(branch["expires_at"].endswith("Z"))
        self.assertEqual(created[0]["body"]["endpoints"], [{"type": "read_write"}])

        # PostToolUse state: db fields, and a statement with no live password.
        with open(self._action_state_path(tool_use_id), encoding="utf-8") as f:
            state = json.loads(f.read())
        self.assertEqual(state["action_id"], "act-db-1")
        self.assertEqual(state["containment_ref"], "dashclaw/contained-db-sess-1")
        self.assertIsNone(state["containment_worktree"])
        db_state = state["containment_db"]
        self.assertEqual(db_state["project_id"], "proj-1")
        self.assertEqual(db_state["parent_branch_id"], "br-parent")
        self.assertEqual(db_state["branch_id"], "br-child")
        self.assertEqual(db_state["host"], _BRANCH_HOST)
        self.assertEqual(db_state["db_name"], "neondb")
        self.assertNotIn("npg_s3cret", json.dumps(state))
        self.assertIn("[REDACTED]", db_state["statement"])

        # Session state carries ids and the host — never a connection URL.
        with open(self._db_session_state_path(session_id), encoding="utf-8") as f:
            session_state = f.read()
        self.assertIn("br-child", session_state)
        self.assertNotIn("npg_s3cret", session_state)

    def test_second_db_call_in_the_session_reuses_the_branch(self):
        self.log.guard_response = self._db_verdict()
        session_id = "sess-" + uuid.uuid4().hex[:8]
        self._run_pretool_bash('psql -c "select 1"', session_id=session_id)
        self._run_pretool_bash('psql -c "select 2"', session_id=session_id)
        self.assertEqual(len(self.log.find("POST", "/neon/projects/proj-1/branches")), 1,
                         "one branch per session, created lazily and reused")

    def test_a_second_database_in_the_same_session_fails_toward_interruption(self):
        # A session stages against ONE database. Reusing the first branch for a
        # command aimed at another endpoint would show the operator a diff from
        # database A while Promote replays the statement against database B.
        self.log.guard_response = self._db_verdict()
        session_id = "sess-" + uuid.uuid4().hex[:8]
        code_first, _, _, _, _ = self._run_pretool_bash('psql -c "select 1"', session_id=session_id)
        self.assertEqual(code_first, 0)
        self.assertEqual(len(self.log.find("POST", "/neon/projects/proj-1/branches")), 1)

        other_url = "postgresql://neondb_owner:npg_s3cret@ep-loud-sun-55555.us-east-2.aws.neon.tech/otherdb"
        code, stdout, stderr, _, tool_use_id = self._run_pretool_bash(
            'psql -c "select 2"',
            {"DATABASE_URL": other_url},
            session_id=session_id,
        )
        self.assertEqual(code, 2, "a second database interrupts instead of staging on the wrong branch")
        self.assertIn("ep-cool-frost-12345", stderr)
        self.assertIn("ep-loud-sun-55555", stderr)
        self.assertNotIn("npg_s3cret", stderr, "endpoint ids are named; URLs never are")
        self.assertEqual(stdout, "", "no updatedInput — the command never runs")
        self.assertEqual(len(self.log.find("POST", "/neon/projects/proj-1/branches")), 1,
                         "no second branch is created")
        with open(self._action_state_path(tool_use_id), encoding="utf-8") as f:
            self.assertIsNone(json.loads(f.read())["containment_ref"])

    def test_a_skewed_db_verdict_for_an_inline_connection_string_interrupts(self):
        # Defense in depth: this hook never advertises the db capability for a
        # literal-carrying command, so a conformant server cannot send this.
        # Staging it would produce a card the operator can never promote — the
        # ledger redacts the recorded act and the replay must be byte-exact.
        self.log.guard_response = self._db_verdict()
        code, stdout, stderr, _, _ = self._run_pretool_bash("psql " + _PROD_URL + " -c 'select 1'")
        self.assertEqual(code, 2)
        self.assertIn("inline connection string", stderr)
        self.assertEqual(stdout, "")
        self.assertEqual(self.log.find("POST", "/neon/projects/proj-1/branches"), [])

    def test_rewrite_disabled_falls_back_to_an_instructive_deny(self):
        self.log.guard_response = self._db_verdict()
        code, _, stderr, _, _ = self._run_pretool_bash(
            'psql -c "select 1"', {"DASHCLAW_CONTAINMENT_REWRITE": "0"}
        )
        self.assertEqual(code, 2)
        self.assertIn(_BRANCH_HOST, stderr)
        self.assertNotIn("npg_s3cret", stderr, "a log line never carries the password")

    def test_missing_server_ref_fails_toward_interruption(self):
        # Unlike the worktree's local fallback, there is no safe locally-derived
        # name for a real cloud resource — the branch is never created.
        self.log.guard_response = {
            "decision": "allow_contained",
            "recorded": True,
            "action_id": "act-db-noref",
            "containment": {"status": "contained", "basis": "db_branch"},
        }
        code, _, stderr, _, tool_use_id = self._run_pretool_bash('psql -c "select 1"')
        self.assertEqual(code, 2)
        self.assertIn("containment ref", stderr)
        self.assertEqual(self.log.find("POST", "/neon/projects/proj-1/branches"), [])
        with open(self._action_state_path(tool_use_id), encoding="utf-8") as f:
            state = json.loads(f.read())
        self.assertIsNone(state["containment_ref"])

    def test_unresolvable_target_fails_toward_interruption(self):
        self.log.guard_response = self._db_verdict()
        code, _, stderr, _, _ = self._run_pretool_bash(
            'psql -c "select 1"',
            {"DATABASE_URL": "postgresql://u:p@db.internal.example.com:5432/app"},
        )
        self.assertEqual(code, 2)
        self.assertIn("Neon DATABASE_URL", stderr)

    def test_db_kill_switch_interrupts_a_skewed_db_verdict(self):
        self.log.guard_response = self._db_verdict()
        code, _, stderr, _, _ = self._run_pretool_bash(
            'psql -c "select 1"', {"DASHCLAW_DB_CONTAINMENT": "0"}
        )
        self.assertEqual(code, 2)
        self.assertIn("DASHCLAW_DB_CONTAINMENT=0", stderr)
        self.assertEqual(self.log.find("POST", "/neon/projects/proj-1/branches"), [])

    # -----------------------------------------------------------------------
    # PostToolUse: the evidence artifact
    # -----------------------------------------------------------------------

    def _write_db_action_state(self, tool_use_id, action_id, ref, statement):
        with open(self._action_state_path(tool_use_id), "w", encoding="utf-8") as f:
            f.write(json.dumps({
                "action_id": action_id,
                "containment_ref": ref,
                "containment_worktree": None,
                "containment_base_sha": None,
                "containment_db": {
                    "ref": ref,
                    "project_id": "proj-1",
                    "parent_branch_id": "br-parent",
                    "branch_id": "br-child",
                    "host": _BRANCH_HOST,
                    "db_name": "neondb",
                    "statement": statement,
                },
            }))

    def _run_posttool(self, tool_use_id, session_id, output):
        return _run_hook(
            _POSTTOOL_SCRIPT,
            {
                "tool_name": "Bash",
                "tool_use_id": tool_use_id,
                "session_id": session_id,
                "tool_input": {"command": "psql"},
                "tool_response": {"output": output, "exit_code": 0},
            },
            self._env(),
        )

    def test_db_evidence_artifact_shape_and_flip(self):
        action_id = "act-db-evidence"
        ref = "dashclaw/contained-db-sess-2"
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        session_id = "sess-" + uuid.uuid4().hex[:8]
        self._contained_turn_path(session_id)
        self._write_db_action_state(
            tool_use_id, action_id, ref,
            "DATABASE_URL='postgresql://neondb_owner:[REDACTED]@" + _BRANCH_HOST + "/neondb' psql -c \"insert into t values (1)\"",
        )

        code, _, stderr = self._run_posttool(tool_use_id, session_id, "INSERT 0 1")
        self.assertEqual(code, 0, stderr)

        artifacts = self.log.find("POST", "/api/artifacts")
        self.assertEqual(len(artifacts), 1)
        body = artifacts[0]["body"]
        self.assertEqual(body["artifact_type"], "patch")
        self.assertEqual(body["name"], "containment-diff-" + action_id)
        self.assertEqual(body["source_action_id"], action_id)
        content = body["content_json"]
        self.assertEqual(content["kind"], "db")
        self.assertEqual(content["ref"], ref, "evidence binding: content.ref === containment_ref")
        self.assertEqual(content["diff"], self.log.schema_diff)
        self.assertIn("insert into t values (1)", content["statement"])
        self.assertEqual(content["stdout_tail"], "INSERT 0 1")
        self.assertEqual(content["project_id"], "proj-1")
        self.assertEqual(content["branch_id"], "br-child")
        self.assertEqual(content["parent_branch_id"], "br-parent")
        self.assertEqual(content["db_name"], "neondb")
        self.assertNotIn("note", content, "a non-empty schema diff needs no note")

        # The Neon comparison asked for the right pair of branches.
        compares = [r for r in self.log.get_all() if r["path"].endswith("/compare_schema")]
        self.assertEqual(len(compares), 1)
        self.assertIn("base_branch_id=br-parent", compares[0]["query"])
        self.assertIn("db_name=neondb", compares[0]["query"])

        # Same flip as the file path, and the Stop-hook backstop is armed.
        flips = [r for r in self.log.find("PATCH", "/api/actions/" + action_id)
                 if (r["body"] or {}).get("containment_status") == "awaiting_promotion"]
        self.assertEqual(len(flips), 1)
        self.assertEqual(flips[0]["body"]["containment_ref"], ref)
        self.assertEqual(flips[0]["body"]["agent_id"], _AGENT_ID)
        with open(self._contained_turn_path(session_id), encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), action_id + "\t" + ref)

    def test_empty_schema_diff_gets_the_data_change_note(self):
        self.log.schema_diff = ""
        self.addCleanup(setattr, self.log, "schema_diff",
                        "ALTER TABLE users ADD COLUMN nickname text;")
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        self._write_db_action_state(tool_use_id, "act-db-empty", "dashclaw/contained-db-sess-3", "psql -c 'update t set a=1'")
        self._run_posttool(tool_use_id, "sess-" + uuid.uuid4().hex[:8], "UPDATE 3")
        content = self.log.find("POST", "/api/artifacts")[0]["body"]["content_json"]
        self.assertEqual(content["diff"], "")
        self.assertIn("data changes are not diffable", content["note"])

    def test_unavailable_schema_comparison_still_posts_the_evidence(self):
        self.log.compare_schema_status = 500
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        action_id = "act-db-nocompare"
        self._write_db_action_state(tool_use_id, action_id, "dashclaw/contained-db-sess-4", "psql -c 'update t set a=1'")
        code, _, _ = self._run_posttool(tool_use_id, "sess-" + uuid.uuid4().hex[:8], "UPDATE 3")
        self.assertEqual(code, 0)
        content = self.log.find("POST", "/api/artifacts")[0]["body"]["content_json"]
        self.assertIn("schema comparison unavailable", content["note"])
        self.assertTrue(self.log.find("PATCH", "/api/actions/" + action_id),
                        "the statement and the output are still reviewable evidence")

    def test_output_tail_is_capped_and_scrubbed(self):
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        self._write_db_action_state(tool_use_id, "act-db-tail", "dashclaw/contained-db-sess-5", "psql")
        noisy = ("x" * 5000) + "\nconnected to " + _PROD_URL + "\n"
        self._run_posttool(tool_use_id, "sess-" + uuid.uuid4().hex[:8], noisy)
        content = self.log.find("POST", "/api/artifacts")[0]["body"]["content_json"]
        self.assertLessEqual(len(content["stdout_tail"].encode("utf-8")), 4096)
        self.assertNotIn("npg_s3cret", content["stdout_tail"])
        self.assertIn("neondb_owner:[REDACTED]@" + _PROD_HOST, content["stdout_tail"])

    def test_a_url_straddling_the_tail_cut_is_still_scrubbed(self):
        # The tail slice cuts the FRONT: scrubbing after it would leave a URL
        # whose `postgres://` prefix fell outside the window unredacted.
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        self._write_db_action_state(tool_use_id, "act-db-straddle", "dashclaw/contained-db-sess-6", "psql")
        noisy = ("x" * 100) + " connected to " + _PROD_URL + " ok" + ("z" * 4000)
        self._run_posttool(tool_use_id, "sess-" + uuid.uuid4().hex[:8], noisy)
        tail = self.log.find("POST", "/api/artifacts")[0]["body"]["content_json"]["stdout_tail"]
        self.assertLessEqual(len(tail.encode("utf-8")), 4096)
        self.assertNotIn(_PROD_URL[:20], tail, "the cut really did land inside the URL")
        self.assertNotIn("npg_s3cret", tail)
        self.assertIn("[REDACTED]", tail)

    def test_oversized_schema_diff_is_capped_with_the_marker_inside_the_diff(self):
        self.log.schema_diff = "ALTER TABLE t ADD COLUMN c1 text;" * 40
        self.addCleanup(setattr, self.log, "schema_diff",
                        "ALTER TABLE users ADD COLUMN nickname text;")
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        self._write_db_action_state(tool_use_id, "act-db-bigdiff", "dashclaw/contained-db-sess-7", "psql")
        _run_hook(
            _POSTTOOL_SCRIPT,
            {
                "tool_name": "Bash",
                "tool_use_id": tool_use_id,
                "session_id": "sess-" + uuid.uuid4().hex[:8],
                "tool_input": {"command": "psql"},
                "tool_response": {"output": "ALTER TABLE", "exit_code": 0},
            },
            self._env(DASHCLAW_CONTAINMENT_DIFF_CAP_BYTES="64"),
        )
        diff = self.log.find("POST", "/api/artifacts")[0]["body"]["content_json"]["diff"]
        self.assertIn("-- truncated by DashClaw at 64 bytes --", diff)
        self.assertTrue(diff.startswith("ALTER TABLE t ADD COLUMN"))

    def test_a_worktree_contained_action_still_takes_the_file_path(self):
        # No containment_db in the state -> nothing here may fire; the file path
        # owns it (and fails its own way when the worktree is missing).
        tool_use_id = "tu-" + uuid.uuid4().hex[:8]
        with open(self._action_state_path(tool_use_id), "w", encoding="utf-8") as f:
            f.write(json.dumps({
                "action_id": "act-file-1",
                "containment_ref": "dashclaw/contained-sess-9",
                "containment_worktree": os.path.join(self.workspace, "not-a-worktree"),
                "containment_base_sha": None,
            }))
        code, _, _ = self._run_posttool(tool_use_id, "sess-" + uuid.uuid4().hex[:8], "done")
        self.assertEqual(code, 0)
        self.assertEqual(self.log.find("POST", "/api/artifacts"), [])
        self.assertEqual([r for r in self.log.get_all() if r["path"].endswith("/compare_schema")], [])


if __name__ == "__main__":
    unittest.main()
