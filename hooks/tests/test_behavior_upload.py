"""Tests for the opt-in anonymized behavior-sample upload.

Covers the Stop hook's _maybe_push_samples (DEFAULT OFF: env absent means no
HTTP, no new files) and the behavior_recorder.anonymize_sample_for_upload
allowlist projection (drops goal/project/agent_name/matched_policies/intel,
hashes session_id + paths, adds write_path_groups, masks command operands).

Mirrors the subprocess + mock-HTTP-server harness of test_stop_assumptions.py.
Each hook run gets its OWN child tempdir (TMPDIR/TEMP/TMP overridden) so the
upload throttle marker, the byte-offset file, and the pending-sample sweep
never leak between tests or touch the developer machine's real tempdir.
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
_STOP_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_stop.py")

sys.path.insert(0, _HOOKS_DIR)
from dashclaw_agent_intel import behavior_recorder  # noqa: E402

_INGEST_PATH = "/api/behavior/samples/ingest"


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

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            log.add("POST", self.path, json.loads(raw) if raw else None)
            self._respond({"ok": True})

        def do_PATCH(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            log.add("PATCH", self.path, json.loads(raw) if raw else None)
            self._respond({"ok": True})

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


# ── Fixture samples (deliberately include every field that must be stripped) ──

_RAW_SESSION = "swarm-raw-session-secret-42"


def _fixture_samples():
    base = {
        "schema_version": 1,
        "ts": "2026-06-10T12:00:00+00:00",
        "source": "claude-code",
        "model": "claude-opus-4-8",
        "session_id": _RAW_SESSION,
        "agent_id": "agent-1",
        "agent_name": "Wes Secret Agent",
        "project": "topsecret-client-project",
        "declared_goal": "refactor the billing secret stuff",
        "intel": {"file": {"sensitive_path": True}},
        "matched_policies": ["pol_aaa", "pol_bbb"],
        "action_type": "file_write",
        "risk_score": 55,
        "reversible": True,
        "guard_decision": "allow",
        "outcome_status": "completed",
        "error_type": None,
        "duration_ms": 120,
        "action_id": "act_xyz",
        "bash_intent": None,
        "command_shape": None,
        "read_paths": [],
        "write_paths": [],
        "sensitive_path": False,
    }
    write = dict(base, event_id="bse_write00000001", tool="Write",
                 tool_category="file", write_paths=["app/api/auth/route.ts"],
                 read_paths=["docs/private-notes.md"], sensitive_path=True)
    bash = dict(base, event_id="bse_bash000000001", tool="Bash",
                tool_category="execution", action_type="execution",
                bash_intent="destructive",
                command_shape="git push --force origin main")
    safe = dict(base, event_id="bse_safe000000001", tool="Bash",
                tool_category="execution", action_type="execution",
                bash_intent="read_only", command_shape="npm run test")
    return [write, bash, safe]


class TestBehaviorUpload(unittest.TestCase):
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
        # Isolated samples dir + child tempdir per test.
        self.samples_dir = tempfile.mkdtemp(prefix="dashclaw_test_samples_")
        self.child_tmp = tempfile.mkdtemp(prefix="dashclaw_test_tmp_")
        self.addCleanup(shutil.rmtree, self.samples_dir, True)
        self.addCleanup(shutil.rmtree, self.child_tmp, True)
        self.day_file = os.path.join(self.samples_dir, "2026-06-10.jsonl")
        with open(self.day_file, "w", encoding="utf-8") as f:
            for s in _fixture_samples():
                f.write(json.dumps(s) + "\n")

    def _env(self, upload=None):
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-upload",
            "DASHCLAW_CODE_SESSIONS_ENABLED": "0",
            "DASHCLAW_BEHAVIOR_INSIGHTS": "0",
            "DASHCLAW_BEHAVIOR_SAMPLES_ENABLED": "1",
            "DASHCLAW_BEHAVIOR_SAMPLES_DIR": self.samples_dir,
            # Child tempdir isolation: throttle marker, offsets file, and the
            # pending-sample sweep all resolve tempfile.gettempdir() here.
            "TMPDIR": self.child_tmp,
            "TEMP": self.child_tmp,
            "TMP": self.child_tmp,
        }
        if upload is not None:
            env["DASHCLAW_BEHAVIOR_UPLOAD"] = upload
        return env

    def _run_hook(self, env_overrides, timeout=15):
        env = os.environ.copy()
        for key in list(env.keys()):
            if key.startswith("DASHCLAW_"):
                del env[key]
        env["DASHCLAW_DISABLE_DOTENV"] = "1"
        env.update(env_overrides)
        proc = subprocess.run(
            [sys.executable, _STOP_SCRIPT],
            input=json.dumps({"session_id": "sess-upload-test", "transcript_path": ""}).encode("utf-8"),
            capture_output=True,
            timeout=timeout,
            env=env,
        )
        return proc.returncode, proc.stderr.decode("utf-8", errors="replace")

    def _ingest_posts(self):
        return [r for r in self.log.get_all()
                if r["method"] == "POST" and r["path"] == _INGEST_PATH]

    # ── Default OFF ───────────────────────────────────────────────────────────

    def test_flag_absent_means_zero_upload_requests_and_no_new_files(self):
        with open(self.day_file, "rb") as f:
            before = f.read()

        code, err = self._run_hook(self._env(upload=None))
        self.assertEqual(code, 0, msg=err)

        self.assertEqual(self._ingest_posts(), [])
        # Recorder behavior unchanged: the JSONL store is byte-identical and
        # no upload marker/offset files were created.
        with open(self.day_file, "rb") as f:
            self.assertEqual(f.read(), before)
        leftovers = [n for n in os.listdir(self.child_tmp)
                     if n.startswith("dashclaw_behavior_upload")]
        self.assertEqual(leftovers, [])

    def test_flag_zero_means_off(self):
        code, err = self._run_hook(self._env(upload="0"))
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._ingest_posts(), [])

    # ── Opt-in ON ─────────────────────────────────────────────────────────────

    def test_flag_on_uploads_anonymized_samples_only(self):
        code, err = self._run_hook(self._env(upload="1"))
        self.assertEqual(code, 0, msg=err)

        posts = self._ingest_posts()
        self.assertEqual(len(posts), 1)
        samples = posts[0]["body"]["samples"]
        self.assertEqual(len(samples), 3)

        serialized = json.dumps(posts[0]["body"])
        # NONE of the identifying fields/values may cross the wire.
        for forbidden in (
            "declared_goal", "agent_name", "matched_policies", "intel",
            "project", "topsecret-client-project", "Wes Secret Agent",
            "refactor the billing secret stuff", _RAW_SESSION,
            "app/api/auth/route.ts", "docs/private-notes.md", "route.ts",
            "act_xyz", "test-key-upload",
        ):
            self.assertNotIn(forbidden, serialized, msg=forbidden)

        by_id = {s["event_id"]: s for s in samples}
        write = by_id["bse_write00000001"]
        # Hashed identity tokens + group classification.
        self.assertTrue(write["session_id"].startswith("sh_"))
        self.assertEqual(len(write["session_id"]), 15)
        self.assertEqual(len(write["write_paths"]), 1)
        self.assertTrue(write["write_paths"][0].startswith("ph_"))
        self.assertTrue(write["read_paths"][0].startswith("ph_"))
        self.assertEqual(write["write_path_groups"], ["auth"])
        self.assertEqual(write["matched_policy_count"], 2)
        # Masked command shapes: first two tokens + flags kept, operands masked,
        # allowlisted words survive.
        self.assertEqual(by_id["bse_bash000000001"]["command_shape"],
                         "git push --force <arg> <arg>")
        self.assertEqual(by_id["bse_safe000000001"]["command_shape"],
                         "npm run test")

    def test_second_run_within_throttle_uploads_nothing_new(self):
        code, err = self._run_hook(self._env(upload="1"))
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(len(self._ingest_posts()), 1)

        self.log.clear()
        code, err = self._run_hook(self._env(upload="1"))
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(self._ingest_posts(), [])


class TestAnonymizeSampleForUpload(unittest.TestCase):
    SALT = "unit-test-salt"

    def test_strips_every_disallowed_field(self):
        sample = _fixture_samples()[0]
        sample = dict(sample, unknown_future_field="must never leak")
        out = behavior_recorder.anonymize_sample_for_upload(sample, self.SALT)
        for key in ("declared_goal", "project", "agent_name",
                    "matched_policies", "intel", "action_id",
                    "unknown_future_field"):
            self.assertNotIn(key, out)
        self.assertEqual(out["matched_policy_count"], 2)
        # Kept verbatim.
        for key in ("schema_version", "event_id", "ts", "source", "model",
                    "tool", "tool_category", "bash_intent", "action_type",
                    "risk_score", "reversible", "guard_decision",
                    "sensitive_path", "outcome_status", "error_type",
                    "duration_ms", "agent_id"):
            self.assertIn(key, out)
            self.assertEqual(out[key], sample[key])

    def test_hashes_are_salted_prefixed_and_identity_preserving(self):
        sample = {"session_id": "sess-1",
                  "read_paths": ["src/a.ts", "src/a.ts"],
                  "write_paths": ["src/a.ts"]}
        out = behavior_recorder.anonymize_sample_for_upload(sample, self.SALT)
        self.assertRegex(out["session_id"], r"^sh_[0-9a-f]{12}$")
        for token in out["read_paths"] + out["write_paths"]:
            self.assertRegex(token, r"^ph_[0-9a-f]{12}$")
        # Same path ⇒ same token (loop detection); read/write hash identically.
        self.assertEqual(out["read_paths"][0], out["read_paths"][1])
        self.assertEqual(out["read_paths"][0], out["write_paths"][0])
        # Different salt ⇒ different tokens; salt never appears in the output.
        other = behavior_recorder.anonymize_sample_for_upload(sample, "other-salt")
        self.assertNotEqual(out["read_paths"][0], other["read_paths"][0])
        self.assertNotIn(self.SALT, json.dumps(out))

    def test_write_path_groups_mirror_path_match(self):
        cases = [
            (["app/api/auth/route.ts"], ["auth"]),
            (["src/deep/middleware.ts"], ["middleware"]),
            (["config/.env.local"], ["secrets"]),
            (["livingcode/emitter.py"], ["livingcode"]),
            (["src/utils/helpers.ts"], []),
            (["app/api/auth/x.ts", "billing/charge.js"], ["auth", "billing"]),
        ]
        for paths, expected in cases:
            out = behavior_recorder.anonymize_sample_for_upload(
                {"write_paths": paths}, self.SALT)
            self.assertEqual(out["write_path_groups"], expected, msg=str(paths))

    def test_command_shape_masking(self):
        cases = [
            ("git push --force origin main", "git push --force <arg> <arg>"),
            ("npm run test", "npm run test"),
            ("npm run lint --fix extras", "npm run lint --fix <arg>"),
            ("npx vitest run --coverage", "npx vitest <arg> --coverage"),
            ("git status", "git status"),
            ("git log <path>", "git log <path>"),  # placeholders survive
            ("pip install requests coverage", "pip install <arg> coverage"),
            (None, None),
        ]
        for shape, expected in cases:
            out = behavior_recorder.anonymize_sample_for_upload(
                {"command_shape": shape}, self.SALT)
            self.assertEqual(out["command_shape"], expected, msg=str(shape))


if __name__ == "__main__":
    unittest.main()
