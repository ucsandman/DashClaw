"""Tests for dashclaw_agent_intel.stop_state — the tempdir session-state
contracts shared between PreToolUse and the Stop hook (turn actions, cursor,
posted-assumption keys, throttle markers, upload offsets)."""

import os
import tempfile
import time
import unittest

from dashclaw_agent_intel import stop_state as ss


class TestSafeSessionId(unittest.TestCase):
    def test_path_traversal_is_neutralized(self):
        self.assertEqual(ss.safe_session_id("../etc/passwd"), ".._etc_passwd")

    def test_allowed_chars_pass_through(self):
        self.assertEqual(ss.safe_session_id("abc-DEF_1.2"), "abc-DEF_1.2")

    def test_empty_stays_empty(self):
        self.assertEqual(ss.safe_session_id(""), "")


class _TempStateCase(unittest.TestCase):
    """Each test gets a session id unique to the test run; files it creates
    are removed afterwards."""

    def setUp(self):
        self.session_id = "sstest-%d-%s" % (os.getpid(), self._testMethodName)
        self.paths = [
            ss.turn_actions_path(self.session_id),
            ss.cursor_path(self.session_id),
            ss.assumptions_posted_path(self.session_id),
        ]

    def tearDown(self):
        for p in self.paths:
            try:
                os.remove(p)
            except OSError:
                pass


class TestCursor(_TempStateCase):
    def test_roundtrip(self):
        ss.write_cursor(self.session_id, "uuid-123")
        self.assertEqual(ss.read_cursor(self.session_id), "uuid-123")

    def test_empty_uuid_not_written(self):
        ss.write_cursor(self.session_id, "")
        self.assertEqual(ss.read_cursor(self.session_id), "")

    def test_missing_file_reads_empty(self):
        self.assertEqual(ss.read_cursor(self.session_id), "")


class TestTurnActions(_TempStateCase):
    def test_reads_ordered_deduped(self):
        with open(ss.turn_actions_path(self.session_id), "w", encoding="utf-8") as f:
            f.write("a1\n\na2\na1\na3\n")
        self.assertEqual(ss.read_turn_actions(self.session_id), ["a1", "a2", "a3"])

    def test_missing_file_reads_empty_list(self):
        self.assertEqual(ss.read_turn_actions(self.session_id), [])

    def test_clear_removes_file(self):
        with open(ss.turn_actions_path(self.session_id), "w", encoding="utf-8") as f:
            f.write("a1\n")
        ss.clear_turn_actions(self.session_id)
        self.assertEqual(ss.read_turn_actions(self.session_id), [])
        # Clearing again must not raise.
        ss.clear_turn_actions(self.session_id)


class TestPostedAssumptionKeys(_TempStateCase):
    def test_roundtrip_appends(self):
        ss.append_posted_assumption_keys(self.session_id, ["k1", "k2"])
        ss.append_posted_assumption_keys(self.session_id, ["k3"])
        self.assertEqual(ss.read_posted_assumption_keys(self.session_id), {"k1", "k2", "k3"})

    def test_empty_keys_write_nothing(self):
        ss.append_posted_assumption_keys(self.session_id, [])
        self.assertFalse(os.path.exists(ss.assumptions_posted_path(self.session_id)))


class TestCountSessionActions(_TempStateCase):
    def test_counts_unique_action_ids(self):
        path = os.path.join(
            tempfile.gettempdir(),
            "dashclaw_session_tool_map_" + ss.safe_session_id(self.session_id),
        )
        self.paths.append(path)
        with open(path, "w", encoding="utf-8") as f:
            f.write("t1\tact_1\nt2\tact_2\nt3\tact_1\nmalformed-line\n")
        self.assertEqual(ss.count_session_actions(self.session_id), 2)

    def test_missing_map_counts_zero(self):
        self.assertEqual(ss.count_session_actions(self.session_id), 0)


class TestThrottleMarkers(unittest.TestCase):
    def tearDown(self):
        for p in (ss.insights_marker_path(), ss.samples_marker_path()):
            try:
                os.remove(p)
            except OSError:
                pass

    def test_insights_due_when_never_pushed(self):
        try:
            os.remove(ss.insights_marker_path())
        except OSError:
            pass
        self.assertTrue(ss.insights_due(600))

    def test_insights_not_due_right_after_mark(self):
        ss.mark_insights_pushed()
        self.assertFalse(ss.insights_due(600))

    def test_insights_due_after_throttle_window(self):
        with open(ss.insights_marker_path(), "w", encoding="utf-8") as f:
            f.write(str(time.time() - 601))
        self.assertTrue(ss.insights_due(600))

    def test_samples_marker_mirrors_insights_behavior(self):
        ss.mark_samples_pushed()
        self.assertFalse(ss.samples_push_due(600))
        with open(ss.samples_marker_path(), "w", encoding="utf-8") as f:
            f.write(str(time.time() - 601))
        self.assertTrue(ss.samples_push_due(600))


class TestSampleOffsets(unittest.TestCase):
    def setUp(self):
        self._backup = ss.read_sample_offsets()

    def tearDown(self):
        ss.write_sample_offsets(self._backup)

    def test_roundtrip(self):
        ss.write_sample_offsets({"/tmp/day.jsonl": 42})
        self.assertEqual(ss.read_sample_offsets(), {"/tmp/day.jsonl": 42})

    def test_non_dict_content_reads_empty(self):
        with open(ss.samples_offsets_path(), "w", encoding="utf-8") as f:
            f.write("[1,2,3]")
        self.assertEqual(ss.read_sample_offsets(), {})


class TestLogHookError(unittest.TestCase):
    def test_appends_source_tagged_line(self):
        marker = "stop-state-test-%d" % os.getpid()
        ss.log_hook_error(marker)
        path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        with open(path, encoding="utf-8") as f:
            tail = f.read()[-2000:]
        self.assertIn(" stop " + marker, tail)


if __name__ == "__main__":
    unittest.main()
