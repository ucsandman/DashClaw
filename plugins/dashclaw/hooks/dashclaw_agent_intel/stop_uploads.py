"""Behavior insights push + anonymized sample upload for the Stop hook.

Two independent, throttled, fail-silent uploaders extracted verbatim from
dashclaw_stop.py in the health pass (config arrives as explicit parameters
instead of the hook's module globals, so both paths are unit-testable):

- maybe_push_insights: SAFE aggregate snapshot (counts only, no raw behavior)
  to /api/behavior/insights so a hosted dashboard can show DashClaw is alive
  and learning. On whenever the recorder is on; opt out with
  DASHCLAW_BEHAVIOR_INSIGHTS=0 (the hook passes that as `opt_out`).
- maybe_push_samples: OPT-IN (default OFF) anonymized JSONL sample upload to
  /api/behavior/samples/ingest. Each new line is anonymized CLIENT-SIDE
  before transit; the hashing salt is derived from the API key and is never
  logged or sent anywhere.
"""

import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request

from . import behavior_recorder
from . import stop_state
from .http_client import request_with_retry

INSIGHTS_THROTTLE_SECONDS = 600
SAMPLES_THROTTLE_SECONDS = 600
SAMPLES_BATCH_MAX = 500


def recorder_enabled():
    """True iff the behavior recorder reports it's on. Fail-silent → False."""
    try:
        return bool(behavior_recorder.is_enabled())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Insights push (safe aggregate → hosted dashboard)
# ---------------------------------------------------------------------------

def build_insights_snapshot(workspace, log):
    """Build the SAFE aggregate snapshot, or None on failure/empty. Fail-silent."""
    try:
        return behavior_recorder.build_insights(workspace)
    except Exception as e:
        log("build_insights -> " + type(e).__name__ + ": " + str(e))
        return None


def post_insights(base_url, api_key, snapshot, log):
    """POST the safe aggregate snapshot to /api/behavior/insights. Fail-silent."""
    url = base_url + "/api/behavior/insights"
    data = json.dumps(snapshot).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "x-api-key": api_key},
        method="POST",
    )
    try:
        request_with_retry(req, timeout=3)
    except urllib.error.HTTPError as e:
        log("POST /api/behavior/insights -> HTTP " + str(e.code))
    except Exception as e:
        log("POST /api/behavior/insights -> " + type(e).__name__ + ": " + str(e))


def maybe_push_insights(base_url, api_key, opt_out, workspace, log):
    """Push the SAFE aggregate snapshot so a hosted dashboard can show DashClaw
    is learning. Gated on the recorder being on, the opt-out flag, and a
    throttle so we don't recompute on every Stop. Raw behavior never leaves the
    machine — only counts/tallies/signals/timestamps. Fail-silent."""
    if opt_out or not base_url or not api_key:
        return
    if not recorder_enabled():
        return
    if not stop_state.insights_due(INSIGHTS_THROTTLE_SECONDS):
        return
    snapshot = build_insights_snapshot(workspace, log)
    if not snapshot:
        return
    post_insights(base_url, api_key, snapshot, log)
    stop_state.mark_insights_pushed()


# ---------------------------------------------------------------------------
# Anonymized behavior-sample upload (opt-in, default OFF)
# ---------------------------------------------------------------------------

def upload_salt(api_key):
    """Hashing salt for anonymization, derived from the API key (HMAC-SHA256 of
    a fixed label keyed by the key). Never logged, never transmitted."""
    return hmac.new(
        api_key.encode("utf-8"), b"dashclaw-behavior-upload", hashlib.sha256
    ).hexdigest()


def read_new_sample_lines(offsets, workspace):
    """Complete NEW JSONL lines per day file since the recorded byte offset.

    Returns [(path, new_offset, [raw lines])]. A trailing partial line (no
    newline yet) is left for the next push. Read-only; never writes."""
    directory = behavior_recorder.samples_dir(workspace)
    try:
        names = sorted(n for n in os.listdir(directory) if behavior_recorder._DAY_FILE_RE.match(n))
    except OSError:
        return []
    out = []
    for name in names:
        path = os.path.join(directory, name)
        try:
            start = int(offsets.get(path) or 0)
        except (TypeError, ValueError):
            start = 0
        try:
            if os.path.getsize(path) <= start:
                continue
            with open(path, "rb") as f:
                f.seek(start)
                chunk = f.read()
        except OSError:
            continue
        end = chunk.rfind(b"\n")
        if end < 0:
            continue
        lines = chunk[:end].decode("utf-8", errors="replace").splitlines()
        out.append((path, start + end + 1, lines))
    return out


def anonymize_sample_lines(lines, salt):
    """Parse + anonymize raw JSONL lines. Unparseable lines are skipped."""
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict) or not obj.get("event_id"):
            continue
        try:
            out.append(behavior_recorder.anonymize_sample_for_upload(obj, salt))
        except Exception:
            continue
    return out


def post_sample_batch(base_url, api_key, batch, log):
    """POST one anonymized batch to /api/behavior/samples/ingest. True on success."""
    req = urllib.request.Request(
        base_url + "/api/behavior/samples/ingest",
        data=json.dumps({"samples": batch}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key},
        method="POST",
    )
    try:
        request_with_retry(req, timeout=3)
        return True
    except urllib.error.HTTPError as e:
        log("POST /api/behavior/samples/ingest -> HTTP " + str(e.code))
    except Exception as e:
        log("POST /api/behavior/samples/ingest -> " + type(e).__name__ + ": " + str(e))
    return False


def maybe_push_samples(base_url, api_key, enabled, workspace, log):
    """Opt-in anonymized sample upload for the remote Policy Coach.

    Gated on (ALL required): base_url + api_key present, the recorder being
    on, and the explicit DASHCLAW_BEHAVIOR_UPLOAD=1/true/yes opt-in — absent
    means OFF and this function does nothing (no reads, no files, no HTTP).
    Throttled to one push per SAMPLES_THROTTLE_SECONDS; only new JSONL bytes
    since the per-day offset marker upload; anonymized client-side before
    transit; fail-silent (a failed batch keeps its offset for retry)."""
    if not enabled or not base_url or not api_key:
        return
    try:
        if not recorder_enabled():
            return
        if not stop_state.samples_push_due(SAMPLES_THROTTLE_SECONDS):
            return
        salt = upload_salt(api_key)
        offsets = stop_state.read_sample_offsets()
        ok = True
        for path, new_offset, lines in read_new_sample_lines(offsets, workspace):
            if not ok:
                break
            samples = anonymize_sample_lines(lines, salt)
            for i in range(0, len(samples), SAMPLES_BATCH_MAX):
                if not post_sample_batch(base_url, api_key, samples[i:i + SAMPLES_BATCH_MAX], log):
                    ok = False
                    break
            else:
                offsets[path] = new_offset
        # Drop offsets for day files that no longer exist (retention/cleanup).
        offsets = {p: o for p, o in offsets.items() if os.path.exists(p)}
        stop_state.write_sample_offsets(offsets)
        stop_state.mark_samples_pushed()
    except Exception as e:
        log("push_samples -> " + type(e).__name__ + ": " + str(e))
