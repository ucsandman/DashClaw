# DashClaw Layered Intelligence — Implementation Plan

> **SUPERSEDED (2026-06-12):** this plan was executed in commit `4c614e2e` (2026-04-04) and audited against main @ v4.16.0 on 2026-06-12 — 15/17 tasks fully SHIPPED, 2 test-coverage gaps remain.
> The executable remainder and the full verdict table live in **`docs/plans/2026-06-12-layered-intelligence-rebaselined.md`**. Do not execute this document; its code anchors predate the 4.x architecture.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port claw-code-parity's deep agent tool intelligence into DashClaw as a layered system — fast local classification via a Python module + smart server-side governance via expanded guard/signals/sessions APIs.

**Architecture:** Three layers — (1) `dashclaw_agent_intel` Python module (stdlib only, vendored alongside hooks) for deterministic classification of bash commands, file operations, 40+ tools, session state, and MCP health; (2) updated pretool/posttool hooks that import the module and send enriched context to the guard API; (3) DashClaw server extensions — 3 new policy types, 4 new signal types, recovery recipe engine, and session lifecycle API.

**Tech Stack:** Python 3.10+ (stdlib only for intel module + hooks), Next.js 15 / Node 20+ (server), Drizzle ORM + Postgres (schema), Vitest (server tests), unittest (Python tests)

**Target repo:** `C:\Projects\DashClaw`

**Spec:** `C:\Projects\claw-code-parity\docs\superpowers\specs\2026-04-03-dashclaw-layered-intelligence-design.md`

---

## File Map

### New Files (Layer 1 — Intel Module)
- `hooks/dashclaw_agent_intel/__init__.py` — Public API re-exports
- `hooks/dashclaw_agent_intel/command_parser.py` — Shared command parsing (wrappers, pipes, redirections)
- `hooks/dashclaw_agent_intel/bash_classifier.py` — 6-submodule bash intent classifier
- `hooks/dashclaw_agent_intel/file_scanner.py` — File operation security scanner
- `hooks/dashclaw_agent_intel/tool_recognizer.py` — 40+ tool catalog and classifier
- `hooks/dashclaw_agent_intel/session_tracker.py` — Agent session lifecycle state machine
- `hooks/dashclaw_agent_intel/mcp_monitor.py` — MCP server health monitor

### New Files (Layer 1 — Tests)
- `hooks/tests/__init__.py` — Test package init
- `hooks/tests/test_command_parser.py`
- `hooks/tests/test_bash_classifier.py`
- `hooks/tests/test_file_scanner.py`
- `hooks/tests/test_tool_recognizer.py`
- `hooks/tests/test_session_tracker.py`
- `hooks/tests/test_mcp_monitor.py`

### Modified Files (Layer 2 — Hooks)
- `hooks/dashclaw_pretool.py` — Replace regex classification with intel module
- `hooks/dashclaw_posttool.py` — Richer outcome reporting

### New Files (Layer 2 — Hook Tests)
- `hooks/tests/test_pretool_integration.py` — Hook e2e with mock server
- `hooks/tests/test_posttool_integration.py`

### New Files (Layer 3 — Server)
- `app/lib/recovery.js` — Recovery recipe engine
- `app/api/sessions/route.js` — POST + GET sessions
- `app/api/sessions/[sessionId]/route.js` — GET + PATCH session
- `app/api/sessions/[sessionId]/events/route.js` — GET session events

### Modified Files (Layer 3 — Server)
- `schema/schema.js` — Add sessions table, permission_level on agentPairings
- `app/lib/guard.js` — Permission escalation, green contract, branch freshness policy types
- `app/lib/signals.js` — 4 new signal types
- `app/api/pairings/[pairingId]/route.js` — Accept permission_level on PATCH

### New Files (Layer 3 — Server Tests)
- `__tests__/unit/guard-intel.test.js` — Guard enrichment + new policy types
- `__tests__/unit/recovery.test.js` — Recovery recipes
- `__tests__/unit/signals-intel.test.js` — New signal types
- `__tests__/unit/sessions.test.js` — Session lifecycle

---

## Phase A: Intel Module

### Task 1: Command Parser Foundation

**Files:**
- Create: `hooks/dashclaw_agent_intel/command_parser.py`
- Create: `hooks/tests/__init__.py`
- Create: `hooks/tests/test_command_parser.py`

This is the shared parsing layer used by the bash classifier. It extracts base commands, flags, wrappers, pipes, redirections, and targets from shell command strings.

- [ ] **Step 1: Write failing tests for command parsing**

```python
# hooks/tests/test_command_parser.py
import unittest
from dashclaw_agent_intel.command_parser import parse_command


class TestParseCommand(unittest.TestCase):

    def test_simple_command(self):
        result = parse_command("ls -la /tmp")
        self.assertEqual(result["base_command"], "ls")
        self.assertEqual(result["flags"], ["-la"])
        self.assertEqual(result["targets"], ["/tmp"])
        self.assertIsNone(result["wrapper"])
        self.assertEqual(result["pipes"], [])
        self.assertEqual(result["redirections"], [])

    def test_sudo_wrapper(self):
        result = parse_command("sudo apt install nginx")
        self.assertEqual(result["wrapper"], "sudo")
        self.assertEqual(result["base_command"], "apt")
        self.assertEqual(result["targets"], ["nginx"])

    def test_env_wrapper(self):
        result = parse_command("env VAR=1 python script.py")
        self.assertEqual(result["wrapper"], "env")
        self.assertEqual(result["base_command"], "python")

    def test_pipe_chain(self):
        result = parse_command("cat file.txt | grep error | wc -l")
        self.assertEqual(result["base_command"], "cat")
        self.assertEqual(len(result["pipes"]), 2)
        self.assertEqual(result["pipes"][0]["base_command"], "grep")
        self.assertEqual(result["pipes"][1]["base_command"], "wc")

    def test_redirection_output(self):
        result = parse_command("echo hello > output.txt")
        self.assertEqual(result["base_command"], "echo")
        self.assertEqual(result["redirections"], [{"type": ">", "target": "output.txt"}])

    def test_redirection_append(self):
        result = parse_command("echo hello >> log.txt")
        self.assertEqual(result["redirections"], [{"type": ">>", "target": "log.txt"}])

    def test_git_subcommand(self):
        result = parse_command("git push origin main")
        self.assertEqual(result["base_command"], "git")
        self.assertEqual(result["subcommand"], "push")
        self.assertEqual(result["targets"], ["origin", "main"])

    def test_empty_command(self):
        result = parse_command("")
        self.assertEqual(result["base_command"], "")

    def test_chained_commands(self):
        result = parse_command("cd /tmp && ls -la")
        self.assertEqual(result["base_command"], "cd")
        self.assertEqual(len(result["chains"]), 1)
        self.assertEqual(result["chains"][0]["base_command"], "ls")

    def test_quoted_argument(self):
        result = parse_command('grep "hello world" file.txt')
        self.assertEqual(result["base_command"], "grep")
        self.assertIn("hello world", result["targets"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Create package init and run tests to verify they fail**

```python
# hooks/dashclaw_agent_intel/__init__.py
"""DashClaw Agent Intelligence — local classification for agent governance."""
```

```python
# hooks/tests/__init__.py
```

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_command_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'dashclaw_agent_intel.command_parser'`

- [ ] **Step 3: Implement command parser**

```python
# hooks/dashclaw_agent_intel/command_parser.py
"""Shell command parser — extracts structure from command strings."""

import shlex
import re

_WRAPPERS = {"sudo", "env", "nohup", "nice", "ionice", "strace", "time", "timeout"}
_SUBCOMMAND_TOOLS = {"git", "docker", "kubectl", "npm", "yarn", "pip", "cargo", "go", "apt", "brew", "systemctl"}
_REDIRECT_PATTERN = re.compile(r"(>>|>|2>>|2>|&>>|&>)\s*(\S+)")


def parse_command(command_str):
    """Parse a shell command string into structured components.

    Returns dict with: base_command, flags, targets, wrapper, subcommand,
    pipes, redirections, chains.
    """
    command_str = command_str.strip()
    if not command_str:
        return _empty_result()

    # Split on && and ; for chained commands
    chains = _split_chains(command_str)
    first_segment = chains[0]
    chain_results = [_parse_segment(seg) for seg in chains[1:]]

    result = _parse_segment(first_segment)
    result["chains"] = chain_results
    return result


def _parse_segment(segment):
    """Parse a single command segment (no chains)."""
    segment = segment.strip()
    if not segment:
        return _empty_result()

    # Extract redirections before tokenizing
    redirections = []
    for match in _REDIRECT_PATTERN.finditer(segment):
        redirections.append({"type": match.group(1), "target": match.group(2)})
    clean_segment = _REDIRECT_PATTERN.sub("", segment).strip()

    # Split on pipes
    pipe_parts = _split_pipes(clean_segment)
    first_part = pipe_parts[0]
    pipe_results = [_parse_tokens(_tokenize(p)) for p in pipe_parts[1:]]

    result = _parse_tokens(_tokenize(first_part))
    result["pipes"] = pipe_results
    result["redirections"] = redirections
    return result


def _parse_tokens(tokens):
    """Parse tokenized command into structured result."""
    if not tokens:
        return _empty_result()

    idx = 0
    wrapper = None

    # Skip env var assignments (VAR=value)
    while idx < len(tokens) and "=" in tokens[idx] and not tokens[idx].startswith("-"):
        idx += 1

    # Detect wrapper
    if idx < len(tokens) and tokens[idx] in _WRAPPERS:
        wrapper = tokens[idx]
        idx += 1
        # Skip wrapper flags
        while idx < len(tokens) and tokens[idx].startswith("-"):
            idx += 1
        # Skip env var assignments after wrapper
        while idx < len(tokens) and "=" in tokens[idx] and not tokens[idx].startswith("-"):
            idx += 1

    if idx >= len(tokens):
        return _empty_result(wrapper=wrapper)

    base_command = tokens[idx]
    idx += 1

    # Detect subcommand for tools like git, docker, npm
    subcommand = None
    if base_command in _SUBCOMMAND_TOOLS and idx < len(tokens) and not tokens[idx].startswith("-"):
        subcommand = tokens[idx]
        idx += 1

    # Separate flags from targets
    flags = []
    targets = []
    while idx < len(tokens):
        tok = tokens[idx]
        if tok.startswith("-"):
            flags.append(tok)
        else:
            targets.append(tok)
        idx += 1

    return {
        "base_command": base_command,
        "subcommand": subcommand,
        "flags": flags,
        "targets": targets,
        "wrapper": wrapper,
        "pipes": [],
        "redirections": [],
        "chains": [],
    }


def _tokenize(s):
    """Tokenize a command string, handling quotes."""
    try:
        return shlex.split(s)
    except ValueError:
        return s.split()


def _split_pipes(s):
    """Split on unquoted pipe characters."""
    parts = []
    current = []
    in_quote = None
    for char in s:
        if char in ('"', "'") and in_quote is None:
            in_quote = char
            current.append(char)
        elif char == in_quote:
            in_quote = None
            current.append(char)
        elif char == "|" and in_quote is None:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def _split_chains(s):
    """Split on && and ; outside quotes."""
    parts = []
    current = []
    i = 0
    in_quote = None
    while i < len(s):
        c = s[i]
        if c in ('"', "'") and in_quote is None:
            in_quote = c
            current.append(c)
        elif c == in_quote:
            in_quote = None
            current.append(c)
        elif c == "&" and i + 1 < len(s) and s[i + 1] == "&" and in_quote is None:
            parts.append("".join(current))
            current = []
            i += 2
            continue
        elif c == ";" and in_quote is None:
            parts.append("".join(current))
            current = []
        else:
            current.append(c)
        i += 1
    parts.append("".join(current))
    return [p for p in parts if p.strip()]


def _empty_result(wrapper=None):
    return {
        "base_command": "",
        "subcommand": None,
        "flags": [],
        "targets": [],
        "wrapper": wrapper,
        "pipes": [],
        "redirections": [],
        "chains": [],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_command_parser.py -v`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/__init__.py hooks/dashclaw_agent_intel/command_parser.py hooks/tests/__init__.py hooks/tests/test_command_parser.py
git commit -m "feat(intel): add command parser foundation for bash classification"
```

---

### Task 2: Bash Intent Classifier — Core Classification

**Files:**
- Create: `hooks/dashclaw_agent_intel/bash_classifier.py`
- Create: `hooks/tests/test_bash_classifier.py`

This is the main public API. It uses the command parser and runs 6 validation submodules in a pipeline.

- [ ] **Step 1: Write failing tests for bash classification**

```python
# hooks/tests/test_bash_classifier.py
import unittest
from dashclaw_agent_intel.bash_classifier import classify_bash


class TestClassifyBashIntent(unittest.TestCase):
    """Test intent classification for common commands."""

    def test_cat_is_readonly(self):
        r = classify_bash("cat README.md", mode="readonly", workspace="/tmp/project")
        self.assertEqual(r["intent"], "readonly")

    def test_grep_is_readonly(self):
        r = classify_bash("grep -r TODO src/", mode="readonly", workspace="/tmp/project")
        self.assertEqual(r["intent"], "readonly")

    def test_git_log_is_readonly(self):
        r = classify_bash("git log --oneline -10", mode="readonly", workspace="/tmp/project")
        self.assertEqual(r["intent"], "readonly")

    def test_git_push_is_write(self):
        r = classify_bash("git push origin main", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "write")

    def test_git_reset_hard_is_destructive(self):
        r = classify_bash("git reset --hard HEAD~1", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "destructive")

    def test_rm_rf_is_destructive(self):
        r = classify_bash("rm -rf /", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "destructive")

    def test_curl_is_network(self):
        r = classify_bash("curl https://api.example.com/data", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "network")

    def test_npm_install_is_package_management(self):
        r = classify_bash("npm install express", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "package_management")

    def test_kill_is_process_management(self):
        r = classify_bash("kill -9 12345", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "process_management")

    def test_sudo_apt_is_system_admin(self):
        r = classify_bash("sudo apt install nginx", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["intent"], "system_admin")

    def test_empty_command(self):
        r = classify_bash("", mode="readonly", workspace="/tmp/project")
        self.assertEqual(r["intent"], "unknown")


