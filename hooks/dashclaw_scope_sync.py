#!/usr/bin/env python3
"""dashclaw_scope_sync.py -- SessionStart hook: reachability follows the role.

Turns a role's `blocked_tools` (a `role_constraint` policy field) into Claude
Code `permissions.deny` rules at session start, so a tool the role blocks
cannot even be CHOSEN by the harness -- it is denied before the guard ever
sees it. The server-side evaluator stays the backstop; this hook only removes
reach, so a server that is unreachable simply leaves the deny list as it is.

`allowed_tools` is intentionally NOT translated here: Claude Code's
`permissions.deny` cannot express "deny everything except", so allowlists stay
server-enforced only.

Ownership: this hook owns ONLY the deny entries it wrote, tracked in
`<project>/.claude/.dashclaw-scope.json`. It never touches deny entries it did
not add and never breaks a session -- any failure exits 0 silently.
"""

import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

SETTINGS_FILE = "settings.local.json"
SCOPE_FILE = ".dashclaw-scope.json"


def _now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _debug(msg):
    """Debug/diagnostic line -> stderr (Claude Code shows only stdout as context)."""
    try:
        sys.stderr.write("[dashclaw_scope_sync] " + str(msg) + "\n")
    except Exception:
        pass


def translate_pattern(pattern):
    """Map one `blocked_tools` glob to a Claude Code permission rule.

    - A bare tool name maps to itself: `Bash` -> `Bash`, `mcp__x__search` ->
      `mcp__x__search`.
    - A whole trailing `__*` becomes a server-wide MCP rule: `mcp__xapi__*` ->
      `mcp__xapi`.
    - Any other `*` placement cannot be expressed as a deny rule -> None
      (the caller skips and counts it).
    """
    if not isinstance(pattern, str) or not pattern:
        return None
    if "*" not in pattern:
        return pattern
    if pattern.endswith("__*") and "*" not in pattern[:-3]:
        return pattern[:-3]
    return None


def blocked_tools_from_policies(policies):
    """Union `blocked_tools` across active `role_constraint` policies (order-preserving)."""
    seen = []
    for p in policies or []:
        if not isinstance(p, dict):
            continue
        if p.get("policy_type") != "role_constraint" or not p.get("active"):
            continue
        rules = p.get("rules")
        if isinstance(rules, str):
            try:
                rules = json.loads(rules)
            except Exception:
                continue
        if not isinstance(rules, dict):
            continue
        for t in rules.get("blocked_tools") or []:
            if isinstance(t, str) and t and t not in seen:
                seen.append(t)
    return seen


def _translate_all(blocked):
    """Translate the union to deny rules, dropping (and counting) inexpressible globs."""
    entries, skipped = [], 0
    for pat in blocked:
        rule = translate_pattern(pat)
        if rule is None:
            skipped += 1
            _debug('skipped inexpressible blocked_tools pattern "%s"' % pat)
        elif rule not in entries:
            entries.append(rule)
    return entries, skipped


def _read_owned(scope_path):
    """Previously owned deny entries from the scope file (best-effort)."""
    if not os.path.exists(scope_path):
        return []
    try:
        with open(scope_path, "r", encoding="utf-8") as f:
            prev = json.load(f)
    except Exception:
        return []
    if isinstance(prev, dict) and isinstance(prev.get("entries"), list):
        return [e for e in prev["entries"] if isinstance(e, str)]
    return []


