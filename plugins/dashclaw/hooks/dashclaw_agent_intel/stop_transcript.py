"""Pure transcript logic for the Stop hook (dashclaw_stop.py).

Everything here is side-effect-free (the only I/O is load_entries reading the
transcript file): parsing Claude Code transcript JSONL, locating the current
turn, summing token usage, collecting tool_use blocks, extracting stated
assumptions, and the token-distribution / PATCH-body math. Extracted verbatim
from dashclaw_stop.py in the health pass so the logic is unit-testable; the
hook re-imports these under its original underscore names.
"""

import json
import os
import re


def parse_entry_line(line):
    """Parse one transcript line into a dict, or None to skip it."""
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except Exception:
        return None


def load_entries(transcript_path):
    if not transcript_path or not os.path.exists(transcript_path):
        return []
    out = []
    try:
        with open(transcript_path, encoding="utf-8") as f:
            for line in f:
                entry = parse_entry_line(line)
                if entry is not None:
                    out.append(entry)
    except Exception:
        return []
    return out


def index_after_last_user_prompt(entries):
    """Return the index of the first entry after the most recent real user
    prompt — i.e. the start of the current assistant turn.

    A "real" user prompt is a user entry whose content is a string, or whose
    content list has no tool_result blocks. Tool results are modeled as user
    messages but are not prompts."""
    for i in range(len(entries) - 1, -1, -1):
        e = entries[i]
        if e.get("type") != "user":
            continue
        msg = e.get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return i + 1
        if isinstance(content, list):
            has_tool_result = any(
                isinstance(c, dict) and c.get("type") == "tool_result"
                for c in content
            )
            if not has_tool_result:
                return i + 1
    return 0


def resolve_turn_start(entries, last_uuid):
    """Index of the first entry to attribute to this turn.

    Starts just after `last_uuid` if found; otherwise falls back to the first
    entry after the most recent real user prompt."""
    if last_uuid:
        for i, e in enumerate(entries):
            if e.get("uuid") == last_uuid:
                return i + 1
    return index_after_last_user_prompt(entries)


def usage_input_tokens(usage):
    """Effective input-token count used for cost from one usage block:
      - regular input tokens        full price
      - cache_creation_input_tokens full price (~1.25x is close to 1x for 5m cache)
      - cache_read_input_tokens     10% price — apply the discount here so
                                    downstream cost derivation matches real billing"""
    total = int(usage.get("input_tokens") or 0)
    total += int(usage.get("cache_creation_input_tokens") or 0)
    cache_read = int(usage.get("cache_read_input_tokens") or 0)
    # Half-away-from-zero to match JS Math.round() in packages/openclaw-plugin/src/index.ts
    # so the same transcript produces the same token totals across both paths.
    # Python's built-in round() uses banker's rounding, which diverges on .5 boundaries.
    total += int(cache_read * 0.1 + 0.5)
    return total


def entry_uuid(entry):
    return entry.get("uuid") or ""


def assistant_entry_usage(entry):
    """Return (tokens_in, tokens_out, model) for an assistant entry."""
    if entry.get("type") != "assistant":
        return 0, 0, ""
    msg = entry.get("message") or {}
    usage = msg.get("usage") or {}
    return (
        usage_input_tokens(usage),
        int(usage.get("output_tokens") or 0),
        msg.get("model") or "",
    )


def collect_turn_usage(entries, last_uuid):
    """Sum token usage and pick a model from assistant entries since last_uuid.

    Returns (tokens_in, tokens_out, model, new_cursor_uuid).
    If last_uuid is missing or not found, starts from the last user prompt."""
    start = resolve_turn_start(entries, last_uuid)

    tokens_in = 0
    tokens_out = 0
    model = ""
    new_cursor = last_uuid
    for e in entries[start:]:
        new_cursor = entry_uuid(e) or new_cursor
        in_delta, out_delta, entry_model = assistant_entry_usage(e)
        tokens_in += in_delta
        tokens_out += out_delta
        model = model or entry_model

    return tokens_in, tokens_out, model, new_cursor


# ---------------------------------------------------------------------------
# Governed tool_use collection (coverage truth)
# ---------------------------------------------------------------------------

# The governed matcher mirrors the PreToolUse harness matcher in
# hooks/settings.json ("Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|Skill|
# mcp__.*") exactly, including how MCP tool names appear in the transcript
# (mcp__<server>__<method>).
GOVERNED_TOOL_RE = re.compile(r"^(?:Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|Skill|mcp__.*)$")


def is_governed_tool_name(name):
    return bool(name) and bool(GOVERNED_TOOL_RE.match(name))


def collect_turn_tool_uses(entries, start):
    """(tool_use_id, tool_name) pairs from tool_use blocks in entries[start:].

    Mirrors how dashclaw_code_session_reporter._collect_tool_use_action_map
    walks assistant message content — same slice, same block shape."""
    out = []
    for e in entries[start:]:
        msg = e.get("message") if isinstance(e, dict) else None
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            tool_use_id = block.get("id")
            name = block.get("name")
            if tool_use_id and name:
                out.append((tool_use_id, name))
    return out


# ---------------------------------------------------------------------------
# Assumption extraction
# ---------------------------------------------------------------------------

ASSUMPTIONS_PER_TURN_CAP = 5
_ASSUMPTIONS_HEADER_RE = re.compile(r"^\s*ASSUMPTIONS I'M MAKING:\s*$", re.MULTILINE)
_ASSUMPTION_ITEM_RE = re.compile(r"^\s*\d+\.\s+(.+?)\s*$")


def turn_assistant_text(entries, start):
    """Concatenated text blocks from the turn's assistant entries."""
    parts = []
    for e in entries[start:]:
        if e.get("type") != "assistant":
            continue
        content = (e.get("message") or {}).get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text" and c.get("text"):
                    parts.append(c["text"])
    return "\n".join(parts)


def extract_assumptions(text):
    """Numbered items from "ASSUMPTIONS I'M MAKING:" blocks, in order.

    Items run until the first non-item line (e.g. the "→ Correct me now"
    tail). Leading blank lines after the header are tolerated; blanks after
    the first item end the block. Deduplicated, capped per turn."""
    out = []
    if not text:
        return out
    for m in _ASSUMPTIONS_HEADER_RE.finditer(text):
        seen_item = False
        for line in text[m.end():].splitlines():
            if not line.strip():
                if seen_item:
                    break
                continue
            item = _ASSUMPTION_ITEM_RE.match(line)
            if not item:
                break
            seen_item = True
            val = item.group(1).strip()
            if val and val not in out:
                out.append(val)
            if len(out) >= ASSUMPTIONS_PER_TURN_CAP:
                return out
    return out


# ---------------------------------------------------------------------------
# Distribution + PATCH-body math
# ---------------------------------------------------------------------------

def distribute(total, n):
    """Split `total` into `n` non-negative integers that sum to `total`.

    Early buckets get one extra when the split isn't even. n must be > 0."""
    base = total // n
    remainder = total - base * n
    return [base + (1 if i < remainder else 0) for i in range(n)]


def patch_body_for(in_part, out_part, model, has_tokens, ts_end):
    """Build the conditional-close PATCH body for one action_id."""
    body = {
        "close_if_running": True,
        "status": "completed",
        "output_summary": "Auto-closed by Stop hook",
        "timestamp_end": ts_end,
    }
    if has_tokens:
        body["tokens_in"] = in_part
        body["tokens_out"] = out_part
        if model:
            body["model"] = model
    return body


def datetime_now_iso():
    """ISO-8601 UTC timestamp with trailing Z — matches posttool convention."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
