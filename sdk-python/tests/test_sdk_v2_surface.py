"""
Unit tests for the v2 governance surface of the Python SDK.

Mirrors the Node SDK's sdk-v2.test.js to ensure parity across SDKs.
Uses a RecordingDashClaw that intercepts _request() calls instead of
hitting the network, so tests run instantly with zero dependencies.
"""

import unittest
from datetime import datetime, timezone

from dashclaw.client import (
    DashClaw,
    DashClawError,
    GuardBlockedError,
    ApprovalDeniedError,
)


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
        self.calls.append({"path": path, "method": method, "body": payload})
        return {"ok": True, "path": path, "method": method, "body": payload}

    def _sign_payload(self, payload):
        """Disable signing in tests."""
        return None


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------

class TestConstructor(unittest.TestCase):
    def test_strips_trailing_slash(self):
        client = RecordingDashClaw(base_url="https://example.test/")
        self.assertEqual(client.base_url, "https://example.test")

    def test_strips_multiple_trailing_slashes(self):
        client = RecordingDashClaw(base_url="https://example.test///")
        # rstrip("/") removes all trailing slashes
        self.assertFalse(client.base_url.endswith("/"))

    def test_rejects_invalid_guard_mode(self):
        with self.assertRaises(ValueError) as ctx:
            RecordingDashClaw(guard_mode="yolo")
        self.assertIn("guard_mode", str(ctx.exception))

    def test_accepts_valid_guard_modes(self):
        for mode in ("off", "warn", "enforce"):
            client = RecordingDashClaw(guard_mode=mode)
            self.assertEqual(client.guard_mode, mode)

    def test_stores_agent_id(self):
        client = RecordingDashClaw(agent_id="custom-agent")
        self.assertEqual(client.agent_id, "custom-agent")

    def test_stores_optional_fields(self):
        client = RecordingDashClaw(agent_name="TestBot", swarm_id="swarm-1")
        self.assertEqual(client.agent_name, "TestBot")
        self.assertEqual(client.swarm_id, "swarm-1")


# ---------------------------------------------------------------------------
# guard
# ---------------------------------------------------------------------------

class TestGuard(unittest.TestCase):
    def test_posts_to_guard_with_agent_id(self):
        client = RecordingDashClaw()
        client.guard({"action": "send_email", "target": "user@example.com"})

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/guard")
        self.assertEqual(call["body"]["agent_id"], "agent-1")
        self.assertEqual(call["body"]["action"], "send_email")

    def test_allows_overriding_agent_id(self):
        client = RecordingDashClaw()
        client.guard({"action": "deploy", "agent_id": "agent-override"})

        call = client.calls[-1]
        self.assertEqual(call["body"]["agent_id"], "agent-override")


# ---------------------------------------------------------------------------
# create_action
# ---------------------------------------------------------------------------

class TestCreateAction(unittest.TestCase):
    def test_posts_to_actions_with_agent_id(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "Fetch weather data")

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/actions")
        self.assertEqual(call["body"]["action_type"], "api_call")
        self.assertEqual(call["body"]["declared_goal"], "Fetch weather data")
        self.assertEqual(call["body"]["agent_id"], "agent-1")

    def test_passes_kwargs_through(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "goal", risk_level="high", tags=["important"])

        call = client.calls[-1]
        self.assertEqual(call["body"]["risk_level"], "high")
        self.assertEqual(call["body"]["tags"], ["important"])

    def test_includes_session_id_when_provided(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "goal", session_id="sess_7")
        call = client.calls[-1]
        self.assertEqual(call["body"]["session_id"], "sess_7")

    def test_omits_session_id_when_not_provided(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "goal")
        call = client.calls[-1]
        self.assertNotIn("session_id", call["body"])

    def test_session_id_is_a_named_parameter(self):
        import inspect
        params = inspect.signature(DashClaw.create_action).parameters
        self.assertIn("session_id", params)


