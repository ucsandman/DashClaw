"""Tests for dashclaw_session_digest.py (SessionStart digest hook).

Contract: never blocks, always exits 0, prints a digest to stdout when the
API answers, prints nothing when config is missing or the API is down.
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HOOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dashclaw_session_digest.py")


def run_hook(env_overrides):
    # DASHCLAW_LIVENESS_PROBE_DISABLED: the digest spawns the v8.2 liveness
    # probe as a detached side effect on real installs; tests isolate it.
    env = {**os.environ, "DASHCLAW_DISABLE_DOTENV": "1", "DASHCLAW_LIVENESS_PROBE_DISABLED": "1"}
    # Start from a config-clean slate so machine env vars don't leak in.
    for k in ("DASHCLAW_BASE_URL", "DASHCLAW_URL", "DASHCLAW_API_KEY", "DASHCLAW_AGENT_ID", "DASHCLAW_DIGEST_DISABLED"):
        env.pop(k, None)
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, HOOK], input=b"{}", capture_output=True, env=env, timeout=15
    )


class _Api(BaseHTTPRequestHandler):
    def do_GET(self):
        # Response shapes mirror app/api/learning/route.ts and
        # app/api/handoffs/route.ts (latest=true branch) as of 2026-06-11.
        if self.path.startswith("/api/learning"):
            body = {
                "decisions": [
                    {"decision": "Use FF-only sync for main checkout", "outcome": "success", "confidence": 90, "timestamp": "2026-06-10T12:00:00Z"},
                    {"decision": "Retry flaky vercel deploy once", "outcome": "failure", "confidence": 40, "timestamp": "2026-06-09T12:00:00Z"},
                ],
                "lessons": [
                    {"action_type": "deploy", "guidance": "Prefer reversible deploy strategies (success rate 0.92, n=24)", "confidence": 85},
                ],
                "stats": {"totalDecisions": 31, "totalLessons": 1, "successRate": 88, "totalWithOutcome": 25, "patterns": 1},
            }
        elif self.path.startswith("/api/handoffs"):
            body = {
                "id": "h_1",
                "agent_id": "claude-code",
                "project_id": None,
                "bundle": {"summary": "Finished digest hook tests"},
                "created_at": "2026-06-11T01:00:00Z",
            }
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):  # keep test output clean
        pass


class _ApiNoHandoff(_Api):
    def do_GET(self):
        if self.path.startswith("/api/handoffs"):
            data = json.dumps({"error": "no_handoff"}).encode()
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def _serve(handler=_Api):
    srv = HTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def test_no_config_prints_nothing_exits_zero():
    r = run_hook({})
    assert r.returncode == 0
    assert r.stdout == b""


def test_api_unreachable_fails_silent():
    r = run_hook({"DASHCLAW_BASE_URL": "http://127.0.0.1:1", "DASHCLAW_API_KEY": "oc_test"})
    assert r.returncode == 0
    assert r.stdout == b""


def test_digest_rendered_from_api():
    srv = _serve()
    try:
        r = run_hook({
            "DASHCLAW_BASE_URL": f"http://127.0.0.1:{srv.server_address[1]}",
            "DASHCLAW_API_KEY": "oc_test",
            "DASHCLAW_AGENT_ID": "claude-code",
        })
    finally:
        srv.shutdown()
    out = r.stdout.decode()
    assert r.returncode == 0
    assert "DashClaw digest" in out
    assert "FF-only sync" in out                  # decision title
    assert "(90%)" in out                          # int confidence rendered as percent
    assert "reversible deploy strategies" in out  # lesson guidance
    assert "unconsumed handoff" in out.lower()    # handoff pointer
    assert "dashclaw_handoff_consume" in out      # how to consume
    assert len(out.splitlines()) <= 22            # stays compact


def test_no_handoff_404_digest_still_renders():
    srv = _serve(_ApiNoHandoff)
    try:
        r = run_hook({
            "DASHCLAW_BASE_URL": f"http://127.0.0.1:{srv.server_address[1]}",
            "DASHCLAW_API_KEY": "oc_test",
        })
    finally:
        srv.shutdown()
    out = r.stdout.decode()
    assert r.returncode == 0
    assert "DashClaw digest" in out
    assert "handoff" not in out.lower()


def test_disabled_flag_prints_nothing():
    srv = _serve()
    try:
        r = run_hook({
            "DASHCLAW_BASE_URL": f"http://127.0.0.1:{srv.server_address[1]}",
            "DASHCLAW_API_KEY": "oc_test",
            "DASHCLAW_DIGEST_DISABLED": "1",
        })
    finally:
        srv.shutdown()
    assert r.returncode == 0
    assert r.stdout == b""


# ---------------------------------------------------------------------------
# v8.2: enforcement-liveness probe spawn (detached, marker-throttled)
# ---------------------------------------------------------------------------

def _import_digest():
    import importlib
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(HOOK))
    os.environ.setdefault("DASHCLAW_DISABLE_DOTENV", "1")
    module = importlib.import_module("dashclaw_session_digest")
    return module


def test_probe_spawn_throttled_by_fresh_marker(tmp_path, monkeypatch):
    digest = _import_digest()
    home = tmp_path / "home"
    root = home / ".dashclaw" / "liveness-probe"
    root.mkdir(parents=True)
    marker = root / ".last-spawn"
    marker.write_text("now")
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(home) if p == "~" else p)
    monkeypatch.delenv("DASHCLAW_LIVENESS_PROBE_DISABLED", raising=False)
    calls = []
    monkeypatch.setattr(digest.subprocess, "Popen", lambda *a, **k: calls.append(a))
    digest._maybe_spawn_liveness_probe()
    assert calls == []


def test_probe_spawn_fires_and_writes_marker(tmp_path, monkeypatch):
    digest = _import_digest()
    home = tmp_path / "home"
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(home) if p == "~" else p)
    monkeypatch.delenv("DASHCLAW_LIVENESS_PROBE_DISABLED", raising=False)
    calls = []
    monkeypatch.setattr(digest.subprocess, "Popen", lambda *a, **k: calls.append((a, k)))
    digest._maybe_spawn_liveness_probe()
    assert len(calls) == 1
    argv = calls[0][0][0]
    assert argv[1].endswith("enforcement_liveness_probe.py")
    assert argv[2:] == ["--source", "session-start"]
    assert (home / ".dashclaw" / "liveness-probe" / ".last-spawn").exists()


def test_probe_spawn_disabled_env(tmp_path, monkeypatch):
    digest = _import_digest()
    monkeypatch.setenv("DASHCLAW_LIVENESS_PROBE_DISABLED", "1")
    calls = []
    monkeypatch.setattr(digest.subprocess, "Popen", lambda *a, **k: calls.append(a))
    digest._maybe_spawn_liveness_probe()
    assert calls == []
