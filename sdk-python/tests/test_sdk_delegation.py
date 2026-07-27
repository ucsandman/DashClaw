"""
Unit tests for the delegation-constraint convenience wrapper of the Python SDK.

Mirrors the Node SDK's sdk-delegation.test.js to ensure parity across SDKs.
Uses a RecordingDashClaw that intercepts _request() calls instead of
hitting the network, so tests run instantly with zero dependencies.
"""

import unittest

from dashclaw.client import DashClaw


class RecordingDashClaw(DashClaw):
    """Subclass that captures _request calls instead of making HTTP requests."""

    def __init__(self, **overrides):
        defaults = {
            "base_url": "https://example.test",
            "api_key": "test-key",
            "agent_id": "claude-code",
        }
        defaults.update(overrides)
        super().__init__(**defaults)
        self.calls = []

    def _request(self, path, method="GET", body=None, json=None, **kwargs):
        payload = json or body
        self.calls.append({"path": path, "method": method, "body": payload, "params": kwargs.get("params")})
        return {"ok": True, "path": path, "method": method, "body": payload}


class TestCreateDelegationConstraint(unittest.TestCase):
    def test_posts_a_delegation_constraint_policy_to_policies(self):
        client = RecordingDashClaw()
        rules = {"parent": "claude-code", "child_types": ["*"], "max_risk_score": 40, "escalate_action": "require_approval"}
        client.create_delegation_constraint(rules)

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/policies")
        self.assertEqual(call["body"]["policy_type"], "delegation_constraint")
        self.assertEqual(call["body"]["rules"], rules)
        self.assertTrue(call["body"]["active"])
        self.assertEqual(call["body"]["name"], "Delegation constraint")
        self.assertNotIn("agent_ids", call["body"])

    def test_accepts_a_name_override(self):
        client = RecordingDashClaw()
        client.create_delegation_constraint({"parent": "*"}, name="ceiling")

        call = client.calls[-1]
        self.assertEqual(call["body"]["name"], "ceiling")

    def test_includes_agent_ids_only_when_given(self):
        client = RecordingDashClaw()
        client.create_delegation_constraint({"parent": "*"}, agent_ids=["claude-code", "claude-code:explore"])

        call = client.calls[-1]
        self.assertEqual(call["body"]["agent_ids"], ["claude-code", "claude-code:explore"])


if __name__ == "__main__":
    unittest.main()
