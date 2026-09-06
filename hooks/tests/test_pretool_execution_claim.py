import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
HOOK_PATH = REPO_ROOT / "hooks" / "dashclaw_pretool.py"


def load_hook():
    old_env = os.environ.copy()
    old_argv = sys.argv[:]
    try:
        os.environ.update({
            "DASHCLAW_DISABLE_DOTENV": "1",
            "DASHCLAW_BASE_URL": "https://dashclaw.test",
            "DASHCLAW_API_KEY": "test-key",
            "DASHCLAW_HOOK_MODE": "enforce",
        })
        sys.argv = [str(HOOK_PATH)]
        spec = importlib.util.spec_from_file_location("dashclaw_pretool_claim_test", HOOK_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        os.environ.clear()
        os.environ.update(old_env)
        sys.argv = old_argv


class PretoolExecutionClaimTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hook = load_hook()

    def test_advertises_execution_claims_while_preserving_containment_caps(self):
        context = {}
        with (
            mock.patch.object(self.hook, "CONTAINMENT_ENABLED", True),
            mock.patch.object(self.hook, "HOOK_MODE", "enforce"),
            mock.patch.object(self.hook, "_is_git_repo", return_value=True),
            mock.patch.object(self.hook, "_db_containment_available", return_value=True),
        ):
            self.hook._attach_client_capabilities(context, "Bash", {"command": "echo ok"})
        self.assertEqual(
            context["client_capabilities"],
            ["execution_claims", "allow_contained", "allow_contained:db"],
        )

    def test_missing_claim_protocol_blocks_with_upgrade_diagnostic(self):
        with mock.patch.dict(os.environ, {"DASHCLAW_REQUIRE_EXECUTION_CLAIMS": "1"}), self.assertRaises(SystemExit) as raised:
            self.hook._require_execution_claim_protocol("allow", {})
        self.assertEqual(raised.exception.code, 2)

    def test_legacy_server_preserves_enforcement_during_staged_rollout(self):
        with mock.patch.dict(os.environ, {"DASHCLAW_REQUIRE_EXECUTION_CLAIMS": "0"}):
            for decision in ("allow", "warn", "require_approval", "block"):
                self.hook._require_execution_claim_protocol(decision, {"decision": decision})

    def test_advertised_unknown_protocol_cannot_downgrade_to_legacy(self):
        with mock.patch.dict(os.environ, {"DASHCLAW_REQUIRE_EXECUTION_CLAIMS": "0"}), self.assertRaises(SystemExit) as raised:
            self.hook._require_execution_claim_protocol("allow", {
                "execution_claim_required": True, "claim_protocol": 2,
            })
        self.assertEqual(raised.exception.code, 2)

    def test_claim_uses_one_non_retrying_patch_and_requires_exact_echo(self):
        context = {"act": {"kind": "shell", "command": "echo ok"}}

        def response(method, path, body=None, **kwargs):
            self.assertEqual(method, "PATCH")
            self.assertEqual(path, "/api/actions/act_1")
            self.assertEqual(kwargs.get("retries"), 0)
            self.assertTrue(body["claim_execution"])
            self.assertEqual(body["agent_id"], self.hook.AGENT_ID)
            self.assertEqual(body["act"], context["act"])
            return {
                "claimed": True,
                "action_id": "act_1",
                "attempt_id": body["attempt_id"],
            }

        with mock.patch.object(self.hook, "api_request", side_effect=response) as request:
            self.assertTrue(self.hook._claim_execution("act_1", context))
        self.assertEqual(request.call_count, 1)

    def test_claim_carries_the_recorded_subagent_identity(self):
        # Regression: a haiku-scout leaf call is recorded as claude-code:haiku-scout,
        # so the claim must not fall back to the bare parent id (2026-09-05).
        context = {"act": {"kind": "shell", "command": "echo probe"}}
        with mock.patch.object(self.hook, "SUBAGENT_IDENTITY", "distinct"):
            self.hook._apply_distinct_subagent_id(context, "haiku-scout")
        self.assertEqual(context["agent_id"], self.hook.AGENT_ID + ":haiku-scout")
        seen = {}

        def response(method, path, body=None, **kwargs):
            seen.update(body)
            return {"claimed": True, "action_id": "act_1", "attempt_id": body["attempt_id"]}

        with mock.patch.object(self.hook, "api_request", side_effect=response):
            self.assertTrue(self.hook._claim_execution("act_1", context))
        self.assertEqual(seen["agent_id"], self.hook.AGENT_ID + ":haiku-scout")

    def test_claim_rejects_response_loss_conflict_and_malformed_echo(self):
        responses = (
            None,
            {"claimed": False, "action_id": "act_1", "attempt_id": "wrong"},
            {"claimed": True, "action_id": "act_other", "attempt_id": "wrong"},
            {},
        )
        for response in responses:
            with self.subTest(response=response):
                with mock.patch.object(self.hook, "api_request", return_value=response) as request:
                    self.assertFalse(self.hook._claim_execution("act_1", {}))
                self.assertEqual(request.call_count, 1)

    # --- folded claim (5.35): the guard call carries the claim, no PATCH ---------

    def test_guard_context_asks_for_a_folded_claim(self):
        context = {}
        self.hook._request_folded_claim(context)
        self.assertIs(context["claim_execution"], True)
        # Same shape PATCH /api/actions/[actionId] enforces for attempt_id.
        self.assertRegex(context["attempt_id"], r"^[A-Za-z0-9_-]{16,128}$")

    def test_folded_claim_outcome_true_false_none(self):
        context = {"attempt_id": "attempt-1234567890"}
        self.assertIs(self.hook._folded_claim_outcome(
            {"claimed": True, "action_id": "act_1", "attempt_id": "attempt-1234567890"}, "act_1", context), True)
        # Refused by the server: the PATCH would answer 409; never retry.
        self.assertIs(self.hook._folded_claim_outcome(
            {"claimed": False, "attempt_id": "attempt-1234567890", "claim_error": "EXECUTION_CLAIM_CONFLICT"}, "act_1", context), False)
        # Echo for another attempt or another action is not this call's claim.
        self.assertIs(self.hook._folded_claim_outcome(
            {"claimed": True, "action_id": "act_1", "attempt_id": "other-1234567890"}, "act_1", context), False)
        self.assertIs(self.hook._folded_claim_outcome(
            {"claimed": True, "action_id": "act_2", "attempt_id": "attempt-1234567890"}, "act_1", context), False)
        # Legacy server, or a verdict the server leaves to the PATCH.
        self.assertIsNone(self.hook._folded_claim_outcome({"execution_claim_required": True}, "act_1", context))
        self.assertIsNone(self.hook._folded_claim_outcome(None, "act_1", context))

    def _authorize(self, guard_resp, context):
        with (
            mock.patch.object(self.hook, "write_action_id"),
            mock.patch.object(self.hook, "append_turn_action"),
            mock.patch.object(self.hook, "api_request", side_effect=lambda method, path, body=None, **kw: {"claimed": True, "action_id": "act_1", "attempt_id": body["attempt_id"]}) as request,
        ):
            self.hook._authorize_execution("act_1", context, "tool_1", guard_resp)
            return request

    def test_folded_claim_skips_the_patch(self):
        context = {"attempt_id": "attempt-1234567890"}
        request = self._authorize({
            "execution_claim_required": True, "claim_protocol": 1,
            "claimed": True, "action_id": "act_1", "attempt_id": "attempt-1234567890",
        }, context)
        self.assertEqual(request.call_count, 0)

    def test_refused_folded_claim_blocks_without_a_patch(self):
        context = {"attempt_id": "attempt-1234567890"}
        with (
            mock.patch.object(self.hook, "write_action_id"),
            mock.patch.object(self.hook, "append_turn_action"),
            mock.patch.object(self.hook, "api_request") as request,
            self.assertRaises(SystemExit) as raised,
        ):
            self.hook._authorize_execution("act_1", context, "tool_1", {
                "execution_claim_required": True, "claim_protocol": 1,
                "claimed": False, "attempt_id": "attempt-1234567890", "claim_error": "EXECUTION_CLAIM_CONFLICT",
            })
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(request.call_count, 0)

    def test_legacy_server_without_folded_claim_still_patches(self):
        context = {"attempt_id": "attempt-1234567890"}
        request = self._authorize({"execution_claim_required": True, "claim_protocol": 1}, context)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], "PATCH")
        self.assertEqual(request.call_args.args[1], "/api/actions/act_1")


if __name__ == "__main__":
    unittest.main()
