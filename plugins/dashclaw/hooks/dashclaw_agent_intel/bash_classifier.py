"""Bash intent classifier for dashclaw-agent-intel.

Classifies shell commands by intent, risk, and reversibility using
six validation submodules run as a pipeline.

Uses only the Python standard library + the sibling command_parser module.
"""

import re
from typing import Optional

from dashclaw_agent_intel.command_parser import parse_command
from dashclaw_agent_intel.file_scanner import is_placeholder_path

# ---------------------------------------------------------------------------
# Intent lookup tables
# ---------------------------------------------------------------------------

READONLY_COMMANDS = frozenset({
    "cat", "head", "tail", "less", "more", "wc", "file", "stat", "du", "df",
    "ls", "tree", "find", "locate", "which", "whereis", "type",
    "grep", "rg", "awk", "cut", "sort", "uniq", "diff", "comm",
    "echo", "printf", "date", "uname", "whoami", "pwd", "hostname",
    "ps", "top", "htop", "free", "uptime", "env", "printenv",
    "man", "help", "info",
    "sha256sum", "md5sum", "sha1sum", "cksum", "b2sum",
    "base64", "od", "xxd", "hexdump",
    "id", "groups", "lsof", "readlink", "realpath", "basename", "dirname",
    "test", "[", "true", "false", "seq", "yes", "tee",
    "xargs", "tr", "column", "fold", "expand", "unexpand",
    "sed",  # sed without -i is readonly (stdout only); sed_validation handles -i
})

GIT_READONLY_SUBCOMMANDS = frozenset({
    "status", "log", "diff", "show", "branch", "tag", "remote",
    "stash", "describe", "rev-parse", "rev-list", "blame",
    "ls-files", "ls-tree", "config", "reflog", "shortlog",
    "whatchanged", "name-rev", "verify-commit", "verify-tag",
})

GIT_WRITE_SUBCOMMANDS = frozenset({
    "add", "commit", "merge", "cherry-pick", "checkout", "switch",
    "restore", "mv", "rm", "rebase", "pull", "fetch", "stash",
    "push",  # push is write normally; destructive with --force
})

GIT_DESTRUCTIVE_SUBCOMMANDS = frozenset({
    "clean",  # clean -f
    "reset",  # reset --hard
})

WRITE_COMMANDS = frozenset({
    "cp", "mv", "mkdir", "touch", "chmod", "chown", "chgrp", "ln",
    "tee", "install", "patch", "rename",
})

DESTRUCTIVE_COMMANDS = frozenset({
    "rm", "rmdir", "shred", "mkfs", "fdisk", "dd", "truncate",
})

NETWORK_COMMANDS = frozenset({
    "curl", "wget", "ssh", "scp", "rsync", "ping", "traceroute",
    "dig", "nslookup", "host", "nc", "netcat", "telnet", "ftp", "sftp",
})

PROCESS_COMMANDS = frozenset({
    "kill", "killall", "pkill", "nohup", "bg", "fg", "crontab",
    "disown", "wait", "jobs",
})

PACKAGE_COMMANDS = frozenset({
    "npm", "yarn", "pnpm", "pip", "pip3", "pipx",
    "cargo", "go", "gem", "bundle",
    "brew", "apt", "apt-get", "dnf", "yum", "pacman", "snap", "flatpak",
    "composer", "dotnet", "nuget",
})

# Language interpreters / script runners. Without this category they fall
# through to "unknown", and the pretool hook replaces the classifier score
# with the Bash tool's blunt base risk (70 = RISK_HIGH_MIN) — so `node -e`
# was blocked by fallback, not by analysis.
INTERPRETER_COMMANDS = frozenset({
    "node", "nodejs", "python", "python2", "python3",
    "ruby", "perl", "php", "deno", "bun", "tsx", "ts-node",
})

