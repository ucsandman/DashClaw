"""Tests for dashclaw_agent_intel.behavior_recorder.

Covers deterministic redaction, opt-in gating, fail-silent behavior, and the
PreToolUse -> PostToolUse pending-sample roundtrip that produces a redacted
JSONL behavior sample on local disk.
"""

import json
import os
import tempfile
import unittest

from dashclaw_agent_intel import behavior_recorder as br


class TestRedaction(unittest.TestCase):
    def test_scrubs_known_secret_shapes(self):
        secrets = [
            "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA",
            "sk_live_AAAAAAAAAAAAAAAA",
            "ghp_AAAAAAAAAAAAAAAAAAAAAAAA",
            "AKIAABCDEFGHIJKLMNOP",
        ]
        for s in secrets:
            out = br.redact_text("token=%s end" % s)
            self.assertIn("<REDACTED:", out)
            self.assertNotIn(s, out)

    def test_env_assignment_keeps_variable_name(self):
        out = br.redact_text("ANTHROPIC_API_KEY=sk-ant-secretvalue123456")
        self.assertIn("ANTHROPIC_API_KEY=<REDACTED:env_assign>", out)
        self.assertNotIn("secretvalue", out)

    def test_bounds_length(self):
        self.assertEqual(len(br.redact_text("a" * 5000)), br._MAX_FIELD)

    def test_redact_path_home_and_workspace(self):
        ws = "/tmp/project"
        out = br.redact_path("/tmp/project/app/api/auth/route.js", workspace=ws)
        self.assertEqual(out, "app/api/auth/route.js")

    def test_command_shape_preserves_verbs_redacts_operands(self):
        shape = br.command_shape("git push --force origin /secret/path", workspace="/tmp/project")
        self.assertIn("git", shape)
        self.assertIn("push", shape)
        self.assertIn("--force", shape)
        self.assertIn("<path>", shape)

    def test_command_shape_redacts_secret_token(self):
        shape = br.command_shape("export TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAA")
        self.assertNotIn("ghp_AAAA", shape)


class TestRecorderRoundtrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_ENABLED"] = "1"
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_DIR"] = self.tmp.name
        self.workspace = "/tmp/project"

    def tearDown(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED", None)
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_DIR", None)
        self.tmp.cleanup()

    def _read_all_samples(self):
        rows = []
        for name in os.listdir(self.tmp.name):
            if not name.endswith(".jsonl"):
                continue
            with open(os.path.join(self.tmp.name, name), encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))
        return rows

    def test_pre_then_post_writes_completed_sample(self):
        context = {
            "agent_id": "claude-code",
            "action_type": "apply",
            "risk_score": 35,
            "reversible": True,
            "target": "/tmp/project/app/api/auth/route.js",
            "tool": {"category": "file_io"},
            "intel": {"file": {"sensitive_path": True}},
        }
        tool_input = {"file_path": "/tmp/project/app/api/auth/route.js", "content": "x"}
        br.record_pre("tu_1", "Write", tool_input, context, {"matched_policies": []}, "allow", "enforce", self.workspace)
        # PreToolUse persists a 'running' record immediately so the sample
        # survives even when PostToolUse never fires (~96% miss rate).
        pre_rows = self._read_all_samples()
        self.assertEqual(len(pre_rows), 1)
        self.assertEqual(pre_rows[0]["outcome_status"], "running")
        event_id = pre_rows[0]["event_id"]

        br.record_post("tu_1", "completed", {"exit_code": 0}, action_id="act_123", workspace=self.workspace)

        # PostToolUse appends a finalized record with the SAME event_id;
        # readSamples merges them (finalized supersedes running).
        rows = self._read_all_samples()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["event_id"] == event_id for r in rows))
        final = [r for r in rows if r["outcome_status"] == "completed"]
        self.assertEqual(len(final), 1)
        row = final[0]
        self.assertEqual(row["tool"], "Write")
        self.assertEqual(row["action_id"], "act_123")
        self.assertEqual(row["write_paths"], ["app/api/auth/route.js"])
        self.assertEqual(row["guard_decision"], "allow")
        self.assertTrue(row["event_id"].startswith("bse_"))

    def test_enforce_block_writes_terminal_sample_immediately(self):
        context = {"agent_id": "claude-code", "action_type": "security", "risk_score": 90, "reversible": False,
                   "intel": {"bash": {"intent": "destructive"}}, "tool": {"category": "execution"}}
        tool_input = {"command": "rm -rf /tmp/project/data"}
        br.record_pre("tu_block", "Bash", tool_input, context, {"matched_policies": ["gp_x"]}, "block", "enforce", self.workspace)
        rows = self._read_all_samples()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome_status"], "blocked")
        self.assertEqual(rows[0]["bash_intent"], "destructive")

    def test_post_marks_failed(self):
        context = {"agent_id": "a", "action_type": "build", "risk_score": 25, "reversible": True, "tool": {}, "intel": {}}
        br.record_pre("tu_f", "Bash", {"command": "npm run build"}, context, {}, "allow", "enforce", self.workspace)
        br.record_post("tu_f", "failed", {"error_type": "runtime"}, action_id=None, workspace=self.workspace)
        # 'running' (pre) + 'failed' (post) share an event_id; the finalized
        # record carries the failure outcome.
        final = [r for r in self._read_all_samples() if r["outcome_status"] == "failed"]
        self.assertEqual(len(final), 1)
        self.assertEqual(final[0]["error_type"], "runtime")


