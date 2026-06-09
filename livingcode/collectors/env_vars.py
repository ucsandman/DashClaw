"""Env var collector — finds process.env references and cross-refs .env.example."""
import os
import re

from livingcode.types import EnvVarInfo

ENV_REF_RE = re.compile(r"process\.env\.([A-Z_][A-Z0-9_]*)")
SKIP_DIRS = {
    "node_modules", ".next", "dist", ".git", "__pycache__",
    ".organism", "coverage", "_archive",
    # Generated outputs of livingcode-refresh — including them creates a
    # feedback loop where shape.json gains/loses entries depending on
    # whether a refresh has run since the last clone.
    ".claude", ".gitnexus",
}
SCAN_EXTENSIONS = {".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"}

# Vars used with no fallback — failure if missing
KNOWN_REQUIRED = {"DATABASE_URL", "NEXTAUTH_SECRET", "ENCRYPTION_KEY", "DASHCLAW_API_KEY"}


def _parse_env_example(repo_path: str) -> set[str]:
    """Read .env.example and return documented var names."""
    path = os.path.join(repo_path, ".env.example")
    documented: set[str] = set()
    if not os.path.isfile(path):
        return documented
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    name = line.split("=", 1)[0].strip()
                    if name:
                        documented.add(name)
    except OSError:
        pass
    return documented


def collect_env_vars(repo_path: str) -> list[EnvVarInfo]:
    """Scan codebase for process.env.X references."""
    var_files: dict[str, list[str]] = {}

    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in files:
            ext = os.path.splitext(fname)[1]
            if ext not in SCAN_EXTENSIONS:
                continue
            filepath = os.path.join(root, fname)
            try:
                with open(filepath, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except OSError:
                continue

            found = ENV_REF_RE.findall(content)
            if found:
                rel_path = os.path.relpath(filepath, repo_path).replace("\\", "/")
                for var_name in set(found):
                    var_files.setdefault(var_name, []).append(rel_path)

    documented = _parse_env_example(repo_path)

    result: list[EnvVarInfo] = []
    for name, ref_files in sorted(var_files.items()):
        result.append(
            EnvVarInfo(
                name=name,
                required=name in KNOWN_REQUIRED,
                files=sorted(set(ref_files)),
                in_env_example=name in documented,
            )
        )
    return result
