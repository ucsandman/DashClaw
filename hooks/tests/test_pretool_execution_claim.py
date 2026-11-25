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

    # --- transient-failure handling (2026-09-15) ---------------------------------
    #
    # A server 500 is not a refusal. On 2026-09-14 a Postgres 22P05 on the
    # claim path (one NUL in a payload, see app/lib/pg-text.js) made every
    # claim answer 500, and the hook reported an ambiguous claim and blocked
    # five tool calls. The database makes a claim one-shot on its own, so a
    # transient failure is worth a second attempt.

    def test_transient_failure_is_retried_and_can_still_claim(self):
        seen = []

        def response(method, path, body=None, **kwargs):
            self.assertTrue(kwargs.get("distinguish_transient"))
            seen.append(body["attempt_id"])
            if len(seen) == 1:
                return self.hook.TRANSIENT_FAILED
            return {"claimed": True, "action_id": "act_1", "attempt_id": body["attempt_id"]}

        with mock.patch.object(self.hook, "api_request", side_effect=response) as request:
            self.assertTrue(self.hook._claim_execution("act_1", {}))
        self.assertEqual(request.call_count, 2)
        # Each attempt carries its own nonce; the server binds the claim to one.
        self.assertEqual(len(set(seen)), 2)

    def test_a_refusal_blocks_on_the_first_answer_without_a_readback(self):
        with mock.patch.object(self.hook, "api_request", return_value=None) as request,                 mock.patch.object(self.hook, "get_action") as get_action:
            self.assertFalse(self.hook._claim_execution("act_1", {}))
        self.assertEqual(request.call_count, 1)
        self.assertEqual(get_action.call_count, 0)

    def test_lost_response_is_reconciled_by_reading_our_own_attempt_back(self):
        seen = []

        def response(method, path, body=None, **kwargs):
            seen.append(body["attempt_id"])
            return self.hook.TRANSIENT_FAILED if len(seen) == 1 else None

        with mock.patch.object(self.hook, "api_request", side_effect=response),                 mock.patch.object(self.hook, "get_action") as get_action:
            get_action.side_effect = lambda action_id: {"action": {
                "execution_claimed_at": "2026-09-15T00:00:00Z",
                "execution_attempt_id": seen[0],
            }}
            self.assertTrue(self.hook._claim_execution("act_1", {}))
        self.assertEqual(get_action.call_count, 1)

    def test_a_claim_held_by_someone_else_is_never_accepted_as_ours(self):
        def response(method, path, body=None, **kwargs):
            return self.hook.TRANSIENT_FAILED

        with mock.patch.object(self.hook, "api_request", side_effect=response) as request,                 mock.patch.object(self.hook, "get_action", return_value={"action": {
                    "execution_claimed_at": "2026-09-15T00:00:00Z",
                    "execution_attempt_id": "some-other-agents-attempt",
                }}):
            self.assertFalse(self.hook._claim_execution("act_1", {}))
        self.assertEqual(request.call_count, 2)

    def test_an_unclaimed_row_after_two_transient_failures_still_blocks(self):
        with mock.patch.object(self.hook, "api_request", return_value=self.hook.TRANSIENT_FAILED),                 mock.patch.object(self.hook, "get_action", return_value={"action": {
                    "execution_claimed_at": None, "execution_attempt_id": None,
                }}):
            self.assertFalse(self.hook._claim_execution("act_1", {}))

    # --- an unresolved claim is not a conflict (2026-09-15) ----------------------
    #
    # The guard has already allowed the call by this point; the claim is the
    # ledger's exactly-once stamp, not the authorization. Only a claim held by
    # ANOTHER attempt may take the tool call away. Before this, every refusal
    # blocked, and a day of Bash and Edit calls died on my-dashclaw labelled
    # EXECUTION_CLAIM_CONFLICT without one competing executor among them.

    def _authorize_unresolved(self, row, guard_extra=None, policy="proceed"):
        """Drive _authorize_execution through a refused folded claim, with
        `row` as what GET /api/actions/<id> reports. Returns (calls, logged)."""
        calls = []

        def response(method, path, body=None, **kwargs):
            calls.append((method, path, body))
            if path.endswith("/cancel"):
                return {"ok": True, "action_id": "act_1", "status": "cancelled"}
            return None

        guard_resp = {
            "execution_claim_required": True, "claim_protocol": 1,
            "claimed": False, "attempt_id": "attempt-1234567890",
            "claim_error": "EXECUTION_CLAIM_CONFLICT",
        }
        guard_resp.update(guard_extra or {})
        with (
            mock.patch.object(self.hook, "write_action_id"),
            mock.patch.object(self.hook, "append_turn_action"),
            mock.patch.object(self.hook, "EXECUTION_CLAIM_POLICY", policy),
            mock.patch.object(self.hook, "_log_hook_error") as logged,
            mock.patch.object(self.hook, "get_action", return_value=row) as get_action,
            mock.patch.object(self.hook, "api_request", side_effect=response),
        ):
            raised = None
            try:
                self.hook._authorize_execution(
                    "act_1", {"attempt_id": "attempt-1234567890"}, "tool_1", guard_resp)
            except SystemExit as exc:
                raised = exc
        return calls, logged, get_action, raised

    def test_a_claim_held_by_another_attempt_blocks_and_cancels_the_row(self):
        calls, logged, _, raised = self._authorize_unresolved({"action": {
            "execution_claimed_at": "2026-09-15T00:00:00Z",
            "execution_attempt_id": "some-other-agents-attempt",
        }})
        self.assertIsNotNone(raised)
        self.assertEqual(raised.code, 2)
        self.assertIn(("POST", "/api/actions/act_1/cancel", {"reason": mock.ANY}), calls)
        self.assertTrue(any("execution_claim_conflict" in str(c.args[0]) for c in logged.call_args_list))

    def test_a_refused_claim_with_no_competing_attempt_proceeds(self):
        calls, logged, _, raised = self._authorize_unresolved({"action": {
            "execution_claimed_at": None, "execution_attempt_id": None,
        }})
        self.assertIsNone(raised)
        # Nothing is abandoned: the row stays open for the outcome patch, and
        # a refused claim is still never retried as a PATCH.
        self.assertEqual(calls, [])
        self.assertTrue(any("execution_claim_unresolved" in str(c.args[0]) for c in logged.call_args_list))

    def test_an_unreadable_row_is_not_evidence_of_a_second_executor(self):
        # Failing to READ the row is the same class of fault as failing to
        # claim it. Neither proves a competing attempt, so neither may block.
        calls, _, _, raised = self._authorize_unresolved(None)
        self.assertIsNone(raised)
        self.assertEqual(calls, [])

    def test_the_row_decides_a_conflict_not_the_servers_label(self):
        # The first cut of the server-side reason codes called a genuine second
        # claim "unavailable" (the candidate query skips already-claimed rows,
        # so a real conflict arrives as "no candidate"). The hook reads the row
        # either way, so a wrong label cannot let a second executor through.
        calls, _, get_action, raised = self._authorize_unresolved(
            {"action": {"execution_claimed_at": "2026-09-15T00:00:00Z",
                        "execution_attempt_id": "someone-elses-attempt"}},
            guard_extra={"claim_error": "EXECUTION_CLAIM_UNAVAILABLE", "claim_reason": "no_candidate"})
        self.assertEqual(get_action.call_count, 1)
        self.assertIsNotNone(raised)
        self.assertEqual(raised.code, 2)
        self.assertIn(("POST", "/api/actions/act_1/cancel", {"reason": mock.ANY}), calls)

    def test_strict_policy_restores_the_old_block(self):
        calls, logged, _, raised = self._authorize_unresolved({"action": {
            "execution_claimed_at": None, "execution_attempt_id": None,
        }}, policy="block")
        self.assertIsNotNone(raised)
        self.assertEqual(raised.code, 2)
        self.assertIn(("POST", "/api/actions/act_1/cancel", {"reason": mock.ANY}), calls)

    def test_a_failed_cancel_is_logged_and_never_raises(self):
        with mock.patch.object(self.hook, "api_request", return_value=None),                 mock.patch.object(self.hook, "_log_hook_error") as logged:
            self.hook._abandon_unclaimed_action("act_1", "execution claim unresolved")
        self.assertEqual(logged.call_count, 1)

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

    def test_refused_folded_claim_is_never_retried_as_a_patch(self):
        context = {"attempt_id": "attempt-1234567890"}
        with (
            mock.patch.object(self.hook, "write_action_id"),
            mock.patch.object(self.hook, "append_turn_action"),
            mock.patch.object(self.hook, "get_action", return_value={"action": {
                "execution_claimed_at": None, "execution_attempt_id": None}}),
            mock.patch.object(self.hook, "api_request") as request,
        ):
            self.hook._authorize_execution("act_1", context, "tool_1", {
                "execution_claim_required": True, "claim_protocol": 1,
                "claimed": False, "attempt_id": "attempt-1234567890", "claim_error": "EXECUTION_CLAIM_CONFLICT",
            })
        # No PATCH retry of a refusal, and no cancel: nothing was abandoned.
        self.assertEqual(request.call_args_list, [])

    def test_legacy_server_without_folded_claim_still_patches(self):
        context = {"attempt_id": "attempt-1234567890"}
        request = self._authorize({"execution_claim_required": True, "claim_protocol": 1}, context)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], "PATCH")
        self.assertEqual(request.call_args.args[1], "/api/actions/act_1")


