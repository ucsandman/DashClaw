"""Tests for dashclaw_agent_intel.tool_recognizer.classify_tool."""

import os
import unittest

from dashclaw_agent_intel.tool_recognizer import (
    PERMISSION_LEVELS,
    TOOL_CATALOG,
    classify_tool,
)


# ---------------------------------------------------------------------------
# Catalog completeness
# ---------------------------------------------------------------------------

class TestCatalogCompleteness(unittest.TestCase):
    """The tool catalog must contain 40+ tools with all required fields."""

    def test_catalog_has_at_least_40_tools(self):
        self.assertGreaterEqual(len(TOOL_CATALOG), 40)

    def test_every_tool_has_required_fields(self):
        required = {"category", "required_permission", "risk_profile"}
        for tool_name, entry in TOOL_CATALOG.items():
            with self.subTest(tool=tool_name):
                self.assertTrue(
                    required.issubset(entry.keys()),
                    f"{tool_name} missing keys: {required - entry.keys()}",
                )

    def test_every_risk_profile_has_required_keys(self):
        profile_keys = {
            "base_risk",
            "can_spawn_processes",
            "can_access_network",
            "can_modify_files",
            "can_escalate_permissions",
        }
        for tool_name, entry in TOOL_CATALOG.items():
            with self.subTest(tool=tool_name):
                rp = entry["risk_profile"]
                self.assertTrue(
                    profile_keys.issubset(rp.keys()),
                    f"{tool_name} risk_profile missing: {profile_keys - rp.keys()}",
                )


# ---------------------------------------------------------------------------
# Specific tool classifications
# ---------------------------------------------------------------------------

