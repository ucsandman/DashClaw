"""Tests for dashclaw_agent_intel.bash_classifier.classify_bash."""

import unittest
from dashclaw_agent_intel.bash_classifier import classify_bash


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

class TestIntentClassification(unittest.TestCase):
    """Verify the ``intent`` field for representative commands."""

    def test_cat_is_readonly(self):
        r = classify_bash("cat README.md")
        self.assertEqual(r["intent"], "readonly")

    def test_grep_is_readonly(self):
        r = classify_bash("grep -rn TODO src/")
        self.assertEqual(r["intent"], "readonly")

    def test_git_log_is_readonly(self):
        r = classify_bash("git log --oneline -10")
        self.assertEqual(r["intent"], "readonly")

    def test_git_push_is_write(self):
        r = classify_bash("git push origin main")
        self.assertEqual(r["intent"], "write")

    def test_git_reset_hard_is_destructive(self):
        r = classify_bash("git reset --hard HEAD~1")
        self.assertEqual(r["intent"], "destructive")

    def test_rm_rf_is_destructive(self):
        r = classify_bash("rm -rf /tmp/build")
        self.assertEqual(r["intent"], "destructive")

    def test_curl_is_network(self):
        r = classify_bash("curl https://example.com")
        self.assertEqual(r["intent"], "network")

    def test_npm_install_is_package_management(self):
        r = classify_bash("npm install express")
        self.assertEqual(r["intent"], "package_management")

    def test_kill_is_process_management(self):
        r = classify_bash("kill -9 1234")
        self.assertEqual(r["intent"], "process_management")

    def test_sudo_apt_is_system_admin(self):
        r = classify_bash("sudo apt install nginx")
        self.assertEqual(r["intent"], "system_admin")

    def test_empty_command_is_unknown(self):
        r = classify_bash("")
        self.assertEqual(r["intent"], "unknown")


# ---------------------------------------------------------------------------
# Validation submodules
# ---------------------------------------------------------------------------

class TestReadonlyValidation(unittest.TestCase):
    """Submodule 1: read_only_validation."""

    def test_readonly_blocks_write_command(self):
        r = classify_bash("cp a.txt b.txt", mode="readonly")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("read_only_validation", checks)
        self.assertEqual(checks["read_only_validation"]["result"], "block")

    def test_readonly_allows_safe_command(self):
        r = classify_bash("ls -la", mode="readonly")
        checks = {v["check"]: v for v in r["validations"]}
        # read_only_validation should either be absent or 'allow'
        if "read_only_validation" in checks:
            self.assertEqual(checks["read_only_validation"]["result"], "allow")

    def test_readonly_blocks_redirection(self):
        r = classify_bash("echo hello > file.txt", mode="readonly")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("read_only_validation", checks)
        self.assertEqual(checks["read_only_validation"]["result"], "block")


class TestDestructiveCommandValidation(unittest.TestCase):
    """Submodule 2: destructive_command."""

    def test_rm_rf_warns(self):
        r = classify_bash("rm -rf /tmp/build")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertIn(checks["destructive_command"]["result"], ("warn", "block"))

    def test_rm_rf_root_blocks(self):
        r = classify_bash("rm -rf /")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertEqual(checks["destructive_command"]["result"], "block")

    def test_fork_bomb_blocks(self):
        r = classify_bash(":(){ :|:& };:")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertEqual(checks["destructive_command"]["result"], "block")

    def test_mkfs_blocks(self):
        r = classify_bash("mkfs.ext4 /dev/sda1")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertEqual(checks["destructive_command"]["result"], "block")

    def test_dd_blocks(self):
        r = classify_bash("dd if=/dev/zero of=/dev/sda")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertEqual(checks["destructive_command"]["result"], "block")

    def test_bounded_rm_allows(self):
        r = classify_bash("rm build-output.txt")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertEqual(checks["destructive_command"]["result"], "allow")

    def test_rm_f_single_file_allows(self):
        # -f without -r is still bounded (force, not recursive).
        r = classify_bash("rm -f stale.lock")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertEqual(checks["destructive_command"]["result"], "allow")

    def test_rm_glob_warns(self):
        r = classify_bash("rm *.log")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertEqual(checks["destructive_command"]["result"], "warn")

    def test_rm_r_without_f_warns(self):
        r = classify_bash("rm -r build/")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertEqual(checks["destructive_command"]["result"], "warn")

    def test_rm_r_root_blocks(self):
        # Recursive root delete blocks even without -f.
        r = classify_bash("rm -r /")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertEqual(checks["destructive_command"]["result"], "block")