# ---------------------------------------------------------------------------
# update_outcome
# ---------------------------------------------------------------------------

class TestUpdateOutcome(unittest.TestCase):
    def test_patches_action_with_status(self):
        client = RecordingDashClaw()
        client.update_outcome("act_123", status="completed")

        call = client.calls[-1]
        self.assertEqual(call["method"], "PATCH")
        self.assertEqual(call["path"], "/api/actions/act_123")
        self.assertEqual(call["body"]["status"], "completed")

    def test_includes_timestamp_end_automatically(self):
        client = RecordingDashClaw()
        before = datetime.now(timezone.utc)
        client.update_outcome("act_123", status="completed")
        after = datetime.now(timezone.utc)

        ts = client.calls[-1]["body"]["timestamp_end"]
        self.assertIsNotNone(ts)
        self.assertTrue(ts.endswith("Z"))

    def test_preserves_explicit_timestamp_end(self):
        client = RecordingDashClaw()
        explicit_ts = "2025-01-01T00:00:00Z"
        client.update_outcome("act_123", status="completed", timestamp_end=explicit_ts)

        self.assertEqual(client.calls[-1]["body"]["timestamp_end"], explicit_ts)

    def test_accepts_dict_as_first_status_arg(self):
        client = RecordingDashClaw()
        client.update_outcome("act_123", {"status": "failed", "error": "timeout"})

        call = client.calls[-1]
        self.assertEqual(call["body"]["status"], "failed")
        self.assertEqual(call["body"]["error"], "timeout")


# ---------------------------------------------------------------------------
# Durable execution finality — Phase 4 wrappers
# ---------------------------------------------------------------------------

class TestReportActionOutcome(unittest.TestCase):
    def test_posts_completed_to_outcome_route(self):
        client = RecordingDashClaw()
        client.report_action_outcome("act_1", "completed", summary="shipped")
        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/actions/act_1/outcome")
        self.assertEqual(call["body"], {"status": "completed", "summary": "shipped"})

    def test_posts_failed_with_error_message(self):
        client = RecordingDashClaw()
        client.report_action_outcome("act_1", "failed", error_message="boom")
        body = client.calls[-1]["body"]
        self.assertEqual(body, {"status": "failed", "error_message": "boom"})

    def test_posts_partial_with_progress(self):
        client = RecordingDashClaw()
        client.report_action_outcome("act_1", "partial", progress={"step": 2})
        body = client.calls[-1]["body"]
        self.assertEqual(body, {"status": "partial", "progress": {"step": 2}})

    def test_omits_optional_fields_when_not_provided(self):
        client = RecordingDashClaw()
        client.report_action_outcome("act_1", "completed")
        body = client.calls[-1]["body"]
        self.assertEqual(body, {"status": "completed"})


class TestGetActionOutcome(unittest.TestCase):
    def test_gets_outcome_route(self):
        client = RecordingDashClaw()
        client.get_action_outcome("act_1")
        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["path"], "/api/actions/act_1/outcome")


class TestReportActionConvenienceWrappers(unittest.TestCase):
    def test_report_action_success(self):
        client = RecordingDashClaw()
        client.report_action_success("act_1", summary="shipped")
        body = client.calls[-1]["body"]
        self.assertEqual(body, {"status": "completed", "summary": "shipped"})

    def test_report_action_failure_requires_error_message(self):
        client = RecordingDashClaw()
        client.report_action_failure("act_1", "boom", summary="context")
        body = client.calls[-1]["body"]
        self.assertEqual(
            body,
            {"status": "failed", "summary": "context", "error_message": "boom"},
        )

    def test_report_action_partial_requires_progress(self):
        client = RecordingDashClaw()
        client.report_action_partial("act_1", {"step": 2}, summary="halfway")
        body = client.calls[-1]["body"]
        self.assertEqual(
            body,
            {"status": "partial", "summary": "halfway", "progress": {"step": 2}},
        )


