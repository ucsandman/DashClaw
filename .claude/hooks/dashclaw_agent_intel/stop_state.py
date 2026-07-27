"""Tempdir session-state helpers for the Stop hook (dashclaw_stop.py).

The cross-hook contract lives in these files: PreToolUse appends action_ids to
the per-session turn file, the Stop hook consumes them, tracks its transcript
cursor, remembers which extracted assumptions it already POSTed, and throttles
the insights/sample pushes via marker files. Extracted verbatim from
dashclaw_stop.py in the health pass so the file contracts are unit-testable;
the hook re-imports these under its original underscore names.

Every reader returns a safe empty value on any failure and every writer
swallows errors — the Stop hook must never block session end.
"""

import json
import os
import re
import tempfile
import time

# Session IDs come from untrusted stdin. Before we use one as a temp-file
# suffix, replace anything outside this whitelist so a crafted session_id
# like "../etc/passwd" cannot escape the tempdir.
_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def safe_session_id(session_id):
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


def log_hook_error(message, source="stop"):
    """Best-effort append to a shared tempdir log so ops can detect
    token-attribution drift (API-key rotation, base-URL typo, transient 5xx)."""
    try:
        path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).isoformat()
        with open(path, "a", encoding="utf-8") as f:
            f.write(ts + " " + source + " " + str(message) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Turn actions + transcript cursor
# ---------------------------------------------------------------------------

def turn_actions_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + safe_session_id(session_id))


def cursor_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_stop_cursor_" + safe_session_id(session_id))


def read_cursor(session_id):
    try:
        with open(cursor_path(session_id), encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def write_cursor(session_id, uuid):
    if not uuid:
        return
    try:
        with open(cursor_path(session_id), "w", encoding="utf-8") as f:
            f.write(uuid)
    except Exception:
        pass


def read_turn_actions(session_id):
    try:
        with open(turn_actions_path(session_id), encoding="utf-8") as f:
            ids = [ln.strip() for ln in f.readlines()]
    except Exception:
        return []
    # Preserve order, drop blanks and duplicates
    seen = set()
    out = []
    for aid in ids:
        if aid and aid not in seen:
            seen.add(aid)
            out.append(aid)
    return out


def clear_turn_actions(session_id):
    try:
        os.remove(turn_actions_path(session_id))
    except Exception:
        pass


def count_session_actions(session_id):
    """Unique governed action_ids accumulated for this session by pretool's
    session tool map. Best-effort; 0 on any failure."""
    path = os.path.join(
        tempfile.gettempdir(),
        "dashclaw_session_tool_map_" + safe_session_id(session_id),
    )
    try:
        with open(path, encoding="utf-8") as f:
            return len({ln.split("\t", 1)[1].strip() for ln in f if "\t" in ln})
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Assumption idempotency keys
# ---------------------------------------------------------------------------

def assumptions_posted_path(session_id):
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_assumptions_" + safe_session_id(session_id)
    )


def read_posted_assumption_keys(session_id):
    try:
        with open(assumptions_posted_path(session_id), encoding="utf-8") as f:
            return {ln.strip() for ln in f if ln.strip()}
    except Exception:
        return set()


def append_posted_assumption_keys(session_id, keys):
    if not keys:
        return
    try:
        with open(assumptions_posted_path(session_id), "a", encoding="utf-8") as f:
            for key in keys:
                f.write(key + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Deviation idempotency keys
# ---------------------------------------------------------------------------

def deviations_posted_path(session_id):
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_deviations_" + safe_session_id(session_id)
    )


def read_posted_deviation_keys(session_id):
    try:
        with open(deviations_posted_path(session_id), encoding="utf-8") as f:
            return {ln.strip() for ln in f if ln.strip()}
    except Exception:
        return set()


def append_posted_deviation_keys(session_id, keys):
    if not keys:
        return
    try:
        with open(deviations_posted_path(session_id), "a", encoding="utf-8") as f:
            for key in keys:
                f.write(key + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Containment Verdicts (Task 10): per-turn contained-action log + idempotency
#
# PostToolUse appends "<action_id>\t<containment_ref>" for every contained
# mutation it processes this turn (dashclaw_posttool.py). The Stop hook reads
# these pairs, PATCHes containment_status=awaiting_promotion for each
# (idempotent per session via the posted-keys file below, mirroring the
# assumption/deviation pattern above), then clears the per-turn log.
# ---------------------------------------------------------------------------

def contained_turn_path(session_id):
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_contained_turn_" + safe_session_id(session_id)
    )


def read_contained_turn_actions(session_id):
    """(action_id, containment_ref) pairs appended this turn. Dedups by
    action_id (first ref wins); [] on any read failure."""
    try:
        with open(contained_turn_path(session_id), encoding="utf-8") as f:
            lines = f.readlines()
    except Exception:
        return []
    seen = set()
    out = []
    for raw in lines:
        line = raw.rstrip("\n")
        if "\t" not in line:
            continue
        action_id, _, ref = line.partition("\t")
        action_id = action_id.strip()
        ref = ref.strip()
        if action_id and ref and action_id not in seen:
            seen.add(action_id)
            out.append((action_id, ref))
    return out


def clear_contained_turn_actions(session_id):
    try:
        os.remove(contained_turn_path(session_id))
    except Exception:
        pass


def contained_posted_path(session_id):
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_contained_posted_" + safe_session_id(session_id)
    )


def read_posted_containment_keys(session_id):
    try:
        with open(contained_posted_path(session_id), encoding="utf-8") as f:
            return {ln.strip() for ln in f if ln.strip()}
    except Exception:
        return set()


def append_posted_containment_keys(session_id, keys):
    if not keys:
        return
    try:
        with open(contained_posted_path(session_id), "a", encoding="utf-8") as f:
            for key in keys:
                f.write(key + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Push throttle markers + sample-upload offsets
# ---------------------------------------------------------------------------

def insights_marker_path():
    return os.path.join(tempfile.gettempdir(), "dashclaw_insights_push")


def insights_due(throttle_seconds):
    """True when enough time has passed since the last push (or never pushed)."""
    try:
        with open(insights_marker_path(), encoding="utf-8") as f:
            last = float(f.read().strip())
        return (time.time() - last) >= throttle_seconds
    except Exception:
        return True


def mark_insights_pushed():
    try:
        with open(insights_marker_path(), "w", encoding="utf-8") as f:
            f.write(str(time.time()))
    except Exception:
        pass


def samples_marker_path():
    return os.path.join(tempfile.gettempdir(), "dashclaw_behavior_upload_push")


def samples_push_due(throttle_seconds):
    """True when enough time has passed since the last push (or never pushed)."""
    try:
        with open(samples_marker_path(), encoding="utf-8") as f:
            last = float(f.read().strip())
        return (time.time() - last) >= throttle_seconds
    except Exception:
        return True


def mark_samples_pushed():
    try:
        with open(samples_marker_path(), "w", encoding="utf-8") as f:
            f.write(str(time.time()))
    except Exception:
        pass


def samples_offsets_path():
    return os.path.join(tempfile.gettempdir(), "dashclaw_behavior_upload_offsets.json")


def read_sample_offsets():
    """Per-day-file byte offsets of already-uploaded JSONL. {} on any failure."""
    try:
        with open(samples_offsets_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_sample_offsets(offsets):
    try:
        with open(samples_offsets_path(), "w", encoding="utf-8") as f:
            f.write(json.dumps(offsets))
    except Exception:
        pass
