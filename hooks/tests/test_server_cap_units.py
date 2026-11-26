"""Text the hook cuts to a server cap must fit that cap as the SERVER counts it.

The guard validates string length in JavaScript, which counts UTF-16 code
units. Python slices by code point. A character outside the Basic Multilingual
Plane (most emoji) is one code point and two units, so text cut with `[:cap]`
arrived over the cap whenever it held one. The guard answered 400 "Validation
failed" and the hook, failing closed, blocked the tool call (2026-11-25: a
2,100-character Bash command with one emoji in it could not run).
"""

import os
import shutil
import sys
import tempfile
import unittest

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HOOKS_DIR)

import dashclaw_pretool  # noqa: E402
from dashclaw_agent_intel import classify_tool  # noqa: E402

ROBOT = "\U0001F916"  # one code point, two UTF-16 code units


def units(text):
    """Length as the server's validator measures it."""
    return len(text.encode("utf-16-le")) // 2


class TestClipUnits(unittest.TestCase):
    def test_plain_text_is_cut_at_the_cap(self):
        self.assertEqual(dashclaw_pretool._clip_units("x" * 30, 10), "x" * 10)

    def test_text_under_the_cap_is_unchanged(self):
        self.assertEqual(dashclaw_pretool._clip_units("ab" + ROBOT, 10), "ab" + ROBOT)

    def test_an_emoji_counts_as_two_units(self):
        self.assertEqual(dashclaw_pretool._clip_units(ROBOT * 10, 5), ROBOT * 2)

    def test_text_exactly_at_the_cap_is_kept_whole(self):
        text = "x" * 8 + ROBOT
        self.assertEqual(dashclaw_pretool._clip_units(text, 10), text)

    def test_empty_and_missing_text_pass_through(self):
        self.assertEqual(dashclaw_pretool._clip_units("", 10), "")
        self.assertIsNone(dashclaw_pretool._clip_units(None, 10))


class TestCutsFitTheServerCaps(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dashclaw_cap_units_")
        self._old_cwd = dashclaw_pretool._HOOK_CWD
        dashclaw_pretool._HOOK_CWD = self.dir

    def tearDown(self):
        dashclaw_pretool._HOOK_CWD = self._old_cwd
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_shell_goal_with_an_emoji_fits_2000(self):
        tool_input = {"command": "echo " + ROBOT + " " + "x" * 3000}
        goal = dashclaw_pretool._enrich_bash(tool_input, classify_tool("Bash", tool_input))["declared_goal"]
        self.assertLessEqual(units(goal), 2000)
        # Still as much of the command as the cap allows.
        self.assertGreaterEqual(units(goal), 1999)

    def test_shell_goal_without_an_emoji_still_uses_the_whole_cap(self):
        tool_input = {"command": "echo " + "x" * 3000}
        goal = dashclaw_pretool._enrich_bash(tool_input, classify_tool("Bash", tool_input))["declared_goal"]
        self.assertEqual(units(goal), 2000)

    def test_shell_act_command_with_an_emoji_fits_8192(self):
        act = dashclaw_pretool._build_act("Bash", {"command": "echo " + ROBOT + " " + "x" * 9000})
        self.assertLessEqual(units(act["command"]), 8192)

    def test_file_act_excerpt_with_an_emoji_fits_4096(self):
        act = dashclaw_pretool._build_act("Write", {"file_path": "notes.md", "content": ROBOT + "x" * 5000})
        self.assertLessEqual(units(act["file"]["content_excerpt"]), 4096)

    def test_script_excerpt_with_an_emoji_fits_6144(self):
        with open(os.path.join(self.dir, "big.mjs"), "w", encoding="utf-8") as f:
            f.write("// " + ROBOT + "\n" + "x" * 7000)
        act = dashclaw_pretool._build_act("Bash", {"command": "node big.mjs"})
        self.assertLessEqual(units(act["script"]["content_excerpt"]), 6144)

    def test_scanned_content_with_an_emoji_fits_50000(self):
        context = {}
        dashclaw_pretool._attach_autoscan_content(
            context, "Write", {"file_path": "notes.md", "content": ROBOT + "x" * 60000}
        )
        self.assertLessEqual(units(context["content"]), 50000)


if __name__ == "__main__":
    unittest.main()