# Per-interpreter inline-eval flags. Flag meanings collide across
# interpreters (python -E ignores env vars; perl -E is eval with features),
# so each base command gets its own set rather than one shared list.
_INLINE_EVAL_FLAGS = {
    "node": frozenset({"-e", "--eval", "-p", "--print"}),
    "nodejs": frozenset({"-e", "--eval", "-p", "--print"}),
    "bun": frozenset({"-e", "--eval", "-p", "--print"}),
    "tsx": frozenset({"-e", "--eval", "-p", "--print"}),
    "ts-node": frozenset({"-e", "--eval", "-p", "--print"}),
    "deno": frozenset({"--eval"}),
    "python": frozenset({"-c"}),
    "python2": frozenset({"-c"}),
    "python3": frozenset({"-c"}),
    "ruby": frozenset({"-e"}),
    "perl": frozenset({"-e", "-E"}),
    "php": frozenset({"-r"}),
}

# Escape hatches inside an inline-eval payload: spawning processes, deleting
# files, or shelling out from within the one-liner. These warrant an extra
# warn on top of the inline-eval warn — still below the block band; the
# server-side guard sees the full command and can escalate further.
_INLINE_ESCAPE_HATCH_RE = re.compile(
    r"child_process|subprocess|os\.system|execSync|spawnSync"
    r"|fs\.(?:rm|unlink|rmdir)|rmtree|rm\s+-rf|shutil",
    re.IGNORECASE,
)

SYSTEM_ADMIN_COMMANDS = frozenset({
    "systemctl", "service", "journalctl",
    "useradd", "userdel", "usermod", "groupadd", "groupdel",
    "iptables", "ip6tables", "ufw", "firewall-cmd",
    "mount", "umount",
    "reboot", "shutdown", "poweroff", "halt", "init",
    "modprobe", "insmod", "rmmod",
    "sysctl", "ldconfig",
})

# System paths that workspace_write mode should warn about.
SYSTEM_PATHS = (
    "/etc/", "/usr/", "/var/", "/boot/", "/sys/", "/proc/",
    "/sbin/", "/lib/", "/lib64/", "/opt/",
    "/etc", "/usr", "/var", "/boot", "/sys", "/proc",
    "/sbin", "/lib", "/lib64", "/opt",
)

# Sensitive file patterns that boost risk.
SENSITIVE_PATTERNS = re.compile(
    r"(?:\.env|secret|credential|private_key|\.pem|id_rsa|\.key)",
    re.IGNORECASE,
)

# Fork bomb patterns.
_FORK_BOMB_RE = re.compile(r":\(\)\s*\{.*\}|/dev/null.*&\s*\|.*&|fork\s*bomb", re.IGNORECASE)

# Base risk scores by intent.
_RISK_BASE = {
    "readonly": 5,
    "write": 35,
    "destructive": 90,
    "network": 40,
    "process_management": 50,
    "package_management": 30,
    "system_admin": 75,
    "interpreter": 35,  # running a script file is routine; inline eval warns on top
    "unknown": 20,
}

# A bounded rm (non-recursive, explicit non-glob targets) is irreversible but
# routine — deleting one named file is everyday agent work, not `rm -rf`.
# The full destructive base (90) pushed every single-file delete into block
# territory while the policy engine, given honest context, allowed it.
_BOUNDED_RM_BASE = 55
_BOUNDED_RM_MAX_TARGETS = 3
_GLOB_CHARS = "*?["


def is_bounded_rm(parsed: dict) -> bool:
    """True for a non-recursive rm with a few explicit, non-glob targets."""
    base = (parsed.get("base_command") or "").rsplit("/", 1)[-1]
    if base != "rm":
        return False
    flags = parsed.get("flags", [])
    recursive = "--recursive" in flags or any(
        f.startswith("-") and not f.startswith("--") and "r" in f.lower() for f in flags
    )
    if recursive:
        return False
    targets = parsed.get("targets", [])
    if not targets or len(targets) > _BOUNDED_RM_MAX_TARGETS:
        return False
    return not any(ch in t for t in targets for ch in _GLOB_CHARS)


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

def _classify_git(parsed: dict) -> str:
    """Classify a git command by its subcommand and flags."""
    sub = parsed.get("subcommand") or ""
    flags = parsed.get("flags", [])

    # Destructive git subcommands.
    if sub == "reset" and "--hard" in flags:
        return "destructive"
    if sub == "clean" and any(f.startswith("-") and "f" in f for f in flags):
        return "destructive"
    if sub == "push" and any(f in ("--force", "-f", "--force-with-lease") for f in flags):
        return "destructive"

    if sub in GIT_DESTRUCTIVE_SUBCOMMANDS:
        # Without the dangerous flags, still treat as write.
        return "write"

    if sub in GIT_READONLY_SUBCOMMANDS:
        return "readonly"
    if sub in GIT_WRITE_SUBCOMMANDS:
        return "write"
    # Unknown git subcommand -> write (safe default).
    return "write"


