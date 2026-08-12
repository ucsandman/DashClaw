"""Tests for enforcement_liveness_probe.py (roadmap v8.2).

Contract under test: the probe reproduces the harness's hook contract around
the real installed command — timeout is SECONDS, seconds*1000 past int32
overflows the timer and cancels the hook (fail-open), exit 2 holds and
anything else proceeds — and verdicts by the witness file, never the ledger.

The seeded v4.72.1 regression is the acceptance test from the roadmap: a
settings.json carrying the exact overflowed timeout (3600000) must yield
verdict `executed` even when the hook itself would have blocked.
"""
import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from tempfile import TemporaryDirectory
from unittest import mock

PROBE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "enforcement_liveness_probe.py")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DASHCLAW_DISABLE_DOTENV", "1")
from enforcement_liveness_probe import (  # noqa: E402
    default_settings_paths,
    effective_hook_timer,
    find_pretool_entries,
)


class TestEffectiveHookTimer(unittest.TestCase):
    def test_sane_timeout_does_not_overflow(self):
        seconds, ms, overflowed = effective_hook_timer(3660)
        self.assertEqual(seconds, 3660)
        self.assertEqual(ms, 3_660_000)
        self.assertFalse(overflowed)

    def test_v4721_seed_overflows(self):
        # The exact value every installer wrote before v4.72.1: milliseconds
        # in a seconds field. 3600000 * 1000 > 2^31-1 -> timer fires at once.
        seconds, ms, overflowed = effective_hook_timer(3600000)
        self.assertTrue(overflowed)
        self.assertEqual(ms, 3_600_000_000)

    def test_absent_and_garbage_fall_back_to_harness_default(self):
        for value in (None, "abc", "", -5, 0, float("nan")):
            seconds, ms, overflowed = effective_hook_timer(value)
            self.assertEqual(seconds, 600, value)
            self.assertFalse(overflowed, value)

    def test_overflow_boundary(self):
        self.assertFalse(effective_hook_timer(2_147_483)[2])   # 2^31-1 ms is ~2147483.6s
        self.assertTrue(effective_hook_timer(2_147_484)[2])


class TestFindPretoolEntries(unittest.TestCase):
    def test_finds_dashclaw_entry_and_ignores_others(self):
        with TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "settings.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"hooks": {"PreToolUse": [
                    {"matcher": "Bash", "hooks": [
                        {"type": "command", "command": "node run_hook.cjs dashclaw_pretool.py", "timeout": 3660},
                        {"type": "command", "command": "node some_other_hook.cjs"},
                    ]},
                ]}}, f)
            entries, problems = find_pretool_entries([path])
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["timeout_seconds"], 3660)
            self.assertEqual(entries[0]["harness"], "claude-code")
            self.assertFalse(entries[0]["overflowed"])
            self.assertEqual(problems, [])

    def test_missing_file_is_silent_but_malformed_one_is_reported(self):
        # An absent config is an ordinary "not installed". A config that EXISTS
        # and cannot be parsed is a reason the seam could not be probed, and
        # swallowing it renders the same false "nothing installed" green.
        with TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "bad.json")
            with open(bad, "w", encoding="utf-8") as f:
                f.write("{not json")
            entries, problems = find_pretool_entries([bad, os.path.join(tmp, "absent.json")])
            self.assertEqual(entries, [])
            self.assertEqual(len(problems), 1)
            self.assertIn("bad.json", problems[0])

    def test_parses_the_codex_toml_seam(self):
        # The exact block `dashclaw install codex` writes into
        # ~/.codex/config.toml. `[[hooks.PreToolUse]]` +
        # `[[hooks.PreToolUse.hooks]]` decode to the same nesting the JSON
        # path walks, so only the parser differs.
        with TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "config.toml")
            with open(path, "w", encoding="utf-8") as f:
                f.write(
                    '[[hooks.PreToolUse]]\n'
                    'matcher = "Bash|Edit|Write|MultiEdit"\n'
                    '[[hooks.PreToolUse.hooks]]\n'
                    'type = "command"\n'
                    'command = "python /h/dashclaw_pretool.py --agent-id codex"\n'
                    'timeout = 3600\n'
                )
            entries, problems = find_pretool_entries([path])
            self.assertEqual(problems, [])
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["harness"], "codex")
            self.assertEqual(entries[0]["timeout_seconds"], 3600)
            self.assertEqual(entries[0]["settings_path"], path)

    def test_codex_timeout_never_emulates_the_claude_code_overflow(self):
        # The int32 timer overflow was observed on the Claude Code harness and
        # nowhere else. Asserting it for codex would render a live seam
        # `executed` on a large-but-legal timeout — a false RED invented from
        # an unverified contract.
        self.assertTrue(effective_hook_timer(3_600_000, "claude-code")[2])
        self.assertFalse(effective_hook_timer(3_600_000, "codex")[2])


