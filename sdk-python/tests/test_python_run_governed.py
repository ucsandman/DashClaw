"""
Unit tests for the Python SDK's evidence-first guard surface: run_governed
and scrub_act. Node parity: __tests__/unit/sdk-run-governed.test.js.
See docs/superpowers/specs/2026-07-05-evidence-first-guard.md §5.

Uses a RecordingDashClaw that intercepts _request() calls instead of hitting
the network, following the conventions of test_sdk_v2_surface.py /
test_client.py.
"""

import unittest

from dashclaw.client import (
    DashClaw,
    GuardBlockedError,
    ApprovalDeniedError,
    ApprovalPendingError,
    scrub_act,
)


class RecordingDashClaw(DashClaw):
    """Subclass that returns canned responses keyed by (method, bare path)
    instead of making HTTP requests, and records every call."""

    def __init__(self, responses=None, **overrides):
        defaults = {
            "base_url": "https://example.test",
            "api_key": "test-key",
            "agent_id": "agent-1",
        }
        defaults.update(overrides)
        super().__init__(**defaults)
        self.calls = []
        self.responses = responses or {}
        self.wait_for_approval_calls = []
        self._wait_for_approval_result = {}
        self._wait_for_approval_error = None

    def _request(self, path, method="GET", body=None, json=None, **kwargs):
        payload = json if json is not None else body
        bare = path.split("?")[0]
        self.calls.append({"path": bare, "method": method, "body": payload})
        key = (method, bare)
        if key in self.responses:
            value = self.responses[key]
            if isinstance(value, Exception):
                raise value
            return value
        return {"ok": True}

    def _sign_payload(self, payload):
        return None

    def wait_for_approval(self, action_id, timeout=300, interval=5):
        self.wait_for_approval_calls.append(action_id)
        if self._wait_for_approval_error:
            raise self._wait_for_approval_error
        return self._wait_for_approval_result


# ---------------------------------------------------------------------------
# scrub_act
# ---------------------------------------------------------------------------

class TestScrubAct(unittest.TestCase):
    def test_strips_secret_headers_from_an_http_act(self):
        act = {
            "kind": "http",
            "request": {
                "method": "POST",
                "url": "https://x.test",
                "headers": {
                    "Authorization": "Bearer abc123",
                    "Cookie": "session=1",
                    "x-api-key": "k_live_1",
                    "Content-Type": "application/json",
                },
            },
        }
        out = scrub_act(act)
        self.assertEqual(out["request"]["headers"], {"Content-Type": "application/json"})

    def test_masks_secret_shaped_substrings_in_command(self):
        act = {
            "kind": "shell",
            "command": (
                'curl -H "Authorization: Bearer sk-abcdefghij1234" '
                '-d "password=hunter2&token=oc_live_zzz111&secret=ghp_abcdefghijklmnopqrst123" https://x'
            ),
        }
        out = scrub_act(act)
        self.assertNotIn("sk-abcdefghij1234", out["command"])
        self.assertNotIn("hunter2", out["command"])
        self.assertNotIn("oc_live_zzz111", out["command"])
        self.assertNotIn("ghp_abcdefghijklmnopqrst123", out["command"])
        self.assertIn("Bearer [REDACTED]", out["command"])
        self.assertIn("password=[REDACTED]", out["command"])
        self.assertIn("token=[REDACTED]", out["command"])
        self.assertIn("secret=[REDACTED]", out["command"])

    def test_masks_sql_statement_and_file_content_excerpt(self):
        self.assertNotIn(
            "sk-verysecretvalue1",
            scrub_act({"kind": "sql", "statement": "UPDATE users SET token='sk-verysecretvalue1'"})["statement"],
        )
        self.assertNotIn(
            "sk-verysecretvalue1",
            scrub_act({"kind": "file", "file": {"path": ".env", "content_excerpt": "API_KEY=sk-verysecretvalue1"}})["file"]["content_excerpt"],
        )

    def test_is_pure_does_not_mutate_input(self):
        act = {"kind": "shell", "command": "sk-aaaaaaaaaa"}
        out = scrub_act(act)
        self.assertEqual(act["command"], "sk-aaaaaaaaaa")
        self.assertEqual(out["command"], "[REDACTED]")

    def test_passes_through_non_dict_unchanged(self):
        self.assertIsNone(scrub_act(None))
        self.assertEqual(scrub_act("rm -rf /"), "rm -rf /")

    def test_leaves_benign_text_untouched(self):
        out = scrub_act({"kind": "shell", "command": "ls -la /tmp"})
        self.assertEqual(out["command"], "ls -la /tmp")


# ---------------------------------------------------------------------------
# run_governed
# ---------------------------------------------------------------------------