class TestModeValidation(unittest.TestCase):
    """Submodule 3: mode_validation."""

    def test_workspace_write_warns_system_path(self):
        r = classify_bash("cp file /etc/config", mode="workspace_write")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("mode_validation", checks)
        self.assertEqual(checks["mode_validation"]["result"], "warn")


class TestSedValidation(unittest.TestCase):
    """Submodule 4: sed_validation."""

    def test_sed_i_blocked_in_readonly(self):
        r = classify_bash("sed -i 's/old/new/' file.txt", mode="readonly")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("sed_validation", checks)
        self.assertEqual(checks["sed_validation"]["result"], "block")

    def test_sed_stdout_allowed_in_readonly(self):
        r = classify_bash("sed 's/old/new/' file.txt", mode="readonly")
        checks = {v["check"]: v for v in r["validations"]}
        if "sed_validation" in checks:
            self.assertEqual(checks["sed_validation"]["result"], "allow")

    def test_sed_i_warns_in_workspace_write(self):
        r = classify_bash("sed -i 's/old/new/' file.txt", mode="workspace_write")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("sed_validation", checks)
        self.assertEqual(checks["sed_validation"]["result"], "warn")


class TestPathValidation(unittest.TestCase):
    """Submodule 5: path_validation."""

    def test_path_traversal_warned(self):
        r = classify_bash("cat ../../etc/passwd")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("path_validation", checks)
        self.assertEqual(checks["path_validation"]["result"], "warn")

    def test_home_ref_warned(self):
        r = classify_bash("rm ~/important.txt")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("path_validation", checks)
        self.assertEqual(checks["path_validation"]["result"], "warn")


class TestCommandSemanticsValidation(unittest.TestCase):
    """Submodule 6: command_semantics — always runs, always 'allow'."""

    def test_semantics_always_present(self):
        r = classify_bash("ls -la")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("command_semantics", checks)
        self.assertEqual(checks["command_semantics"]["result"], "allow")


# ---------------------------------------------------------------------------
# Risk score
# ---------------------------------------------------------------------------

class TestRiskScore(unittest.TestCase):
    """Risk score computation."""

    def test_readonly_low_risk(self):
        r = classify_bash("cat README.md")
        self.assertLessEqual(r["risk_score"], 20)

    def test_destructive_high_risk(self):
        r = classify_bash("rm -rf /tmp/build")
        self.assertGreaterEqual(r["risk_score"], 85)

    def test_git_push_moderate_risk(self):
        r = classify_bash("git push origin main")
        # write base = 35, no boosts expected -> moderate
        self.assertGreaterEqual(r["risk_score"], 30)
        self.assertLessEqual(r["risk_score"], 60)

    def test_sensitive_target_boosts_risk(self):
        r = classify_bash("cat .env")
        self.assertGreaterEqual(r["risk_score"], 20)  # base 5 + 15 = 20

    def test_risk_capped_at_100(self):
        r = classify_bash("rm -rf /")
        self.assertLessEqual(r["risk_score"], 100)

    def test_bounded_rm_graded_below_block_band(self):
        # Single explicit file delete: irreversible but routine — warn band.
        r = classify_bash("rm build-output.txt")
        self.assertEqual(r["intent"], "destructive")
        self.assertLessEqual(r["risk_score"], 60)
        self.assertGreaterEqual(r["risk_score"], 35)

    def test_recursive_rm_keeps_full_destructive_risk(self):
        r = classify_bash("rm -rf node_modules")
        self.assertGreaterEqual(r["risk_score"], 90)

    def test_env_prefix_classifies_real_command(self):
        # KEY=value prefixes (e.g. fake dry-run creds) must not collapse the
        # command to "unknown" or trip the sensitive-target boost.
        r = classify_bash("STRIPE_SECRET_KEY=sk_test_123 API_TOKEN=fake npm run dry-run")
        self.assertEqual(r["intent"], "package_management")
        self.assertLessEqual(r["risk_score"], 40)

    def test_placeholder_env_file_not_boosted(self):
        plain = classify_bash("cat README.md")
        placeholder = classify_bash("cat .env.example")
        self.assertEqual(placeholder["risk_score"], plain["risk_score"])

    def test_real_env_file_still_boosted(self):
        r = classify_bash("cat .env")
        self.assertGreaterEqual(r["risk_score"], 20)