class TestDefaultSettingsPaths(unittest.TestCase):
    def test_codex_resolves_to_its_own_config_not_claude_code(self):
        # The regression this fixes: every runtime resolved to
        # .claude/settings.json, so the codex-wired run drove the Claude Code
        # seam and filed the verdict as `runtime = codex`.
        with mock.patch.dict(os.environ, {"CODEX_HOME": os.path.join("C:", "cx")}):
            paths = default_settings_paths("/proj", "codex")
        self.assertEqual(len(paths), 1)
        self.assertTrue(paths[0].endswith("config.toml"))
        self.assertNotIn(".claude", paths[0])

    def test_claude_code_and_unknown_keep_the_settings_json_pair(self):
        for runtime in ("claude-code", "unknown"):
            paths = default_settings_paths("/proj", runtime)
            self.assertEqual(len(paths), 2, runtime)
            self.assertTrue(all(p.endswith("settings.json") for p in paths), runtime)


# ---------------------------------------------------------------------------
# End-to-end probe runs against a stub hook + stub API
# ---------------------------------------------------------------------------

STUB_EXIT_2 = "import sys; sys.stdin.read(); sys.stderr.write('[DashClaw] Blocked by policy: probe\\n'); sys.exit(2)"
STUB_EXIT_0 = "import sys; sys.stdin.read(); sys.exit(0)"
STUB_OBSERVE = "import sys; sys.stdin.read(); sys.stderr.write('[DashClaw] [observe] Would block: probe\\n'); sys.exit(0)"