def _classify_intent(parsed: dict, raw_command: str) -> str:
    """Determine the intent category for a parsed command."""
    base = parsed.get("base_command", "")
    if not base:
        return "unknown"

    # Strip path prefix if present (e.g. /usr/bin/rm -> rm).
    base_name = base.rsplit("/", 1)[-1]

    # Check for sudo wrapper early — used for escalation decisions.
    wrapper = parsed.get("wrapper")

    # Handle mkfs variants (mkfs.ext4, mkfs.xfs, etc.).
    if base_name.startswith("mkfs"):
        return "destructive"

    # Git has special subcommand-level classification.
    if base_name == "git":
        return _classify_git(parsed)

    # Package managers: sudo + package manager = system_admin.
    if base_name in PACKAGE_COMMANDS:
        if wrapper == "sudo":
            return "system_admin"
        return "package_management"

    # Interpreters: sudo + interpreter = system_admin (root code execution).
    if base_name in INTERPRETER_COMMANDS:
        if wrapper == "sudo":
            return "system_admin"
        return "interpreter"

    # Walk through categories in priority order.
    if base_name in DESTRUCTIVE_COMMANDS:
        return "destructive"
    if base_name in SYSTEM_ADMIN_COMMANDS:
        return "system_admin"
    if base_name in PROCESS_COMMANDS:
        return "process_management"
    if base_name in NETWORK_COMMANDS:
        return "network"
    if base_name in WRITE_COMMANDS:
        return "write"
    if base_name in READONLY_COMMANDS:
        return "readonly"

    if wrapper == "sudo":
        return "system_admin"

    return "unknown"


# ---------------------------------------------------------------------------
# Validation submodules (pipeline)
# ---------------------------------------------------------------------------

def _run_read_only_validation(
    parsed: dict, intent: str, mode: str, raw_command: str,
) -> Optional[dict]:
    """Submodule 1: In readonly mode, block write/destructive/process/system/package
    commands and redirections.  Allow safe readonly commands."""
    if mode != "readonly":
        return None

    base = (parsed.get("base_command") or "").rsplit("/", 1)[-1]
    redirections = parsed.get("redirections", [])

    # Block redirections that write to files.
    if redirections:
        return {
            "check": "read_only_validation",
            "result": "block",
            "reason": f"file redirection in readonly mode",
        }

    # Block non-readonly intents. Interpreters can write files and spawn
    # processes, so they are not readonly-safe.
    if intent in ("write", "destructive", "process_management", "system_admin", "package_management", "interpreter"):
        return {
            "check": "read_only_validation",
            "result": "block",
            "reason": f"{intent} command not allowed in readonly mode",
        }

    return {
        "check": "read_only_validation",
        "result": "allow",
        "reason": "command is safe in readonly mode",
    }