class PretoolDenyNoteTests(unittest.TestCase):
    """A deny note typed on /approvals is stored as error_message; the denied
    agent must see it on stderr, not a fixed line."""

    @classmethod
    def setUpClass(cls):
        cls.hook = load_hook()

    def _wait_denied(self, action):
        import io
        err = io.StringIO()
        with (
            mock.patch.object(self.hook, "APPROVAL_TIMEOUT", 30),
            mock.patch.object(self.hook.time, "sleep"),
            mock.patch.object(self.hook, "get_action", return_value={"action": action}),
            mock.patch.object(sys, "stderr", err),
            self.assertRaises(SystemExit) as raised,
        ):
            self.hook._wait_for_approval("act_1", "tool_1", {}, {})
        return raised.exception.code, err.getvalue()

    def test_denied_action_prints_the_operator_note(self):
        code, err = self._wait_denied({"status": "failed", "error_message": "use the staging branch"})
        self.assertEqual(code, 2)
        self.assertIn("[DashClaw] Denied by operator: use the staging branch", err)

    def test_cancelled_action_prints_the_operator_note(self):
        code, err = self._wait_denied({"status": "cancelled", "error_message": "use the staging branch"})
        self.assertEqual(code, 2)
        self.assertIn("use the staging branch", err)

    def test_server_default_reason_is_not_printed_as_a_note(self):
        code, err = self._wait_denied({"status": "failed", "error_message": "Denied by human operator"})
        self.assertEqual(code, 2)
        self.assertIn("[DashClaw] Action denied by operator.", err)
        self.assertNotIn("Denied by operator: Denied by human operator", err)

    def test_denied_action_without_a_note_keeps_the_old_line(self):
        code, err = self._wait_denied({"status": "failed"})
        self.assertEqual(code, 2)
        self.assertIn("[DashClaw] Action denied by operator.", err)


if __name__ == "__main__":
    unittest.main()
