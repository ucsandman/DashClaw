"""Tests for dashclaw_agent_intel.file_scanner.scan_file_operation."""

import os
import sys
import tempfile
import unittest

from dashclaw_agent_intel.file_scanner import scan_file_operation


class TestPathTraversal(unittest.TestCase):
    """Detect '..' path traversal in file paths."""

    def test_traversal_detected(self):
        result = scan_file_operation("../../../etc/passwd", workspace="/tmp/project")
        self.assertTrue(result["traversal_detected"])

    def test_no_traversal(self):
        result = scan_file_operation("src/main.py", workspace="/tmp/project")
        self.assertFalse(result["traversal_detected"])

    def test_traversal_mid_path(self):
        result = scan_file_operation("src/../../../etc/shadow", workspace="/tmp/project")
        self.assertTrue(result["traversal_detected"])


class TestWorkspaceBoundary(unittest.TestCase):
    """Ensure resolved paths stay inside the workspace."""

    def test_outside_workspace(self):
        result = scan_file_operation("/etc/passwd", workspace="/tmp/project")
        self.assertTrue(result["outside_workspace"])

    def test_inside_workspace(self):
        result = scan_file_operation("src/main.py", workspace="/tmp/project")
        self.assertFalse(result["outside_workspace"])

    def test_workspace_root_itself(self):
        result = scan_file_operation("/tmp/project/file.txt", workspace="/tmp/project")
        self.assertFalse(result["outside_workspace"])

    def test_absolute_inside_workspace(self):
        result = scan_file_operation("/tmp/project/deep/nested/file.py", workspace="/tmp/project")
        self.assertFalse(result["outside_workspace"])


class TestBinaryDetection(unittest.TestCase):
    """Detect binary content via NUL bytes in first 8KB."""

    def test_binary_detected(self):
        content = "header\x00binary_data"
        result = scan_file_operation("file.bin", content=content, workspace="/tmp/project")
        self.assertTrue(result["binary_detected"])

    def test_text_not_binary(self):
        content = "def main():\n    print('hello')\n"
        result = scan_file_operation("main.py", content=content, workspace="/tmp/project")
        self.assertFalse(result["binary_detected"])

    def test_empty_content_not_binary(self):
        result = scan_file_operation("empty.txt", content="", workspace="/tmp/project")
        self.assertFalse(result["binary_detected"])

    def test_nul_byte_beyond_8kb_not_detected(self):
        """NUL byte after the 8KB scan window should not trigger."""
        content = "A" * (8 * 1024 + 1) + "\x00"
        result = scan_file_operation("file.dat", content=content, workspace="/tmp/project")
        self.assertFalse(result["binary_detected"])


class TestSizeLimit(unittest.TestCase):
    """Check content size tracking and limit enforcement."""

    def test_size_bytes_correct(self):
        content = "hello world\n"
        result = scan_file_operation("file.txt", content=content, workspace="/tmp/project")
        self.assertEqual(result["size_bytes"], len(content.encode("utf-8")))

    def test_size_exceeds_limit(self):
        content = "X" * (11 * 1024 * 1024)  # 11 MB
        result = scan_file_operation("big.bin", content=content, workspace="/tmp/project")
        self.assertTrue(result["size_exceeds_limit"])

    def test_size_within_limit(self):
        content = "small file"
        result = scan_file_operation("small.txt", content=content, workspace="/tmp/project")
        self.assertFalse(result["size_exceeds_limit"])

    def test_empty_content_size(self):
        result = scan_file_operation("empty.txt", content="", workspace="/tmp/project")
        self.assertEqual(result["size_bytes"], 0)
        self.assertFalse(result["size_exceeds_limit"])


