"""
Unit tests for the Containment Verdicts surface of the Python SDK.

Mirrors the Node SDK's sdk-containment.test.js to ensure parity across SDKs.
Uses a RecordingDashClaw that intercepts _request() calls instead of hitting
the network, so tests run instantly with zero dependencies.
"""

import unittest

from dashclaw.client import DashClaw


class RecordingDashClaw(DashClaw):
    """Subclass that captures _request calls instead of making HTTP requests."""

    def __init__(self, **overrides):
        defaults = {
            "base_url": "https://example.test",
            "api_key": "test-key",
            "agent_id": "agent-1",
        }
        defaults.update(overrides)
        super().__init__(**defaults)
        self.calls = []

    def _request(self, path, method="GET", body=None, params=None, **kwargs):
        payload = kwargs.get("json", body)
        self.calls.append({"path": path, "method": method, "body": payload, "params": kwargs.get("params", params)})
        return {"ok": True, "path": path, "method": method, "body": payload}


class TestResolveContainment(unittest.TestCase):
    def test_posts_verdict_to_containment_endpoint(self):
        client = RecordingDashClaw()
        client.resolve_containment("act_1", "promote")

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/actions/act_1/containment")
        self.assertEqual(call["body"], {"verdict": "promote"})

    def test_accepts_discard(self):
        client = RecordingDashClaw()
        client.resolve_containment("act_2", "discard")

        call = client.calls[-1]
        self.assertEqual(call["body"], {"verdict": "discard"})

    def test_rejects_invalid_verdict_before_any_request(self):
        client = RecordingDashClaw()
        with self.assertRaises(ValueError):
            client.resolve_containment("act_1", "approve")
        self.assertEqual(client.calls, [])

    def test_does_not_send_client_capabilities(self):
        """Bare SDK callers have no staging machinery (RFC) — this SDK never
        advertises client_capabilities, so it never sees allow_contained."""
        client = RecordingDashClaw()
        client.resolve_containment("act_1", "promote")

        call = client.calls[-1]
        self.assertNotIn("client_capabilities", call["body"])


class TestListContained(unittest.TestCase):
    def test_defaults_to_awaiting_promotion(self):
        client = RecordingDashClaw()
        client.list_contained()

        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertIn("containment_status=awaiting_promotion", call["path"])

    def test_honors_explicit_status_and_limit(self):
        client = RecordingDashClaw()
        client.list_contained(status="contained", limit=10)

        call = client.calls[-1]
        self.assertIn("containment_status=contained", call["path"])
        self.assertIn("limit=10", call["path"])


if __name__ == "__main__":
    unittest.main()