class TestDeriveIdempotencyKey(unittest.TestCase):
    def test_returns_identical_hash_for_identical_inputs(self):
        a = DashClaw.derive_idempotency_key({"agent_id": "a", "action_type": "deploy"})
        b = DashClaw.derive_idempotency_key({"agent_id": "a", "action_type": "deploy"})
        self.assertEqual(a, b)
        self.assertEqual(len(a), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in a))

    def test_differs_when_input_changes(self):
        a = DashClaw.derive_idempotency_key({"agent_id": "a", "action_type": "deploy"})
        b = DashClaw.derive_idempotency_key({"agent_id": "a", "action_type": "plan"})
        self.assertNotEqual(a, b)

    def test_is_order_independent_across_key_insertion(self):
        a = DashClaw.derive_idempotency_key({"x": 1, "y": 2})
        b = DashClaw.derive_idempotency_key({"y": 2, "x": 1})
        self.assertEqual(a, b)

    def test_rejects_non_dict_input(self):
        with self.assertRaises(TypeError):
            DashClaw.derive_idempotency_key("foo")
        with self.assertRaises(TypeError):
            DashClaw.derive_idempotency_key(None)


# ---------------------------------------------------------------------------
# record_assumption
# ---------------------------------------------------------------------------

class TestRecordAssumption(unittest.TestCase):
    def test_posts_assumption_dict(self):
        client = RecordingDashClaw()
        assumption = {"action_id": "act_1", "assumption": "User is authenticated"}
        client.record_assumption(assumption)

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/assumptions")
        self.assertEqual(call["body"], assumption)


# ---------------------------------------------------------------------------
# heartbeat
# ---------------------------------------------------------------------------

class TestHeartbeat(unittest.TestCase):
    def test_posts_with_defaults(self):
        client = RecordingDashClaw()
        client.heartbeat()

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/agents/heartbeat")
        self.assertEqual(call["body"]["agent_id"], "agent-1")
        self.assertEqual(call["body"]["status"], "online")
        self.assertIsNone(call["body"]["current_task_id"])
        self.assertIsNone(call["body"]["metadata"])

    def test_accepts_custom_status_and_metadata(self):
        client = RecordingDashClaw()
        meta = {"cpu": 0.8, "memory": "512MB"}
        client.heartbeat(status="busy", current_task_id="task_42", metadata=meta)

        call = client.calls[-1]
        self.assertEqual(call["body"]["status"], "busy")
        self.assertEqual(call["body"]["current_task_id"], "task_42")
        self.assertEqual(call["body"]["metadata"], meta)

    def test_includes_agent_name_when_set(self):
        client = RecordingDashClaw(agent_name="WeatherBot")
        client.heartbeat()

        self.assertEqual(client.calls[-1]["body"]["agent_name"], "WeatherBot")


# ---------------------------------------------------------------------------
# report_connections
# ---------------------------------------------------------------------------

class TestReportConnections(unittest.TestCase):
    def test_posts_formatted_connections(self):
        client = RecordingDashClaw()
        connections = [
            {"provider": "openai", "auth_type": "api_key", "status": "active"},
            {"provider": "slack", "authType": "oauth", "plan_name": "pro"},
        ]
        client.report_connections(connections)

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/agents/connections")
        self.assertEqual(call["body"]["agent_id"], "agent-1")
        self.assertEqual(len(call["body"]["connections"]), 2)
        self.assertEqual(call["body"]["connections"][0]["provider"], "openai")
        # authType should be normalized to auth_type
        self.assertEqual(call["body"]["connections"][1]["auth_type"], "oauth")


# ---------------------------------------------------------------------------
# register_open_loop
# ---------------------------------------------------------------------------

