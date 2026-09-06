"""Tests for dashclaw_scope_sync.py -- the SessionStart hook that turns a
role's blocked_tools into Claude Code permissions.deny rules.

Stdlib only. The hook's core is injectable (`run(..., fetch)`), so these tests
exercise the real translation + merge + ownership logic without a network call
or a subprocess -- `fetch` is a plain callable returning a policies list or
None (unreachable). Filesystem effects land in a per-test tempdir.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dashclaw_scope_sync as sync


def _role(blocked, active=True, name="Reviewer"):
    return {
        "name": name,
        "policy_type": "role_constraint",
        "active": active,
        "rules": json.dumps({"blocked_tools": blocked}),
    }


class TestTranslatePattern(unittest.TestCase):
    def test_translation_table(self):
        cases = {
            "Bash": "Bash",
            "Write": "Write",
            "mcp__xapi__search": "mcp__xapi__search",
            "mcp__xapi__*": "mcp__xapi",
            "mcp__github__*": "mcp__github",
        }
        for pat, expected in cases.items():
            self.assertEqual(sync.translate_pattern(pat), expected, pat)

    def test_inexpressible_globs_are_skipped(self):
        # A `*` anywhere but the whole trailing __* segment cannot be a deny rule.
        for pat in ["mcp__a__*__b", "mcp__*__search", "Wr*te", "*", "mcp__x__sea*"]:
            self.assertIsNone(sync.translate_pattern(pat), pat)

    def test_translate_all_counts_skips_and_dedupes(self):
        entries, skipped = sync._translate_all(
            ["Bash", "mcp__xapi__*", "mcp__*__x", "Bash"]
        )
        self.assertEqual(entries, ["Bash", "mcp__xapi"])
        self.assertEqual(skipped, 1)


class TestBlockedToolsFromPolicies(unittest.TestCase):
    def test_unions_active_role_constraints_only(self):
        policies = [
            _role(["Write"]),
            _role(["Bash", "Write"], name="Deployer"),
            _role(["mcp__xapi__*"], active=False),          # inactive -> ignored
            {"policy_type": "risk_threshold", "active": True,  # wrong type -> ignored
             "rules": json.dumps({"blocked_tools": ["Grep"]})},
        ]
        self.assertEqual(sync.blocked_tools_from_policies(policies), ["Write", "Bash"])

    def test_tolerates_bad_rows(self):
        policies = [None, {"policy_type": "role_constraint", "active": True, "rules": "{bad json"}]
        self.assertEqual(sync.blocked_tools_from_policies(policies), [])


class TestSyncDeny(unittest.TestCase):
    def setUp(self):
        self._ctx = tempfile.TemporaryDirectory()
        self.project = self._ctx.name
        self.settings_path = os.path.join(self.project, ".claude", "settings.local.json")
        self.scope_path = os.path.join(self.project, ".claude", ".dashclaw-scope.json")

    def tearDown(self):
        self._ctx.cleanup()

    def _read_settings(self):
        with open(self.settings_path, "r", encoding="utf-8") as f:
            return f.read()

    def test_fresh_file_created_with_only_permissions_deny(self):
        added, removed = sync.sync_deny(self.project, "claude-code", ["Write", "mcp__xapi"])
        self.assertEqual((added, removed), (2, 0))
        raw = self._read_settings()
        self.assertTrue(raw.endswith("\n"))
        data = json.loads(raw)
        self.assertEqual(data, {"permissions": {"deny": ["Write", "mcp__xapi"]}})
        scope = json.load(open(self.scope_path, encoding="utf-8"))
        self.assertEqual(scope["entries"], ["Write", "mcp__xapi"])
        self.assertEqual(scope["agent_id"], "claude-code")

    def test_merge_preserves_unrelated_entries_and_other_keys(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w", encoding="utf-8") as f:
            json.dump({
                "permissions": {"deny": ["Read(/etc/**)"], "allow": ["Bash"]},
                "env": {"FOO": "bar"},
            }, f, indent=2)
            f.write("\n")

        sync.sync_deny(self.project, "a1", ["Write"])
        data = json.loads(self._read_settings())
        self.assertIn("Read(/etc/**)", data["permissions"]["deny"])   # untouched
        self.assertIn("Write", data["permissions"]["deny"])           # added
        self.assertEqual(data["permissions"]["allow"], ["Bash"])      # preserved
        self.assertEqual(data["env"], {"FOO": "bar"})                 # preserved

    def test_stale_owned_entry_is_removed(self):
        sync.sync_deny(self.project, "a1", ["Write", "Bash"])
        # Second run no longer blocks Bash -> our owned Bash is dropped.
        added, removed = sync.sync_deny(self.project, "a1", ["Write"])
        self.assertEqual(removed, 1)
        data = json.loads(self._read_settings())
        self.assertEqual(data["permissions"]["deny"], ["Write"])

    def test_does_not_remove_entries_it_did_not_add(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w", encoding="utf-8") as f:
            json.dump({"permissions": {"deny": ["Bash"]}}, f, indent=2)
            f.write("\n")
        # A user placed Bash manually; a later run blocks nothing -> Bash stays.
        sync.sync_deny(self.project, "a1", [])
        data = json.loads(self._read_settings())
        self.assertEqual(data["permissions"]["deny"], ["Bash"])

    def test_unparseable_settings_is_left_untouched(self):
        os.makedirs(os.path.dirname(self.settings_path))
        with open(self.settings_path, "w", encoding="utf-8") as f:
            f.write("{ this is not json ")
        result = sync.sync_deny(self.project, "a1", ["Write"])
        self.assertIsNone(result)
        self.assertEqual(self._read_settings(), "{ this is not json ")  # byte-for-byte

    def test_no_op_when_nothing_to_do_and_no_file(self):
        result = sync.sync_deny(self.project, "a1", [])
        self.assertEqual(result, (0, 0))
        self.assertFalse(os.path.exists(self.settings_path))
        self.assertFalse(os.path.exists(self.scope_path))


class TestRun(unittest.TestCase):
    def setUp(self):
        self._ctx = tempfile.TemporaryDirectory()
        self.project = self._ctx.name

    def tearDown(self):
        self._ctx.cleanup()

    def _settings(self):
        path = os.path.join(self.project, ".claude", "settings.local.json")
        if not os.path.exists(path):
            return None
        return json.load(open(path, encoding="utf-8"))

    def test_happy_path_writes_deny(self):
        summary = sync.run(
            self.project, "https://x", "key", "a1",
            fetch=lambda: [_role(["Write", "mcp__xapi__*", "mcp__*__x"])],
        )
        self.assertEqual(summary, {"denied": 2, "added": 2, "removed": 0, "skipped": 1})
        self.assertEqual(self._settings()["permissions"]["deny"], ["Write", "mcp__xapi"])

    def test_server_down_leaves_file_untouched(self):
        # Seed an existing file, then a run whose fetch returns None must not touch it.
        sync.run(self.project, "https://x", "key", "a1", fetch=lambda: [_role(["Write"])])
        before = json.dumps(self._settings(), sort_keys=True)
        summary = sync.run(self.project, "https://x", "key", "a1", fetch=lambda: None)
        self.assertEqual(summary, {"denied": 0, "added": 0, "removed": 0, "skipped": 0})
        self.assertEqual(json.dumps(self._settings(), sort_keys=True), before)

    def test_missing_url_or_key_writes_nothing(self):
        called = {"n": 0}

        def _fetch():
            called["n"] += 1
            return []

        self.assertEqual(
            sync.run(self.project, "", "key", "a1", fetch=_fetch),
            {"denied": 0, "added": 0, "removed": 0, "skipped": 0},
        )
        self.assertEqual(
            sync.run(self.project, "https://x", "", "a1", fetch=_fetch),
            {"denied": 0, "added": 0, "removed": 0, "skipped": 0},
        )
        self.assertEqual(called["n"], 0)          # fetch never attempted
        self.assertIsNone(self._settings())       # nothing written


if __name__ == "__main__":
    unittest.main()