# ---------------------------------------------------------------------------
# Reversibility
# ---------------------------------------------------------------------------

class TestReversibility(unittest.TestCase):
    """Only destructive commands are irreversible."""

    def test_readonly_is_reversible(self):
        r = classify_bash("cat file.txt")
        self.assertTrue(r["reversible"])

    def test_write_is_reversible(self):
        r = classify_bash("cp a.txt b.txt")
        self.assertTrue(r["reversible"])

    def test_destructive_is_irreversible(self):
        r = classify_bash("rm -rf /tmp/build")
        self.assertFalse(r["reversible"])

    def test_network_is_reversible(self):
        r = classify_bash("curl https://example.com")
        self.assertTrue(r["reversible"])


# ---------------------------------------------------------------------------
# Return shape
# ---------------------------------------------------------------------------

class TestReturnShape(unittest.TestCase):
    """classify_bash always returns a well-formed dict."""

    def test_all_keys_present(self):
        r = classify_bash("ls")
        for key in ("intent", "risk_score", "reversible", "validations", "parsed"):
            self.assertIn(key, r)

    def test_parsed_comes_from_parser(self):
        r = classify_bash("git push origin main")
        self.assertEqual(r["parsed"]["base_command"], "git")
        self.assertEqual(r["parsed"]["subcommand"], "push")


# ---------------------------------------------------------------------------
# Wrapper detection
# ---------------------------------------------------------------------------

class TestWrapperDetection(unittest.TestCase):
    """Wrappers like sudo should be unwrapped for classification."""

    def test_sudo_wrapper_detected(self):
        r = classify_bash("sudo rm -rf /tmp/build")
        self.assertEqual(r["intent"], "destructive")
        self.assertEqual(r["parsed"]["wrapper"], "sudo")


# ---------------------------------------------------------------------------
# Interpreter commands (node, python, etc.)
# ---------------------------------------------------------------------------

class TestInterpreterClassification(unittest.TestCase):
    """Interpreters get honest scoring instead of the unknown-command fallback.

    Before this intent existed, `node -e` classified as "unknown" and the
    pretool hook pinned it to the Bash tool's blunt base risk (70) — exactly
    RISK_HIGH_MIN — so every inline node/python invocation hit the block band
    by accident, not by analysis.
    """

    def test_node_script_is_interpreter(self):
        r = classify_bash("node scripts/build.js")
        self.assertEqual(r["intent"], "interpreter")

    def test_node_script_lands_in_allow_band(self):
        r = classify_bash("node scripts/build.js")
        self.assertLess(r["risk_score"], 40)

    def test_python_script_is_interpreter(self):
        r = classify_bash("python scripts/gen_report.py")
        self.assertEqual(r["intent"], "interpreter")
        self.assertLess(r["risk_score"], 40)

    def test_node_inline_eval_warns(self):
        r = classify_bash("node -e \"console.log(require('./package.json').version)\"")
        self.assertEqual(r["intent"], "interpreter")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("interpreter_validation", checks)
        self.assertEqual(checks["interpreter_validation"]["result"], "warn")

    def test_node_inline_eval_lands_in_warn_band(self):
        r = classify_bash("node -e \"console.log(1)\"")
        self.assertGreaterEqual(r["risk_score"], 40)
        self.assertLess(r["risk_score"], 70)

    def test_python_dash_c_lands_in_warn_band(self):
        r = classify_bash("python -c 'print(1+1)'")
        self.assertEqual(r["intent"], "interpreter")
        self.assertGreaterEqual(r["risk_score"], 40)
        self.assertLess(r["risk_score"], 70)

    def test_deno_eval_subcommand_warns(self):
        r = classify_bash("deno eval 'console.log(1)'")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("interpreter_validation", checks)
        self.assertEqual(checks["interpreter_validation"]["result"], "warn")

    def test_python_dash_e_is_not_inline_eval(self):
        # python -E (ignore env) is not inline eval; only -c is for python.
        r = classify_bash("python -E scripts/gen_report.py")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertEqual(checks["interpreter_validation"]["result"], "allow")
        self.assertLess(r["risk_score"], 40)

    def test_inline_payload_with_escape_hatch_boosts_risk(self):
        plain = classify_bash("node -e \"console.log(1)\"")
        spawny = classify_bash(
            "node -e \"require('child_process').execSync('git status')\""
        )
        self.assertGreater(spawny["risk_score"], plain["risk_score"])
        self.assertLess(spawny["risk_score"], 70)

    def test_sudo_node_is_system_admin(self):
        r = classify_bash("sudo node server.js")
        self.assertEqual(r["intent"], "system_admin")

    def test_readonly_mode_blocks_interpreter(self):
        r = classify_bash("node -e \"console.log(1)\"", mode="readonly")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("read_only_validation", checks)
        self.assertEqual(checks["read_only_validation"]["result"], "block")

    def test_interpreter_is_reversible(self):
        r = classify_bash("node scripts/build.js")
        self.assertTrue(r["reversible"])


