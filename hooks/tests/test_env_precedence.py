"""Tests for explicit-env-beats-dotenv BASE_URL resolution (F3, 2026-07-27
e2e proof).

Incident: C:\\Projects\\DashClaw\\.env sets DASHCLAW_BASE_URL to Wes's hosted
production instance. A test run explicitly exported DASHCLAW_URL=
http://localhost:3001 but never exported DASHCLAW_BASE_URL. _load_dotenv()
loaded the repo's .env value into os.environ for the key that was NOT already
set (DASHCLAW_BASE_URL), and the old resolution `BASE_URL or URL` then
preferred the dotenv-provided BASE_URL over the explicitly-exported URL --
silently misrouting three hook-triggered guard/record calls to production.

The fix (_resolve_base_url in all three hook scripts) tracks which of the two
keys were explicitly present in the process env BEFORE _load_dotenv() ran, so
resolution is: explicit BASE_URL > explicit URL > dotenv BASE_URL > dotenv
URL. These tests cover the pure resolution function (all four precedence
branches) plus one end-to-end proof that imports each real hook script from
an isolated sandbox with a fake `.env` -- reproducing the incident's exact
shape without ever touching this repo's real .env/.env.local.

Uses only the Python standard library.
"""

import importlib
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

_REAL_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REAL_HOOKS_DIR not in sys.path:
    sys.path.insert(0, _REAL_HOOKS_DIR)

_HOOK_MODULES = ("dashclaw_pretool", "dashclaw_posttool", "dashclaw_stop")


# ---------------------------------------------------------------------------
# Part 1: the pure _resolve_base_url function, one branch per test.
#
# Imported with DASHCLAW_DISABLE_DOTENV=1 so _load_dotenv() is a no-op and
# os.environ reflects exactly what the test sets -- i.e. exactly the "post
# dotenv" state _resolve_base_url normally sees, with the explicit/dotenv
# origin passed in directly instead of inferred from disk.
# ---------------------------------------------------------------------------

def _import_hook(module_name, env=None):
    overrides = {"DASHCLAW_DISABLE_DOTENV": "1"}
    overrides.update(env or {})
    clean = os.environ.copy()
    for k in list(clean):
        if k.startswith("DASHCLAW_"):
            del clean[k]
    clean.update(overrides)
    with mock.patch.dict(os.environ, clean, clear=True):
        sys.modules.pop(module_name, None)
        return importlib.import_module(module_name)


def _call_resolve(m, env, base_explicit, url_explicit):
    """Call m._resolve_base_url(base_explicit, url_explicit) with os.environ
    controlled to exactly `env` for the duration of the call -- the function
    reads os.environ.get(...) live, so it must never be called against the
    ambient real process environment (which may itself have a real
    DASHCLAW_BASE_URL/DASHCLAW_URL set on this dogfooding machine)."""
    clean = os.environ.copy()
    for k in list(clean):
        if k.startswith("DASHCLAW_"):
            del clean[k]
    clean.update(env)
    with mock.patch.dict(os.environ, clean, clear=True):
        return m._resolve_base_url(base_explicit, url_explicit)


class TestResolveBaseUrlBranches(unittest.TestCase):
    """One test per hook script x the four precedence branches, proving all
    three (pretool/posttool/stop) resolve identically. `_resolve_base_url` is
    a pure(ish) function of (os.environ, explicit-flags), so each branch
    controls os.environ directly around the call rather than relying on the
    module's own import-time resolution."""

    def _check(self, module_name):
        m = _import_hook(module_name)
        both = {"DASHCLAW_BASE_URL": "https://hosted.example", "DASHCLAW_URL": "http://localhost:3001"}

        # Both explicit -> BASE_URL wins (existing precedence preserved).
        self.assertEqual(
            _call_resolve(m, both, True, True), "https://hosted.example",
            "%s: both explicit must prefer BASE_URL" % module_name,
        )
        # Only URL explicit, BASE_URL present but NOT explicit (i.e. as if
        # dotenv had populated it) -> explicit URL wins. This is the exact
        # incident shape.
        self.assertEqual(
            _call_resolve(m, both, False, True), "http://localhost:3001",
            "%s: explicit URL must beat a dotenv-sourced BASE_URL" % module_name,
        )
        # Neither explicit (both as if dotenv-sourced) -> BASE_URL still wins
        # (pre-existing precedence between the two dotenv values).
        self.assertEqual(
            _call_resolve(m, both, False, False), "https://hosted.example",
            "%s: dotenv BASE_URL must beat dotenv URL" % module_name,
        )

    def test_pretool(self):
        self._check("dashclaw_pretool")

    def test_posttool(self):
        self._check("dashclaw_posttool")

    def test_stop(self):
        self._check("dashclaw_stop")

    def test_only_url_present_no_base_url_at_all(self):
        m = _import_hook("dashclaw_pretool")
        env = {"DASHCLAW_URL": "http://localhost:3001"}
        self.assertEqual(_call_resolve(m, env, False, True), "http://localhost:3001")
        self.assertEqual(_call_resolve(m, env, False, False), "http://localhost:3001")

    def test_neither_present_resolves_empty(self):
        m = _import_hook("dashclaw_pretool")
        self.assertEqual(_call_resolve(m, {}, False, False), "")


