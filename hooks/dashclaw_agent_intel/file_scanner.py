"""File operation security scanner for dashclaw-agent-intel.

Checks file write/edit operations for security concerns:
binary content, size limits, symlink escapes, path traversal,
workspace boundary violations, and sensitive file patterns.

Uses only the Python standard library.
"""

import os
from typing import Optional

# Maximum file size: 10 MB.
MAX_FILE_SIZE = 10 * 1024 * 1024

# How many bytes to scan for NUL to detect binary content.
_BINARY_SCAN_WINDOW = 8 * 1024

# System paths that should not be written to by an agent.
_SYSTEM_PREFIXES = ("/etc/", "/boot/", "/sys/", "/proc/", "/dev/",
                    "/sbin/", "/usr/sbin/", "/var/run/", "/var/lock/")

# Placeholder/template env files (.env.example and friends) hold placeholder
# values by convention — every project ships one, and agents are routinely
# asked to update it. Treating them as secrets blocks benign work, so the
# env_file rule (and the bash/pretool sensitive boosts) exempt them.
_PLACEHOLDER_SUFFIXES = (".example", ".sample", ".template", ".dist")


def is_placeholder_path(path: str) -> bool:
    """True when *path*'s basename marks a placeholder/template file."""
    basename = path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    return basename.lower().endswith(_PLACEHOLDER_SUFFIXES)


# Sensitive pattern rules: list of (match_fn, pattern_name).
# match_fn receives (basename, full_path) and returns True on match.
_SENSITIVE_RULES: list[tuple] = [
    # .env files — exact basename or basename starting with ".env",
    # except placeholder/template variants (.env.example etc.)
    (lambda b, _p: (b == ".env" or b.startswith(".env.")) and not is_placeholder_path(b), "env_file"),

    # credential / secret in basename (case-insensitive)
    (lambda b, _p: "credential" in b.lower() or "secret" in b.lower(), "credentials"),

    # private keys
    (lambda b, _p: (
        "private_key" in b.lower()
        or b.lower() in ("id_rsa", "id_ed25519")
        or b.lower().endswith(".pem")
    ), "private_key"),

    # certificates
    (lambda b, _p: (
        b.lower().endswith(".key")
        or b.lower().endswith(".crt")
        or b.lower().endswith(".pfx")
        or b.lower().endswith(".p12")
    ), "certificate"),

    # auth secrets — token, password, passwd in basename
    (lambda b, _p: (
        "token" in b.lower()
        or "password" in b.lower()
        or b.lower() == "passwd"
        or b.lower().startswith("passwd.")
    ), "auth_secret"),

    # system config — path starts with a known system prefix
    (lambda _b, p: any(p.startswith(prefix) for prefix in _SYSTEM_PREFIXES), "system_config"),
]


def _is_binary(content: str) -> bool:
    """Return True if *content* contains NUL bytes in the first 8 KB."""
    return "\x00" in content[:_BINARY_SCAN_WINDOW]


def _detect_sensitive(basename: str, full_path: str) -> tuple[bool, Optional[str]]:
    """Check *basename* and *full_path* against sensitive-file rules.

    Returns (is_sensitive, pattern_name_or_None).
    """
    # Normalise the full path to forward slashes for consistent matching.
    normalised = full_path.replace("\\", "/")
    for match_fn, pattern_name in _SENSITIVE_RULES:
        if match_fn(basename, normalised):
            return True, pattern_name
    return False, None


def scan_file_operation(
    path: str,
    content: str = "",
    workspace: str = "/tmp",
) -> dict:
    """Scan a file operation for security concerns.

    Parameters
    ----------
    path:
        The file path being written/edited (absolute or relative).
    content:
        The content that will be written.  Defaults to empty string.
    workspace:
        The workspace root directory.  Paths outside this are flagged.

    Returns
    -------
    dict with keys:
        binary_detected, size_bytes, size_exceeds_limit,
        symlink_escape, traversal_detected, outside_workspace,
        resolved_path, sensitive_path, sensitive_pattern
    """
    workspace = os.path.normpath(os.path.abspath(workspace))

    # --- Resolve the path ---
    if os.path.isabs(path):
        resolved = os.path.normpath(os.path.abspath(path))
    else:
        resolved = os.path.normpath(os.path.join(workspace, path))

    # --- Path traversal ---
    # Check the raw path string for ".." components.
    traversal_detected = ".." in path.replace("\\", "/").split("/")

    # --- Workspace boundary ---
    # Use normpath + startswith so /tmp/project-evil doesn't pass
    # the prefix check for /tmp/project.
    outside_workspace = not (
        resolved == workspace
        or resolved.startswith(workspace + os.sep)
    )

    # --- Symlink escape ---
    symlink_escape = False
    if os.path.islink(path if os.path.isabs(path) else resolved):
        real = os.path.realpath(resolved)
        if not (real == workspace or real.startswith(workspace + os.sep)):
            symlink_escape = True

    # --- Binary detection ---
    binary_detected = _is_binary(content)

    # --- Size ---
    size_bytes = len(content.encode("utf-8"))
    size_exceeds_limit = size_bytes > MAX_FILE_SIZE

    # --- Sensitive patterns ---
    # Check both the resolved path and the original input path so that
    # Unix-style system paths (e.g. /etc/passwd) are detected even on
    # Windows where the resolved path gets a drive-letter prefix.
    basename = os.path.basename(resolved)
    sensitive_path, sensitive_pattern = _detect_sensitive(basename, resolved)
    if not sensitive_path:
        # Re-check using the original path (forward-slash normalised).
        sensitive_path, sensitive_pattern = _detect_sensitive(
            os.path.basename(path), path,
        )

    return {
        "binary_detected": binary_detected,
        "size_bytes": size_bytes,
        "size_exceeds_limit": size_exceeds_limit,
        "symlink_escape": symlink_escape,
        "traversal_detected": traversal_detected,
        "outside_workspace": outside_workspace,
        "resolved_path": resolved,
        "sensitive_path": sensitive_path,
        "sensitive_pattern": sensitive_pattern,
    }