class TestRegisterOpenLoop(unittest.TestCase):
    def test_posts_loop_payload(self):
        client = RecordingDashClaw()
        client.register_open_loop("act_1", "dependency", "Waiting for approval")

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/actions/loops")
        self.assertEqual(call["body"]["action_id"], "act_1")
        self.assertEqual(call["body"]["loop_type"], "dependency")
        self.assertEqual(call["body"]["description"], "Waiting for approval")

    def test_passes_kwargs_through(self):
        client = RecordingDashClaw()
        client.register_open_loop("act_1", "dependency", "desc", priority="high")

        self.assertEqual(client.calls[-1]["body"]["priority"], "high")


# ---------------------------------------------------------------------------
# resolve_open_loop
# ---------------------------------------------------------------------------

class TestResolveOpenLoop(unittest.TestCase):
    def test_patches_loop_with_status_and_resolution(self):
        client = RecordingDashClaw()
        client.resolve_open_loop("loop_1", "resolved", resolution="Approval received")

        call = client.calls[-1]
        self.assertEqual(call["method"], "PATCH")
        self.assertEqual(call["path"], "/api/actions/loops/loop_1")
        self.assertEqual(call["body"]["status"], "resolved")
        self.assertEqual(call["body"]["resolution"], "Approval received")

    def test_resolution_defaults_to_none(self):
        client = RecordingDashClaw()
        client.resolve_open_loop("loop_1", "abandoned")

        self.assertIsNone(client.calls[-1]["body"]["resolution"])


# ---------------------------------------------------------------------------
# get_signals
# ---------------------------------------------------------------------------

class TestGetSignals(unittest.TestCase):
    def test_get_request_to_signals(self):
        client = RecordingDashClaw()
        client.get_signals()

        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["path"], "/api/actions/signals")
        self.assertIsNone(call["body"])


# ---------------------------------------------------------------------------
# create_webhook
# ---------------------------------------------------------------------------

class TestCreateWebhook(unittest.TestCase):
    def test_posts_url_and_events(self):
        client = RecordingDashClaw()
        client.create_webhook("https://hooks.test/inbound", events=["action.created"])

        call = client.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/webhooks")
        self.assertEqual(call["body"]["url"], "https://hooks.test/inbound")
        self.assertEqual(call["body"]["events"], ["action.created"])

    def test_omits_events_when_none(self):
        client = RecordingDashClaw()
        client.create_webhook("https://hooks.test/inbound")

        call = client.calls[-1]
        self.assertEqual(call["body"], {"url": "https://hooks.test/inbound"})
        self.assertNotIn("events", call["body"])


# ---------------------------------------------------------------------------
# map_compliance
# ---------------------------------------------------------------------------

class TestMapCompliance(unittest.TestCase):
    def test_get_with_framework_param(self):
        client = RecordingDashClaw()
        client.map_compliance("SOC2")

        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertIn("/api/compliance/map", call["path"])
        self.assertIn("framework=SOC2", call["path"])

    def test_url_encodes_framework(self):
        client = RecordingDashClaw()
        client.map_compliance("ISO 27001")

        call = client.calls[-1]
        self.assertIn("framework=ISO%2027001", call["path"])


# ---------------------------------------------------------------------------
# get_proof_report
# ---------------------------------------------------------------------------

class TestGetProofReport(unittest.TestCase):
    def test_defaults_to_json_format(self):
        client = RecordingDashClaw()
        client.get_proof_report()

        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertIn("format=json", call["path"])

    def test_accepts_custom_format(self):
        client = RecordingDashClaw()
        client.get_proof_report(format="pdf")

        self.assertIn("format=pdf", client.calls[-1]["path"])


# ---------------------------------------------------------------------------
# get_activity_logs
# ---------------------------------------------------------------------------