# ---------------------------------------------------------------------------
# Part 2: end-to-end wiring proof. Each hook script is copied into an
# isolated sandbox dir with a REAL fake .env one level up, so the module's
# own _load_dotenv() (unmodified, not mocked) walks up and finds it --
# proving the whole "capture explicit-ness before dotenv runs" wiring works,
# not just the pure function in isolation. Never touches this repo's real
# .env/.env.local.
# ---------------------------------------------------------------------------

def _make_sandbox(dotenv_lines, script_name):
    root = tempfile.mkdtemp(prefix="dashclaw-env-precedence-")
    hooks_dir = os.path.join(root, "hooks")
    os.makedirs(hooks_dir)
    shutil.copy(os.path.join(_REAL_HOOKS_DIR, script_name), hooks_dir)
    shutil.copytree(
        os.path.join(_REAL_HOOKS_DIR, "dashclaw_agent_intel"),
        os.path.join(hooks_dir, "dashclaw_agent_intel"),
    )
    if dotenv_lines:
        with open(os.path.join(root, ".env"), "w", encoding="utf-8") as f:
            f.write("\n".join(dotenv_lines) + "\n")
    return root, hooks_dir


def _import_from_sandbox(hooks_dir, module_name, env):
    """Import module_name from hooks_dir with a REAL (non-mocked)
    _load_dotenv() run -- DASHCLAW_DISABLE_DOTENV is deliberately absent."""
    clean = os.environ.copy()
    for k in list(clean):
        if k.startswith("DASHCLAW_"):
            del clean[k]
    clean.update(env)
    if hooks_dir not in sys.path:
        sys.path.insert(0, hooks_dir)
    sys.modules.pop(module_name, None)
    with mock.patch.dict(os.environ, clean, clear=True):
        return importlib.import_module(module_name)


class TestEndToEndDotenvVsExplicit(unittest.TestCase):
    """Reproduces the exact 2026-07-27 incident shape end to end, for each of
    the three hook scripts (F3 applies to all of them)."""

    def setUp(self):
        self._roots = []
        self._sys_path_added = []

    def tearDown(self):
        for p in self._sys_path_added:
            if p in sys.path:
                sys.path.remove(p)
        for module_name in _HOOK_MODULES:
            sys.modules.pop(module_name, None)
        for root in self._roots:
            shutil.rmtree(root, ignore_errors=True)

    def _sandbox_import(self, script_name, module_name, dotenv_lines, env):
        root, hooks_dir = _make_sandbox(dotenv_lines, script_name)
        self._roots.append(root)
        self._sys_path_added.append(hooks_dir)
        return _import_from_sandbox(hooks_dir, module_name, env)

    def _check_incident_shape(self, script_name, module_name):
        m = self._sandbox_import(
            script_name,
            module_name,
            dotenv_lines=["DASHCLAW_BASE_URL=https://hosted.example"],
            env={
                "DASHCLAW_URL": "http://localhost:3001",
                "DASHCLAW_API_KEY": "test-key",
            },
        )
        self.assertEqual(
            m.BASE_URL, "http://localhost:3001",
            "%s: explicit DASHCLAW_URL must win over the repo's .env DASHCLAW_BASE_URL" % module_name,
        )

    def test_pretool_end_to_end(self):
        self._check_incident_shape("dashclaw_pretool.py", "dashclaw_pretool")

    def test_posttool_end_to_end(self):
        self._check_incident_shape("dashclaw_posttool.py", "dashclaw_posttool")

    def test_stop_end_to_end(self):
        self._check_incident_shape("dashclaw_stop.py", "dashclaw_stop")

    def test_both_explicit_base_url_wins_end_to_end(self):
        m = self._sandbox_import(
            "dashclaw_pretool.py",
            "dashclaw_pretool",
            dotenv_lines=["DASHCLAW_BASE_URL=https://hosted-from-dotenv.example"],
            env={
                "DASHCLAW_BASE_URL": "https://explicit-hosted.example",
                "DASHCLAW_URL": "http://localhost:3001",
                "DASHCLAW_API_KEY": "test-key",
            },
        )
        self.assertEqual(m.BASE_URL, "https://explicit-hosted.example")


if __name__ == "__main__":
    unittest.main()
