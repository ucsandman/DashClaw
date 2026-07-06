"""Tests for dashclaw_agent_intel.stop_uploads — the insights push and the
opt-in anonymized behavior-sample upload. Network is stubbed at the module's
request_with_retry seam; the non-negotiable gates (opt-in default OFF,
fail-silent, throttle, offset bookkeeping) are what these tests pin."""

import json
import os
import tempfile
import unittest
from unittest import mock

from dashclaw_agent_intel import stop_state as ss
from dashclaw_agent_intel import stop_uploads as su


class _NoNetworkCase(unittest.TestCase):
    """Fails the test if any HTTP request escapes the stubs."""

    def setUp(self):
        patcher = mock.patch.object(
            su, "request_with_retry",
            side_effect=AssertionError("unexpected network call"),
        )
        self.request_mock = patcher.start()
        self.addCleanup(patcher.stop)
        self.logs = []
        self.log = self.logs.append


class TestSampleUploadGates(_NoNetworkCase):
    def test_disabled_is_a_hard_noop(self):
        # Opt-in absent => OFF: no recorder probe, no files, no HTTP.
        with mock.patch.object(su, "recorder_enabled", side_effect=AssertionError("probed recorder")):
            su.maybe_push_samples("http://x", "key", False, None, self.log)
        self.assertEqual(self.logs, [])

    def test_missing_config_is_a_noop_even_when_enabled(self):
        su.maybe_push_samples("", "key", True, None, self.log)
        su.maybe_push_samples("http://x", "", True, None, self.log)
        self.assertEqual(self.logs, [])

    def test_recorder_off_skips(self):
        with mock.patch.object(su, "recorder_enabled", return_value=False):
            su.maybe_push_samples("http://x", "key", True, None, self.log)
        self.assertEqual(self.logs, [])

    def test_exceptions_are_logged_never_raised(self):
        with mock.patch.object(su, "recorder_enabled", return_value=True), \
             mock.patch.object(ss, "samples_push_due", side_effect=RuntimeError("boom")):
            su.maybe_push_samples("http://x", "key", True, None, self.log)
        self.assertTrue(any("push_samples ->" in line for line in self.logs))


class TestInsightsGates(_NoNetworkCase):
    def test_opt_out_skips(self):
        with mock.patch.object(su, "recorder_enabled", side_effect=AssertionError("probed recorder")):
            su.maybe_push_insights("http://x", "key", True, None, self.log)
        self.assertEqual(self.logs, [])

    def test_missing_config_skips(self):
        su.maybe_push_insights("", "", False, None, self.log)
        self.assertEqual(self.logs, [])

    def test_empty_snapshot_skips_post_and_marker(self):
        with mock.patch.object(su, "recorder_enabled", return_value=True), \
             mock.patch.object(ss, "insights_due", return_value=True), \
             mock.patch.object(su, "build_insights_snapshot", return_value=None), \
             mock.patch.object(ss, "mark_insights_pushed", side_effect=AssertionError("marked")):
            su.maybe_push_insights("http://x", "key", False, None, self.log)

    def test_successful_push_posts_and_marks(self):
        self.request_mock.side_effect = None
        self.request_mock.return_value = b"{}"
        with mock.patch.object(su, "recorder_enabled", return_value=True), \
             mock.patch.object(ss, "insights_due", return_value=True), \
             mock.patch.object(su, "build_insights_snapshot", return_value={"counts": 1}), \
             mock.patch.object(ss, "mark_insights_pushed") as marked:
            su.maybe_push_insights("http://x", "key", False, None, self.log)
        self.assertEqual(self.request_mock.call_count, 1)
        req = self.request_mock.call_args[0][0]
        self.assertTrue(req.full_url.endswith("/api/behavior/insights"))
        marked.assert_called_once()


class TestSalt(unittest.TestCase):
    def test_salt_is_deterministic_per_key_and_never_the_key(self):
        s1 = su.upload_salt("key-a")
        s2 = su.upload_salt("key-a")
        s3 = su.upload_salt("key-b")
        self.assertEqual(s1, s2)
        self.assertNotEqual(s1, s3)
        self.assertNotIn("key-a", s1)
        self.assertEqual(len(s1), 64)  # hex SHA-256


class TestAnonymizeLines(unittest.TestCase):
    def test_skips_unparseable_and_keyless_lines(self):
        lines = [
            "not json",
            json.dumps({"no_event_id": 1}),
            json.dumps({"event_id": "e1", "tool": "Bash"}),
            "",
        ]
        with mock.patch.object(su.behavior_recorder, "anonymize_sample_for_upload",
                               side_effect=lambda obj, salt: {"id": obj["event_id"]}):
            out = su.anonymize_sample_lines(lines, "salt")
        self.assertEqual(out, [{"id": "e1"}])

    def test_anonymizer_failure_skips_line(self):
        with mock.patch.object(su.behavior_recorder, "anonymize_sample_for_upload",
                               side_effect=RuntimeError("bad")):
            out = su.anonymize_sample_lines([json.dumps({"event_id": "e1"})], "salt")
        self.assertEqual(out, [])


class TestReadNewSampleLines(unittest.TestCase):
    def test_reads_only_complete_new_lines_since_offset(self):
        with tempfile.TemporaryDirectory() as d:
            day = os.path.join(d, "2026-07-06.jsonl")
            first = b'{"event_id":"e1"}\n'
            with open(day, "wb") as f:
                f.write(first + b'{"event_id":"e2"}\n{"partial')
            with mock.patch.object(su.behavior_recorder, "samples_dir", return_value=d), \
                 mock.patch.object(su.behavior_recorder, "_DAY_FILE_RE") as day_re:
                day_re.match = lambda n: n.endswith(".jsonl")
                out = su.read_new_sample_lines({day: len(first)}, None)
        self.assertEqual(len(out), 1)
        path, new_offset, lines = out[0]
        self.assertEqual(path, day)
        self.assertEqual(lines, ['{"event_id":"e2"}'])
        # Partial trailing line stays unconsumed for the next push.
        self.assertEqual(new_offset, len(first) + len(b'{"event_id":"e2"}\n'))

    def test_missing_directory_returns_empty(self):
        with mock.patch.object(su.behavior_recorder, "samples_dir",
                               return_value=os.path.join(tempfile.gettempdir(), "nope-%d" % os.getpid())):
            self.assertEqual(su.read_new_sample_lines({}, None), [])


if __name__ == "__main__":
    unittest.main()
