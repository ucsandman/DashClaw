"""Script-then-execute composition detection (spec §3, §8).

Write side: dashclaw_posttool records written paths into the session ledger.
Execute side: dashclaw_pretool._enrich_bash routes a content grade onto
executes of TTL-fresh self-written scripts. The composition signal itself
never escalates risk (F5 lesson) — only the script's content grade does.
"""

import os
import shutil
import sys
import tempfile
import time
import unittest
import uuid

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HOOKS_DIR)

import dashclaw_posttool  # noqa: E402
import dashclaw_pretool  # noqa: E402
from dashclaw_agent_intel import classify_tool  # noqa: E402
from dashclaw_agent_intel.written_paths_ledger import (  # noqa: E402
    delete_ledger,
    is_recently_written,
    normalize_exec_path,
    record_written_paths,
)

_DESTRUCTIVE_SH = "rm " + "-rf /c/Users/someone\n"
_DESTRUCTIVE_PY = "import shutil\nshutil.rmtree('/home/u')\n"
_DESTRUCTIVE_PS1 = "Remove-Item -Recurse -Force C:\\Users\\someone\n"


class _EnrichBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dashclaw_stx_")
        self.sid = "stx-" + uuid.uuid4().hex[:12]
        self.suffix = dashclaw_pretool._INSTANCE_STATE_SUFFIX
        self._old_sid = dashclaw_pretool._SESSION_ID
        self._old_cwd = dashclaw_pretool._HOOK_CWD
        dashclaw_pretool._SESSION_ID = self.sid
        dashclaw_pretool._HOOK_CWD = self.dir

    def tearDown(self):
        dashclaw_pretool._SESSION_ID = self._old_sid
        dashclaw_pretool._HOOK_CWD = self._old_cwd
        delete_ledger(self.sid, self.suffix)
        shutil.rmtree(self.dir, ignore_errors=True)

    def _write_script(self, name, content):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return path

    def _prime(self, path, now=None):
        record_written_paths(self.sid, self.suffix, [path], cwd=self.dir, now=now)

    def _enrich(self, command):
        tool_input = {"command": command}
        tool_info = classify_tool("Bash", tool_input)
        return dashclaw_pretool._enrich_bash(tool_input, tool_info)

    def _checks(self, enriched):
        return [v.get("check") for v in enriched["intel"]["bash"]["validations"]]


class TestEscalation(_EnrichBase):
    """§9.1 — the repro grades ≥ the inline grade for the same payload."""

    def test_bash_self_written_destructive_script_escalates(self):
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(p)
        e = self._enrich("bash " + p)
        self.assertEqual(e["risk_score"], 100)  # inline grade for the payload
        self.assertIn("script_then_execute", self._checks(e))

    def test_target_is_the_normalized_script_path(self):
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(p)
        e = self._enrich("bash " + p)
        self.assertEqual(e["target"], normalize_exec_path(p, self.dir))

    def test_dot_slash_form(self):
        self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(os.path.join(self.dir, "x.sh"))
        e = self._enrich("./x.sh")
        self.assertEqual(e["risk_score"], 100)
        self.assertIn("script_then_execute", self._checks(e))

    def test_source_form(self):
        p = self._write_script("env.sh", _DESTRUCTIVE_SH)
        self._prime(p)
        e = self._enrich("source " + p)
        self.assertEqual(e["risk_score"], 100)

    def test_python_escape_hatch_script(self):
        p = self._write_script("x.py", _DESTRUCTIVE_PY)
        self._prime(p)
        e = self._enrich("python " + p)
        self.assertGreaterEqual(e["risk_score"], 80)
        self.assertIn("script_then_execute", self._checks(e))

    def test_pwsh_file_form(self):
        p = self._write_script("x.ps1", _DESTRUCTIVE_PS1)
        self._prime(p)
        e = self._enrich("pwsh -File " + p)
        self.assertEqual(e["risk_score"], 100)

    def test_chained_execute(self):
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(p)
        e = self._enrich("echo start && bash " + p)
        self.assertEqual(e["risk_score"], 100)

    def test_content_validations_ride_with_prefix(self):
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(p)
        e = self._enrich("bash " + p)
        self.assertTrue(
            any(str(c).startswith("script_content:") for c in self._checks(e))
        )


class TestFalsePositivePins(_EnrichBase):
    """§8 — no new warn/block on routine script workflows (F5 lesson)."""

    def test_unwritten_script_gets_zero_escalation(self):
        # `bash <path>` baselines at the hook's execution base; the pin is
        # "no change and no composition signal", not an absolute number.
        baseline = self._enrich("bash " + os.path.join(self.dir, "x.sh"))["risk_score"]
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        # NOT primed — the session did not write it as far as the ledger knows
        e = self._enrich("bash " + p)
        self.assertNotIn("script_then_execute", self._checks(e))
        self.assertEqual(e["risk_score"], baseline)

    def test_benign_self_written_script_no_risk_change(self):
        p = self._write_script("cleanup.sh", "rm " + "-rf .next dist\n")
        baseline = self._enrich("bash " + p)["risk_score"]
        self._prime(p)
        e = self._enrich("bash " + p)
        self.assertEqual(e["risk_score"], baseline)

    def test_ttl_expired_entry_no_escalation(self):
        baseline = self._enrich("bash " + os.path.join(self.dir, "x.sh"))["risk_score"]
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(p, now=time.time() - 7200)
        e = self._enrich("bash " + p)
        self.assertNotIn("script_then_execute", self._checks(e))
        self.assertEqual(e["risk_score"], baseline)

    def test_no_session_id_no_escalation(self):
        p = self._write_script("x.sh", _DESTRUCTIVE_SH)
        self._prime(p)
        dashclaw_pretool._SESSION_ID = ""
        e = self._enrich("bash " + p)
        self.assertNotIn("script_then_execute", self._checks(e))


