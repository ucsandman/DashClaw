import unittest
from unittest.mock import patch

from dashclaw.client import DashClaw


class GuardRecordIdempotencyTests(unittest.TestCase):
    def test_recording_matches_creation_without_mutating_input(self):
        claw = DashClaw(base_url="https://example.test", api_key="test", agent_id="agent-1")
        context = {"action_type": "test", "declared_goal": "retry recording"}
        with patch.object(claw, "_request", return_value={}) as request, patch(
            "dashclaw.client.time.time", return_value=7200
        ):
            claw.guard(context, record=True)
            claw.guard(context, record=True)
            claw.create_action(**context)
        keys = [call.kwargs["json"].get("idempotency_key") for call in request.call_args_list]
        self.assertTrue(keys[0])
        self.assertEqual(len(set(keys)), 1)
        self.assertNotIn("idempotency_key", context)

    def test_explicit_key_and_evaluation_only(self):
        claw = DashClaw(base_url="https://example.test", api_key="test", agent_id="agent-1")
        with patch.object(claw, "_request", return_value={}) as request:
            claw.guard({"idempotency_key": "caller-key"}, record=True)
            claw.guard({"action_type": "test", "declared_goal": "evaluate only"})
        self.assertEqual(request.call_args_list[0].kwargs["json"]["idempotency_key"], "caller-key")
        self.assertNotIn("idempotency_key", request.call_args_list[1].kwargs["json"])
