"""Governance-scope visibility: DASHCLAW_GOVERNED_CATEGORIES must not be silent.

Adversarial review 2026-08-11: the env var narrows governance on the operator's
own machine and main() exits before any network call for an excluded category,
so the server never learned those tool calls happened. Unlike
DASHCLAW_HOOK_MODE=observe — visible on every decision via enforcement_mode —
narrowing produced no row, no witness and no signal, and the dashboard read
green while shell commands and file writes ran unwatched.
"""

import os
import unittest
from unittest import mock

from dashclaw_agent_intel.tool_recognizer import (
    ungoverned_default_categories,
    _DEFAULT_GOVERNED_CATEGORIES,
)


def _with_env(value):
    """Env context where DASHCLAW_GOVERNED_CATEGORIES is *value* (None = unset)."""
    env = dict(os.environ)
    env.pop("DASHCLAW_GOVERNED_CATEGORIES", None)
    if value is not None:
        env["DASHCLAW_GOVERNED_CATEGORIES"] = value
    return mock.patch.dict(os.environ, env, clear=True)


class TestUngovernedDefaultCategories(unittest.TestCase):
    def test_default_posture_reports_nothing(self):
        # search/system are ungoverned out of the box by design. Reporting them
        # would light up every healthy install permanently, which is how a red
        # signal becomes wallpaper.
        with _with_env(None):
            self.assertEqual(ungoverned_default_categories(), [])

    def test_all_reports_nothing(self):
        with _with_env("all"):
            self.assertEqual(ungoverned_default_categories(), [])

    def test_narrowing_reports_every_dropped_default_category(self):
        # The critic's example: an operator narrows to one category and every
        # other default silently stops being governed.
        with _with_env("mcp"):
            missing = ungoverned_default_categories()
        self.assertEqual(missing, sorted(_DEFAULT_GOVERNED_CATEGORIES - {"mcp"}))
        self.assertIn("execution", missing)
        self.assertIn("file_io", missing)

    def test_a_typo_surfaces_as_the_category_it_dropped(self):
        # "executon" governs nothing; the real risk is that it reads like it
        # does. The report has to name `execution` as missing.
        with _with_env("executon,file_io,orchestration,interactive,mcp"):
            self.assertEqual(ungoverned_default_categories(), ["execution"])

    def test_result_is_sorted_and_stable(self):
        with _with_env("interactive"):
            first = ungoverned_default_categories()
            second = ungoverned_default_categories()
        self.assertEqual(first, second)
        self.assertEqual(first, sorted(first))


class TestHookForwardsTheGap(unittest.TestCase):
    """The gap has to ride on the calls the hook DOES still make."""

    def _context(self):
        import dashclaw_pretool
        return dashclaw_pretool._build_guard_context(
            "Bash",
            {"name": "Bash", "category": "execution", "required_permission": "execute"},
            {"action_type": "other", "risk_score": 10, "reversible": True,
             "declared_goal": "Bash: echo hi", "target": None, "intel": {}},
            {"command": "echo hi"},
        )

    def test_absent_at_the_default_posture(self):
        with _with_env(None):
            ctx = self._context()
        self.assertNotIn("ungoverned_categories", ctx)

    def test_present_and_named_when_narrowed(self):
        with _with_env("mcp"):
            ctx = self._context()
        self.assertIn("ungoverned_categories", ctx)
        self.assertIn("execution", ctx["ungoverned_categories"])
        self.assertIn("file_io", ctx["ungoverned_categories"])


if __name__ == "__main__":
    unittest.main()
