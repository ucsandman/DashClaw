"""act.script excerpt (2026-09-04 incident): the hook forwards an excerpt of
a locally executed script inside act.script so the SERVER can grade the
script's CONTENT, not just the command line that invoked it. Independent of
the written-paths ledger — any local script the command executes, not only
ones this session wrote.
"""

import os
import shutil
import sys
import tempfile
import unittest

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HOOKS_DIR)

import dashclaw_pretool  # noqa: E402


class _ActScriptBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dashclaw_act_script_")
        self._old_cwd = dashclaw_pretool._HOOK_CWD
        dashclaw_pretool._HOOK_CWD = self.dir

    def tearDown(self):
        dashclaw_pretool._HOOK_CWD = self._old_cwd
        shutil.rmtree(self.dir, ignore_errors=True)

    def _write_script(self, name, content):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return path


class TestActScriptAttachment(_ActScriptBase):
    def test_bash_running_local_script_attaches_excerpt(self):
        self._write_script(
            "domain-buy.mjs",
            "fetch('https://api.vercel.com/v1/registrar/domains/x/buy')\n",
        )
        act = dashclaw_pretool._build_act(
            "Bash", {"command": "node domain-buy.mjs truckside.io"}
        )
        self.assertIn("script", act)
        self.assertEqual(
            act["script"]["path"], os.path.join(self.dir, "domain-buy.mjs")
        )
        self.assertIn(
            "registrar/domains/x/buy", act["script"]["content_excerpt"]
        )

    def test_missing_script_path_yields_no_script_key(self):
        act = dashclaw_pretool._build_act(
            "Bash", {"command": "node " + os.path.join(self.dir, "ghost.mjs")}
        )
        self.assertNotIn("script", act)

    def test_command_with_no_exec_candidate_yields_no_script_key(self):
        act = dashclaw_pretool._build_act("Bash", {"command": "ls -la"})
        self.assertNotIn("script", act)

    def test_sensitive_script_path_attaches_path_only(self):
        self._write_script(".env", "SECRET=1\nfetch('https://x/buy')\n")
        act = dashclaw_pretool._build_act("Bash", {"command": "bash .env"})
        self.assertIn("script", act)
        self.assertNotIn("content_excerpt", act["script"])

    def test_oversized_script_is_skipped(self):
        self._write_script("big.mjs", "x" * (dashclaw_pretool._ACT_SCRIPT_MAX_BYTES + 1))
        act = dashclaw_pretool._build_act("Bash", {"command": "node big.mjs"})
        self.assertNotIn("script", act)


if __name__ == "__main__":
    unittest.main()
