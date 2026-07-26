"""
Unit tests for the preflight-plan-authorization surface of the Python SDK.

Mirrors the Node SDK's sdk-plans.test.js to ensure parity across SDKs.
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
            "agent_id": "agent-1",
        }
        defaults.update(overrides)
        super().__init__(**defaults)
        self.calls = []

    def _request(self, path, method="GET", body=None, json=None, **kwargs):
        payload = json or body
        self.calls.append({"path": path, "method": method, "body": payload, "params": kwargs.get("params")})
        return {"ok": True, "path": path, "method": method, "body": payload}

    def _sign_payload(self, payload):
        """Disable signing in tests."""
        return None


class TestSubmitPlan(unittest.TestCase):
    def test_posts_to_plans_with_agent_id(self):
        client = RecordingDashClaw()
        client.submit_plan("ship it", [{"action_type": "deploy", "step_goal": "push"}])

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/plans")
        self.assertEqual(call["body"]["agent_id"], "agent-1")
        self.assertEqual(call["body"]["declared_goal"], "ship it")
        self.assertEqual(call["body"]["steps"], [{"action_type": "deploy", "step_goal": "push"}])

    def test_omits_ttl_minutes_when_not_provided(self):
        client = RecordingDashClaw()
        client.submit_plan("ship it", [])

        call = client.calls[-1]
        self.assertNotIn("ttl_minutes", call["body"])

    def test_includes_ttl_minutes_when_provided(self):
        client = RecordingDashClaw()
        client.submit_plan("ship it", [], ttl_minutes=60)

        call = client.calls[-1]
        self.assertEqual(call["body"]["ttl_minutes"], 60)


class WaitPlanClient(DashClaw):
    """Overrides get_plan directly (like WaitClient in test_client.py) so
    wait_for_plan_review's polling loop can be exercised without network."""

    def __init__(self, plans=None, **overrides):
        defaults = {
            "base_url": "https://example.test",
            "api_key": "test-key",
            "agent_id": "agent-1",
        }
        defaults.update(overrides)
        super().__init__(**defaults)
        self.plans = list(plans or [])
        self.get_plan_calls = 0

    def get_plan(self, plan_id):
        self.get_plan_calls += 1
        if len(self.plans) > 1:
            return self.plans.pop(0)
        return self.plans[0]


class TestWaitForPlanReview(unittest.TestCase):
    def test_polls_until_status_leaves_pending(self):
        client = WaitPlanClient(
            plans=[
                {"plan": {"status": "pending"}},
                {"plan": {"status": "approved"}, "steps": []},
            ]
        )
        result = client.wait_for_plan_review("p1", timeout=5, interval=0)
        self.assertEqual(result["plan"]["status"], "approved")
        self.assertEqual(client.get_plan_calls, 2)

    def test_returns_immediately_when_not_pending(self):
        res = {"plan": {"status": "denied"}}
        client = WaitPlanClient(plans=[res])
        result = client.wait_for_plan_review("p1", timeout=5, interval=0)
        self.assertEqual(result, res)
        self.assertEqual(client.get_plan_calls, 1)

    def test_times_out_raises_timeout_error(self):
        client = WaitPlanClient(plans=[{"plan": {"status": "pending"}}])
        with self.assertRaises(TimeoutError) as ctx:
            client.wait_for_plan_review("p1", timeout=0.01, interval=0)
        self.assertIn("p1", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