def _run_destructive_command_validation(
    parsed: dict, intent: str, raw_command: str,
) -> Optional[dict]:
    """Submodule 2: Detect catastrophic destructive commands."""
    base = (parsed.get("base_command") or "").rsplit("/", 1)[-1]
    flags = parsed.get("flags", [])
    targets = parsed.get("targets", [])

    # Fork bomb detection.
    if _FORK_BOMB_RE.search(raw_command):
        return {
            "check": "destructive_command",
            "result": "block",
            "reason": "fork bomb detected",
        }

    # SQL injection patterns.
    if re.search(r"DROP\s+TABLE", raw_command, re.IGNORECASE):
        return {
            "check": "destructive_command",
            "result": "block",
            "reason": "DROP TABLE detected",
        }

    # mkfs — always block.
    if base.startswith("mkfs"):
        return {
            "check": "destructive_command",
            "result": "block",
            "reason": f"filesystem format command: {base}",
        }

    # dd with of= — always block.
    if base == "dd":
        of_targets = [t for t in targets if t.startswith("of=")]
        if of_targets or any("of=" in f for f in flags):
            return {
                "check": "destructive_command",
                "result": "block",
                "reason": "dd with output file is destructive",
            }
        # dd without of= in targets — check raw command.
        if "of=" in raw_command:
            return {
                "check": "destructive_command",
                "result": "block",
                "reason": "dd with output file is destructive",
            }

    # rm — graded: root targets block, recursive/glob/multi-target warns,
    # a bounded single-file delete is routine and passes.
    if base == "rm":
        recursive = "--recursive" in flags or any(
            f.startswith("-") and not f.startswith("--") and "r" in f.lower() for f in flags
        )
        if recursive:
            # Check for root targets.
            for t in targets:
                if t in ("/", "/*", "/.", "/.."):
                    return {
                        "check": "destructive_command",
                        "result": "block",
                        "reason": "recursive rm with root target",
                    }
            # Non-root recursive rm — warn.
            return {
                "check": "destructive_command",
                "result": "warn",
                "reason": "rm -rf on non-root path",
            }
        if is_bounded_rm(parsed):
            return {
                "check": "destructive_command",
                "result": "allow",
                "reason": "bounded non-recursive rm (explicit targets)",
            }
        # Non-recursive but unbounded (globs / many targets / no targets) — warn.
        return {
            "check": "destructive_command",
            "result": "warn",
            "reason": "rm command detected",
        }

    if intent == "destructive":
        return {
            "check": "destructive_command",
            "result": "warn",
            "reason": f"destructive command: {base}",
        }

    return None


def _run_mode_validation(
    parsed: dict, intent: str, mode: str, workspace: Optional[str],
) -> Optional[dict]:
    """Submodule 3: In workspace_write mode, warn when commands target system paths."""
    if mode != "workspace_write":
        return None

    targets = parsed.get("targets", [])
    redirections = parsed.get("redirections", [])

    all_paths = list(targets) + [r.get("target", "") for r in redirections]

    for path in all_paths:
        for sys_path in SYSTEM_PATHS:
            if path.startswith(sys_path):
                return {
                    "check": "mode_validation",
                    "result": "warn",
                    "reason": f"target '{path}' is a system path",
                }
    return None


def _run_sed_validation(
    parsed: dict, mode: str,
) -> Optional[dict]:
    """Submodule 4: Handle sed -i specifically."""
    base = (parsed.get("base_command") or "").rsplit("/", 1)[-1]
    if base != "sed":
        return None

    flags = parsed.get("flags", [])
    has_inplace = any(f == "-i" or f.startswith("-i") for f in flags)

    if has_inplace:
        if mode == "readonly":
            return {
                "check": "sed_validation",
                "result": "block",
                "reason": "sed -i (in-place edit) blocked in readonly mode",
            }
        return {
            "check": "sed_validation",
            "result": "warn",
            "reason": "sed -i modifies files in place",
        }

    # sed without -i is stdout-only.
    return {
        "check": "sed_validation",
        "result": "allow",
        "reason": "sed without -i outputs to stdout only",
    }


def _run_interpreter_validation(
    parsed: dict, intent: str, raw_command: str,
) -> Optional[dict]:
    """Submodule: grade interpreter invocations.

    Inline eval (`node -e`, `python -c`, `deno eval`, ...) is arbitrary code
    execution and warns; running a named script file is routine and allows.
    An inline payload that spawns processes or deletes files warns harder
    (extra +10 via the escape-hatch check in _compute_risk).
    """
    if intent != "interpreter":
        return None

    base = (parsed.get("base_command") or "").rsplit("/", 1)[-1]
    flags = parsed.get("flags", [])
    targets = parsed.get("targets", [])

    eval_flags = _INLINE_EVAL_FLAGS.get(base, frozenset())
    inline = any(f in eval_flags for f in flags)
    # deno's eval is a subcommand, not a flag.
    if base == "deno" and targets and targets[0] == "eval":
        inline = True

    if inline:
        return {
            "check": "interpreter_validation",
            "result": "warn",
            "reason": f"inline code execution via {base}",
        }
    return {
        "check": "interpreter_validation",
        "result": "allow",
        "reason": f"{base} running a script file",
    }