def sync_deny(project_dir, agent_id, entries):
    """Merge `entries` into <project>/.claude/settings.local.json permissions.deny.

    Owns only the entries this hook wrote (tracked in .dashclaw-scope.json):
    stale owned entries are removed, new ones added, entries owned by anyone
    else are left untouched, and every other key in the file is preserved.
    Returns (added, removed), or None if settings.local.json existed but could
    not be read/parsed (in which case nothing is written).
    """
    claude_dir = os.path.join(project_dir, ".claude")
    settings_path = os.path.join(claude_dir, SETTINGS_FILE)
    scope_path = os.path.join(claude_dir, SCOPE_FILE)

    prev_owned = _read_owned(scope_path)
    prev_set = set(prev_owned)

    settings = {}
    had_trailing_newline = True
    if os.path.exists(settings_path):
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                raw = f.read()
        except Exception:
            _debug("settings.local.json unreadable; leaving it untouched")
            return None
        if raw.strip():
            try:
                settings = json.loads(raw)
            except Exception:
                _debug("settings.local.json unparseable; leaving it untouched")
                return None
            if not isinstance(settings, dict):
                _debug("settings.local.json is not a JSON object; leaving it untouched")
                return None
            had_trailing_newline = raw.endswith("\n")

    perms = settings.get("permissions")
    if not isinstance(perms, dict):
        perms = {}
    deny = perms.get("deny")
    if not isinstance(deny, list):
        deny = []

    existing_before = set(d for d in deny if isinstance(d, str))
    want = set(entries)

    # Remove entries this hook previously owned that are no longer wanted.
    removed = 0
    new_deny = []
    for d in deny:
        if isinstance(d, str) and d in prev_set and d not in want:
            removed += 1
            continue
        new_deny.append(d)

    # Add wanted entries not already present.
    added = 0
    for e in entries:
        if e not in new_deny:
            new_deny.append(e)
            added += 1

    # We own an entry when we previously owned it or just added it; an entry
    # that already existed under someone else's authorship stays theirs.
    owned_now = [e for e in entries if e in prev_set or e not in existing_before]

    changed = added > 0 or removed > 0
    ownership_changed = owned_now != prev_owned

    # Nothing to do and nothing to record -> leave the workspace untouched.
    if not changed and not ownership_changed and not os.path.exists(settings_path):
        return 0, 0

    if changed:
        perms["deny"] = new_deny
        settings["permissions"] = perms
        os.makedirs(claude_dir, exist_ok=True)
        out = json.dumps(settings, indent=2)
        if had_trailing_newline:
            out += "\n"
        with open(settings_path, "w", encoding="utf-8") as f:
            f.write(out)

    if changed or ownership_changed:
        os.makedirs(claude_dir, exist_ok=True)
        scope = {"agent_id": agent_id, "synced_at": _now_iso(), "entries": owned_now}
        with open(scope_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(scope, indent=2) + "\n")

    return added, removed


def run(project_dir, base_url, api_key, agent_id, fetch):
    """Core, injectable for tests. `fetch()` returns the policies list, or None
    when the server is unreachable / answered non-200 (leave the file as-is)."""
    if not base_url or not api_key:
        return {"denied": 0, "added": 0, "removed": 0, "skipped": 0}
    policies = fetch()
    if policies is None:
        return {"denied": 0, "added": 0, "removed": 0, "skipped": 0}
    blocked = blocked_tools_from_policies(policies)
    entries, skipped = _translate_all(blocked)
    result = sync_deny(project_dir, agent_id, entries)
    if result is None:
        return {"denied": len(entries), "added": 0, "removed": 0, "skipped": skipped}
    added, removed = result
    return {"denied": len(entries), "added": added, "removed": removed, "skipped": skipped}


def _project_dir():
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def main():
    try:
        # Lazy import: the pure helpers above stay importable for unit tests
        # without dragging in the pretool stack. pretool resolves the same
        # AGENT_ID, base URL and API key (and the dotenv loader) this hook uses.
        import dashclaw_pretool as pretool

        base_url = pretool.BASE_URL
        api_key = pretool.API_KEY
        agent_id = pretool.AGENT_ID

        def _fetch():
            path = "/api/policies?agent_id=" + urllib.parse.quote(agent_id or "")
            resp = pretool.api_request("GET", path, retries=1)
            if not isinstance(resp, dict):
                return None
            pols = resp.get("policies")
            return pols if isinstance(pols, list) else []

        summary = run(_project_dir(), base_url, api_key, agent_id, _fetch)
        print("denied=%(denied)d added=%(added)d removed=%(removed)d skipped=%(skipped)d" % summary)
    except Exception as exc:  # never break a session
        _debug("unexpected error (session unaffected): %s" % exc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