class TestGetActivityLogs(unittest.TestCase):
    def test_get_without_filters(self):
        client = RecordingDashClaw()
        client.get_activity_logs()

        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["path"], "/api/activity")

    def test_get_with_filters(self):
        client = RecordingDashClaw()
        client.get_activity_logs(agent_id="agent-1", limit=50)

        call = client.calls[-1]
        self.assertIn("/api/activity?", call["path"])
        self.assertIn("agent_id=agent-1", call["path"])
        self.assertIn("limit=50", call["path"])

    def test_ignores_none_filters(self):
        client = RecordingDashClaw()
        client.get_activity_logs(agent_id="agent-1", status=None)

        call = client.calls[-1]
        self.assertNotIn("status", call["path"])


# ---------------------------------------------------------------------------
# Error Classes
# ---------------------------------------------------------------------------

class TestGuardBlockedError(unittest.TestCase):
    def test_stores_decision_and_reasons(self):
        decision = {
            "decision": "block",
            "reasons": ["Policy violation", "Rate limit exceeded"],
            "warnings": ["Approaching quota"],
            "matched_policies": ["pol_1"],
            "risk_score": 0.95,
        }
        err = GuardBlockedError(decision)

        self.assertIsInstance(err, DashClawError)
        self.assertEqual(err.decision, "block")
        self.assertEqual(err.reasons, ["Policy violation", "Rate limit exceeded"])
        self.assertEqual(err.warnings, ["Approaching quota"])
        self.assertEqual(err.matched_policies, ["pol_1"])
        self.assertEqual(err.risk_score, 0.95)
        self.assertEqual(err.status, 403)
        self.assertIn("block", str(err))

    def test_handles_empty_decision(self):
        err = GuardBlockedError({})
        self.assertIsNone(err.decision)
        self.assertEqual(err.reasons, [])
        self.assertEqual(err.warnings, [])
        self.assertIsNone(err.risk_score)


class TestApprovalDeniedError(unittest.TestCase):
    def test_stores_decision(self):
        err = ApprovalDeniedError("Operator denied the action.", decision="denied")

        self.assertIsInstance(err, DashClawError)
        self.assertEqual(err.decision, "denied")
        self.assertEqual(err.status, 403)
        self.assertIn("denied", str(err).lower())

    def test_decision_defaults_to_none(self):
        err = ApprovalDeniedError("Timeout")
        self.assertIsNone(err.decision)


# ---------------------------------------------------------------------------
# Phase 2 agent identity (#104) — auth_token + agent_name auto-include parity
# ---------------------------------------------------------------------------

class TestPhase2AuthToken(unittest.TestCase):
    """Mirrors Node SDK's authToken behavior. The header itself is verified by
    a separate test that patches urllib.request.urlopen so the real _request
    code path runs (see TestPhase2BearerHeader below)."""

    def test_auth_token_defaults_to_none(self):
        client = RecordingDashClaw()
        self.assertIsNone(client.auth_token)

    def test_stores_auth_token_when_provided(self):
        client = RecordingDashClaw(auth_token="eyJhbGciOiJFZERTQSJ9.x.y")
        self.assertEqual(client.auth_token, "eyJhbGciOiJFZERTQSJ9.x.y")


class TestPhase1AgentNameAutoInclude(unittest.TestCase):
    """Phase 1 parity gap closed alongside Phase 2 — Python now matches
    Node SDK's auto-include of agent_name from the constructor on guard()."""

    def test_guard_auto_includes_agent_name_from_constructor(self):
        client = RecordingDashClaw(agent_name="my-worker")
        client.guard({"action_type": "deploy"})

        body = client.calls[-1]["body"]
        self.assertEqual(body["agent_name"], "my-worker")
        self.assertEqual(body["agent_id"], "agent-1")

    def test_caller_agent_name_overrides_constructor(self):
        client = RecordingDashClaw(agent_name="constructor-name")
        client.guard({"action_type": "deploy", "agent_name": "call-site-name"})

        body = client.calls[-1]["body"]
        self.assertEqual(body["agent_name"], "call-site-name")

    def test_no_agent_name_emitted_when_neither_set(self):
        client = RecordingDashClaw()  # no agent_name in constructor
        client.guard({"action_type": "deploy"})

        body = client.calls[-1]["body"]
        self.assertNotIn("agent_name", body)


