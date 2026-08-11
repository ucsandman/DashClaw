"""The guard scorer matches systems_touched against a DECLARED-SYSTEM
vocabulary (app/lib/guard/risk.ts: filesystem/shell moderate, database/
production/postgres/neon/redis high). This hook used to forward its own
internal tool CATEGORY instead ("execution", "file_io", ...), which shares no
word with that vocabulary, so systemsTouchedFactors() returned [] on every
Claude Code tool call and the +10/+5 modifiers were dead on this path.

These tests pin the two halves of the contract: the map only ever emits words
the scorer knows, and no category is silently forwarded raw.
"""

import os
import sys
import unittest

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HOOKS_DIR)

import dashclaw_pretool  # noqa: E402

# Mirrors app/lib/guard/risk.ts. If the scorer's lists change, this test fails
# rather than letting the hook drift back into emitting words nothing scores.
HIGH_RISK_SYSTEMS = ["production", "database", "postgres", "neon", "redis"]
MODERATE_RISK_SYSTEMS = ["filesystem", "shell"]
SCORED_SYSTEMS = set(HIGH_RISK_SYSTEMS + MODERATE_RISK_SYSTEMS)

# The categories _enrich_default knows how to map to an action_type; the same
# set tool_info["category"] can hold.
CATEGORIES = ["execution", "orchestration", "file_io", "interactive", "mcp", "unknown"]


class TestCategorySystemsMap(unittest.TestCase):
    def test_map_exists(self):
        self.assertTrue(hasattr(dashclaw_pretool, "CATEGORY_SYSTEMS"))

    def test_every_emitted_system_is_one_the_scorer_actually_scores(self):
        for category, systems in dashclaw_pretool.CATEGORY_SYSTEMS.items():
            for system in systems:
                self.assertIn(
                    system,
                    SCORED_SYSTEMS,
                    "category %r emits %r, which no risk factor matches" % (category, system),
                )

    def test_no_category_is_forwarded_as_its_own_name(self):
        # The original bug: systems_touched = [tool_info["category"]].
        for category, systems in dashclaw_pretool.CATEGORY_SYSTEMS.items():
            self.assertNotIn(
                category,
                systems,
                "category %r forwards itself; the scorer has no such system" % category,
            )

    def test_the_two_categories_that_touch_a_real_system_are_mapped(self):
        self.assertEqual(dashclaw_pretool.CATEGORY_SYSTEMS.get("file_io"), ["filesystem"])
        self.assertEqual(dashclaw_pretool.CATEGORY_SYSTEMS.get("execution"), ["shell"])

    def test_categories_touching_no_declared_system_stay_empty(self):
        # orchestration/interactive/mcp/unknown have no filesystem or shell of
        # their own; inventing one would inflate the floor on nothing.
        for category in ["orchestration", "interactive", "mcp", "unknown"]:
            self.assertEqual(dashclaw_pretool.CATEGORY_SYSTEMS.get(category, []), [])

    def test_map_covers_no_unknown_category(self):
        for category in dashclaw_pretool.CATEGORY_SYSTEMS:
            self.assertIn(category, CATEGORIES)


class TestGuardContextUsesTheMap(unittest.TestCase):
    def _context(self, category):
        tool_info = {
            "category": category,
            "required_permission": "ask",
            "risk_profile": {"base_risk": 30},
        }
        enrichment = {
            "action_type": "apply",
            "declared_goal": "Write: /tmp/x",
            "risk_score": 30,
            "reversible": True,
            "intel": {},
        }
        return dashclaw_pretool._build_guard_context("Write", tool_info, enrichment, {})

    def test_file_io_declares_filesystem(self):
        self.assertEqual(self._context("file_io")["systems_touched"], ["filesystem"])

    def test_execution_declares_shell(self):
        self.assertEqual(self._context("execution")["systems_touched"], ["shell"])

    def test_unmapped_category_declares_nothing(self):
        self.assertEqual(self._context("mcp")["systems_touched"], [])

    def test_category_is_still_reported_under_tool(self):
        # The internal category is not lost — it stays on the tool descriptor,
        # which is where it was always meant to be read from.
        self.assertEqual(self._context("file_io")["tool"]["category"], "file_io")


if __name__ == "__main__":
    unittest.main()