def _run_path_validation(
    parsed: dict, workspace: Optional[str],
) -> Optional[dict]:
    """Submodule 5: Warn on ../ traversal and ~ home directory references."""
    targets = parsed.get("targets", [])
    redirections = parsed.get("redirections", [])

    all_paths = list(targets) + [r.get("target", "") for r in redirections]

    for path in all_paths:
        if "../" in path or path == "..":
            return {
                "check": "path_validation",
                "result": "warn",
                "reason": f"path traversal detected: '{path}'",
            }
        if path.startswith("~"):
            return {
                "check": "path_validation",
                "result": "warn",
                "reason": f"home directory reference: '{path}'",
            }
    return None


def _run_command_semantics(
    parsed: dict, intent: str,
) -> dict:
    """Submodule 6: Informational classification. Always runs, always 'allow'."""
    base = (parsed.get("base_command") or "").rsplit("/", 1)[-1]
    sub = parsed.get("subcommand")
    label = f"{base} {sub}" if sub else base
    return {
        "check": "command_semantics",
        "result": "allow",
        "reason": f"classified as {intent}: {label}" if label else f"classified as {intent}",
    }


# ---------------------------------------------------------------------------
# Risk score computation
# ---------------------------------------------------------------------------

def _compute_risk(
    intent: str, validations: list[dict], parsed: dict, raw_command: str,
) -> int:
    """Compute risk score 0-100 from intent, validations, and targets."""
    score = _RISK_BASE.get(intent, 20)

    # A bounded non-recursive rm is destructive in kind (irreversible) but a
    # routine single-file delete in degree — grade it below the catastrophic
    # destructive base so it lands in the warn band, not the block band.
    if intent == "destructive" and is_bounded_rm(parsed):
        score = min(score, _BOUNDED_RM_BASE)

    # Sensitive target boost (placeholder/template files exempt).
    targets = parsed.get("targets", [])
    redirections = parsed.get("redirections", [])
    all_paths = list(targets) + [r.get("target", "") for r in redirections]

    for path in all_paths:
        if SENSITIVE_PATTERNS.search(path) and not is_placeholder_path(path):
            score += 15
            break  # Only boost once.

    # Validation result boosts.
    for v in validations:
        if v["result"] == "block":
            score = max(85, score)
        elif v["result"] == "warn":
            score += 10

    # Inline-eval payloads that spawn processes / delete files / shell out
    # get one extra boost — surfaced in the warn band, not auto-blocked.
    inline_eval = any(
        v["check"] == "interpreter_validation" and v["result"] == "warn"
        for v in validations
    )
    if inline_eval and _INLINE_ESCAPE_HATCH_RE.search(raw_command):
        score += 10

    return min(score, 100)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_bash(
    command: str,
    mode: str = "workspace_write",
    workspace: Optional[str] = None,
) -> dict:
    """Classify a bash command by intent, risk, and reversibility.

    Args:
        command: The raw shell command string.
        mode: One of "readonly", "workspace_write", or "full_access".
        workspace: Optional workspace root path for path validation.

    Returns:
        A dict with keys: intent, risk_score, reversible, validations, parsed.
    """
    parsed = parse_command(command)
    intent = _classify_intent(parsed, command)

    # --- Run all 6 validation submodules (pipeline) ---
    validations: list[dict] = []

    v1 = _run_read_only_validation(parsed, intent, mode, command)
    if v1 is not None:
        validations.append(v1)

    v2 = _run_destructive_command_validation(parsed, intent, command)
    if v2 is not None:
        validations.append(v2)

    v3 = _run_mode_validation(parsed, intent, mode, workspace)
    if v3 is not None:
        validations.append(v3)

    v4 = _run_sed_validation(parsed, mode)
    if v4 is not None:
        validations.append(v4)

    v5 = _run_path_validation(parsed, workspace)
    if v5 is not None:
        validations.append(v5)

    v_interp = _run_interpreter_validation(parsed, intent, command)
    if v_interp is not None:
        validations.append(v_interp)

    v6 = _run_command_semantics(parsed, intent)
    validations.append(v6)

    # --- Compute derived fields ---
    risk_score = _compute_risk(intent, validations, parsed, command)
    reversible = intent != "destructive"

    return {
        "intent": intent,
        "risk_score": risk_score,
        "reversible": reversible,
        "validations": validations,
        "parsed": parsed,
    }