class TestClassifyBashValidations(unittest.TestCase):
    """Test the 6 validation submodules."""

    def test_readonly_blocks_write_command(self):
        r = classify_bash("rm file.txt", mode="readonly", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("read_only_validation", checks)
        self.assertEqual(checks["read_only_validation"]["result"], "block")

    def test_readonly_allows_safe_command(self):
        r = classify_bash("ls -la", mode="readonly", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        ro = checks.get("read_only_validation")
        if ro:
            self.assertEqual(ro["result"], "allow")

    def test_destructive_warning_on_rm_rf(self):
        r = classify_bash("rm -rf /var/log", mode="workspace_write", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("destructive_command", checks)
        self.assertEqual(checks["destructive_command"]["result"], "block")

    def test_mode_warns_system_path_in_workspace_mode(self):
        r = classify_bash("touch /etc/hosts", mode="workspace_write", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("mode_validation", checks)
        self.assertEqual(checks["mode_validation"]["result"], "warn")

    def test_sed_i_blocked_in_readonly(self):
        r = classify_bash("sed -i 's/foo/bar/' file.txt", mode="readonly", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("sed_validation", checks)
        self.assertEqual(checks["sed_validation"]["result"], "block")

    def test_sed_stdout_allowed_in_readonly(self):
        r = classify_bash("sed 's/foo/bar/' file.txt", mode="readonly", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        sed = checks.get("sed_validation")
        if sed:
            self.assertEqual(sed["result"], "allow")

    def test_path_traversal_warned(self):
        r = classify_bash("cat ../../etc/passwd", mode="workspace_write", workspace="/tmp/project")
        checks = {v["check"]: v for v in r["validations"]}
        self.assertIn("path_validation", checks)
        self.assertEqual(checks["path_validation"]["result"], "warn")

    def test_wrapper_detected_in_parsed(self):
        r = classify_bash("sudo rm -rf /tmp/junk", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(r["parsed"]["wrapper"], "sudo")
        self.assertEqual(r["parsed"]["base_command"], "rm")


class TestClassifyBashRiskScore(unittest.TestCase):
    """Test risk score computation."""

    def test_readonly_command_low_risk(self):
        r = classify_bash("ls -la", mode="readonly", workspace="/tmp/project")
        self.assertLessEqual(r["risk_score"], 10)

    def test_destructive_command_high_risk(self):
        r = classify_bash("rm -rf /", mode="workspace_write", workspace="/tmp/project")
        self.assertGreaterEqual(r["risk_score"], 85)

    def test_git_push_moderate_risk(self):
        r = classify_bash("git push origin main", mode="workspace_write", workspace="/tmp/project")
        self.assertGreaterEqual(r["risk_score"], 50)
        self.assertLessEqual(r["risk_score"], 85)

    def test_reversible_flag_set(self):
        r = classify_bash("rm -rf /", mode="workspace_write", workspace="/tmp/project")
        self.assertFalse(r["reversible"])

    def test_readonly_is_reversible(self):
        r = classify_bash("cat file.txt", mode="readonly", workspace="/tmp/project")
        self.assertTrue(r["reversible"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_bash_classifier.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'dashclaw_agent_intel.bash_classifier'`

- [ ] **Step 3: Implement bash classifier**

```python
# hooks/dashclaw_agent_intel/bash_classifier.py
"""Bash intent classifier — 6-submodule validation pipeline.

Ported from claw-code-parity's bash_validation.rs.
"""

import re
from .command_parser import parse_command

# --- Intent classification tables ---

_READONLY_COMMANDS = frozenset([
    "cat", "head", "tail", "less", "more", "wc", "file", "stat", "du", "df",
    "ls", "tree", "find", "locate", "which", "whereis", "type", "readlink",
    "grep", "rg", "ag", "ack", "sed",  # sed without -i is readonly
    "awk", "cut", "sort", "uniq", "tr", "diff", "comm", "join", "paste",
    "echo", "printf", "date", "cal", "uname", "hostname", "whoami", "id", "env", "printenv",
    "pwd", "test", "true", "false", "seq", "expr", "bc",
    "ps", "top", "htop", "free", "uptime", "lsof", "ss", "netstat",
    "man", "help", "info",
    "sha256sum", "md5sum", "base64",
])

_READONLY_GIT_SUBCOMMANDS = frozenset([
    "status", "log", "diff", "show", "branch", "tag", "remote", "stash",
    "describe", "rev-parse", "rev-list", "shortlog", "blame", "ls-files",
    "ls-tree", "ls-remote", "name-rev", "reflog", "config",
])

_WRITE_GIT_SUBCOMMANDS = frozenset([
    "add", "commit", "merge", "rebase", "cherry-pick", "am", "apply",
    "checkout", "switch", "restore", "mv", "rm",
])

_DESTRUCTIVE_GIT_SUBCOMMANDS = frozenset([
    "push", "reset", "clean", "gc", "filter-branch", "rebase",
])

_WRITE_COMMANDS = frozenset([
    "cp", "mv", "mkdir", "touch", "chmod", "chown", "chgrp", "ln",
    "tee", "install", "patch",
])

_DESTRUCTIVE_COMMANDS = frozenset([
    "rm", "rmdir", "shred", "mkfs", "fdisk", "parted", "dd",
    "truncate", "wipefs",
])

_NETWORK_COMMANDS = frozenset([
    "curl", "wget", "ssh", "scp", "rsync", "ftp", "sftp", "nc", "ncat",
    "telnet", "ping", "traceroute", "dig", "nslookup", "host",
])

_PROCESS_COMMANDS = frozenset([
    "kill", "killall", "pkill", "nohup", "disown", "bg", "fg", "jobs",
    "screen", "tmux", "crontab", "at", "batch",
])

_PACKAGE_COMMANDS = frozenset([
    "npm", "yarn", "pnpm", "pip", "pip3", "pipx", "conda",
    "cargo", "go", "gem", "bundle", "composer",
    "brew", "apt", "apt-get", "dnf", "yum", "pacman", "snap", "flatpak",
])

_SYSTEM_ADMIN_COMMANDS = frozenset([
    "systemctl", "service", "journalctl", "loginctl",
    "useradd", "userdel", "usermod", "groupadd", "passwd",
    "iptables", "ufw", "firewall-cmd",
    "mount", "umount", "fdisk", "lvm",
    "reboot", "shutdown", "halt", "poweroff", "init",
])

_DESTRUCTIVE_PATTERNS = [
    re.compile(r"rm\s+.*-.*r.*f|rm\s+.*-.*f.*r", re.IGNORECASE),
    re.compile(r"mkfs\b"),
    re.compile(r"dd\s+if="),
    re.compile(r":\(\)\{.*\|.*&\s*\};:"),  # fork bomb
    re.compile(r"DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE", re.IGNORECASE),
    re.compile(r">\s*/dev/sd[a-z]"),
]

_SYSTEM_PATHS = ("/etc/", "/usr/", "/var/", "/boot/", "/sys/", "/proc/", "/sbin/", "/lib/")

_SENSITIVE_PATTERNS = [
    re.compile(r"\.env\b"),
    re.compile(r"secret|credential|private_key|id_rsa|\.pem\b", re.IGNORECASE),
]

# --- Risk score table ---

_INTENT_RISK = {
    "readonly": 5,
    "write": 35,
    "destructive": 90,
    "network": 40,
    "process_management": 50,
    "package_management": 30,
    "system_admin": 75,
    "unknown": 20,
}

_IRREVERSIBLE_INTENTS = frozenset(["destructive"])


def classify_bash(command, mode="workspace_write", workspace="/tmp"):
    """Classify a bash command and run the 6-submodule validation pipeline.

    Args:
        command: Raw command string.
        mode: Agent permission mode (readonly|workspace_write|danger).
        workspace: Agent workspace root path.

    Returns:
        Dict with intent, risk_score, reversible, validations, parsed.
    """
    parsed = parse_command(command)
    if not parsed["base_command"]:
        return {
            "intent": "unknown",
            "risk_score": 0,
            "reversible": True,
            "validations": [],
            "parsed": parsed,
        }

    intent = _classify_intent(parsed)
    validations = _run_validation_pipeline(command, parsed, mode, workspace)

    # Boost risk score based on validations
    risk = _INTENT_RISK.get(intent, 20)
    for v in validations:
        if v["result"] == "block":
            risk = max(risk, 85)
        elif v["result"] == "warn":
            risk = max(risk, risk + 10)

    # Boost for sensitive targets
    for target in parsed.get("targets", []):
        for pat in _SENSITIVE_PATTERNS:
            if pat.search(target):
                risk = min(risk + 15, 100)
                break

    risk = min(risk, 100)

    return {
        "intent": intent,
        "risk_score": risk,
        "reversible": intent not in _IRREVERSIBLE_INTENTS,
        "validations": validations,
        "parsed": parsed,
    }


def _classify_intent(parsed):
    """Classify command intent from parsed structure."""
    base = parsed["base_command"]
    sub = parsed.get("subcommand")
    wrapper = parsed.get("wrapper")

    # System admin via sudo wrapper
    if wrapper == "sudo" and base in (_PACKAGE_COMMANDS | _SYSTEM_ADMIN_COMMANDS):
        return "system_admin"

    # Git subcommand classification
    if base == "git" and sub:
        if sub in _READONLY_GIT_SUBCOMMANDS:
            return "readonly"
        if sub in _DESTRUCTIVE_GIT_SUBCOMMANDS:
            # git push is write, git reset --hard is destructive
            flags = parsed.get("flags", [])
            if sub == "push":
                if "--force" in flags or "-f" in flags:
                    return "destructive"
                return "write"
            if sub == "reset" and "--hard" in flags:
                return "destructive"
            if sub == "clean" and ("-f" in flags or "-fd" in flags):
                return "destructive"
            return "write"
        if sub in _WRITE_GIT_SUBCOMMANDS:
            return "write"
        return "readonly"  # unknown git subcommand defaults to readonly

    # Direct lookup tables
    if base in _DESTRUCTIVE_COMMANDS:
        return "destructive"
    if base in _NETWORK_COMMANDS:
        return "network"
    if base in _PROCESS_COMMANDS:
        return "process_management"
    if base in _PACKAGE_COMMANDS:
        return "package_management"
    if base in _SYSTEM_ADMIN_COMMANDS:
        return "system_admin"
    if base in _WRITE_COMMANDS:
        return "write"
    if base in _READONLY_COMMANDS:
        # sed with -i is a write
        if base == "sed" and "-i" in parsed.get("flags", []):
            return "write"
        return "readonly"

    # Redirections make readonly commands into writes
    if parsed.get("redirections"):
        return "write"

    return "unknown"


def _run_validation_pipeline(command, parsed, mode, workspace):
    """Run the 6-submodule pipeline. Returns list of validation results."""
    validations = []

    # 1. Read-only validation
    v = _validate_read_only(parsed, mode)
    if v:
        validations.append(v)

    # 2. Destructive command warning
    v = _validate_destructive(command, parsed)
    if v:
        validations.append(v)

    # 3. Mode validation (workspace_write targeting system paths)
    v = _validate_mode(parsed, mode, workspace)
    if v:
        validations.append(v)

    # 4. Sed validation
    v = _validate_sed(parsed, mode)
    if v:
        validations.append(v)

    # 5. Path validation (traversal, escapes)
    v = _validate_paths(parsed, workspace)
    if v:
        validations.append(v)

    # 6. Command semantics (informational, always included)
    v = _validate_semantics(parsed)
    if v:
        validations.append(v)

    return validations


def _validate_read_only(parsed, mode):
    """Submodule 1: Block write/destructive commands in readonly mode."""
    if mode != "readonly":
        return None

    base = parsed["base_command"]
    intent = _classify_intent(parsed)

    if intent in ("write", "destructive", "process_management", "system_admin", "package_management"):
        return {
            "check": "read_only_validation",
            "result": "block",
            "reason": f"'{base}' is not allowed in readonly mode",
        }

    if parsed.get("redirections"):
        return {
            "check": "read_only_validation",
            "result": "block",
            "reason": "output redirection not allowed in readonly mode",
        }

    return {"check": "read_only_validation", "result": "allow", "reason": ""}


def _validate_destructive(command, parsed):
    """Submodule 2: Warn/block on destructive patterns."""
    for pat in _DESTRUCTIVE_PATTERNS:
        if pat.search(command):
            return {
                "check": "destructive_command",
                "result": "block",
                "reason": f"destructive pattern detected: {pat.pattern[:40]}",
            }

    base = parsed["base_command"]
    if base in _DESTRUCTIVE_COMMANDS:
        flags = parsed.get("flags", [])
        targets = parsed.get("targets", [])
        # rm -rf with / or * is especially dangerous
        if base == "rm" and any(f in flags for f in ["-rf", "-fr"]):
            if any(t in ("/", "/*", "~", "~/*") for t in targets):
                return {
                    "check": "destructive_command",
                    "result": "block",
                    "reason": f"rm -rf targeting root/home path: {' '.join(targets)}",
                }
            return {
                "check": "destructive_command",
                "result": "warn",
                "reason": f"recursive forced removal: rm -rf {' '.join(targets)}",
            }

    return None


def _validate_mode(parsed, mode, workspace):
    """Submodule 3: Warn when workspace_write targets system paths."""
    if mode != "workspace_write":
        return None

    for target in parsed.get("targets", []):
        for sys_path in _SYSTEM_PATHS:
            if target.startswith(sys_path):
                return {
                    "check": "mode_validation",
                    "result": "warn",
                    "reason": f"workspace_write agent targeting system path: {target}",
                }
    return None


def _validate_sed(parsed, mode):
    """Submodule 4: Block sed -i in readonly mode."""
    if parsed["base_command"] != "sed":
        return None

    has_inplace = "-i" in parsed.get("flags", []) or any(
        f.startswith("-i") for f in parsed.get("flags", [])
    )

    if has_inplace and mode == "readonly":
        return {
            "check": "sed_validation",
            "result": "block",
            "reason": "sed -i (in-place edit) not allowed in readonly mode",
        }

    if has_inplace:
        return {"check": "sed_validation", "result": "warn", "reason": "sed -i modifies files in-place"}

    return {"check": "sed_validation", "result": "allow", "reason": "sed stdout-only (no -i flag)"}


def _validate_paths(parsed, workspace):
    """Submodule 5: Warn on path traversal and escapes."""
    all_targets = parsed.get("targets", [])
    for pipe in parsed.get("pipes", []):
        all_targets.extend(pipe.get("targets", []))

    for target in all_targets:
        if ".." in target:
            return {
                "check": "path_validation",
                "result": "warn",
                "reason": f"path traversal detected: {target}",
            }
        if target.startswith("~"):
            return {
                "check": "path_validation",
                "result": "warn",
                "reason": f"home directory reference: {target}",
            }
    return None


def _validate_semantics(parsed):
    """Submodule 6: Informational intent classification."""
    intent = _classify_intent(parsed)
    return {
        "check": "command_semantics",
        "result": "allow",
        "reason": f"classified as {intent}",
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_bash_classifier.py -v`
Expected: All 19 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/bash_classifier.py hooks/tests/test_bash_classifier.py
git commit -m "feat(intel): add bash intent classifier with 6 validation submodules"
```

---

### Task 3: File Security Scanner

**Files:**
- Create: `hooks/dashclaw_agent_intel/file_scanner.py`
- Create: `hooks/tests/test_file_scanner.py`

- [ ] **Step 1: Write failing tests**

```python
# hooks/tests/test_file_scanner.py
import os
import tempfile
import unittest
from dashclaw_agent_intel.file_scanner import scan_file_operation


class TestFileScanner(unittest.TestCase):

    def setUp(self):
        self.workspace = tempfile.mkdtemp()

    def test_traversal_detected(self):
        r = scan_file_operation("../../etc/passwd", "", self.workspace)
        self.assertTrue(r["traversal_detected"])

    def test_no_traversal(self):
        r = scan_file_operation(os.path.join(self.workspace, "file.txt"), "", self.workspace)
        self.assertFalse(r["traversal_detected"])

    def test_outside_workspace(self):
        r = scan_file_operation("/etc/passwd", "", self.workspace)
        self.assertTrue(r["outside_workspace"])

    def test_inside_workspace(self):
        path = os.path.join(self.workspace, "src", "main.py")
        r = scan_file_operation(path, "", self.workspace)
        self.assertFalse(r["outside_workspace"])

    def test_binary_detected(self):
        r = scan_file_operation("test.bin", "hello\x00world", self.workspace)
        self.assertTrue(r["binary_detected"])

    def test_text_not_binary(self):
        r = scan_file_operation("test.txt", "hello world", self.workspace)
        self.assertFalse(r["binary_detected"])

    def test_size_bytes(self):
        content = "x" * 1000
        r = scan_file_operation("test.txt", content, self.workspace)
        self.assertEqual(r["size_bytes"], 1000)

    def test_size_exceeds_limit(self):
        content = "x" * (11 * 1024 * 1024)  # 11MB
        r = scan_file_operation("test.txt", content, self.workspace)
        self.assertTrue(r["size_exceeds_limit"])

    def test_sensitive_env_file(self):
        r = scan_file_operation(".env", "SECRET=foo", self.workspace)
        self.assertTrue(r["sensitive_path"])
        self.assertEqual(r["sensitive_pattern"], "env_file")

    def test_sensitive_credentials(self):
        r = scan_file_operation("credentials.json", "{}", self.workspace)
        self.assertTrue(r["sensitive_path"])

    def test_sensitive_private_key(self):
        r = scan_file_operation("id_rsa", "", self.workspace)
        self.assertTrue(r["sensitive_path"])

    def test_normal_file_not_sensitive(self):
        r = scan_file_operation("src/main.py", "print('hello')", self.workspace)
        self.assertFalse(r["sensitive_path"])

    def test_symlink_escape(self):
        # Create a symlink inside workspace pointing outside
        target_dir = tempfile.mkdtemp()
        link_path = os.path.join(self.workspace, "escape_link")
        try:
            os.symlink(target_dir, link_path)
            r = scan_file_operation(link_path, "", self.workspace)
            self.assertTrue(r["symlink_escape"])
        except OSError:
            self.skipTest("Symlinks not supported on this platform")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_file_scanner.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement file scanner**

```python
# hooks/dashclaw_agent_intel/file_scanner.py
"""File operation security scanner.

Ported from claw-code-parity's file_ops.rs security guards.
"""

import os
import re

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
_BINARY_CHECK_SIZE = 8192  # First 8KB

_SENSITIVE_PATTERNS = [
    (re.compile(r"(^|/)\.env(\.|$)", re.IGNORECASE), "env_file"),
    (re.compile(r"credential|secret", re.IGNORECASE), "credentials"),
    (re.compile(r"private_key|id_rsa|id_ed25519|\.pem$", re.IGNORECASE), "private_key"),
    (re.compile(r"\.key$|\.crt$|\.pfx$|\.p12$", re.IGNORECASE), "certificate"),
    (re.compile(r"token|password|passwd", re.IGNORECASE), "auth_secret"),
]

_SYSTEM_CONFIG_PATHS = (
    "/etc/", "/boot/", "/sys/", "/proc/",
    "C:\\Windows\\System32", "C:\\Windows\\system32",
)


def scan_file_operation(path, content="", workspace="/tmp"):
    """Scan a file write/edit operation for security concerns.

    Args:
        path: Target file path (absolute or relative).
        content: File content being written (string).
        workspace: Agent workspace root.

    Returns:
        Dict with binary_detected, size_bytes, size_exceeds_limit,
        symlink_escape, traversal_detected, outside_workspace,
        resolved_path, sensitive_path, sensitive_pattern.
    """
    path_str = str(path)

    # Normalize path
    if os.path.isabs(path_str):
        abs_path = os.path.normpath(path_str)
    else:
        abs_path = os.path.normpath(os.path.join(workspace, path_str))

    # Traversal detection (before resolution)
    traversal_detected = ".." in path_str

    # Resolve symlinks if path exists
    resolved = abs_path
    symlink_escape = False
    if os.path.exists(abs_path):
        try:
            resolved = os.path.realpath(abs_path)
            if os.path.islink(abs_path):
                ws_norm = os.path.normpath(workspace)
                symlink_escape = not resolved.startswith(ws_norm)
        except OSError:
            pass

    # Workspace boundary check
    ws_norm = os.path.normpath(workspace)
    outside_workspace = not os.path.normpath(resolved).startswith(ws_norm)

    # Binary detection (NUL byte scan)
    content_bytes = content.encode("utf-8", errors="replace") if isinstance(content, str) else content
    check_slice = content_bytes[:_BINARY_CHECK_SIZE]
    binary_detected = b"\x00" in check_slice

    # Size check
    size_bytes = len(content_bytes) if content_bytes else 0
    size_exceeds_limit = size_bytes > MAX_FILE_SIZE

    # Sensitive path detection
    sensitive_path = False
    sensitive_pattern = None
    basename = os.path.basename(path_str)
    check_str = path_str + "/" + basename  # check both full path and basename

    for pat, label in _SENSITIVE_PATTERNS:
        if pat.search(check_str):
            sensitive_path = True
            sensitive_pattern = label
            break

    if not sensitive_path:
        for sys_path in _SYSTEM_CONFIG_PATHS:
            if abs_path.startswith(sys_path):
                sensitive_path = True
                sensitive_pattern = "system_config"
                break

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_file_scanner.py -v`
Expected: All 13 tests PASS (1 may skip on Windows if symlinks aren't available)

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/file_scanner.py hooks/tests/test_file_scanner.py
git commit -m "feat(intel): add file security scanner — traversal, binary, symlink, workspace guards"
```

---

### Task 4: Tool Surface Recognizer

**Files:**
- Create: `hooks/dashclaw_agent_intel/tool_recognizer.py`
- Create: `hooks/tests/test_tool_recognizer.py`

- [ ] **Step 1: Write failing tests**

```python
# hooks/tests/test_tool_recognizer.py
import os
import unittest
from dashclaw_agent_intel.tool_recognizer import classify_tool, TOOL_CATALOG


class TestToolCatalog(unittest.TestCase):

    def test_catalog_has_40_plus_tools(self):
        self.assertGreaterEqual(len(TOOL_CATALOG), 40)

    def test_every_tool_has_required_fields(self):
        for name, info in TOOL_CATALOG.items():
            self.assertIn("category", info, f"{name} missing category")
            self.assertIn("required_permission", info, f"{name} missing required_permission")
            self.assertIn("risk_profile", info, f"{name} missing risk_profile")


class TestClassifyTool(unittest.TestCase):

    def test_bash_is_execution(self):
        r = classify_tool("Bash", {"command": "ls"})
        self.assertEqual(r["category"], "execution")
        self.assertEqual(r["required_permission"], "danger")
        self.assertTrue(r["governed"])

    def test_read_is_search(self):
        r = classify_tool("Read", {"file_path": "/tmp/test.txt"})
        self.assertEqual(r["category"], "search")
        self.assertEqual(r["required_permission"], "readonly")

    def test_write_is_file_io(self):
        r = classify_tool("Write", {"file_path": "/tmp/test.txt", "content": "hello"})
        self.assertEqual(r["category"], "file_io")
        self.assertEqual(r["required_permission"], "workspace_write")
        self.assertTrue(r["governed"])

    def test_agent_is_orchestration(self):
        r = classify_tool("Agent", {"prompt": "do something"})
        self.assertEqual(r["category"], "orchestration")
        self.assertEqual(r["required_permission"], "danger")

    def test_mcp_tool_recognized(self):
        r = classify_tool("mcp__agentcash__search", {"query": "test"})
        self.assertEqual(r["category"], "mcp")
        self.assertTrue(r["governed"])

    def test_unknown_tool_defaults_governed(self):
        r = classify_tool("BrandNewTool2027", {})
        self.assertEqual(r["category"], "unknown")
        self.assertEqual(r["required_permission"], "workspace_write")
        self.assertTrue(r["governed"])

    def test_sleep_is_system(self):
        r = classify_tool("Sleep", {"duration": 5})
        self.assertEqual(r["category"], "system")
        self.assertEqual(r["required_permission"], "allow")

    def test_default_governed_categories(self):
        """Default: execution, orchestration, file_io, interactive, mcp are governed."""
        r_bash = classify_tool("Bash", {})
        r_read = classify_tool("Read", {})
        r_write = classify_tool("Write", {})
        r_agent = classify_tool("Agent", {})
        r_sleep = classify_tool("Sleep", {})
        self.assertTrue(r_bash["governed"])
        self.assertFalse(r_read["governed"])  # search is ungoverned by default
        self.assertTrue(r_write["governed"])
        self.assertTrue(r_agent["governed"])
        self.assertFalse(r_sleep["governed"])  # system is ungoverned by default

    def test_governed_categories_env_override(self):
        """DASHCLAW_GOVERNED_CATEGORIES=all governs everything."""
        os.environ["DASHCLAW_GOVERNED_CATEGORIES"] = "all"
        try:
            r = classify_tool("Read", {})
            self.assertTrue(r["governed"])
        finally:
            del os.environ["DASHCLAW_GOVERNED_CATEGORIES"]


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_tool_recognizer.py -v`
Expected: FAIL

- [ ] **Step 3: Implement tool recognizer**

```python
# hooks/dashclaw_agent_intel/tool_recognizer.py
"""Tool surface recognizer — 40+ tool catalog with permission levels.

Ported from claw-code-parity's tools/lib.rs MVP tool specs.
"""

import os

# Permission levels (ordered)
PERMISSION_LEVELS = ["readonly", "workspace_write", "danger", "prompt", "allow"]
DEFAULT_GOVERNED_CATEGORIES = {"execution", "orchestration", "file_io", "interactive", "mcp"}


def _risk(base=20, spawn=False, network=False, files=False, escalate=False):
    return {
        "base_risk": base,
        "can_spawn_processes": spawn,
        "can_access_network": network,
        "can_modify_files": files,
        "can_escalate_permissions": escalate,
    }


TOOL_CATALOG = {
    # --- execution ---
    "Bash": {"category": "execution", "required_permission": "danger", "risk_profile": _risk(70, spawn=True, network=True, files=True, escalate=True)},
    "REPL": {"category": "execution", "required_permission": "danger", "risk_profile": _risk(60, spawn=True, files=True)},
    "PowerShell": {"category": "execution", "required_permission": "danger", "risk_profile": _risk(70, spawn=True, network=True, files=True, escalate=True)},
    # --- file_io ---
    "Write": {"category": "file_io", "required_permission": "workspace_write", "risk_profile": _risk(30, files=True)},
    "Edit": {"category": "file_io", "required_permission": "workspace_write", "risk_profile": _risk(25, files=True)},
    "MultiEdit": {"category": "file_io", "required_permission": "workspace_write", "risk_profile": _risk(30, files=True)},
    "NotebookEdit": {"category": "file_io", "required_permission": "workspace_write", "risk_profile": _risk(25, files=True)},
    # --- search ---
    "Read": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    "Glob": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    "Grep": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    "WebSearch": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(15, network=True)},
    "WebFetch": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(15, network=True)},
    "ToolSearch": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    # --- orchestration ---
    "Agent": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(60, spawn=True, network=True, files=True, escalate=True)},
    "Skill": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(50, spawn=True, files=True)},
    "RemoteTrigger": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(65, spawn=True, network=True, escalate=True)},
    # --- system ---
    "EnterPlanMode": {"category": "system", "required_permission": "allow", "risk_profile": _risk(0)},
    "ExitPlanMode": {"category": "system", "required_permission": "allow", "risk_profile": _risk(0)},
    "Config": {"category": "system", "required_permission": "allow", "risk_profile": _risk(10)},
    "Sleep": {"category": "system", "required_permission": "allow", "risk_profile": _risk(0)},
    "StructuredOutput": {"category": "system", "required_permission": "allow", "risk_profile": _risk(0)},
    # --- interactive ---
    "AskUserQuestion": {"category": "interactive", "required_permission": "prompt", "risk_profile": _risk(5)},
    "SendUserMessage": {"category": "interactive", "required_permission": "prompt", "risk_profile": _risk(5)},
    # --- task tools ---
    "TaskCreate": {"category": "orchestration", "required_permission": "workspace_write", "risk_profile": _risk(20)},
    "TaskGet": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    "TaskList": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    "TaskStop": {"category": "orchestration", "required_permission": "workspace_write", "risk_profile": _risk(30)},
    "TaskUpdate": {"category": "orchestration", "required_permission": "workspace_write", "risk_profile": _risk(20)},
    "TaskOutput": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    # --- cron/team ---
    "CronCreate": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(55, spawn=True)},
    "CronDelete": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(40)},
    "CronList": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    "TeamCreate": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(50, spawn=True)},
    "TeamDelete": {"category": "orchestration", "required_permission": "danger", "risk_profile": _risk(40)},
    # --- LSP ---
    "LSP": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(10)},
    # --- worktree ---
    "EnterWorktree": {"category": "orchestration", "required_permission": "workspace_write", "risk_profile": _risk(35, files=True)},
    "ExitWorktree": {"category": "orchestration", "required_permission": "workspace_write", "risk_profile": _risk(20)},
    # --- todo ---
    "TodoWrite": {"category": "file_io", "required_permission": "workspace_write", "risk_profile": _risk(10, files=True)},
    # --- notebook ---
    "NotebookRead": {"category": "search", "required_permission": "readonly", "risk_profile": _risk(5)},
    # --- general network ---
    "SendMessage": {"category": "interactive", "required_permission": "prompt", "risk_profile": _risk(15, network=True)},
}


def classify_tool(tool_name, tool_input=None):
    """Classify a tool call and determine governance.

    Args:
        tool_name: The tool name string (e.g., "Bash", "mcp__agentcash__search").
        tool_input: The tool input dict (currently unused, reserved for future input-based classification).

    Returns:
        Dict with tool_name, category, required_permission, governed, risk_profile.
    """
    # MCP tools: any tool starting with mcp__
    if tool_name.startswith("mcp__"):
        return {
            "tool_name": tool_name,
            "category": "mcp",
            "required_permission": "workspace_write",
            "governed": _is_governed("mcp"),
            "risk_profile": _risk(35, network=True, files=True),
        }

    # Known tool lookup
    if tool_name in TOOL_CATALOG:
        info = TOOL_CATALOG[tool_name]
        return {
            "tool_name": tool_name,
            "category": info["category"],
            "required_permission": info["required_permission"],
            "governed": _is_governed(info["category"]),
            "risk_profile": info["risk_profile"],
        }

    # Unknown tool — fail-safe toward governance
    return {
        "tool_name": tool_name,
        "category": "unknown",
        "required_permission": "workspace_write",
        "governed": True,
        "risk_profile": _risk(30, files=True),
    }


def _is_governed(category):
    """Check if a tool category is governed based on env config."""
    env = os.environ.get("DASHCLAW_GOVERNED_CATEGORIES", "")
    if env.strip().lower() == "all":
        return True
    if env.strip():
        governed = {c.strip().lower() for c in env.split(",")}
    else:
        governed = DEFAULT_GOVERNED_CATEGORIES
    return category in governed
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_tool_recognizer.py -v`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/tool_recognizer.py hooks/tests/test_tool_recognizer.py
git commit -m "feat(intel): add tool surface recognizer — 40+ tool catalog with permission levels"
```

---

### Task 5: Session State Tracker

**Files:**
- Create: `hooks/dashclaw_agent_intel/session_tracker.py`
- Create: `hooks/tests/test_session_tracker.py`

- [ ] **Step 1: Write failing tests**

```python
# hooks/tests/test_session_tracker.py
import unittest
from dashclaw_agent_intel.session_tracker import SessionTracker


class TestSessionTracker(unittest.TestCase):

    def test_initial_state(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        state = s.get_state()
        self.assertEqual(state["status"], "spawning")
        self.assertEqual(state["agent_id"], "test")
        self.assertTrue(state["session_id"].startswith("sess_"))

    def test_transition_to_ready(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        self.assertEqual(s.get_state()["status"], "ready")

    def test_transition_to_running(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        s.transition("running")
        self.assertEqual(s.get_state()["status"], "running")

    def test_transition_to_blocked_with_reason(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("running")
        s.transition("blocked", reason="MCP down")
        state = s.get_state()
        self.assertEqual(state["status"], "blocked")
        self.assertEqual(state["blocked_reason"], "MCP down")

    def test_transition_to_finished(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("running")
        s.transition("finished")
        self.assertEqual(s.get_state()["status"], "finished")

    def test_transition_to_failed(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("running")
        s.transition("failed", reason="crash")
        self.assertEqual(s.get_state()["status"], "failed")

    def test_event_log(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        s.transition("running")
        events = s.get_state()["events"]
        self.assertEqual(len(events), 3)  # spawning + ready + running
        self.assertEqual(events[0]["kind"], "spawning")
        self.assertEqual(events[1]["kind"], "ready")
        self.assertEqual(events[2]["kind"], "running")

    def test_events_have_sequential_ids(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        events = s.get_state()["events"]
        self.assertEqual(events[0]["seq"], 1)
        self.assertEqual(events[1]["seq"], 2)

    def test_invalid_transition_raises(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("finished")
        with self.assertRaises(ValueError):
            s.transition("running")  # can't go from finished to running


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_session_tracker.py -v`
Expected: FAIL

- [ ] **Step 3: Implement session tracker**

```python
# hooks/dashclaw_agent_intel/session_tracker.py
"""Agent session lifecycle state machine.

Ported from claw-code-parity's worker_boot.rs.
"""

import uuid
from datetime import datetime, timezone

VALID_STATUSES = {"spawning", "ready", "running", "blocked", "finished", "failed"}
TERMINAL_STATUSES = {"finished", "failed"}

# Valid transitions: from_status -> set of allowed to_statuses
_TRANSITIONS = {
    "spawning": {"ready", "running", "blocked", "failed"},
    "ready": {"running", "blocked", "failed"},
    "running": {"blocked", "finished", "failed"},
    "blocked": {"ready", "running", "finished", "failed"},
}


class SessionTracker:
    """Track agent session lifecycle with event logging."""

    def __init__(self, agent_id, workspace):
        self._session_id = f"sess_{uuid.uuid4().hex[:12]}"
        self._agent_id = agent_id
        self._workspace = workspace
        self._status = "spawning"
        self._status_since = _now()
        self._blocked_reason = None
        self._events = []
        self._seq = 0
        self._push_event("spawning")

    def transition(self, new_status, reason=None):
        """Transition to a new status.

        Args:
            new_status: Target status string.
            reason: Optional reason (used for blocked/failed).

        Raises:
            ValueError: If transition is not allowed.
        """
        if new_status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {new_status}")

        allowed = _TRANSITIONS.get(self._status)
        if allowed is None or new_status not in allowed:
            raise ValueError(
                f"Cannot transition from '{self._status}' to '{new_status}'"
            )

        self._status = new_status
        self._status_since = _now()
        self._blocked_reason = reason if new_status in ("blocked", "failed") else None
        self._push_event(new_status, detail=reason)

    def get_state(self):
        """Return current session state as a dict."""
        return {
            "session_id": self._session_id,
            "agent_id": self._agent_id,
            "workspace": self._workspace,
            "status": self._status,
            "status_since": self._status_since,
            "blocked_reason": self._blocked_reason,
            "events": list(self._events),
        }

    def _push_event(self, kind, detail=None):
        self._seq += 1
        event = {"seq": self._seq, "kind": kind, "at": _now()}
        if detail:
            event["detail"] = detail
        self._events.append(event)


def _now():
    return datetime.now(timezone.utc).isoformat()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_session_tracker.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/session_tracker.py hooks/tests/test_session_tracker.py
git commit -m "feat(intel): add session state tracker — lifecycle state machine with event log"
```

---

### Task 6: MCP Health Monitor

**Files:**
- Create: `hooks/dashclaw_agent_intel/mcp_monitor.py`
- Create: `hooks/tests/test_mcp_monitor.py`

- [ ] **Step 1: Write failing tests**

```python
# hooks/tests/test_mcp_monitor.py
import json
import os
import tempfile
import unittest
from dashclaw_agent_intel.mcp_monitor import McpHealthMonitor


class TestMcpHealthMonitor(unittest.TestCase):

    def test_register_and_check(self):
        m = McpHealthMonitor()
        m.register("agentcash", status="connected")
        r = m.check("agentcash")
        self.assertEqual(r["server"], "agentcash")
        self.assertEqual(r["status"], "connected")
        self.assertTrue(r["healthy"])
        self.assertIsNone(r["error"])

    def test_unhealthy_server(self):
        m = McpHealthMonitor()
        m.register("chrome-devtools", status="error", error="connection refused")
        r = m.check("chrome-devtools")
        self.assertFalse(r["healthy"])
        self.assertEqual(r["error"], "connection refused")

    def test_auth_required(self):
        m = McpHealthMonitor()
        m.register("private-api", status="auth_required")
        r = m.check("private-api")
        self.assertFalse(r["healthy"])
        self.assertEqual(r["status"], "auth_required")

    def test_unknown_server(self):
        m = McpHealthMonitor()
        r = m.check("nonexistent")
        self.assertEqual(r["status"], "disconnected")
        self.assertFalse(r["healthy"])

    def test_list_servers(self):
        m = McpHealthMonitor()
        m.register("a", status="connected")
        m.register("b", status="error", error="timeout")
        servers = m.list_servers()
        self.assertEqual(len(servers), 2)

    def test_state_persistence(self):
        state_file = os.path.join(tempfile.mkdtemp(), "mcp_state.json")

        m1 = McpHealthMonitor(state_file=state_file)
        m1.register("agentcash", status="connected")
        m1.save()

        m2 = McpHealthMonitor.from_state_file(state_file)
        r = m2.check("agentcash")
        self.assertEqual(r["status"], "connected")
        self.assertTrue(r["healthy"])

    def test_update_status(self):
        m = McpHealthMonitor()
        m.register("server", status="connecting")
        m.register("server", status="connected")
        r = m.check("server")
        self.assertEqual(r["status"], "connected")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_mcp_monitor.py -v`
Expected: FAIL

- [ ] **Step 3: Implement MCP monitor**

```python
# hooks/dashclaw_agent_intel/mcp_monitor.py
"""MCP server health monitor.

Ported from claw-code-parity's mcp_tool_bridge.rs.
Persists state to a temp file across hook invocations.
"""

import json
import os
import tempfile

VALID_STATUSES = {"disconnected", "connecting", "connected", "auth_required", "error"}
HEALTHY_STATUSES = {"connected"}

_DEFAULT_STATE_FILE = os.path.join(tempfile.gettempdir(), "dashclaw_mcp_state.json")


class McpHealthMonitor:
    """Track MCP server connection state."""

    def __init__(self, state_file=None):
        self._state_file = state_file or _DEFAULT_STATE_FILE
        self._servers = {}

    def register(self, server_name, status="disconnected", error=None):
        """Register or update an MCP server's status."""
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid MCP status: {status}")
        self._servers[server_name] = {
            "server": server_name,
            "status": status,
            "error": error if status == "error" else None,
            "healthy": status in HEALTHY_STATUSES,
        }

    def check(self, server_name):
        """Check an MCP server's health status."""
        if server_name in self._servers:
            return dict(self._servers[server_name])
        return {
            "server": server_name,
            "status": "disconnected",
            "error": None,
            "healthy": False,
        }

    def list_servers(self):
        """List all tracked servers."""
        return [dict(v) for v in self._servers.values()]

    def save(self):
        """Persist state to file."""
        try:
            with open(self._state_file, "w") as f:
                json.dump(self._servers, f)
        except OSError:
            pass  # fire-and-forget

    @classmethod
    def from_state_file(cls, state_file=None):
        """Load monitor from persisted state file."""
        path = state_file or _DEFAULT_STATE_FILE
        monitor = cls(state_file=path)
        try:
            with open(path, "r") as f:
                data = json.load(f)
            for name, info in data.items():
                monitor._servers[name] = info
        except (OSError, json.JSONDecodeError, KeyError):
            pass
        return monitor
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_mcp_monitor.py -v`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/mcp_monitor.py hooks/tests/test_mcp_monitor.py
git commit -m "feat(intel): add MCP health monitor — server state tracking with persistence"
```

---

### Task 7: Wire Module Public API

**Files:**
- Modify: `hooks/dashclaw_agent_intel/__init__.py`

- [ ] **Step 1: Update __init__.py with public re-exports**

```python
# hooks/dashclaw_agent_intel/__init__.py
"""DashClaw Agent Intelligence — local classification for agent governance.

Provides fast, deterministic classification of agent tool calls:
- classify_bash: Bash command intent classification with 6 validation submodules
- scan_file_operation: File security scanning (traversal, binary, symlink, workspace)
- classify_tool: 40+ tool catalog with permission levels and governance flags
- SessionTracker: Agent session lifecycle state machine
- McpHealthMonitor: MCP server health tracking with persistence
"""

from .bash_classifier import classify_bash
from .file_scanner import scan_file_operation
from .tool_recognizer import classify_tool, TOOL_CATALOG, PERMISSION_LEVELS
from .session_tracker import SessionTracker
from .mcp_monitor import McpHealthMonitor

__all__ = [
    "classify_bash",
    "scan_file_operation",
    "classify_tool",
    "TOOL_CATALOG",
    "PERMISSION_LEVELS",
    "SessionTracker",
    "McpHealthMonitor",
]

__version__ = "1.0.0"
```

- [ ] **Step 2: Verify all imports work**

Run: `cd C:\Projects\DashClaw\hooks && python -c "from dashclaw_agent_intel import classify_bash, scan_file_operation, classify_tool, SessionTracker, McpHealthMonitor; print('All imports OK')"`
Expected: `All imports OK`

- [ ] **Step 3: Run full test suite**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/ -v`
Expected: All tests across all 6 test files PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_agent_intel/__init__.py
git commit -m "feat(intel): wire public API — all 5 submodules exported"
```

---

## Phase B: Hook Updates

### Task 8: Pretool Hook v2

**Files:**
- Modify: `hooks/dashclaw_pretool.py`
- Create: `hooks/tests/test_pretool_integration.py`

- [ ] **Step 1: Write failing integration test**

```python
# hooks/tests/test_pretool_integration.py
"""Integration tests for pretool hook v2 using mock DashClaw server."""

import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler

_LAST_GUARD_REQUEST = None
_GUARD_CALL_COUNT = 0


class MockGuardHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        global _LAST_GUARD_REQUEST, _GUARD_CALL_COUNT
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        if self.path == "/api/guard":
            _LAST_GUARD_REQUEST = body
            _GUARD_CALL_COUNT += 1
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "decision": "allow",
                "reason": "test allow",
                "risk_score": body.get("risk_score", 0),
                "signals": [],
                "matched_policies": [],
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress logs


def _run_pretool(tool_name, tool_input, port):
    """Run pretool hook as subprocess with given input."""
    hook_path = os.path.join(os.path.dirname(__file__), "..", "dashclaw_pretool.py")
    env = dict(os.environ)
    env["DASHCLAW_BASE_URL"] = f"http://localhost:{port}"
    env["DASHCLAW_API_KEY"] = "test-key"
    env["DASHCLAW_AGENT_ID"] = "test-agent"
    env["DASHCLAW_HOOK_MODE"] = "enforce"
    env["DASHCLAW_WORKSPACE"] = "/tmp/test-project"
    env["DASHCLAW_PERMISSION_MODE"] = "workspace_write"

    stdin_data = json.dumps({
        "tool_name": tool_name,
        "tool_input": tool_input,
        "tool_use_id": "test-001",
    })

    result = subprocess.run(
        [sys.executable, hook_path],
        input=stdin_data,
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    return result


class TestPretoolV2(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        global _GUARD_CALL_COUNT, _LAST_GUARD_REQUEST
        _GUARD_CALL_COUNT = 0
        _LAST_GUARD_REQUEST = None
        cls.server = HTTPServer(("127.0.0.1", 0), MockGuardHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        global _GUARD_CALL_COUNT, _LAST_GUARD_REQUEST
        _GUARD_CALL_COUNT = 0
        _LAST_GUARD_REQUEST = None

    def test_bash_sends_enriched_intel(self):
        result = _run_pretool("Bash", {"command": "git push origin main"}, self.port)
        self.assertEqual(result.returncode, 0)
        self.assertIsNotNone(_LAST_GUARD_REQUEST)
        self.assertIn("intel", _LAST_GUARD_REQUEST)
        intel = _LAST_GUARD_REQUEST["intel"]
        self.assertIn("bash", intel)
        self.assertEqual(intel["bash"]["intent"], "write")
        self.assertIn("tool", intel)
        self.assertEqual(intel["tool"]["category"], "execution")

    def test_read_tool_ungoverned(self):
        result = _run_pretool("Read", {"file_path": "/tmp/test.txt"}, self.port)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(_GUARD_CALL_COUNT, 0)  # should not call guard

    def test_write_sends_file_intel(self):
        result = _run_pretool("Write", {"file_path": "../../etc/passwd", "content": "bad"}, self.port)
        self.assertEqual(result.returncode, 0)
        self.assertIsNotNone(_LAST_GUARD_REQUEST)
        intel = _LAST_GUARD_REQUEST["intel"]
        self.assertIn("file", intel)
        self.assertTrue(intel["file"]["traversal_detected"])

    def test_mcp_tool_governed(self):
        result = _run_pretool("mcp__agentcash__search", {"query": "test"}, self.port)
        self.assertEqual(result.returncode, 0)
        self.assertIsNotNone(_LAST_GUARD_REQUEST)
        self.assertEqual(_LAST_GUARD_REQUEST["intel"]["tool"]["category"], "mcp")

    def test_unknown_tool_governed(self):
        result = _run_pretool("FutureTool2027", {"data": "test"}, self.port)
        self.assertEqual(result.returncode, 0)
        self.assertIsNotNone(_LAST_GUARD_REQUEST)
        self.assertEqual(_LAST_GUARD_REQUEST["intel"]["tool"]["category"], "unknown")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_pretool_integration.py -v`
Expected: FAIL (pretool v2 not yet implemented)

- [ ] **Step 3: Rewrite pretool hook using intel module**

Replace the contents of `hooks/dashclaw_pretool.py` with the v2 implementation. The full file is ~200 lines (down from 354) because classification logic is now in the intel module.

Key structure:
```python
#!/usr/bin/env python3
"""DashClaw PreToolUse Hook v2 — Layered Intelligence.

Uses dashclaw_agent_intel for semantic classification.
Governs 40+ tools (configurable via DASHCLAW_GOVERNED_CATEGORIES).
Sends enriched intel context to guard API.
"""

import json
import os
import sys
import tempfile
import time
import urllib.request
import urllib.error

# Import intel module (vendored alongside this hook)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel import classify_bash, scan_file_operation, classify_tool, McpHealthMonitor

# --- Config ---
DASHCLAW_BASE_URL = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
DASHCLAW_API_KEY = os.environ.get("DASHCLAW_API_KEY", "")
DASHCLAW_AGENT_ID = os.environ.get("DASHCLAW_AGENT_ID", "claude-code")
DASHCLAW_HOOK_MODE = os.environ.get("DASHCLAW_HOOK_MODE", "enforce")
DASHCLAW_WORKSPACE = os.environ.get("DASHCLAW_WORKSPACE", os.getcwd())
DASHCLAW_PERMISSION_MODE = os.environ.get("DASHCLAW_PERMISSION_MODE", "danger")
GUARD_TIMEOUT = float(os.environ.get("DASHCLAW_GUARD_TIMEOUT", "2.5"))
APPROVAL_POLL_TIMEOUT = int(os.environ.get("DASHCLAW_APPROVAL_TIMEOUT", "30"))

# --- Intent to action_type mapping ---
_INTENT_TO_ACTION = {
    "readonly": "review",
    "write": "apply",
    "destructive": "security",
    "network": "api",
    "process_management": "security",
    "package_management": "build",
    "system_admin": "deploy",
    "unknown": "other",
}

_FILE_IO_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    tool_use_id = data.get("tool_use_id", "")

    # Step 1: Classify tool
    tool_info = classify_tool(tool_name, tool_input)

    # Step 2: Skip ungoverned tools
    if not tool_info["governed"]:
        sys.exit(0)

    # Step 3: Build enriched intel
    intel = {"tool": tool_info}

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        intel["bash"] = classify_bash(command, mode=DASHCLAW_PERMISSION_MODE, workspace=DASHCLAW_WORKSPACE)

    if tool_name in _FILE_IO_TOOLS:
        path = tool_input.get("file_path", tool_input.get("path", ""))
        content = tool_input.get("content", tool_input.get("new_string", ""))
        intel["file"] = scan_file_operation(path, content, DASHCLAW_WORKSPACE)

    if tool_name.startswith("mcp__"):
        server_name = tool_name.split("__")[1] if "__" in tool_name else "unknown"
        mcp = McpHealthMonitor.from_state_file()
        intel["mcp"] = mcp.check(server_name)

    # Step 4: Build guard context
    action_type = _derive_action_type(intel)
    context = {
        "agent_id": DASHCLAW_AGENT_ID,
        "action_type": action_type,
        "declared_goal": _derive_goal(tool_name, tool_input),
        "risk_score": tool_info["risk_profile"]["base_risk"],
        "reversible": intel.get("bash", {}).get("reversible", True),
        "systems_touched": _derive_systems(tool_name, tool_input),
        "intel": intel,
    }

    # Boost risk from bash/file intel
    if "bash" in intel:
        context["risk_score"] = max(context["risk_score"], intel["bash"]["risk_score"])
        context["reversible"] = intel["bash"]["reversible"]
    if "file" in intel:
        if intel["file"].get("traversal_detected") or intel["file"].get("outside_workspace"):
            context["risk_score"] = min(context["risk_score"] + 20, 100)
        if intel["file"].get("sensitive_path"):
            context["risk_score"] = min(context["risk_score"] + 15, 100)

    # Step 5: Call guard
    decision = _guard_check(context)
    if decision is None:
        sys.exit(0)  # graceful degradation

    # Step 6: Handle decision
    _handle_decision(decision, context, tool_use_id)


def _derive_action_type(intel):
    if "bash" in intel:
        return _INTENT_TO_ACTION.get(intel["bash"]["intent"], "other")
    tool_cat = intel.get("tool", {}).get("category", "unknown")
    if tool_cat == "file_io":
        return "apply"
    if tool_cat == "orchestration":
        return "deploy"
    if tool_cat == "mcp":
        return "api"
    return "other"


def _derive_goal(tool_name, tool_input):
    if tool_name == "Bash":
        return tool_input.get("command", "")[:200]
    if tool_name in _FILE_IO_TOOLS:
        return f"{tool_name}: {tool_input.get('file_path', tool_input.get('path', ''))}".strip()[:200]
    if tool_name == "Agent":
        return f"Agent: {tool_input.get('prompt', '')[:150]}"
    return f"{tool_name}: {json.dumps(tool_input)[:150]}"


def _derive_systems(tool_name, tool_input):
    systems = []
    if tool_name == "Bash":
        systems.append("shell")
    if tool_name in _FILE_IO_TOOLS:
        systems.append("filesystem")
    if tool_name.startswith("mcp__"):
        parts = tool_name.split("__")
        if len(parts) >= 2:
            systems.append(f"mcp:{parts[1]}")
    if tool_name in ("Agent", "Skill", "RemoteTrigger"):
        systems.append("orchestration")
    return systems or ["unknown"]


def _guard_check(context):
    try:
        body = json.dumps(context).encode()
        req = urllib.request.Request(
            f"{DASHCLAW_BASE_URL}/api/guard",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": DASHCLAW_API_KEY,
            },
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=GUARD_TIMEOUT)
        return json.loads(resp.read())
    except Exception:
        return None  # graceful degradation


def _handle_decision(decision, context, tool_use_id):
    d = decision.get("decision", "allow")

    if d == "allow":
        _save_action_id(tool_use_id, decision.get("action_id"))
        sys.exit(0)

    if d == "warn":
        print(f"[DashClaw] Warning: {decision.get('reason', 'review recommended')}", file=sys.stderr)
        _save_action_id(tool_use_id, decision.get("action_id"))
        sys.exit(0)

    if d == "block":
        print(f"[DashClaw] Blocked: {decision.get('reason', 'policy violation')}", file=sys.stderr)
        sys.exit(2)

    if d == "require_approval":
        action_id = _create_pending_action(context)
        if action_id and _poll_approval(action_id):
            _save_action_id(tool_use_id, action_id)
            sys.exit(0)
        else:
            print("[DashClaw] Blocked: approval denied or timed out", file=sys.stderr)
            sys.exit(2)

    sys.exit(0)


def _create_pending_action(context):
    try:
        body = json.dumps({**context, "status": "pending_approval"}).encode()
        req = urllib.request.Request(
            f"{DASHCLAW_BASE_URL}/api/actions",
            data=body,
            headers={"Content-Type": "application/json", "x-api-key": DASHCLAW_API_KEY},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=GUARD_TIMEOUT)
        data = json.loads(resp.read())
        return data.get("action_id")
    except Exception:
        return None


def _poll_approval(action_id):
    deadline = time.time() + APPROVAL_POLL_TIMEOUT
    while time.time() < deadline:
        try:
            req = urllib.request.Request(
                f"{DASHCLAW_BASE_URL}/api/actions/{action_id}",
                headers={"x-api-key": DASHCLAW_API_KEY},
            )
            resp = urllib.request.urlopen(req, timeout=2)
            data = json.loads(resp.read())
            status = data.get("status", "")
            if status == "approved":
                return True
            if status in ("denied", "rejected"):
                return False
        except Exception:
            pass
        time.sleep(1)
    return False


def _save_action_id(tool_use_id, action_id):
    if not action_id or not tool_use_id:
        return
    try:
        path = os.path.join(tempfile.gettempdir(), f"dashclaw_{tool_use_id}.json")
        with open(path, "w") as f:
            json.dump({"action_id": action_id}, f)
    except OSError:
        pass


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run integration tests**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_pretool_integration.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_pretool.py hooks/tests/test_pretool_integration.py
git commit -m "feat(hooks): pretool v2 — intel module classification, 40+ tool governance, enriched context"
```

---

### Task 9: Posttool Hook v2

**Files:**
- Modify: `hooks/dashclaw_posttool.py`
- Create: `hooks/tests/test_posttool_integration.py`

- [ ] **Step 1: Write failing test**

```python
# hooks/tests/test_posttool_integration.py
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler

_LAST_PATCH_BODY = None


class MockActionHandler(BaseHTTPRequestHandler):
    def do_PATCH(self):
        global _LAST_PATCH_BODY
        length = int(self.headers.get("Content-Length", 0))
        _LAST_PATCH_BODY = json.loads(self.rfile.read(length)) if length else {}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):
        pass


class TestPosttoolV2(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), MockActionHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_completed_action_reports_status(self):
        global _LAST_PATCH_BODY
        _LAST_PATCH_BODY = None

        # Write a temp action_id file
        tool_use_id = "test-post-001"
        tmp_path = os.path.join(tempfile.gettempdir(), f"dashclaw_{tool_use_id}.json")
        with open(tmp_path, "w") as f:
            json.dump({"action_id": "act_test123"}, f)

        hook_path = os.path.join(os.path.dirname(__file__), "..", "dashclaw_posttool.py")
        env = dict(os.environ)
        env["DASHCLAW_BASE_URL"] = f"http://localhost:{self.port}"
        env["DASHCLAW_API_KEY"] = "test-key"

        stdin_data = json.dumps({
            "tool_use_id": tool_use_id,
            "tool_response": {"output": "success output here"},
        })

        result = subprocess.run(
            [sys.executable, hook_path],
            input=stdin_data, capture_output=True, text=True, env=env, timeout=10,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIsNotNone(_LAST_PATCH_BODY)
        self.assertEqual(_LAST_PATCH_BODY["status"], "completed")
        self.assertIn("output_summary", _LAST_PATCH_BODY)
        self.assertLessEqual(len(_LAST_PATCH_BODY["output_summary"]), 500)

    def test_failed_action_detected(self):
        global _LAST_PATCH_BODY
        _LAST_PATCH_BODY = None

        tool_use_id = "test-post-002"
        tmp_path = os.path.join(tempfile.gettempdir(), f"dashclaw_{tool_use_id}.json")
        with open(tmp_path, "w") as f:
            json.dump({"action_id": "act_fail123"}, f)

        hook_path = os.path.join(os.path.dirname(__file__), "..", "dashclaw_posttool.py")
        env = dict(os.environ)
        env["DASHCLAW_BASE_URL"] = f"http://localhost:{self.port}"
        env["DASHCLAW_API_KEY"] = "test-key"

        stdin_data = json.dumps({
            "tool_use_id": tool_use_id,
            "tool_response": {"error": "command not found"},
        })

        result = subprocess.run(
            [sys.executable, hook_path],
            input=stdin_data, capture_output=True, text=True, env=env, timeout=10,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIsNotNone(_LAST_PATCH_BODY)
        self.assertEqual(_LAST_PATCH_BODY["status"], "failed")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rewrite posttool hook with richer outcome reporting**

Replace `hooks/dashclaw_posttool.py` with v2:

```python
#!/usr/bin/env python3
"""DashClaw PostToolUse Hook v2 — Structured Outcome Reporting.

Reports tool execution outcomes back to DashClaw with enriched metadata.
Never blocks — always exits 0.
"""

import json
import os
import sys
import tempfile
import urllib.request
import urllib.error
from datetime import datetime, timezone

DASHCLAW_BASE_URL = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
DASHCLAW_API_KEY = os.environ.get("DASHCLAW_API_KEY", "")
SUMMARY_MAX_CHARS = 500


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_use_id = data.get("tool_use_id", "")
    tool_response = data.get("tool_response", {})

    action_id = _read_action_id(tool_use_id)
    if not action_id:
        sys.exit(0)

    outcome = _extract_outcome(tool_response)

    _patch_action(action_id, {
        "status": outcome["status"],
        "output_summary": outcome["summary"],
        "timestamp_end": datetime.now(timezone.utc).isoformat(),
        "outcome_metadata": outcome.get("metadata", {}),
    })

    _cleanup_temp(tool_use_id)
    sys.exit(0)


def _extract_outcome(response):
    """Extract structured outcome from tool response."""
    error_val = response.get("error")
    output_val = str(response.get("output", response.get("result", "")))
    exit_code = response.get("exit_code", response.get("returncode"))

    metadata = {}
    if exit_code is not None:
        metadata["exit_code"] = exit_code

    # Determine status
    if error_val:
        return {
            "status": "failed",
            "summary": str(error_val)[:SUMMARY_MAX_CHARS],
            "metadata": {**metadata, "error_type": _classify_error(str(error_val))},
        }

    if exit_code is not None and exit_code != 0:
        return {
            "status": "failed",
            "summary": output_val[:SUMMARY_MAX_CHARS],
            "metadata": {**metadata, "error_type": "exit_code"},
        }

    return {
        "status": "completed",
        "summary": output_val[:SUMMARY_MAX_CHARS],
        "metadata": metadata,
    }


def _classify_error(error_str):
    """Classify error type from error string."""
    lower = error_str.lower()
    if "timeout" in lower or "timed out" in lower:
        return "timeout"
    if "permission" in lower or "denied" in lower or "forbidden" in lower:
        return "permission"
    if "not found" in lower or "no such file" in lower:
        return "not_found"
    return "runtime"


def _read_action_id(tool_use_id):
    if not tool_use_id:
        return None
    try:
        path = os.path.join(tempfile.gettempdir(), f"dashclaw_{tool_use_id}.json")
        with open(path, "r") as f:
            return json.load(f).get("action_id")
    except (OSError, json.JSONDecodeError, KeyError):
        return None


def _patch_action(action_id, body):
    try:
        req = urllib.request.Request(
            f"{DASHCLAW_BASE_URL}/api/actions/{action_id}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-api-key": DASHCLAW_API_KEY},
            method="PATCH",
        )
        urllib.request.urlopen(req, timeout=2.5)
    except Exception:
        pass  # fire-and-forget


def _cleanup_temp(tool_use_id):
    try:
        path = os.path.join(tempfile.gettempdir(), f"dashclaw_{tool_use_id}.json")
        os.remove(path)
    except OSError:
        pass


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run tests**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/test_posttool_integration.py -v`
Expected: All 2 tests PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/dashclaw_posttool.py hooks/tests/test_posttool_integration.py
git commit -m "feat(hooks): posttool v2 — structured outcome metadata, error classification, 500-char summaries"
```

---

## Phase C: Server Extensions

### Task 10: Database Schema — Sessions Table + Permission Level

**Files:**
- Modify: `schema/schema.js`

- [ ] **Step 1: Add sessions table and permission_level column to schema**

Add to `schema/schema.js` after the existing table definitions:

```javascript
// --- Agent Sessions ---
export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  agent_id: text('agent_id').notNull(),
  workspace: text('workspace'),
  branch: text('branch'),
  status: text('status').notNull().default('spawning'),
  status_since: timestamp('status_since', { withTimezone: true }).defaultNow(),
  blocked_reason: text('blocked_reason'),
  green_level: text('green_level'),
  branch_freshness: text('branch_freshness'),
  commits_behind: integer('commits_behind'),
  last_activity: timestamp('last_activity', { withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const sessionEvents = pgTable('session_events', {
  id: serial('id').primaryKey(),
  session_id: text('session_id').notNull(),
  org_id: text('org_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),
  detail: text('detail'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

Also add `permission_level` to the existing `agentPairings` table:

```javascript
// In the agentPairings table definition, add:
permission_level: text('permission_level').default('danger'),
```

- [ ] **Step 2: Generate and run migration**

Run: `cd C:\Projects\DashClaw && npx drizzle-kit generate`
Then: `cd C:\Projects\DashClaw && npx drizzle-kit push` (or applicable migration command)

- [ ] **Step 3: Commit**

```bash
cd C:\Projects\DashClaw
git add schema/schema.js drizzle/
git commit -m "feat(schema): add agent_sessions table and permission_level on pairings"
```

---

### Task 11: Guard — Permission Escalation + New Policy Types

**Files:**
- Modify: `app/lib/guard.js`
- Create: `__tests__/unit/guard-intel.test.js`

- [ ] **Step 1: Write failing tests for new policy types**

```javascript
// __tests__/unit/guard-intel.test.js
import { describe, it, expect } from 'vitest';
import { evaluateGuard, computeRiskScore } from '../../app/lib/guard.js';

// Mock SQL that returns policies
function mockSql(policies = []) {
  const fn = async (strings, ...values) => {
    // Match policy queries
    const query = strings.join('?');
    if (query.includes('guard_policies')) {
      return policies;
    }
    if (query.includes('agent_pairings')) {
      return [{ permission_level: 'workspace_write' }];
    }
    if (query.includes('guard_decisions')) {
      return [];
    }
    return [];
  };
  fn.begin = async (callback) => callback(fn);
  return fn;
}

describe('Permission Escalation', () => {
  it('escalates when tool requires danger but agent has workspace_write', async () => {
    const policies = [{
      id: 'gp_test1',
      type: 'permission_escalation',
      rules: JSON.stringify({ enforce: true }),
      decision: 'require_approval',
      status: 'active',
      agent_ids: null,
    }];

    const result = await evaluateGuard('org_test', {
      agent_id: 'test-agent',
      action_type: 'execute',
      declared_goal: 'bash command',
      intel: {
        tool: { tool_name: 'Bash', category: 'execution', required_permission: 'danger' },
      },
    }, mockSql(policies));

    expect(result.decision).toBe('require_approval');
    expect(result.reason).toContain('permission');
  });

  it('allows when agent permission meets requirement', async () => {
    const policies = [{
      id: 'gp_test2',
      type: 'permission_escalation',
      rules: JSON.stringify({ enforce: true }),
      decision: 'require_approval',
      status: 'active',
      agent_ids: null,
    }];

    const sql = async (strings, ...values) => {
      const query = strings.join('?');
      if (query.includes('guard_policies')) return policies;
      if (query.includes('agent_pairings')) return [{ permission_level: 'danger' }];
      return [];
    };
    sql.begin = async (cb) => cb(sql);

    const result = await evaluateGuard('org_test', {
      agent_id: 'test-agent',
      action_type: 'execute',
      intel: {
        tool: { required_permission: 'danger' },
      },
    }, sql);

    expect(result.decision).not.toBe('require_approval');
  });
});

describe('Green Contract', () => {
  it('blocks deploy without sufficient green level', async () => {
    const policies = [{
      id: 'gp_green1',
      type: 'green_contract',
      rules: JSON.stringify({ action_types: ['deploy'], required_level: 'workspace' }),
      decision: 'block',
      status: 'active',
      agent_ids: null,
    }];

    const result = await evaluateGuard('org_test', {
      agent_id: 'test-agent',
      action_type: 'deploy',
      intel: {
        green: { observed_level: 'targeted' },
      },
    }, mockSql(policies));

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Green contract');
  });

  it('allows deploy with sufficient green level', async () => {
    const policies = [{
      id: 'gp_green2',
      type: 'green_contract',
      rules: JSON.stringify({ action_types: ['deploy'], required_level: 'package' }),
      decision: 'block',
      status: 'active',
      agent_ids: null,
    }];

    const result = await evaluateGuard('org_test', {
      agent_id: 'test-agent',
      action_type: 'deploy',
      intel: {
        green: { observed_level: 'workspace' },
      },
    }, mockSql(policies));

    expect(result.decision).not.toBe('block');
  });
});

describe('Branch Freshness', () => {
  it('blocks deploy from stale branch', async () => {
    const policies = [{
      id: 'gp_branch1',
      type: 'branch_freshness',
      rules: JSON.stringify({
        action_types: ['deploy'],
        max_commits_behind: 0,
        freshness: ['stale', 'diverged'],
      }),
      decision: 'block',
      status: 'active',
      agent_ids: null,
    }];

    const result = await evaluateGuard('org_test', {
      agent_id: 'test-agent',
      action_type: 'deploy',
      intel: {
        branch: { freshness: 'stale', commits_behind: 3 },
      },
    }, mockSql(policies));

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('branch');
  });
});

describe('Backward Compatibility', () => {
  it('works without intel field', async () => {
    const result = await evaluateGuard('org_test', {
      agent_id: 'test-agent',
      action_type: 'test',
      declared_goal: 'run tests',
      risk_score: 15,
    }, mockSql([]));

    expect(result.decision).toBe('allow');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/unit/guard-intel.test.js`
Expected: FAIL — new policy types not handled

- [ ] **Step 3: Add permission escalation + green contract + branch freshness to guard.js**

In `app/lib/guard.js`, add to the policy evaluation switch statement (around line 274) after the existing cases:

```javascript
// Add these constants near the top of guard.js
const PERMISSION_RANK = { readonly: 0, workspace_write: 1, danger: 2, prompt: 3, allow: 4 };
const GREEN_RANK = { targeted: 0, package: 1, workspace: 2, merge_ready: 3 };

// Inside evaluatePolicy function, add cases:

case 'permission_escalation': {
  if (!rules.enforce) break;
  const toolPerm = context.intel?.tool?.required_permission;
  if (!toolPerm) break;
  // Look up agent permission level
  const [pairing] = await sql`
    SELECT permission_level FROM agent_pairings
    WHERE org_id = ${orgId} AND agent_id = ${context.agent_id} AND status = 'approved'
    ORDER BY created_at DESC LIMIT 1
  `;
  const agentLevel = pairing?.permission_level || 'danger';
  if ((PERMISSION_RANK[toolPerm] ?? 0) > (PERMISSION_RANK[agentLevel] ?? 0)) {
    matched = true;
    reasons.push(`Permission escalation: agent has ${agentLevel}, tool requires ${toolPerm}`);
  }
  break;
}

case 'green_contract': {
  const actionTypes = rules.action_types || [];
  if (!actionTypes.includes(context.action_type)) break;
  const observedLevel = context.intel?.green?.observed_level;
  const requiredLevel = rules.required_level;
  if (!observedLevel) {
    matched = true;
    reasons.push(`Green contract: no test status reported, ${requiredLevel} required`);
  } else if ((GREEN_RANK[observedLevel] ?? -1) < (GREEN_RANK[requiredLevel] ?? 0)) {
    matched = true;
    reasons.push(`Green contract: observed ${observedLevel}, required ${requiredLevel}`);
  }
  break;
}

case 'branch_freshness': {
  const actionTypes = rules.action_types || [];
  if (!actionTypes.includes(context.action_type)) break;
  const branch = context.intel?.branch;
  if (!branch) break;
  const triggerFreshness = rules.freshness || ['stale', 'diverged'];
  if (triggerFreshness.includes(branch.freshness)) {
    const maxBehind = rules.max_commits_behind ?? 0;
    if ((branch.commits_behind ?? 0) > maxBehind) {
      matched = true;
      reasons.push(`Branch ${branch.name || 'unknown'} is ${branch.freshness} (${branch.commits_behind} commits behind)`);
    }
  }
  break;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/unit/guard-intel.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add app/lib/guard.js __tests__/unit/guard-intel.test.js
git commit -m "feat(guard): add permission escalation, green contract, branch freshness policy types"
```

---

### Task 12: New Signal Types

**Files:**
- Modify: `app/lib/signals.js`
- Create: `__tests__/unit/signals-intel.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// __tests__/unit/signals-intel.test.js
import { describe, it, expect } from 'vitest';
import { computeSignals } from '../../app/lib/signals.js';

function mockSql(overrides = {}) {
  const fn = async (strings, ...values) => {
    const query = strings.join('?');
    // Return overrides for matching patterns, else empty
    for (const [pattern, result] of Object.entries(overrides)) {
      if (query.includes(pattern)) return result;
    }
    return [];
  };
  fn.begin = async (cb) => cb(fn);
  return fn;
}

describe('session_stalled signal', () => {
  it('fires when session is running for over 2 hours with no activity', async () => {
    const twoHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const sql = mockSql({
      'agent_sessions': [{
        id: 'sess_test',
        agent_id: 'test-agent',
        status: 'running',
        last_activity: twoHoursAgo,
        status_since: twoHoursAgo,
      }],
    });

    const signals = await computeSignals('org_test', null, sql);
    const stalled = signals.find(s => s.type === 'session_stalled');
    expect(stalled).toBeDefined();
    expect(stalled.severity).toBe('amber');
  });
});

describe('branch_stale signal', () => {
  it('fires from guard decision intel', async () => {
    const sql = mockSql({
      'guard_decisions': [{
        id: 'gd_test',
        agent_id: 'test-agent',
        context: JSON.stringify({
          intel: { branch: { freshness: 'stale', commits_behind: 7 } }
        }),
        created_at: new Date().toISOString(),
      }],
    });

    const signals = await computeSignals('org_test', null, sql);
    const stale = signals.find(s => s.type === 'branch_stale');
    expect(stale).toBeDefined();
    expect(stale.severity).toBe('red'); // 7 > 5
  });
});
```

- [ ] **Step 2: Add 4 new signal types to signals.js**

At the end of the `computeSignals` function in `app/lib/signals.js`, add:

```javascript
// --- Session Stalled ---
try {
  const stalledSessions = await sql`
    SELECT id, agent_id, status, last_activity, status_since
    FROM agent_sessions
    WHERE org_id = ${orgId}
      AND status = 'running'
      AND last_activity < NOW() - INTERVAL '2 hours'
      ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
  `;
  for (const sess of stalledSessions) {
    const hoursStalled = Math.round((Date.now() - new Date(sess.last_activity).getTime()) / 3600000);
    signals.push({
      type: 'session_stalled',
      severity: hoursStalled >= 4 ? 'red' : 'amber',
      label: `Session stalled (${hoursStalled}h): ${sess.agent_id}`,
      detail: `Session ${sess.id} has been running with no tool activity for ${hoursStalled} hours`,
      help: 'Consider restarting the agent session or checking for blockers',
      agent_id: sess.agent_id,
      session_id: sess.id,
    });
  }
} catch (e) { /* signal collection is best-effort */ }

// --- Branch Stale (from recent guard decisions) ---
try {
  const recentDecisions = await sql`
    SELECT id, agent_id, context, created_at
    FROM guard_decisions
    WHERE org_id = ${orgId}
      AND created_at > NOW() - INTERVAL '1 hour'
      ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
    ORDER BY created_at DESC LIMIT 20
  `;
  const seenAgents = new Set();
  for (const dec of recentDecisions) {
    try {
      const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
      const branch = ctx?.intel?.branch;
      if (branch?.freshness === 'stale' && !seenAgents.has(dec.agent_id)) {
        seenAgents.add(dec.agent_id);
        const behind = branch.commits_behind || 0;
        signals.push({
          type: 'branch_stale',
          severity: behind >= 5 ? 'red' : 'amber',
          label: `Stale branch: ${branch.name || 'unknown'} (${behind} behind)`,
          detail: `Agent ${dec.agent_id} is working on a branch ${behind} commits behind main`,
          help: 'Rebase or merge-forward before running tests',
          agent_id: dec.agent_id,
        });
      }
    } catch (e) { /* skip unparseable */ }
  }
} catch (e) { /* best-effort */ }

// --- MCP Degraded (from recent guard decisions) ---
try {
  const seenServers = new Set();
  const recentDecisions = await sql`
    SELECT id, agent_id, context FROM guard_decisions
    WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 minutes'
    ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
    ORDER BY created_at DESC LIMIT 20
  `;
  for (const dec of recentDecisions) {
    try {
      const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
      const mcp = ctx?.intel?.mcp;
      if (mcp && !mcp.healthy && !seenServers.has(mcp.server)) {
        seenServers.add(mcp.server);
        signals.push({
          type: 'mcp_degraded',
          severity: mcp.status === 'auth_required' ? 'red' : 'amber',
          label: `MCP degraded: ${mcp.server} (${mcp.status})`,
          detail: mcp.error || `MCP server ${mcp.server} is ${mcp.status}`,
          help: 'Check MCP server configuration and connectivity',
          agent_id: dec.agent_id,
        });
      }
    } catch (e) { /* skip */ }
  }
} catch (e) { /* best-effort */ }

// --- Green Insufficient (from recent guard decisions) ---
try {
  const recentDecisions = await sql`
    SELECT id, agent_id, context FROM guard_decisions
    WHERE org_id = ${orgId}
      AND created_at > NOW() - INTERVAL '1 hour'
      AND decision IN ('block', 'warn')
    ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
    ORDER BY created_at DESC LIMIT 10
  `;
  const seenAgents = new Set();
  for (const dec of recentDecisions) {
    try {
      const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
      const reason = dec.reason || '';
      if (reason.includes('Green contract') && !seenAgents.has(dec.agent_id)) {
        seenAgents.add(dec.agent_id);
        const green = ctx?.intel?.green;
        signals.push({
          type: 'green_insufficient',
          severity: 'red',
          label: `Green insufficient: ${dec.agent_id} (${green?.observed_level || 'none'})`,
          detail: `Agent attempted deploy/merge without sufficient test verification`,
          help: 'Run tests at the required green level before proceeding',
          agent_id: dec.agent_id,
        });
      }
    } catch (e) { /* skip */ }
  }
} catch (e) { /* best-effort */ }
```

- [ ] **Step 3: Run tests**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/unit/signals-intel.test.js`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Projects\DashClaw
git add app/lib/signals.js __tests__/unit/signals-intel.test.js
git commit -m "feat(signals): add session_stalled, branch_stale, mcp_degraded, green_insufficient"
```

---

### Task 13: Recovery Recipe Engine

**Files:**
- Create: `app/lib/recovery.js`
- Create: `__tests__/unit/recovery.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// __tests__/unit/recovery.test.js
import { describe, it, expect } from 'vitest';
import { evaluateRecoveryRecipes, RECOVERY_RECIPES } from '../../app/lib/recovery.js';

describe('Recovery Recipes', () => {
  it('has 6 recipes', () => {
    expect(RECOVERY_RECIPES).toHaveLength(6);
  });

  it('returns suggestion for branch_stale signal', () => {
    const signals = [{ type: 'branch_stale', severity: 'amber', agent_id: 'test', detail: '3 commits behind' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].signal).toBe('branch_stale');
    expect(recipes[0].suggestion).toContain('Rebase');
  });

  it('returns auto_action for repeated_failures', () => {
    const signals = [{ type: 'repeated_failures', severity: 'red', agent_id: 'test' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].auto_action).toBe('reduce_autonomy');
  });

  it('returns empty for unknown signal type', () => {
    const signals = [{ type: 'unknown_signal', severity: 'amber' }];
    const recipes = evaluateRecoveryRecipes(signals);
    expect(recipes).toHaveLength(0);
  });

  it('respects max_attempts', () => {
    const signals = [{ type: 'branch_stale', severity: 'amber', agent_id: 'test' }];
    const attemptLog = { branch_stale: { 'test': 1 } };
    const recipes = evaluateRecoveryRecipes(signals, attemptLog);
    expect(recipes).toHaveLength(0); // already attempted once
  });
});
```

- [ ] **Step 2: Implement recovery engine**

```javascript
// app/lib/recovery.js
/**
 * Recovery recipe engine.
 * Maps signals to recovery suggestions and auto-actions.
 */

export const RECOVERY_RECIPES = [
  {
    signal: 'session_stalled',
    steps: [{ action: 'restart_session' }],
    max_attempts: 1,
    escalation: 'alert_human',
    suggestion: 'Agent session appears stalled. Consider restarting the session.',
    auto_action: 'restart_session',
  },
  {
    signal: 'branch_stale',
    steps: [{ action: 'suggest_rebase' }],
    max_attempts: 1,
    escalation: 'warn_only',
    suggestion: 'Branch is behind main. Rebase or merge-forward recommended before proceeding.',
    auto_action: null,
  },
  {
    signal: 'mcp_degraded',
    steps: [{ action: 'retry_mcp_handshake', timeout_ms: 5000 }],
    max_attempts: 1,
    escalation: 'alert_human',
    suggestion: 'MCP server is degraded. Retry handshake or check server configuration.',
    auto_action: 'retry_mcp_handshake',
  },
  {
    signal: 'repeated_failures',
    steps: [{ action: 'reduce_autonomy', new_permission_level: 'readonly' }],
    max_attempts: 1,
    escalation: 'alert_human',
    suggestion: 'Agent has repeated failures. Reducing autonomy to readonly.',
    auto_action: 'reduce_autonomy',
  },
  {
    signal: 'green_insufficient',
    steps: [{ action: 'suggest_test_run', required_level: 'workspace' }],
    max_attempts: 1,
    escalation: 'block_until_resolved',
    suggestion: 'Tests must pass at workspace level before deploy/merge.',
    auto_action: null,
  },
  {
    signal: 'assumption_drift',
    steps: [{ action: 'suggest_assumption_review' }],
    max_attempts: 1,
    escalation: 'warn_only',
    suggestion: 'Agent assumptions have been invalidated. Review reasoning before proceeding.',
    auto_action: null,
  },
];

/**
 * Evaluate recovery recipes for a set of signals.
 *
 * @param {Array} signals - Array of signal objects with type, severity, agent_id
 * @param {Object} attemptLog - Map of signal_type -> { agent_id -> attempt_count }
 * @returns {Array} Array of recovery recipe results
 */
export function evaluateRecoveryRecipes(signals, attemptLog = {}) {
  const results = [];

  for (const signal of signals) {
    const recipe = RECOVERY_RECIPES.find(r => r.signal === signal.type);
    if (!recipe) continue;

    // Check attempt count
    const agentAttempts = attemptLog[signal.type]?.[signal.agent_id] || 0;
    if (agentAttempts >= recipe.max_attempts) continue;

    results.push({
      signal: signal.type,
      agent_id: signal.agent_id,
      suggestion: recipe.suggestion,
      auto_action: recipe.auto_action,
      escalation: recipe.escalation,
      steps: recipe.steps,
    });
  }

  return results;
}
```

- [ ] **Step 3: Run tests**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/unit/recovery.test.js`
Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Projects\DashClaw
git add app/lib/recovery.js __tests__/unit/recovery.test.js
git commit -m "feat(recovery): add recovery recipe engine — 6 recipes for common agent failures"
```

---

### Task 14: Session Lifecycle API

**Files:**
- Create: `app/api/sessions/route.js`
- Create: `app/api/sessions/[sessionId]/route.js`
- Create: `app/api/sessions/[sessionId]/events/route.js`
- Create: `__tests__/unit/sessions.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// __tests__/unit/sessions.test.js
import { describe, it, expect } from 'vitest';

// These test the API logic directly (not HTTP layer)
// Actual API routes will import these functions

import {
  createSession,
  getSession,
  updateSession,
  listSessions,
  getSessionEvents,
} from '../../app/lib/sessions.js';

function mockSql() {
  const store = { sessions: [], events: [] };
  const fn = async (strings, ...values) => {
    const query = strings.join('?');
    if (query.includes('INSERT INTO agent_sessions')) {
      const session = { id: values[0], org_id: values[1], agent_id: values[2], status: 'spawning' };
      store.sessions.push(session);
      return [session];
    }
    if (query.includes('SELECT') && query.includes('agent_sessions') && query.includes('WHERE id')) {
      return store.sessions.filter(s => s.id === values[0]);
    }
    if (query.includes('UPDATE agent_sessions')) {
      const sess = store.sessions.find(s => s.id === values[values.length - 1]);
      if (sess) sess.status = values[0];
      return [sess];
    }
    if (query.includes('SELECT') && query.includes('agent_sessions') && !query.includes('WHERE id')) {
      return store.sessions;
    }
    if (query.includes('INSERT INTO session_events')) {
      store.events.push({ session_id: values[0], seq: values[2], kind: values[3] });
      return [{}];
    }
    if (query.includes('SELECT') && query.includes('session_events')) {
      return store.events;
    }
    return [];
  };
  fn.begin = async (cb) => cb(fn);
  fn._store = store;
  return fn;
}

describe('Session Lifecycle', () => {
  it('creates a session with spawning status', async () => {
    const sql = mockSql();
    const result = await createSession(sql, 'org_test', 'claude-code', '/tmp/project');
    expect(result.id).toMatch(/^sess_/);
    expect(result.status).toBe('spawning');
  });

  it('updates session status', async () => {
    const sql = mockSql();
    const sess = await createSession(sql, 'org_test', 'claude-code', '/tmp');
    const updated = await updateSession(sql, sess.id, 'org_test', { status: 'running' });
    expect(updated.status).toBe('running');
  });
});
```

- [ ] **Step 2: Implement session lib**

```javascript
// app/lib/sessions.js
import { randomUUID } from 'node:crypto';

export async function createSession(sql, orgId, agentId, workspace, branch = null) {
  const id = `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  const [session] = await sql`
    INSERT INTO agent_sessions (id, org_id, agent_id, workspace, branch, status, status_since, last_activity, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${workspace}, ${branch}, 'spawning', ${now}, ${now}, ${now}, ${now})
    RETURNING *
  `;

  await sql`
    INSERT INTO session_events (session_id, org_id, seq, kind, created_at)
    VALUES (${id}, ${orgId}, ${1}, ${'spawning'}, ${now})
  `;

  return session;
}

export async function getSession(sql, sessionId, orgId) {
  const [session] = await sql`
    SELECT * FROM agent_sessions WHERE id = ${sessionId} AND org_id = ${orgId}
  `;
  return session || null;
}

export async function updateSession(sql, sessionId, orgId, updates) {
  const now = new Date().toISOString();
  const { status, green_level, branch_freshness, commits_behind, blocked_reason } = updates;

  const [session] = await sql`
    UPDATE agent_sessions SET
      status = COALESCE(${status || null}, status),
      status_since = ${status ? now : null},
      green_level = COALESCE(${green_level || null}, green_level),
      branch_freshness = COALESCE(${branch_freshness || null}, branch_freshness),
      commits_behind = COALESCE(${commits_behind ?? null}, commits_behind),
      blocked_reason = ${status === 'blocked' ? (blocked_reason || null) : null},
      last_activity = ${now},
      updated_at = ${now}
    WHERE id = ${sessionId} AND org_id = ${orgId}
    RETURNING *
  `;

  if (session && status) {
    const [lastEvent] = await sql`
      SELECT MAX(seq) as max_seq FROM session_events WHERE session_id = ${sessionId}
    `;
    const nextSeq = (lastEvent?.max_seq || 0) + 1;
    await sql`
      INSERT INTO session_events (session_id, org_id, seq, kind, detail, created_at)
      VALUES (${sessionId}, ${orgId}, ${nextSeq}, ${status}, ${blocked_reason || null}, ${now})
    `;
  }

  return session;
}

export async function listSessions(sql, orgId, filters = {}) {
  const { agent_id, status, limit = 50 } = filters;
  return sql`
    SELECT * FROM agent_sessions
    WHERE org_id = ${orgId}
      ${agent_id ? sql`AND agent_id = ${agent_id}` : sql``}
      ${status ? sql`AND status = ${status}` : sql``}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

export async function getSessionEvents(sql, sessionId, orgId) {
  return sql`
    SELECT * FROM session_events
    WHERE session_id = ${sessionId} AND org_id = ${orgId}
    ORDER BY seq ASC
  `;
}
```

- [ ] **Step 3: Create API routes**

```javascript
// app/api/sessions/route.js
import { NextResponse } from 'next/server';
import { getRequestContext } from '../../lib/org.js';
import { createSession, listSessions } from '../../lib/sessions.js';

export async function POST(request) {
  const { orgId, sql } = await getRequestContext(request);
  const body = await request.json();
  const { agent_id, workspace, branch } = body;

  if (!agent_id) {
    return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
  }

  const session = await createSession(sql, orgId, agent_id, workspace, branch);
  return NextResponse.json(session, { status: 201 });
}

export async function GET(request) {
  const { orgId, sql } = await getRequestContext(request);
  const { searchParams } = new URL(request.url);
  const filters = {
    agent_id: searchParams.get('agent_id'),
    status: searchParams.get('status'),
    limit: parseInt(searchParams.get('limit') || '50', 10),
  };

  const sessions = await listSessions(sql, orgId, filters);
  return NextResponse.json(sessions);
}
```

```javascript
// app/api/sessions/[sessionId]/route.js
import { NextResponse } from 'next/server';
import { getRequestContext } from '../../../lib/org.js';
import { getSession, updateSession } from '../../../lib/sessions.js';

export async function GET(request, { params }) {
  const { orgId, sql } = await getRequestContext(request);
  const session = await getSession(sql, params.sessionId, orgId);
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(session);
}

export async function PATCH(request, { params }) {
  const { orgId, sql } = await getRequestContext(request);
  const body = await request.json();
  const session = await updateSession(sql, params.sessionId, orgId, body);
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(session);
}
```

```javascript
// app/api/sessions/[sessionId]/events/route.js
import { NextResponse } from 'next/server';
import { getRequestContext } from '../../../../lib/org.js';
import { getSessionEvents } from '../../../../lib/sessions.js';

export async function GET(request, { params }) {
  const { orgId, sql } = await getRequestContext(request);
  const events = await getSessionEvents(sql, params.sessionId, orgId);
  return NextResponse.json(events);
}
```

- [ ] **Step 4: Run tests**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/unit/sessions.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Projects\DashClaw
git add app/lib/sessions.js app/api/sessions/ __tests__/unit/sessions.test.js
git commit -m "feat(sessions): add session lifecycle API — create, update, query, events"
```

---

### Task 15: Wire Recovery into Guard Response

**Files:**
- Modify: `app/lib/guard.js`

- [ ] **Step 1: Import and call recovery engine at end of evaluateGuard**

At the end of `evaluateGuard()` in `app/lib/guard.js`, before the return statement, add:

```javascript
import { evaluateRecoveryRecipes } from './recovery.js';

// ... at end of evaluateGuard, before return:

// Check for recovery recipes based on recent signals
let recovery = null;
try {
  // Only check recovery for non-allow decisions
  if (decision !== 'allow') {
    const recentSignals = []; // Build from current context
    if (context.intel?.branch?.freshness === 'stale') {
      recentSignals.push({ type: 'branch_stale', severity: 'amber', agent_id: context.agent_id });
    }
    if (context.intel?.mcp?.healthy === false) {
      recentSignals.push({ type: 'mcp_degraded', severity: 'amber', agent_id: context.agent_id });
    }
    if (context.intel?.green?.observed_level) {
      // Check if green was the reason for block
      if (allReasons.some(r => r.includes('Green contract'))) {
        recentSignals.push({ type: 'green_insufficient', severity: 'red', agent_id: context.agent_id });
      }
    }
    const recipes = evaluateRecoveryRecipes(recentSignals);
    if (recipes.length > 0) {
      recovery = recipes[0]; // Use first matching recipe
    }
  }
} catch (e) { /* recovery is best-effort */ }

return {
  decision,
  action_id: guardDecisionId,
  reason: allReasons.join('; '),
  signals: [...warnings, ...allReasons],
  matched_policies: matchedPolicyIds,
  risk_score: effectiveRiskScore,
  agent_risk_score: agentRiskScore,
  evaluated_at: new Date().toISOString(),
  ...(recovery ? { recovery } : {}),
  ...(learning || {}),
};
```

- [ ] **Step 2: Verify existing guard tests still pass**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/unit/guard-intel.test.js`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd C:\Projects\DashClaw
git add app/lib/guard.js
git commit -m "feat(guard): wire recovery recipes into guard response"
```

---

### Task 16: Update Pairings Route for Permission Level

**Files:**
- Modify: `app/api/pairings/[pairingId]/route.js`

- [ ] **Step 1: Add permission_level to the PATCH handler**

In the existing PATCH handler, add `permission_level` to the accepted fields and the UPDATE query:

```javascript
// In the PATCH handler, extract permission_level from body:
const { status, permission_level, ...rest } = body;

// In the UPDATE query, add:
// permission_level = COALESCE(${permission_level || null}, permission_level),
```

- [ ] **Step 2: Verify with a quick manual test or existing pairing tests**

Run: `cd C:\Projects\DashClaw && npx vitest run __tests__/ --grep pairing`
Expected: Existing tests still pass

- [ ] **Step 3: Commit**

```bash
cd C:\Projects\DashClaw
git add app/api/pairings/
git commit -m "feat(pairings): accept permission_level on PATCH for graduated autonomy"
```

---

### Task 17: Full Integration Test

**Files:**
- Create: `hooks/tests/test_full_integration.py`

- [ ] **Step 1: Write end-to-end test that exercises the full pipeline**

```python
# hooks/tests/test_full_integration.py
"""Full pipeline test: intel module -> pretool -> mock guard -> posttool."""

import unittest
from dashclaw_agent_intel import classify_bash, scan_file_operation, classify_tool, SessionTracker, McpHealthMonitor


class TestFullPipeline(unittest.TestCase):
    """Test the full classification pipeline as the pretool hook would use it."""

    def test_bash_git_push_full_pipeline(self):
        # Step 1: Classify tool
        tool_info = classify_tool("Bash", {"command": "git push origin main"})
        self.assertEqual(tool_info["category"], "execution")
        self.assertTrue(tool_info["governed"])

        # Step 2: Classify bash
        bash_info = classify_bash("git push origin main", mode="workspace_write", workspace="/tmp/project")
        self.assertEqual(bash_info["intent"], "write")
        self.assertGreaterEqual(bash_info["risk_score"], 50)

        # Step 3: Build context
        context = {
            "agent_id": "test-agent",
            "action_type": "apply",
            "risk_score": max(tool_info["risk_profile"]["base_risk"], bash_info["risk_score"]),
            "intel": {"tool": tool_info, "bash": bash_info},
        }
        self.assertIn("intel", context)
        self.assertIn("bash", context["intel"])

    def test_file_write_traversal_full_pipeline(self):
        tool_info = classify_tool("Write", {"file_path": "../../etc/passwd", "content": "bad"})
        self.assertTrue(tool_info["governed"])

        file_info = scan_file_operation("../../etc/passwd", "bad", "/tmp/project")
        self.assertTrue(file_info["traversal_detected"])
        self.assertTrue(file_info["outside_workspace"])

        context = {
            "agent_id": "test-agent",
            "action_type": "apply",
            "intel": {"tool": tool_info, "file": file_info},
        }
        # Risk should be elevated
        risk = tool_info["risk_profile"]["base_risk"]
        if file_info["traversal_detected"] or file_info["outside_workspace"]:
            risk = min(risk + 20, 100)
        self.assertGreaterEqual(risk, 50)

    def test_mcp_tool_full_pipeline(self):
        tool_info = classify_tool("mcp__agentcash__search", {"query": "test"})
        self.assertEqual(tool_info["category"], "mcp")
        self.assertTrue(tool_info["governed"])

        mcp = McpHealthMonitor()
        mcp.register("agentcash", status="connected")
        health = mcp.check("agentcash")
        self.assertTrue(health["healthy"])

    def test_session_lifecycle_full_pipeline(self):
        session = SessionTracker(agent_id="test", workspace="/tmp")
        self.assertEqual(session.get_state()["status"], "spawning")

        session.transition("ready")
        session.transition("running")
        session.transition("finished")
        self.assertEqual(session.get_state()["status"], "finished")
        self.assertEqual(len(session.get_state()["events"]), 4)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run full test suite**

Run: `cd C:\Projects\DashClaw\hooks && python -m pytest tests/ -v`
Expected: ALL tests across all test files PASS

- [ ] **Step 3: Commit**

```bash
cd C:\Projects\DashClaw
git add hooks/tests/test_full_integration.py
git commit -m "test: add full pipeline integration tests for layered intelligence"
```

---

## Summary

| Phase | Tasks | What ships |
|-------|-------|------------|
| A (Intel Module) | 1-7 | `dashclaw_agent_intel` Python package — bash classifier, file scanner, tool recognizer, session tracker, MCP monitor |
| B (Hooks) | 8-9 | Pretool v2 + Posttool v2 — 40+ tool governance, enriched intel context |
| C (Server) | 10-17 | Schema migration, 3 new policy types, 4 new signal types, recovery engine, session API |

**Total: 17 tasks, ~50 commits, ships in 3 phases.**

Each phase is independently valuable:
- Phase A alone gives any Python agent semantic classification capabilities
- Phase B alone upgrades DashClaw hooks from 4-tool regex to 40-tool semantic governance
- Phase C alone adds new server-side policy intelligence that works with enriched or legacy hooks