class TestSensitivePatterns(unittest.TestCase):
    """Detect sensitive file patterns by basename and path."""

    def test_env_file(self):
        result = scan_file_operation(".env", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "env_file")

    def test_env_local_file(self):
        result = scan_file_operation(".env.local", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "env_file")

    def test_env_example_is_placeholder_not_sensitive(self):
        result = scan_file_operation(".env.example", workspace="/tmp/project")
        self.assertFalse(result["sensitive_path"])
        self.assertIsNone(result["sensitive_pattern"])

    def test_env_template_variants_not_sensitive(self):
        for name in (".env.sample", ".env.template", ".env.dist"):
            result = scan_file_operation(name, workspace="/tmp/project")
            self.assertFalse(result["sensitive_path"], name)

    def test_credentials_file(self):
        result = scan_file_operation("credentials.json", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "credentials")

    def test_secret_file(self):
        result = scan_file_operation("secret.yaml", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "credentials")

    def test_private_key(self):
        result = scan_file_operation("id_rsa", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "private_key")

    def test_pem_file(self):
        result = scan_file_operation("server.pem", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "private_key")

    def test_id_ed25519(self):
        result = scan_file_operation("id_ed25519", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "private_key")

    def test_certificate_key(self):
        result = scan_file_operation("server.key", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "certificate")

    def test_certificate_crt(self):
        result = scan_file_operation("ca.crt", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "certificate")

    def test_certificate_pfx(self):
        result = scan_file_operation("cert.pfx", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "certificate")

    def test_certificate_p12(self):
        result = scan_file_operation("cert.p12", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "certificate")

    def test_token_file(self):
        result = scan_file_operation("token.txt", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "auth_secret")

    def test_password_file(self):
        result = scan_file_operation("password.conf", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "auth_secret")

    def test_passwd_file(self):
        result = scan_file_operation("passwd", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "auth_secret")

    def test_system_config_etc(self):
        result = scan_file_operation("/etc/nginx/nginx.conf", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "system_config")

    def test_system_config_boot(self):
        result = scan_file_operation("/boot/grub/grub.cfg", workspace="/tmp/project")
        self.assertTrue(result["sensitive_path"])
        self.assertEqual(result["sensitive_pattern"], "system_config")

    def test_normal_file_not_sensitive(self):
        result = scan_file_operation("src/app.py", workspace="/tmp/project")
        self.assertFalse(result["sensitive_path"])
        self.assertIsNone(result["sensitive_pattern"])


class TestSymlinkEscape(unittest.TestCase):
    """Detect symlinks that escape the workspace boundary."""

    @unittest.skipIf(sys.platform == "win32", "Symlinks unreliable on Windows")
    def test_symlink_escape(self):
        with tempfile.TemporaryDirectory() as workspace:
            link_path = os.path.join(workspace, "escape_link")
            os.symlink("/etc/passwd", link_path)
            result = scan_file_operation(link_path, workspace=workspace)
            self.assertTrue(result["symlink_escape"])

    @unittest.skipIf(sys.platform == "win32", "Symlinks unreliable on Windows")
    def test_symlink_inside_workspace(self):
        with tempfile.TemporaryDirectory() as workspace:
            target = os.path.join(workspace, "real_file.txt")
            with open(target, "w") as f:
                f.write("data")
            link_path = os.path.join(workspace, "safe_link")
            os.symlink(target, link_path)
            result = scan_file_operation(link_path, workspace=workspace)
            self.assertFalse(result["symlink_escape"])

    def test_non_symlink_no_escape(self):
        with tempfile.TemporaryDirectory() as workspace:
            real_file = os.path.join(workspace, "normal.txt")
            with open(real_file, "w") as f:
                f.write("data")
            result = scan_file_operation(real_file, workspace=workspace)
            self.assertFalse(result["symlink_escape"])


class TestResolvedPath(unittest.TestCase):
    """resolved_path is always an absolute, normalized path."""

    def test_relative_path_resolved(self):
        result = scan_file_operation("src/main.py", workspace="/tmp/project")
        self.assertTrue(os.path.isabs(result["resolved_path"]))

    def test_absolute_path_preserved(self):
        result = scan_file_operation("/tmp/project/file.txt", workspace="/tmp/project")
        self.assertEqual(result["resolved_path"], os.path.normpath(os.path.abspath("/tmp/project/file.txt")))


class TestReturnShape(unittest.TestCase):
    """Every result dict has the correct keys."""

    def test_all_keys_present(self):
        result = scan_file_operation("file.txt", workspace="/tmp/project")
        expected_keys = {
            "binary_detected",
            "size_bytes",
            "size_exceeds_limit",
            "symlink_escape",
            "traversal_detected",
            "outside_workspace",
            "resolved_path",
            "sensitive_path",
            "sensitive_pattern",
        }
        self.assertEqual(set(result.keys()), expected_keys)

    def test_value_types(self):
        result = scan_file_operation("file.txt", content="data", workspace="/tmp/project")
        self.assertIsInstance(result["binary_detected"], bool)
        self.assertIsInstance(result["size_bytes"], int)
        self.assertIsInstance(result["size_exceeds_limit"], bool)
        self.assertIsInstance(result["symlink_escape"], bool)
        self.assertIsInstance(result["traversal_detected"], bool)
        self.assertIsInstance(result["outside_workspace"], bool)
        self.assertIsInstance(result["resolved_path"], str)
        self.assertIsInstance(result["sensitive_path"], bool)


if __name__ == "__main__":
    unittest.main()