class TestSpecificTools(unittest.TestCase):
    """Spot-check individual tools against expected category/permission."""

    def test_bash_execution_danger(self):
        r = classify_tool("Bash", {"command": "ls"})
        self.assertEqual(r["category"], "execution")
        self.assertEqual(r["required_permission"], "danger")

    def test_read_search_readonly(self):
        r = classify_tool("Read", {"file_path": "/tmp/a.txt"})
        self.assertEqual(r["category"], "search")
        self.assertEqual(r["required_permission"], "readonly")

    def test_write_file_io_workspace_write(self):
        r = classify_tool("Write", {"file_path": "/tmp/a.txt", "content": "x"})
        self.assertEqual(r["category"], "file_io")
        self.assertEqual(r["required_permission"], "workspace_write")

    def test_agent_orchestration_danger(self):
        r = classify_tool("Agent", {"prompt": "do something"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "danger")

    def test_workflow_orchestration_danger(self):
        """v4.3: Workflow (dynamic-workflow fan-out) mirrors Agent/Task."""
        r = classify_tool("Workflow", {"prompt": "fan out"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "danger")

    def test_sleep_system_allow(self):
        r = classify_tool("Sleep", {})
        self.assertEqual(r["category"], "system")
        self.assertEqual(r["required_permission"], "allow")

    def test_edit_file_io(self):
        r = classify_tool("Edit", {"file_path": "a.py", "old_string": "x", "new_string": "y"})
        self.assertEqual(r["category"], "file_io")
        self.assertEqual(r["required_permission"], "workspace_write")

    def test_glob_search_readonly(self):
        r = classify_tool("Glob", {"pattern": "*.py"})
        self.assertEqual(r["category"], "search")
        self.assertEqual(r["required_permission"], "readonly")

    def test_grep_search_readonly(self):
        r = classify_tool("Grep", {"pattern": "TODO"})
        self.assertEqual(r["category"], "search")
        self.assertEqual(r["required_permission"], "readonly")

    def test_skill_orchestration_danger(self):
        r = classify_tool("Skill", {"skill": "commit"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "danger")

    def test_task_create_orchestration_workspace_write(self):
        r = classify_tool("TaskCreate", {"description": "something"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "workspace_write")

    def test_task_stop_orchestration_workspace_write(self):
        r = classify_tool("TaskStop", {"task_id": "1"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "workspace_write")

    def test_task_update_orchestration_workspace_write(self):
        r = classify_tool("TaskUpdate", {"task_id": "1"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "workspace_write")

    def test_ask_user_question_interactive_prompt(self):
        r = classify_tool("AskUserQuestion", {"question": "proceed?"})
        self.assertEqual(r["category"], "interactive")
        self.assertEqual(r["required_permission"], "prompt")

    def test_send_user_message_interactive_prompt(self):
        r = classify_tool("SendUserMessage", {"message": "done"})
        self.assertEqual(r["category"], "interactive")
        self.assertEqual(r["required_permission"], "prompt")

    def test_repl_execution_danger(self):
        r = classify_tool("REPL", {"code": "1+1"})
        self.assertEqual(r["category"], "execution")
        self.assertEqual(r["required_permission"], "danger")

    def test_powershell_execution_danger(self):
        r = classify_tool("PowerShell", {"command": "Get-Process"})
        self.assertEqual(r["category"], "execution")
        self.assertEqual(r["required_permission"], "danger")


# ---------------------------------------------------------------------------
# MCP tool recognition
# ---------------------------------------------------------------------------

class TestMCPToolRecognition(unittest.TestCase):
    """Tools starting with 'mcp__' should be recognized as MCP tools."""

    def test_mcp_tool_category(self):
        r = classify_tool("mcp__chrome-devtools__click", {"selector": "button"})
        self.assertEqual(r["category"], "mcp")

    def test_mcp_tool_default_permission(self):
        r = classify_tool("mcp__some_server__some_tool", {})
        self.assertEqual(r["required_permission"], "workspace_write")

    def test_mcp_tool_governed(self):
        r = classify_tool("mcp__context7__query-docs", {})
        self.assertTrue(r["governed"])


# ---------------------------------------------------------------------------
# Unknown tool handling
# ---------------------------------------------------------------------------

class TestUnknownToolHandling(unittest.TestCase):
    """Unrecognized tools must default to governed=True (fail-safe)."""

    def test_unknown_tool_category(self):
        r = classify_tool("TotallyFakeToolXYZ", {})
        self.assertEqual(r["category"], "unknown")

    def test_unknown_tool_default_governed(self):
        r = classify_tool("TotallyFakeToolXYZ", {})
        self.assertTrue(r["governed"])

    def test_unknown_tool_default_permission(self):
        r = classify_tool("TotallyFakeToolXYZ", {})
        self.assertEqual(r["required_permission"], "workspace_write")


# ---------------------------------------------------------------------------
# Governance defaults
# ---------------------------------------------------------------------------

class TestGovernanceDefaults(unittest.TestCase):
    """Default governed: execution, orchestration, file_io, interactive, mcp.
    Default ungoverned: search, system."""

    def test_execution_governed_by_default(self):
        r = classify_tool("Bash", {"command": "ls"})
        self.assertTrue(r["governed"])

    def test_orchestration_governed_by_default(self):
        r = classify_tool("Agent", {"prompt": "do it"})
        self.assertTrue(r["governed"])

    def test_file_io_governed_by_default(self):
        r = classify_tool("Write", {"file_path": "a.txt", "content": ""})
        self.assertTrue(r["governed"])

    def test_interactive_governed_by_default(self):
        r = classify_tool("AskUserQuestion", {"question": "ok?"})
        self.assertTrue(r["governed"])

    def test_mcp_governed_by_default(self):
        r = classify_tool("mcp__x__y", {})
        self.assertTrue(r["governed"])

    def test_search_ungoverned_by_default(self):
        r = classify_tool("Read", {"file_path": "a.txt"})
        self.assertFalse(r["governed"])

    def test_system_ungoverned_by_default(self):
        r = classify_tool("Sleep", {})
        self.assertFalse(r["governed"])


# ---------------------------------------------------------------------------
# DASHCLAW_GOVERNED_CATEGORIES env override
# ---------------------------------------------------------------------------

class TestGovernedCategoriesEnvOverride(unittest.TestCase):
    """DASHCLAW_GOVERNED_CATEGORIES env var controls which categories are governed."""

    def setUp(self):
        self._orig = os.environ.get("DASHCLAW_GOVERNED_CATEGORIES")

    def tearDown(self):
        if self._orig is None:
            os.environ.pop("DASHCLAW_GOVERNED_CATEGORIES", None)
        else:
            os.environ["DASHCLAW_GOVERNED_CATEGORIES"] = self._orig

    def test_all_overrides_everything(self):
        os.environ["DASHCLAW_GOVERNED_CATEGORIES"] = "all"
        # system is normally ungoverned; "all" should make it governed.
        r = classify_tool("Sleep", {})
        self.assertTrue(r["governed"])

    def test_custom_categories(self):
        os.environ["DASHCLAW_GOVERNED_CATEGORIES"] = "search,system"
        # search is now governed.
        r_search = classify_tool("Read", {"file_path": "a.txt"})
        self.assertTrue(r_search["governed"])
        # execution is NOT in the list, so ungoverned.
        r_exec = classify_tool("Bash", {"command": "ls"})
        self.assertFalse(r_exec["governed"])


# ---------------------------------------------------------------------------
# Return shape
# ---------------------------------------------------------------------------

class TestReturnShape(unittest.TestCase):
    """classify_tool always returns a well-formed dict."""

    def test_all_keys_present(self):
        r = classify_tool("Bash", {"command": "ls"})
        for key in ("tool_name", "category", "required_permission", "governed", "risk_profile"):
            self.assertIn(key, r, f"Missing key: {key}")

    def test_risk_profile_keys(self):
        r = classify_tool("Bash", {"command": "ls"})
        rp = r["risk_profile"]
        for key in ("base_risk", "can_spawn_processes", "can_access_network",
                     "can_modify_files", "can_escalate_permissions"):
            self.assertIn(key, rp, f"Missing risk_profile key: {key}")


# ---------------------------------------------------------------------------
# PERMISSION_LEVELS constant
# ---------------------------------------------------------------------------

class TestPermissionLevels(unittest.TestCase):
    """PERMISSION_LEVELS is an ordered list of the five permission tiers."""

    def test_contains_all_levels(self):
        expected = {"readonly", "workspace_write", "danger", "prompt", "allow"}
        self.assertEqual(set(PERMISSION_LEVELS), expected)

    def test_is_list(self):
        self.assertIsInstance(PERMISSION_LEVELS, list)


if __name__ == "__main__":
    unittest.main()
