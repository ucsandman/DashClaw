import importlib.util
import hashlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
ADAPTER_PATH = REPO_ROOT / ".hermes" / "hooks" / "dashclaw_pretool_hermes.py"


def load_adapter():
    spec = importlib.util.spec_from_file_location("dashclaw_pretool_hermes_test", ADAPTER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class HermesPretoolAdapterTests(unittest.TestCase):
    def setUp(self):
        self.adapter = load_adapter()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.delegate = Path(self.temp_dir.name) / "dashclaw_pretool.py"
        self.delegate.write_text("# test delegate\n", encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def invoke(self, raw, *, completed=None, side_effect=None, delegate_exists=True):
        stdout = io.StringIO()
        delegate = self.delegate if delegate_exists else Path(self.temp_dir.name) / "missing.py"
        with (
            mock.patch.object(self.adapter, "PRETOOL_SCRIPT", delegate),
            mock.patch.object(self.adapter.sys, "stdin", io.StringIO(raw)),
            mock.patch.object(self.adapter.sys, "stdout", stdout),
            mock.patch.object(
                self.adapter.subprocess,
                "run",
                return_value=completed,
                side_effect=side_effect,
            ) as run,
        ):
            result = self.adapter.main()
        body = json.loads(stdout.getvalue())
        return result, body, run

    def assert_blocked(self, body, reason_fragment):
        self.assertEqual(body.get("decision"), "block")
        self.assertIn(reason_fragment, body.get("reason", "").lower())

    def test_uses_canonical_hook_bundle(self):
        self.assertEqual(
            self.adapter.PRETOOL_SCRIPT,
            REPO_ROOT / "hooks" / "dashclaw_pretool.py",
        )

    def test_packaged_hook_bundle_matches_canonical_source(self):
        canonical = REPO_ROOT / "hooks" / "dashclaw_pretool.py"
        packaged = REPO_ROOT / "plugins" / "dashclaw" / "hooks" / "dashclaw_pretool.py"
        self.assertEqual(
            hashlib.sha256(packaged.read_bytes()).digest(),
            hashlib.sha256(canonical.read_bytes()).digest(),
        )

    def test_stale_repository_pretool_copy_is_removed(self):
        self.assertFalse((REPO_ROOT / ".claude" / "hooks" / "dashclaw_pretool.py").exists())

    def test_malformed_and_non_object_input_block_without_running_delegate(self):
        for raw in ("{", "[]", '"text"', ""):
            with self.subTest(raw=raw):
                result, body, run = self.invoke(raw)
                self.assertEqual(result, 0)
                self.assert_blocked(body, "input")
                run.assert_not_called()

    def test_missing_delegate_blocks(self):
        result, body, run = self.invoke("{}", delegate_exists=False)
        self.assertEqual(result, 0)
        self.assert_blocked(body, "delegate")
        run.assert_not_called()

    def test_timeout_and_process_failure_block(self):
        failures = (
            subprocess.TimeoutExpired(cmd=["python"], timeout=1),
            OSError("cannot spawn"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                result, body, _ = self.invoke("{}", side_effect=failure)
                self.assertEqual(result, 0)
                self.assert_blocked(body, "delegate")

    def test_unexpected_exit_and_invalid_success_output_block(self):
        cases = (
            subprocess.CompletedProcess([], 1, stdout=b"", stderr=b"crash"),
            subprocess.CompletedProcess([], 0, stdout=b"not-json", stderr=b""),
            subprocess.CompletedProcess([], 0, stdout=b"[]", stderr=b""),
        )
        for completed in cases:
            with self.subTest(returncode=completed.returncode, stdout=completed.stdout):
                result, body, _ = self.invoke("{}", completed=completed)
                self.assertEqual(result, 0)
                self.assert_blocked(body, "delegate")

    def test_exact_delegate_allow_and_block_controls(self):
        allow = subprocess.CompletedProcess([], 0, stdout=b"", stderr=b"")
        result, body, _ = self.invoke("{}", completed=allow)
        self.assertEqual(result, 0)
        self.assertEqual(body, {})

        block = subprocess.CompletedProcess([], 2, stdout=b"", stderr=b"canonical block\nmore")
        result, body, _ = self.invoke("{}", completed=block)
        self.assertEqual(result, 0)
        self.assertEqual(body, {"decision": "block", "reason": "canonical block"})


if __name__ == "__main__":
    unittest.main()
