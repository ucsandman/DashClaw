"""Tests for dashclaw_agent_intel.written_paths_ledger (script-then-execute spec §3-§4).

The ledger records paths this session wrote (PostToolUse side) so PreToolUse
can route a content grade onto executes of self-written scripts. Spec:
docs/plans/2026-08-06-script-then-execute-spec.md.
"""

import json
import os
import sys
import tempfile
import unittest
import uuid

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HOOKS_DIR)

from dashclaw_agent_intel.written_paths_ledger import (  # noqa: E402
    delete_ledger,
    extract_exec_candidates,
    grade_script_content,
    is_recently_written,
    ledger_path,
    normalize_exec_path,
    record_written_paths,
)
from dashclaw_agent_intel.command_parser import parse_command  # noqa: E402


def _sid():
    return "sess-" + uuid.uuid4().hex[:12]


SUFFIX = "testsuffix01"


class TestNormalization(unittest.TestCase):
    """§4 — both sides must normalize identically; the equivalence classes
    are the whole reason a single shared helper exists."""

    def test_strips_surrounding_quotes(self):
        self.assertEqual(
            normalize_exec_path('"/tmp/x.sh"', "/tmp", platform="linux"),
            normalize_exec_path("/tmp/x.sh", "/tmp", platform="linux"),
        )

    def test_git_bash_drive_form_maps_to_windows_form(self):
        self.assertEqual(
            normalize_exec_path("/c/Users/x/a.sh", "C:\\proj", platform="win32"),
            normalize_exec_path("C:\\Users\\x\\a.sh", "C:\\proj", platform="win32"),
        )

    def test_relative_path_resolves_against_cwd(self):
        self.assertEqual(
            normalize_exec_path("scripts/x.sh", "C:\\proj", platform="win32"),
            normalize_exec_path("C:\\proj\\scripts\\x.sh", "C:\\proj", platform="win32"),
        )

    def test_dot_slash_resolves_against_cwd(self):
        self.assertEqual(
            normalize_exec_path("./x.sh", "/home/u/proj", platform="linux"),
            normalize_exec_path("/home/u/proj/x.sh", "/home/u/proj", platform="linux"),
        )

    def test_case_insensitive_on_win32(self):
        self.assertEqual(
            normalize_exec_path("C:\\proj\\X.SH", "C:\\proj", platform="win32"),
            normalize_exec_path("c:\\proj\\x.sh", "C:\\proj", platform="win32"),
        )

    def test_case_sensitive_on_linux(self):
        self.assertNotEqual(
            normalize_exec_path("/tmp/X.SH", "/tmp", platform="linux"),
            normalize_exec_path("/tmp/x.sh", "/tmp", platform="linux"),
        )

    def test_forward_slashes_normalize_on_win32(self):
        self.assertEqual(
            normalize_exec_path("C:/proj/x.sh", "C:\\proj", platform="win32"),
            normalize_exec_path("C:\\proj\\x.sh", "C:\\proj", platform="win32"),
        )