class TestPhase2BearerHeader(unittest.TestCase):
    """Verifies the actual _request code path adds Authorization: Bearer.
    Patches urllib.request.urlopen so we test header construction without
    going through RecordingDashClaw (which overrides _request entirely)."""

    def _capture_headers(self, client, path="/api/health"):
        from unittest import mock
        captured = {}

        class _FakeResponse:
            def __enter__(self_inner):
                return self_inner
            def __exit__(self_inner, *a):
                return False
            def read(self_inner):
                return b"{}"

        def _fake_urlopen(req, timeout=None):
            captured["headers"] = dict(req.header_items())
            return _FakeResponse()

        with mock.patch("urllib.request.urlopen", side_effect=_fake_urlopen):
            client._request(path, method="GET")
        return captured["headers"]

    def test_no_authorization_header_when_auth_token_unset(self):
        client = DashClaw(
            base_url="https://example.test",
            api_key="key-1",
            agent_id="agent-1",
        )
        headers = self._capture_headers(client)
        self.assertNotIn("Authorization", headers)

    def test_bearer_header_set_when_auth_token_provided(self):
        client = DashClaw(
            base_url="https://example.test",
            api_key="key-1",
            agent_id="agent-1",
            auth_token="eyJhbGciOiJFZERTQSJ9.x.y",
        )
        headers = self._capture_headers(client)
        self.assertEqual(headers["Authorization"], "Bearer eyJhbGciOiJFZERTQSJ9.x.y")
        # x-api-key still sent — Bearer is additive, not a replacement
        self.assertEqual(headers["X-api-key"], "key-1")


# ---------------------------------------------------------------------------
# x402 — record_x402_purchase convenience (parity with Node recordX402Purchase)
# ---------------------------------------------------------------------------

class TestRecordX402Purchase(unittest.TestCase):
    def _claw(self):
        class _Rec(RecordingDashClaw):
            def _request(self, path, method="GET", body=None, json=None, **kwargs):
                self.calls.append({"path": path, "method": method, "body": json or body})
                if path == "/api/x402/purchases":
                    return {
                        "action": {"action_id": "act_x402"},
                        "purchase": {"provider_id": "prov_1"},
                        "decision": {"decision": "allow"},
                    }
                return {"ok": True}

        return _Rec()

    def test_records_purchase_then_outcome_then_receipt(self):
        claw = self._claw()
        out = claw.record_x402_purchase(
            agent_id="a1", provider="stableenrich.dev", spend=0.007,
            transaction_hash="0xabc", request_id="req1",
        )
        paths = [c["path"] for c in claw.calls]
        self.assertEqual(paths, ["/api/x402/purchases", "/api/actions/act_x402/outcome", "/api/artifacts"])
        purchase = claw.calls[0]["body"]
        self.assertEqual(purchase["provider"], "stableenrich.dev")
        self.assertEqual(purchase["spend_amount"], 0.007)
        self.assertEqual(purchase["payment_method"], "x402")
        artifact = claw.calls[2]["body"]
        self.assertEqual(artifact["artifact_type"], "x402_purchase_result")
        self.assertEqual(artifact["source_action_id"], "act_x402")
        self.assertEqual(artifact["content_json"]["transactionHash"], "0xabc")
        self.assertEqual(out["action"]["action_id"], "act_x402")

    def test_skips_receipt_without_tx_or_request_id(self):
        claw = self._claw()
        claw.record_x402_purchase(agent_id="a1", provider="exa.dev", spend=0.01)
        paths = [c["path"] for c in claw.calls]
        self.assertEqual(paths, ["/api/x402/purchases", "/api/actions/act_x402/outcome"])




if __name__ == "__main__":
    unittest.main()