class _StubApi(BaseHTTPRequestHandler):
    reports = []
    latest_action = None  # dict or None

    def _send(self, code, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/actions"):
            actions = [self.latest_action] if self.latest_action else []
            return self._send(200, {"actions": actions})
        return self._send(404, {})

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/enforcement-liveness":
            type(self).reports.append(body)
            return self._send(201, {"id": "elr_test"})
        return self._send(404, {})

    def do_PATCH(self):
        length = int(self.headers.get("content-length", 0))
        self.rfile.read(length)
        return self._send(200, {"ok": True})

    def log_message(self, *args):
        pass


class ProbeE2E(unittest.TestCase):
    def setUp(self):
        _StubApi.reports = []
        _StubApi.latest_action = None
        self.server = HTTPServer(("127.0.0.1", 0), _StubApi)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base_url = "http://127.0.0.1:%d" % self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _write_fixture(self, tmp, stub_code, timeout):
        stub = os.path.join(tmp, "stub_hook.py")
        with open(stub, "w", encoding="utf-8") as f:
            f.write(stub_code + "\n")
        settings = os.path.join(tmp, "settings.json")
        entry = {"type": "command", "command": '"%s" "%s" dashclaw_pretool.py' % (sys.executable, stub)}
        if timeout is not None:
            entry["timeout"] = timeout
        with open(settings, "w", encoding="utf-8") as f:
            json.dump({"hooks": {"PreToolUse": [{"matcher": ".*", "hooks": [entry]}]}}, f)
        # The stub must run regardless of the trailing dashclaw_pretool.py arg;
        # make it a real no-op arg by having the stub ignore argv.
        return settings

    def _write_codex_fixture(self, tmp, stub_code, timeout):
        """The codex seam: the same stub hook declared in TOML, the shape
        `dashclaw install codex` writes into ~/.codex/config.toml."""
        stub = os.path.join(tmp, "stub_hook.py")
        with open(stub, "w", encoding="utf-8") as f:
            f.write(stub_code + "\n")
        config = os.path.join(tmp, "config.toml")
        command = '"%s" "%s" dashclaw_pretool.py' % (sys.executable, stub)
        with open(config, "w", encoding="utf-8") as f:
            f.write(
                '[[hooks.PreToolUse]]\n'
                'matcher = "Bash|Edit|Write|MultiEdit"\n'
                '[[hooks.PreToolUse.hooks]]\n'
                'type = "command"\n'
                'command = %s\n'
                'timeout = %d\n' % (json.dumps(command), timeout)
            )
        return config

    def _run_probe(self, settings, tmp, extra_env=None, runtime=None):
        env = {**os.environ, "DASHCLAW_DISABLE_DOTENV": "1",
               "DASHCLAW_BASE_URL": self.base_url, "DASHCLAW_API_KEY": "test-key"}
        for k in ("DASHCLAW_URL", "DASHCLAW_HOOK_MODE", "DASHCLAW_LIVENESS_PROBE_DISABLED"):
            env.pop(k, None)
        env.update(extra_env or {})
        argv = [sys.executable, PROBE,
                "--witness-dir", os.path.join(tmp, "witness"), "--source", "ci", "--max-wait", "30"]
        if settings is not None:
            argv += ["--settings", settings]
        if runtime is not None:
            argv += ["--runtime", runtime]
        return subprocess.run(argv, capture_output=True, env=env, timeout=60, text=True)

    def test_seeded_v4721_timeout_yields_executed(self):
        """THE regression test: the exact v4.72.1 config (timeout 3600000)
        must produce verdict `executed` even though the hook would block."""
        with TemporaryDirectory() as tmp:
            settings = self._write_fixture(tmp, STUB_EXIT_2, timeout=3600000)
            proc = self._run_probe(settings, tmp)
            self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
            self.assertEqual(len(_StubApi.reports), 1)
            run = _StubApi.reports[0]
            self.assertEqual(run["verdict"], "executed")
            self.assertTrue(run["hook"]["overflowed"])
            self.assertTrue(run["hook"]["cancelled"])
            self.assertTrue(run["witness"]["executed"])
            self.assertIn("v4.72.1", run["detail"])
            # The per-run witness dir (and file) is cleaned up after the run;
            # only the empty configured root may remain.
            root = os.path.join(tmp, "witness")
            leftovers = [os.path.join(d, f) for d, _, files in os.walk(root) for f in files]
            self.assertEqual(leftovers, [])

    def test_blocking_hook_with_sane_timeout_yields_held(self):
        with TemporaryDirectory() as tmp:
            settings = self._write_fixture(tmp, STUB_EXIT_2, timeout=3660)
            proc = self._run_probe(settings, tmp)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            run = _StubApi.reports[0]
            self.assertEqual(run["verdict"], "held")
            self.assertFalse(run["witness"]["executed"])
            self.assertEqual(run["hook"]["exit_code"], 2)

    def test_codex_toml_seam_is_driven_end_to_end(self):
        """The codex seam reports on ITS OWN config. Before this the probe
        parsed JSON only, so a `--runtime codex` run drove whatever was in
        .claude/settings.json and filed the verdict under the codex name."""
        with TemporaryDirectory() as tmp:
            config = self._write_codex_fixture(tmp, STUB_EXIT_2, timeout=3600)
            proc = self._run_probe(config, tmp, runtime="codex")
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            run = _StubApi.reports[0]
            self.assertEqual(run["runtime"], "codex")
            self.assertEqual(run["verdict"], "held")
            self.assertEqual(run["hook"]["settings_path"], config)
            self.assertEqual(run["hook"]["exit_code"], 2)

    def test_codex_runtime_never_falls_back_to_the_claude_code_seam(self):
        """The regression guard. With no codex config present the verdict is
        `unprovable` naming config.toml — NOT a green borrowed from a healthy
        Claude Code hook that happens to be installed on the same machine."""
        with TemporaryDirectory() as tmp:
            # A healthy Claude Code seam exists in this project root. It must
            # not be able to answer for codex.
            claude_dir = os.path.join(tmp, "proj", ".claude")
            os.makedirs(claude_dir)
            self._write_fixture(tmp, STUB_EXIT_2, timeout=3660)
            with open(os.path.join(claude_dir, "settings.json"), "w", encoding="utf-8") as f:
                json.dump({"hooks": {"PreToolUse": [{"matcher": ".*", "hooks": [
                    {"type": "command",
                     "command": '"%s" "%s" dashclaw_pretool.py' % (sys.executable, os.path.join(tmp, "stub_hook.py")),
                     "timeout": 3660},
                ]}]}}, f)
            proc = self._run_probe(None, tmp, runtime="codex", extra_env={
                "CODEX_HOME": os.path.join(tmp, "empty-codex-home"),
                "CLAUDE_PROJECT_DIR": os.path.join(tmp, "proj"),
            })
            self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
            run = _StubApi.reports[0]
            self.assertEqual(run["runtime"], "codex")
            self.assertEqual(run["verdict"], "unprovable")
            self.assertIn("config.toml", run["detail"])
            self.assertIn("dashclaw install codex", run["detail"])

    def test_allow_decision_yields_unprovable(self):
        _StubApi.latest_action = {"id": "act_1", "status": "running"}
        with TemporaryDirectory() as tmp:
            settings = self._write_fixture(tmp, STUB_EXIT_0, timeout=3660)
            proc = self._run_probe(settings, tmp)
            self.assertEqual(proc.returncode, 1)
            run = _StubApi.reports[0]
            self.assertEqual(run["verdict"], "unprovable")
            self.assertTrue(run["witness"]["executed"])
            self.assertIn("No policy held", run["detail"])

    def test_seam_broken_above_guard_yields_executed(self):
        # Guard recorded a block, but the hook exited 0: fail-open above guard.
        _StubApi.latest_action = {"id": "act_2", "status": "blocked"}
        with TemporaryDirectory() as tmp:
            settings = self._write_fixture(tmp, STUB_EXIT_0, timeout=3660)
            proc = self._run_probe(settings, tmp)
            self.assertEqual(proc.returncode, 1)
            run = _StubApi.reports[0]
            self.assertEqual(run["verdict"], "executed")
            self.assertIn("broken above the guard", run["detail"])

    def test_observe_mode_yields_unprovable(self):
        with TemporaryDirectory() as tmp:
            settings = self._write_fixture(tmp, STUB_OBSERVE, timeout=3660)
            proc = self._run_probe(settings, tmp)
            self.assertEqual(proc.returncode, 1)
            run = _StubApi.reports[0]
            self.assertEqual(run["verdict"], "unprovable")
            self.assertIn("observe mode", run["detail"])

    def test_no_hook_installed_yields_unprovable(self):
        with TemporaryDirectory() as tmp:
            settings = os.path.join(tmp, "settings.json")
            with open(settings, "w", encoding="utf-8") as f:
                json.dump({"hooks": {}}, f)
            proc = self._run_probe(settings, tmp)
            self.assertEqual(proc.returncode, 1)
            run = _StubApi.reports[0]
            self.assertEqual(run["verdict"], "unprovable")
            self.assertIn("ungoverned", run["detail"])

    def test_disabled_env_exits_zero_without_reporting(self):
        with TemporaryDirectory() as tmp:
            settings = self._write_fixture(tmp, STUB_EXIT_2, timeout=3660)
            proc = self._run_probe(settings, tmp, extra_env={"DASHCLAW_LIVENESS_PROBE_DISABLED": "1"})
            self.assertEqual(proc.returncode, 0)
            self.assertEqual(_StubApi.reports, [])


if __name__ == "__main__":
    unittest.main()


class TestSessionStartSpawn(unittest.TestCase):
    """SessionStart entry point (v5, re-homed from the retired session-digest
    hook): throttle to once/12h via a marker file and run the probe in a
    DETACHED child so session start is never delayed."""

    def setUp(self):
        import enforcement_liveness_probe as probe
        self.probe = probe
        self._tmp = TemporaryDirectory()
        self.home = os.path.join(self._tmp.name, "home")
        for k in ("DASHCLAW_LIVENESS_PROBE_DISABLED", "DASHCLAW_LIVENESS_PROBE_SPAWNED"):
            os.environ.pop(k, None)

    def tearDown(self):
        self._tmp.cleanup()

    def _expanduser(self, p):
        return self.home if p == "~" else p

    def _marker(self):
        return os.path.join(self.home, ".dashclaw", "liveness-probe", ".last-spawn")

    def test_throttled_by_fresh_marker(self):
        os.makedirs(os.path.dirname(self._marker()))
        with open(self._marker(), "w", encoding="utf-8") as f:
            f.write("now")
        calls = []
        with mock.patch.object(os.path, "expanduser", self._expanduser), \
                mock.patch.object(self.probe.subprocess, "Popen", lambda *a, **k: calls.append(a)):
            self.probe._throttle_and_detach_session_start()
        self.assertEqual(calls, [])

    def test_fires_detached_and_writes_marker(self):
        calls = []
        with mock.patch.object(os.path, "expanduser", self._expanduser), \
                mock.patch.object(self.probe.subprocess, "Popen", lambda *a, **k: calls.append((a, k))):
            self.probe._throttle_and_detach_session_start()
        self.assertEqual(len(calls), 1)
        argv = calls[0][0][0]
        self.assertTrue(argv[1].endswith("enforcement_liveness_probe.py"))
        self.assertEqual(argv[2:], ["--source", "session-start"])
        # The detached child carries the SPAWNED flag so it runs the probe body
        # inline instead of re-spawning (no infinite loop).
        self.assertEqual(calls[0][1]["env"].get("DASHCLAW_LIVENESS_PROBE_SPAWNED"), "1")
        self.assertTrue(os.path.exists(self._marker()))


class TestProbeIdentityRewrite(unittest.TestCase):
    def test_replaces_installed_agent_id(self):
        from enforcement_liveness_probe import command_with_probe_identity
        cmd = 'python "C:/x/hooks/dashclaw_pretool.py" --agent-id claude-code'
        out = command_with_probe_identity(cmd)
        self.assertIn("--agent-id smoke-liveness-probe", out)
        self.assertNotIn("claude-code", out)

    def test_replaces_equals_form_and_appends_when_absent(self):
        from enforcement_liveness_probe import command_with_probe_identity
        self.assertIn("--agent-id smoke-liveness-probe",
                      command_with_probe_identity("node run_hook.cjs dashclaw_pretool.py --agent-id=codex"))
        appended = command_with_probe_identity("node run_hook.cjs dashclaw_pretool.py")
        self.assertTrue(appended.endswith("--agent-id smoke-liveness-probe"))