class TestGatingAndFailSilent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_DIR"] = self.tmp.name
        self._old_base_url = os.environ.pop("DASHCLAW_BASE_URL", None)
        self._old_url = os.environ.pop("DASHCLAW_URL", None)
        self._old_api_key = os.environ.pop("DASHCLAW_API_KEY", None)
        br._server_config_cache = None

    def tearDown(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED", None)
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_DIR", None)
        if self._old_base_url is not None:
            os.environ["DASHCLAW_BASE_URL"] = self._old_base_url
        if self._old_url is not None:
            os.environ["DASHCLAW_URL"] = self._old_url
        if self._old_api_key is not None:
            os.environ["DASHCLAW_API_KEY"] = self._old_api_key
        br._server_config_cache = None
        self.tmp.cleanup()

    def test_disabled_records_nothing(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED", None)
        self.assertFalse(br.is_enabled())
        br.record_pre("tu_x", "Bash", {"command": "ls"}, {"agent_id": "a", "tool": {}, "intel": {}}, {}, "allow", "enforce", "/tmp/p")
        br.record_post("tu_x", "completed", {}, None, "/tmp/p")
        self.assertEqual(os.listdir(self.tmp.name), [])

    def test_fail_silent_on_garbage(self):
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_ENABLED"] = "1"
        # Missing/garbage context must not raise.
        br.record_pre("tu_g", None, None, None, None, None, "enforce", None)
        br.record_post("tu_missing_pending", "completed", None, None, None)


class TestBuildInsights(unittest.TestCase):
    """build_insights distills local samples into a SAFE aggregate (counts only,
    no raw behavior) for the hosted 'learning in the background' panel."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_DIR"] = self.tmp.name

    def tearDown(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_DIR", None)
        self.tmp.cleanup()

    def _write(self, day, rows):
        path = os.path.join(self.tmp.name, day + ".jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    def test_none_when_empty(self):
        self.assertIsNone(br.build_insights())

    def test_merges_running_and_finalized_by_event_id(self):
        # PreToolUse writes 'running', PostToolUse writes 'completed' with the
        # SAME event_id — they must collapse to a single counted event.
        self._write("2026-06-08", [
            {"event_id": "e1", "agent_id": "claude-code", "ts": "2026-06-08T10:00:00+00:00",
             "tool": "Bash", "outcome_status": "running", "risk_score": 90, "bash_intent": "destructive"},
            {"event_id": "e1", "agent_id": "claude-code", "ts": "2026-06-08T10:00:02+00:00",
             "tool": "Bash", "outcome_status": "completed", "risk_score": 90, "bash_intent": "destructive"},
        ])
        snap = br.build_insights()
        self.assertIsNotNone(snap)
        self.assertEqual(snap["sample_count"], 1)
        self.assertEqual(snap["agent_count"], 1)
        self.assertEqual(snap["signals"]["destructive_commands"], 1)
        self.assertEqual(snap["signals"]["high_risk_actions"], 1)
        self.assertEqual(snap["agents"][0]["agent_id"], "claude-code")
        self.assertEqual(snap["agents"][0]["destructive"], 1)

    def test_aggregates_signals_and_omits_raw_fields(self):
        self._write("2026-06-08", [
            {"event_id": "a", "agent_id": "agent-x", "ts": "2026-06-08T10:00:00+00:00",
             "tool": "Write", "outcome_status": "completed", "sensitive_path": True,
             "command_shape": "rm -rf <path>", "write_paths": ["app/secrets/x"]},
            {"event_id": "b", "agent_id": "agent-x", "ts": "2026-06-08T10:01:00+00:00",
             "tool": "Bash", "outcome_status": "failed", "guard_decision": "require_approval"},
            {"event_id": "c", "agent_id": "agent-x", "ts": "2026-06-08T10:02:00+00:00",
             "tool": "Bash", "outcome_status": "blocked", "guard_decision": "block"},
        ])
        snap = br.build_insights()
        self.assertEqual(snap["sample_count"], 3)
        self.assertEqual(snap["signals"]["protected_path_writes"], 1)
        self.assertEqual(snap["signals"]["failed_actions"], 1)
        self.assertEqual(snap["signals"]["blocked"], 1)
        self.assertEqual(snap["signals"]["approvals"], 1)
        self.assertEqual(snap["agents"][0]["tools"], 2)  # Write + Bash
        self.assertEqual(snap["newest_ts"], "2026-06-08T10:02:00+00:00")

        # The snapshot must carry NO raw behavioral detail.
        blob = json.dumps(snap)
        for forbidden in ("rm -rf", "app/secrets", "command_shape", "write_paths"):
            self.assertNotIn(forbidden, blob)


if __name__ == "__main__":
    unittest.main()