class TestRunGoverned(unittest.TestCase):
    def test_allow_flow_recorded_runs_fn_and_reports_completed_with_one_call(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "allow", "recorded": True, "action_id": "act_1"},
        })
        calls = []

        result = client.run_governed(
            {"kind": "shell", "command": "ls"},
            {"action_type": "other", "declared_goal": "g"},
            lambda: calls.append("ran") or "done",
        )

        self.assertEqual(result, "done")
        self.assertEqual(calls, ["ran"])
        guard_calls = [c for c in client.calls if c["path"] == "/api/guard"]
        self.assertEqual(len(guard_calls), 1)
        self.assertEqual(guard_calls[0]["body"]["act"], {"kind": "shell", "command": "ls"})
        self.assertFalse(any(c["path"] == "/api/actions" for c in client.calls))
        outcome_call = next(c for c in client.calls if c["path"] == "/api/actions/act_1/outcome")
        self.assertEqual(outcome_call["body"], {"status": "completed"})

    def test_falls_back_to_create_action_when_guard_did_not_record(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "allow", "recorded": False, "recorded_error": "boom"},
            ("POST", "/api/actions"): {"action_id": "act_fallback", "action": {"status": "running"}},
        })
        calls = []

        result = client.run_governed(
            {"kind": "shell", "command": "ls"},
            {"action_type": "other", "declared_goal": "g"},
            lambda: calls.append("ran") or "done",
        )

        self.assertEqual(result, "done")
        create_call = next(c for c in client.calls if c["path"] == "/api/actions")
        self.assertEqual(create_call["body"]["act"], {"kind": "shell", "command": "ls"})
        outcome_call = next(c for c in client.calls if c["path"] == "/api/actions/act_fallback/outcome")
        self.assertEqual(outcome_call["body"], {"status": "completed"})

    def test_block_raises_guard_blocked_error_and_skips_create_action(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "block", "reasons": ["Blocked by policy"]},
        })
        fn_called = []

        with self.assertRaises(GuardBlockedError):
            client.run_governed(
                {"kind": "shell", "command": "rm -rf /"},
                {"action_type": "security", "declared_goal": "g"},
                lambda: fn_called.append(1),
            )

        self.assertEqual(fn_called, [])
        self.assertFalse(any(c["path"] == "/api/actions" for c in client.calls))

    def test_waits_for_approval_by_default_when_pending(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "require_approval", "recorded": True, "action_id": "act_2"},
        })
        client._wait_for_approval_result = {"action": {"status": "running", "approved_by": "op"}}

        result = client.run_governed(
            {"kind": "shell", "command": "rm x"},
            {"action_type": "cleanup", "declared_goal": "g"},
            lambda: "ok",
        )

        self.assertEqual(result, "ok")
        self.assertEqual(client.wait_for_approval_calls, ["act_2"])
        self.assertFalse(any(c["path"] == "/api/actions" for c in client.calls))

    def test_wait_false_on_pending_approval_raises_and_never_runs_fn(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "require_approval", "recorded": True, "action_id": "act_3"},
        })
        fn_called = []

        with self.assertRaises(ApprovalPendingError) as ctx:
            client.run_governed(
                {"kind": "shell", "command": "rm x"},
                {"action_type": "cleanup", "declared_goal": "g", "wait": False},
                lambda: fn_called.append(True) or "ok",
            )

        self.assertEqual(ctx.exception.action_id, "act_3")
        self.assertEqual(fn_called, [])
        self.assertEqual(client.wait_for_approval_calls, [])
        self.assertFalse(any(c["path"] == "/api/actions" for c in client.calls))
        guard_call = next(c for c in client.calls if c["path"] == "/api/guard")
        self.assertNotIn("wait", guard_call["body"])

    def test_wait_false_with_allow_decision_runs_fn_normally(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "allow", "recorded": True, "action_id": "act_3b"},
        })

        result = client.run_governed(
            {"kind": "shell", "command": "ls"},
            {"action_type": "cleanup", "declared_goal": "g", "wait": False},
            lambda: "ok",
        )

        self.assertEqual(result, "ok")
        self.assertEqual(client.wait_for_approval_calls, [])

    def test_propagates_approval_denied_without_calling_fn_or_reporting_outcome(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "require_approval", "recorded": True, "action_id": "act_5"},
        })
        client._wait_for_approval_error = ApprovalDeniedError("Denied", "cancelled")
        fn_called = []

        with self.assertRaises(ApprovalDeniedError):
            client.run_governed(
                {"kind": "shell", "command": "rm x"},
                {"action_type": "cleanup", "declared_goal": "g"},
                lambda: fn_called.append(1),
            )

        self.assertEqual(fn_called, [])
        self.assertFalse(any(c["path"].endswith("/outcome") for c in client.calls))

    def test_reports_failed_outcome_and_reraises_when_fn_throws(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "allow", "recorded": True, "action_id": "act_6"},
        })

        def boom():
            raise ValueError("boom")

        with self.assertRaises(ValueError):
            client.run_governed(
                {"kind": "shell", "command": "ls"},
                {"action_type": "other", "declared_goal": "g"},
                boom,
            )

        outcome_call = next(c for c in client.calls if c["path"] == "/api/actions/act_6/outcome")
        self.assertEqual(outcome_call["body"], {"status": "failed", "error_message": "boom"})

    def test_scrubs_the_act_before_sending_to_guard_and_create_action_on_fallback(self):
        client = RecordingDashClaw(responses={
            ("POST", "/api/guard"): {"decision": "allow", "recorded": False},
            ("POST", "/api/actions"): {"action_id": "act_7", "action": {"status": "running"}},
        })

        client.run_governed(
            {"kind": "shell", "command": 'curl -H "Authorization: Bearer sk-aaaaaaaaaaaa" https://x'},
            {"action_type": "other", "declared_goal": "g"},
            lambda: 1,
        )

        guard_call = next(c for c in client.calls if c["path"] == "/api/guard")
        self.assertNotIn("sk-aaaaaaaaaaaa", guard_call["body"]["act"]["command"])
        create_call = next(c for c in client.calls if c["path"] == "/api/actions")
        self.assertNotIn("sk-aaaaaaaaaaaa", create_call["body"]["act"]["command"])


if __name__ == "__main__":
    unittest.main()