# ---------------------------------------------------------------------------
# Git edge cases
# ---------------------------------------------------------------------------

class TestGitEdgeCases(unittest.TestCase):
    """Git push --force is destructive, clean -f is destructive."""

    def test_git_push_force_is_destructive(self):
        r = classify_bash("git push --force origin main")
        self.assertEqual(r["intent"], "destructive")

    def test_git_clean_f_is_destructive(self):
        r = classify_bash("git clean -f")
        self.assertEqual(r["intent"], "destructive")

    def test_git_status_is_readonly(self):
        r = classify_bash("git status")
        self.assertEqual(r["intent"], "readonly")

    def test_git_add_is_write(self):
        r = classify_bash("git add .")
        self.assertEqual(r["intent"], "write")


class TestChainClassification(unittest.TestCase):
    """Chains classify by their most severe segment (2026-07-02 mining fix:
    first-segment-only classification made `cd X && <cmd>` universally
    'unknown' — benign chains hit the hook's blunt 70 fallback and dangerous
    chains hid from this layer entirely)."""

    def test_cd_alone_is_readonly(self):
        r = classify_bash("cd /some/dir")
        self.assertEqual(r["intent"], "readonly")

    def test_cd_chain_inherits_readonly_segment(self):
        r = classify_bash('cd C:/Projects/app && grep -n "pattern" src/f.ts')
        self.assertEqual(r["intent"], "readonly")
        self.assertLessEqual(r["risk_score"], 10)

    def test_cd_chain_cannot_hide_destruction(self):
        r = classify_bash("cd /tmp && rm -rf /")
        self.assertEqual(r["intent"], "destructive")
        self.assertFalse(r["reversible"])
        self.assertGreaterEqual(r["risk_score"], 70)

    def test_semicolon_chain_classifies_all_segments(self):
        r = classify_bash("cd /p; git status")
        self.assertEqual(r["intent"], "readonly")

    def test_chain_reversible_is_all_segments(self):
        r = classify_bash("git status && rm -rf build")
        self.assertFalse(r["reversible"])

    def test_chain_parsed_mirrors_decisive_segment(self):
        # is_bounded_rm and path boosts must grade the segment that scored.
        r = classify_bash("cd /tmp && rm single.txt")
        self.assertEqual(r["parsed"]["base_command"], "rm")
        self.assertEqual(r["intent"], "destructive")
        self.assertLessEqual(r["risk_score"], 55)  # bounded-rm grading survives

    def test_unchained_behavior_unchanged(self):
        r = classify_bash("git pull && npm test")
        self.assertEqual(r["intent"], "write")


class TestNpxClassification(unittest.TestCase):
    """npx is a package-binary runner (interpreter tier), not 'unknown' —
    unknown pinned every npx call to the hook's 70 fallback."""

    def test_npx_is_interpreter_tier(self):
        r = classify_bash("npx vitest run x.test.js")
        self.assertEqual(r["intent"], "interpreter")
        self.assertLess(r["risk_score"], 40)

    def test_npx_auto_install_flag_warns(self):
        r = classify_bash("npx -y some-random-pkg")
        warns = [v for v in r["validations"] if v["result"] == "warn"]
        self.assertTrue(any("auto-install" in v["reason"] for v in warns))
        self.assertGreaterEqual(r["risk_score"], 40)


if __name__ == "__main__":
    unittest.main()
