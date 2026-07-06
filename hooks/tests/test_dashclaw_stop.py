"""Direct tests for the dashclaw_stop.py orchestrator module.

The subprocess-level contracts (never-block, fail-silent, coverage,
assumptions) live in test_stop_integration.py / test_stop_fail_silent.py /
test_stop_coverage.py / test_stop_assumptions.py; this file imports the hook
as a module and pins the hook-resident helpers the extraction left behind."""

import importlib
import os
import sys
import unittest
from unittest import mock

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _HOOKS_DIR not in sys.path:
    sys.path.insert(0, _HOOKS_DIR)


def _import_stop(argv=None, env=None):
    """(Re)import dashclaw_stop with controlled argv/env — module-level config
    is computed at import time, so each test reimports."""
    overrides = {"DASHCLAW_DISABLE_DOTENV": "1"}
    overrides.update(env or {})
    with mock.patch.object(sys, "argv", ["dashclaw_stop.py"] + (argv or [])), \
         mock.patch.dict(os.environ, overrides, clear=False):
        sys.modules.pop("dashclaw_stop", None)
        return importlib.import_module("dashclaw_stop")


class TestArgvAgentId(unittest.TestCase):
    def test_argv_beats_env(self):
        m = _import_stop(argv=["--agent-id", "from-argv"], env={"DASHCLAW_AGENT_ID": "from-env"})
        self.assertEqual(m.AGENT_ID, "from-argv")

    def test_equals_form_parses(self):
        m = _import_stop(argv=["--agent-id=eq-form"])
        self.assertEqual(m.AGENT_ID, "eq-form")

    def test_defaults_to_claude_code(self):
        m = _import_stop(env={"DASHCLAW_AGENT_ID": ""})
        self.assertEqual(m.AGENT_ID, "claude-code")


class TestMissingConfigSuffix(unittest.TestCase):
    def test_names_both_when_both_missing(self):
        m = _import_stop(env={"DASHCLAW_BASE_URL": "", "DASHCLAW_URL": "", "DASHCLAW_API_KEY": ""})
        suffix = m._missing_config_suffix()
        self.assertIn("DASHCLAW_BASE_URL", suffix)
        self.assertIn("DASHCLAW_API_KEY", suffix)
        self.assertIn(" and ", suffix)

    def test_names_only_the_missing_one(self):
        m = _import_stop(env={"DASHCLAW_BASE_URL": "http://x", "DASHCLAW_API_KEY": ""})
        suffix = m._missing_config_suffix()
        self.assertNotIn("DASHCLAW_BASE_URL", suffix)
        self.assertIn("DASHCLAW_API_KEY", suffix)


class TestEnvLineParsing(unittest.TestCase):
    def setUp(self):
        self.m = _import_stop()

    def test_quoted_value_is_unquoted_and_existing_env_wins(self):
        key = "DASHCLAW_STOP_TEST_%d" % os.getpid()
        try:
            self.m._apply_env_line('%s="quoted value"' % key)
            self.assertEqual(os.environ.get(key), "quoted value")
            # Existing env must not be overwritten.
            self.m._apply_env_line("%s=other" % key)
            self.assertEqual(os.environ.get(key), "quoted value")
        finally:
            os.environ.pop(key, None)

    def test_comments_and_blank_lines_are_ignored(self):
        before = dict(os.environ)
        self.m._apply_env_line("# comment")
        self.m._apply_env_line("")
        self.m._apply_env_line("no-equals-sign")
        self.assertEqual(dict(os.environ), before)


class TestReadStdinPayload(unittest.TestCase):
    def setUp(self):
        self.m = _import_stop()

    def _with_stdin(self, raw_bytes):
        fake = mock.MagicMock()
        fake.buffer.read.return_value = raw_bytes
        with mock.patch.object(self.m.sys, "stdin", fake):
            return self.m._read_stdin_payload()

    def test_parses_json_dict(self):
        self.assertEqual(self._with_stdin(b'{"session_id":"s1"}'), {"session_id": "s1"})

    def test_empty_stdin_is_empty_dict(self):
        self.assertEqual(self._with_stdin(b""), {})

    def test_bom_is_tolerated(self):
        self.assertEqual(self._with_stdin(b'\xef\xbb\xbf{"a":1}'), {"a": 1})

    def test_garbage_returns_sentinel(self):
        self.assertIs(self._with_stdin(b"not json"), self.m._STDIN_READ_ERROR)


if __name__ == "__main__":
    unittest.main()