class TestUnreadableHit(_EnrichBase):
    def test_missing_file_floors_review_band(self):
        p = os.path.join(self.dir, "ghost.sh")
        self._prime(p)
        e = self._enrich("bash " + p)
        self.assertGreaterEqual(e["risk_score"], 60)
        self.assertIn("script_then_execute_unreadable", self._checks(e))

    def test_oversized_file_floors_review_band(self):
        p = self._write_script("big.sh", "echo x\n" * 40000)  # > 256 KB
        self._prime(p)
        e = self._enrich("bash " + p)
        self.assertGreaterEqual(e["risk_score"], 60)
        self.assertIn("script_then_execute_unreadable", self._checks(e))


class TestMissPathPerf(unittest.TestCase):
    """§8 perf guard — the miss path is one temp-file open per lookup."""

    def test_ledger_miss_is_cheap(self):
        sid = "stx-perf-" + uuid.uuid4().hex[:8]
        start = time.perf_counter()
        for _ in range(200):
            is_recently_written(sid, "perfsuffix01", "/tmp/never-written.sh", cwd="/tmp")
        elapsed = time.perf_counter() - start
        # 200 misses well under a second keeps the per-call cost far below the
        # 5 ms hot-path budget (v4.73.0).
        self.assertLess(elapsed, 1.0)


class TestPosttoolRecording(unittest.TestCase):
    """§3.2 — the write side of the ledger."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dashclaw_stx_rec_")
        self.sid = "stx-rec-" + uuid.uuid4().hex[:12]
        self.suffix = dashclaw_posttool._INSTANCE_STATE_SUFFIX

    def tearDown(self):
        delete_ledger(self.sid, self.suffix)
        shutil.rmtree(self.dir, ignore_errors=True)

    def _record(self, tool_name, tool_input):
        dashclaw_posttool._record_written_paths({
            "tool_name": tool_name,
            "tool_input": tool_input,
            "session_id": self.sid,
            "cwd": self.dir,
        })

    def _hit(self, path):
        return is_recently_written(self.sid, self.suffix, path, cwd=self.dir)

    def test_write_tool_records_file_path(self):
        p = os.path.join(self.dir, "x.sh")
        self._record("Write", {"file_path": p})
        self.assertTrue(self._hit(p))

    def test_edit_tool_records_file_path(self):
        p = os.path.join(self.dir, "x.sh")
        self._record("Edit", {"file_path": p})
        self.assertTrue(self._hit(p))

    def test_notebook_edit_records_notebook_path(self):
        p = os.path.join(self.dir, "n.ipynb")
        self._record("NotebookEdit", {"notebook_path": p})
        self.assertTrue(self._hit(p))

    def test_bash_redirect_records_target(self):
        self._record("Bash", {"command": "echo hi > out.sh"})
        self.assertTrue(self._hit(os.path.join(self.dir, "out.sh")))

    def test_bash_append_redirect_records_target(self):
        self._record("Bash", {"command": "echo hi >> out.sh"})
        self.assertTrue(self._hit(os.path.join(self.dir, "out.sh")))

    def test_tee_records_target(self):
        self._record("Bash", {"command": "echo hi | tee out.sh"})
        self.assertTrue(self._hit(os.path.join(self.dir, "out.sh")))

    def test_curl_output_flag_records_file_not_url(self):
        self._record("Bash", {"command": "curl -o x.sh https://example.com/payload"})
        self.assertTrue(self._hit(os.path.join(self.dir, "x.sh")))
        self.assertFalse(self._hit("https://example.com/payload"))

    def test_wget_output_flag_records_file(self):
        self._record("Bash", {"command": "wget -O x.sh https://example.com/payload"})
        self.assertTrue(self._hit(os.path.join(self.dir, "x.sh")))

    def test_read_tool_records_nothing(self):
        p = os.path.join(self.dir, "x.sh")
        self._record("Read", {"file_path": p})
        self.assertFalse(self._hit(p))

    def test_bash_without_write_shape_records_nothing(self):
        self._record("Bash", {"command": "ls -la"})
        self.assertFalse(
            os.path.exists(
                __import__("dashclaw_agent_intel.written_paths_ledger", fromlist=["ledger_path"]).ledger_path(
                    self.sid, self.suffix
                )
            )
        )

    def test_missing_session_id_is_noop(self):
        p = os.path.join(self.dir, "x.sh")
        dashclaw_posttool._record_written_paths({
            "tool_name": "Write",
            "tool_input": {"file_path": p},
            "session_id": "",
            "cwd": self.dir,
        })
        self.assertFalse(is_recently_written("", self.suffix, p, cwd=self.dir))


if __name__ == "__main__":
    unittest.main()