class TestLedgerRoundTrip(unittest.TestCase):
    """§3.1/§3.2 — record on the write side, hit on the execute side."""

    def setUp(self):
        self.sid = _sid()

    def tearDown(self):
        delete_ledger(self.sid, SUFFIX)

    def test_recorded_path_is_recently_written(self):
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp")
        self.assertTrue(is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp"))

    def test_unrecorded_path_misses(self):
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp")
        self.assertFalse(is_recently_written(self.sid, SUFFIX, "/tmp/other.sh", cwd="/tmp"))

    def test_empty_ledger_misses(self):
        self.assertFalse(is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp"))

    def test_relative_record_matches_absolute_lookup(self):
        record_written_paths(self.sid, SUFFIX, ["x.sh"], cwd="/home/u/proj")
        self.assertTrue(
            is_recently_written(self.sid, SUFFIX, "/home/u/proj/x.sh", cwd="/home/u/proj")
        )

    def test_ttl_expired_entry_misses(self):
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp", now=1000.0)
        # default TTL 60 minutes
        self.assertFalse(
            is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp", now=1000.0 + 3601)
        )

    def test_ttl_fresh_entry_hits(self):
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp", now=1000.0)
        self.assertTrue(
            is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp", now=1000.0 + 3599)
        )

    def test_ttl_env_override(self):
        os.environ["DASHCLAW_SCRIPT_EXEC_TTL_MINUTES"] = "1"
        try:
            record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp", now=1000.0)
            self.assertTrue(
                is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp", now=1000.0 + 30)
            )
            self.assertFalse(
                is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp", now=1000.0 + 90)
            )
        finally:
            del os.environ["DASHCLAW_SCRIPT_EXEC_TTL_MINUTES"]

    def test_lru_cap_evicts_oldest(self):
        for i in range(501):
            record_written_paths(
                self.sid, SUFFIX, ["/tmp/f%d.sh" % i], cwd="/tmp", now=1000.0 + i
            )
        self.assertFalse(
            is_recently_written(self.sid, SUFFIX, "/tmp/f0.sh", cwd="/tmp", now=1600.0)
        )
        self.assertTrue(
            is_recently_written(self.sid, SUFFIX, "/tmp/f500.sh", cwd="/tmp", now=1600.0)
        )

    def test_rerecording_refreshes_timestamp(self):
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp", now=1000.0)
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp", now=4000.0)
        self.assertTrue(
            is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp", now=4000.0 + 3599)
        )

    def test_corrupt_ledger_fails_soft(self):
        path = ledger_path(self.sid, SUFFIX)
        with open(path, "w", encoding="utf-8") as f:
            f.write("{not json")
        # neither call may raise
        self.assertFalse(is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp"))
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp")
        self.assertTrue(is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp"))

    def test_instance_suffix_isolation(self):
        record_written_paths(self.sid, "suffixaaa001", ["/tmp/x.sh"], cwd="/tmp")
        try:
            self.assertFalse(
                is_recently_written(self.sid, "suffixbbb002", "/tmp/x.sh", cwd="/tmp")
            )
        finally:
            delete_ledger(self.sid, "suffixaaa001")

    def test_delete_ledger_removes_state(self):
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp")
        delete_ledger(self.sid, SUFFIX)
        self.assertFalse(os.path.exists(ledger_path(self.sid, SUFFIX)))
        self.assertFalse(is_recently_written(self.sid, SUFFIX, "/tmp/x.sh", cwd="/tmp"))

    def test_session_id_is_sanitized_in_path(self):
        weird = "a/b\\c:d"
        p = ledger_path(weird, SUFFIX)
        base = os.path.basename(p)
        self.assertNotIn("/", base)
        self.assertNotIn("\\", base)
        self.assertNotIn(":", base)

    def test_no_content_is_stored(self):
        # §3.1: path + timestamp only — a write-time content snapshot is the
        # TOCTOU-shaped mistake.
        record_written_paths(self.sid, SUFFIX, ["/tmp/x.sh"], cwd="/tmp")
        with open(ledger_path(self.sid, SUFFIX), encoding="utf-8") as f:
            data = json.load(f)
        entry = data["entries"][0]
        self.assertEqual(sorted(entry.keys()), ["at", "path"])


class TestExtractExecCandidates(unittest.TestCase):
    """§3.3.1 — executed-path candidates from parse_command output."""

    def _candidates(self, command):
        return extract_exec_candidates(parse_command(command))

    def test_interpreter_with_script_target(self):
        self.assertIn("/tmp/x.sh", self._candidates("bash /tmp/x.sh"))

    def test_program_token_that_is_a_path(self):
        self.assertIn("./x.sh", self._candidates("./x.sh --flag"))

    def test_python_script(self):
        self.assertIn("x.py", self._candidates("python x.py"))

    def test_node_script(self):
        self.assertIn("scripts/run.mjs", self._candidates("node scripts/run.mjs"))

    def test_source_target(self):
        self.assertIn("x.sh", self._candidates("source x.sh"))

    def test_dot_source_target(self):
        self.assertIn("x.sh", self._candidates(". x.sh"))

    def test_pwsh_file_flag(self):
        self.assertIn("x.ps1", self._candidates("pwsh -File x.ps1"))

    def test_chained_segment_execute(self):
        self.assertIn("x.sh", self._candidates("echo hi && bash x.sh"))

    def test_inline_eval_yields_no_candidate(self):
        self.assertEqual(self._candidates('bash -c "echo hi"'), [])
        self.assertEqual(self._candidates("python -c 'print(1)'"), [])

    def test_bare_program_yields_no_candidate(self):
        self.assertEqual(self._candidates("ls -la"), [])

    def test_non_interpreter_targets_ignored(self):
        self.assertEqual(self._candidates("git add file.sh"), [])


class TestGradeScriptContent(unittest.TestCase):
    """§3.3.3 — content grading inherits the inline-command calibration."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dashclaw_stx_test_")

    def tearDown(self):
        import shutil

        shutil.rmtree(self.dir, ignore_errors=True)

    def _write(self, name, content):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return path

    def test_destructive_shell_script_grades_block_band(self):
        path = self._write("x.sh", "rm -rf /c/Users/someone\n")
        graded = grade_script_content(path)
        self.assertTrue(graded["readable"])
        self.assertGreaterEqual(graded["risk_score"], 80)

    def test_regenerable_cleanup_script_stays_low(self):
        # F5 lesson (§2): `bash cleanup.sh` (contents rm -rf .next dist) must
        # stay in the cleanup band exactly as the inline command does.
        path = self._write("cleanup.sh", "rm -rf .next dist\n")
        graded = grade_script_content(path)
        self.assertTrue(graded["readable"])
        self.assertLess(graded["risk_score"], 60)

    def test_benign_script_stays_low(self):
        path = self._write("hello.sh", "echo hello\necho world\n")
        graded = grade_script_content(path)
        self.assertTrue(graded["readable"])
        self.assertLess(graded["risk_score"], 35)

    def test_comment_lines_are_ignored(self):
        path = self._write("c.sh", "# rm -rf /c/Users/someone\necho ok\n")
        graded = grade_script_content(path)
        self.assertLess(graded["risk_score"], 35)

    def test_shell_device_write_inherits_inline_block_grade(self):
        # inline `> /dev/sda` grades 85 (destructive_command:block); the
        # script content must inherit exactly that, not invent a new number.
        path = self._write("d.sh", "cat image.img > /dev/sda\n")
        graded = grade_script_content(path)
        self.assertGreaterEqual(graded["risk_score"], 85)

    def test_python_device_write_grades_100(self):
        # §3.3: raw device writes in interpreter content are the always-block
        # shape (same as the v5.8.2 one-liner path).
        path = self._write("burn.py", "import os\nos.system('dd if=x of=/dev/sda')\n")
        graded = grade_script_content(path)
        self.assertEqual(graded["risk_score"], 100)

    def test_python_escape_hatch_grades_security_band(self):
        path = self._write("x.py", "import shutil\nshutil.rmtree('/home/u')\n")
        graded = grade_script_content(path)
        self.assertTrue(graded["readable"])
        self.assertGreaterEqual(graded["risk_score"], 80)

    def test_benign_python_stays_low(self):
        path = self._write("ok.py", "print('hello')\n")
        graded = grade_script_content(path)
        self.assertTrue(graded["readable"])
        self.assertLess(graded["risk_score"], 60)

    def test_ps1_destructive_grades_block_band(self):
        path = self._write("x.ps1", "Remove-Item -Recurse -Force C:\\Users\\someone\n")
        graded = grade_script_content(path)
        self.assertGreaterEqual(graded["risk_score"], 70)

    def test_shebang_shell_without_extension(self):
        path = self._write("runme", "#!/bin/sh\nrm -rf /c/Users/someone\n")
        graded = grade_script_content(path)
        self.assertGreaterEqual(graded["risk_score"], 80)

    def test_missing_file_is_unreadable(self):
        graded = grade_script_content(os.path.join(self.dir, "nope.sh"))
        self.assertFalse(graded["readable"])

    def test_oversized_file_is_unreadable(self):
        path = self._write("big.sh", "echo x\n" * 40000)  # > 256 KB
        graded = grade_script_content(path)
        self.assertFalse(graded["readable"])

    def test_validations_present_on_escalation(self):
        path = self._write("x.sh", "rm -rf /c/Users/someone\n")
        graded = grade_script_content(path)
        self.assertTrue(graded["validations"])


if __name__ == "__main__":
    unittest.main()
