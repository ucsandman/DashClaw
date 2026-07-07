"""
Characterization tests for the structural hot paths of dashclaw/client.py.

Pins the observable behavior of _request (URL/header/error handling),
_connect_sse (SSE parsing), wait_for_approval, record_x402_purchase,
wrap_client, track, and report_memory_health BEFORE/AFTER the in-file
structural refactor.

Follows the conventions of test_sdk_v2_surface.py: unittest + a
RecordingDashClaw subclass that intercepts _request() so no network
is touched. The _request tests themselves mock urllib at the module
boundary instead.
"""

import io
import json
import unittest
import urllib.error
from unittest import mock

from dashclaw.client import (
    DashClaw,
    DashClawError,
    GuardBlockedError,
    ApprovalDeniedError,
)


DEFAULTS = {
    "base_url": "https://example.test",
    "api_key": "test-key",
    "agent_id": "agent-1",
}


def make_client(**overrides):
    kwargs = dict(DEFAULTS)
    kwargs.update(overrides)
    return DashClaw(**kwargs)


class RecordingDashClaw(DashClaw):
    """Captures _request calls; optional canned responses keyed by (method, path)."""

    def __init__(self, responses=None, **overrides):
        kwargs = dict(DEFAULTS)
        kwargs.update(overrides)
        super().__init__(**kwargs)
        self.calls = []
        self.responses = responses or {}

    def _request(self, path, method="GET", body=None, json=None, **kwargs):
        payload = json if json is not None else body
        self.calls.append({"path": path, "method": method, "body": payload})
        key = (method, path.split("?")[0])
        if key in self.responses:
            value = self.responses[key]
            if isinstance(value, Exception):
                raise value
            return value
        return {"ok": True, "path": path, "method": method, "body": payload}

    def _sign_payload(self, payload):
        return None


class FakeHTTPSuccess:
    def __init__(self, payload):
        self._data = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def make_http_error(code, body_bytes, msg="err"):
    return urllib.error.HTTPError(
        "https://example.test/api/x", code, msg, {}, io.BytesIO(body_bytes)
    )


# ---------------------------------------------------------------------------
# _request: URL building, headers, payload, error normalization
# ---------------------------------------------------------------------------

class TestRequest(unittest.TestCase):
    def _call(self, urlopen_result, client=None, **request_kwargs):
        client = client or make_client()
        with mock.patch("urllib.request.urlopen") as m:
            if isinstance(urlopen_result, Exception):
                m.side_effect = urlopen_result
            else:
                m.return_value = urlopen_result
            result = client._request(**request_kwargs)
            req = m.call_args[0][0]
        return result, req, m

    def test_get_builds_url_and_headers(self):
        result, req, m = self._call(FakeHTTPSuccess({"ok": True}), path="/api/actions")
        self.assertEqual(req.full_url, "https://example.test/api/actions")
        self.assertEqual(req.get_method(), "GET")
        self.assertEqual(req.get_header("X-api-key"), "test-key")
        self.assertEqual(req.get_header("Content-type"), "application/json")
        self.assertIsNone(req.data)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(m.call_args[1], {"timeout": 30})

    def test_params_are_encoded_and_none_filtered(self):
        _, req, _ = self._call(
            FakeHTTPSuccess({}),
            path="/api/actions",
            params={"limit": 5, "skip": None, "status": "running"},
        )
        self.assertEqual(
            req.full_url, "https://example.test/api/actions?limit=5&status=running"
        )

    def test_params_append_with_ampersand_when_query_exists(self):
        _, req, _ = self._call(
            FakeHTTPSuccess({}), path="/api/actions?x=1", params={"y": 2}
        )
        self.assertEqual(req.full_url, "https://example.test/api/actions?x=1&y=2")

    def test_json_keyword_body_and_method_keyword(self):
        _, req, _ = self._call(
            FakeHTTPSuccess({}),
            path="/api/actions",
            method="POST",
            json={"a": 1},
        )
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(json.loads(req.data.decode("utf-8")), {"a": 1})

    def test_body_positional_payload(self):
        _, req, _ = self._call(
            FakeHTTPSuccess({}), path="/api/x", method="PATCH", body={"b": 2}
        )
        self.assertEqual(req.get_method(), "PATCH")
        self.assertEqual(json.loads(req.data.decode("utf-8")), {"b": 2})

    def test_auth_token_adds_bearer_header(self):
        client = make_client(auth_token="tok-123")
        _, req, _ = self._call(FakeHTTPSuccess({}), client=client, path="/api/x")
        self.assertEqual(req.get_header("Authorization"), "Bearer tok-123")

    def test_no_auth_header_without_token(self):
        _, req, _ = self._call(FakeHTTPSuccess({}), path="/api/x")
        self.assertIsNone(req.get_header("Authorization"))

    def test_http_error_with_json_body_raises_dashclaw_error(self):
        err = make_http_error(
            422, json.dumps({"error": "bad input", "details": {"f": 1}}).encode()
        )
        client = make_client()
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(DashClawError) as ctx:
                client._request("/api/x")
        self.assertEqual(str(ctx.exception), "bad input")
        self.assertEqual(ctx.exception.status, 422)
        self.assertEqual(ctx.exception.details, {"f": 1})

    def test_http_403_block_decision_raises_guard_blocked(self):
        decision = {
            "decision": "block",
            "reasons": ["policy_x"],
            "warnings": [],
            "matched_policies": ["p1"],
            "risk_score": 90,
        }
        err = make_http_error(
            403, json.dumps({"error": "blocked", "decision": decision}).encode()
        )
        client = make_client()
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(GuardBlockedError) as ctx:
                client._request("/api/x")
        self.assertEqual(ctx.exception.decision, "block")
        self.assertEqual(ctx.exception.reasons, ["policy_x"])
        self.assertEqual(ctx.exception.status, 403)
        self.assertIn("Guard blocked action: block", str(ctx.exception))

    def test_http_403_non_block_decision_raises_dashclaw_error(self):
        err = make_http_error(
            403,
            json.dumps(
                {"error": "needs approval", "decision": {"decision": "require_approval"}}
            ).encode(),
        )
        client = make_client()
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(DashClawError) as ctx:
                client._request("/api/x")
        self.assertNotIsInstance(ctx.exception, GuardBlockedError)
        self.assertEqual(str(ctx.exception), "needs approval")

    def test_http_error_with_non_json_body_uses_str_of_error(self):
        err = make_http_error(500, b"<html>boom</html>", msg="Server Error")
        client = make_client()
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(DashClawError) as ctx:
                client._request("/api/x")
        self.assertEqual(str(ctx.exception), str(err))
        self.assertEqual(ctx.exception.status, 500)
        self.assertIsNone(ctx.exception.details)

    def test_network_error_wrapped_as_request_failed(self):
        client = make_client()
        with mock.patch(
            "urllib.request.urlopen", side_effect=urllib.error.URLError("refused")
        ):
            with self.assertRaises(DashClawError) as ctx:
                client._request("/api/x")
        self.assertTrue(str(ctx.exception).startswith("Request failed: "))
        self.assertIsNone(ctx.exception.status)

    def test_invalid_json_success_body_wrapped_as_request_failed(self):
        class BadBody:
            def read(self):
                return b"not json"

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        client = make_client()
        with mock.patch("urllib.request.urlopen", return_value=BadBody()):
            with self.assertRaises(DashClawError) as ctx:
                client._request("/api/x")
        self.assertTrue(str(ctx.exception).startswith("Request failed: "))


# ---------------------------------------------------------------------------
# _connect_sse: stream parsing
# ---------------------------------------------------------------------------

class FakeSSEResponse:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    def read(self, n):
        if self._chunks:
            return self._chunks.pop(0)
        return b""

    def close(self):
        self.closed = True


class TestConnectSSE(unittest.TestCase):
    def _connect(self, chunks, action_id="act-1", timeout=5):
        client = make_client()
        resp = FakeSSEResponse(chunks)
        with mock.patch("urllib.request.urlopen", return_value=resp):
            result = client._connect_sse(action_id, timeout)
        return result, resp

    def test_returns_matching_action_updated_event(self):
        data = {"action_id": "act-1", "status": "completed", "approved_by": "op"}
        chunks = [
            b"id: 1\n",
            b"event: action.updated\n",
            ("data: " + json.dumps(data) + "\n\n").encode(),
        ]
        result, resp = self._connect(chunks)
        self.assertEqual(result, data)
        self.assertTrue(resp.closed)

    def test_ignores_non_matching_action_id_until_stream_end(self):
        other = {"action_id": "other", "status": "completed"}
        chunks = [
            ("event: action.updated\ndata: " + json.dumps(other) + "\n\n").encode(),
        ]
        result, resp = self._connect(chunks)
        self.assertIsNone(result)
        self.assertTrue(resp.closed)

    def test_ignores_heartbeat_comments_and_other_events(self):
        data = {"action_id": "act-1", "status": "running"}
        chunks = [
            b": heartbeat\n\n",
            b"event: other.event\ndata: {}\n\n",
            ("event: action.updated\ndata: " + json.dumps(data) + "\n\n").encode(),
        ]
        result, _ = self._connect(chunks)
        self.assertEqual(result, data)

    def test_handles_data_split_across_chunks(self):
        data = {"action_id": "act-1", "x": 1}
        payload = "data: " + json.dumps(data) + "\n\n"
        full = "event: action.updated\n" + payload
        raw = full.encode()
        chunks = [raw[:10], raw[10:20], raw[20:]]
        result, _ = self._connect(chunks)
        self.assertEqual(result, data)

    def test_invalid_json_event_is_skipped(self):
        good = {"action_id": "act-1"}
        chunks = [
            b"event: action.updated\ndata: {nope\n\n",
            ("event: action.updated\ndata: " + json.dumps(good) + "\n\n").encode(),
        ]
        result, _ = self._connect(chunks)
        self.assertEqual(result, good)

    def test_connection_failure_returns_none(self):
        client = make_client()
        with mock.patch("urllib.request.urlopen", side_effect=OSError("nope")):
            self.assertIsNone(client._connect_sse("act-1", 5))

    def test_read_failure_returns_none(self):
        class ExplodingResp:
            def read(self, n):
                raise OSError("mid-stream")

            def close(self):
                pass

        client = make_client()
        with mock.patch("urllib.request.urlopen", return_value=ExplodingResp()):
            self.assertIsNone(client._connect_sse("act-1", 5))

    def test_sends_sse_headers_and_auth(self):
        client = make_client(auth_token="tok-9")
        resp = FakeSSEResponse([])
        with mock.patch("urllib.request.urlopen", return_value=resp) as m:
            client._connect_sse("act-1", 5)
        req = m.call_args[0][0]
        self.assertEqual(req.full_url, "https://example.test/api/stream")
        self.assertEqual(req.get_header("X-api-key"), "test-key")
        self.assertEqual(req.get_header("Accept"), "text/event-stream")
        self.assertEqual(req.get_header("Authorization"), "Bearer tok-9")


# ---------------------------------------------------------------------------
# wait_for_approval: SSE-first, polling fallback, decision paths
# ---------------------------------------------------------------------------

class WaitClient(DashClaw):
    def __init__(self, sse_result=None, actions=None, **overrides):
        kwargs = dict(DEFAULTS)
        kwargs.update(overrides)
        super().__init__(**kwargs)
        self.sse_result = sse_result
        self.sse_calls = 0
        self.actions = list(actions or [])
        self.get_action_calls = 0

    def _connect_sse(self, action_id, timeout):
        self.sse_calls += 1
        return self.sse_result

    def get_action(self, action_id):
        self.get_action_calls += 1
        if len(self.actions) > 1:
            return self.actions.pop(0)
        return self.actions[0]


class TestWaitForApproval(unittest.TestCase):
    def test_sse_approval_returns_fresh_action(self):
        final = {"action": {"status": "completed", "approved_by": "op"}}
        client = WaitClient(
            sse_result={"action_id": "a1", "approved_by": "op"}, actions=[final]
        )
        result = client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertEqual(result, final)
        self.assertEqual(client.sse_calls, 1)

    def test_sse_denial_raises_approval_denied(self):
        client = WaitClient(
            sse_result={"action_id": "a1", "status": "failed", "error_message": "no"},
            actions=[{}],
        )
        with self.assertRaises(ApprovalDeniedError) as ctx:
            client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertEqual(str(ctx.exception), "no")
        self.assertEqual(ctx.exception.decision, "failed")

    def test_polling_resolves_on_approval(self):
        client = WaitClient(
            sse_result=None,
            actions=[
                {"action": {"status": "pending_approval"}},
                {"action": {"status": "completed", "approved_by": "op"}},
            ],
        )
        result = client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertEqual(result["action"]["approved_by"], "op")

    def test_polling_denial_raises_approval_denied(self):
        client = WaitClient(
            sse_result=None,
            actions=[
                {"action": {"status": "pending_approval"}},
                {"action": {"status": "cancelled", "error_message": "denied by op"}},
            ],
        )
        with self.assertRaises(ApprovalDeniedError) as ctx:
            client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertEqual(str(ctx.exception), "denied by op")
        self.assertEqual(ctx.exception.decision, "cancelled")

    def test_left_pending_without_metadata_raises(self):
        client = WaitClient(
            sse_result=None,
            actions=[
                {"action": {"status": "pending_approval"}},
                {"action": {"status": "completed"}},
            ],
        )
        with self.assertRaises(DashClawError) as ctx:
            client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertIn("left pending_approval state", str(ctx.exception))

    def test_running_without_pending_returns_immediately(self):
        res = {"action": {"status": "running"}}
        client = WaitClient(sse_result=None, actions=[res])
        result = client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertEqual(result, res)
        self.assertEqual(client.get_action_calls, 1)

    def test_timeout_raises_timeout_error(self):
        client = WaitClient(
            sse_result=None, actions=[{"action": {"status": "pending_approval"}}]
        )
        with self.assertRaises(TimeoutError) as ctx:
            client.wait_for_approval("a1", timeout=0.01, interval=0)
        self.assertIn("a1", str(ctx.exception))

    def test_sse_exception_falls_back_to_polling(self):
        class BrokenSSE(WaitClient):
            def _connect_sse(self, action_id, timeout):
                raise RuntimeError("sse exploded")

        client = BrokenSSE(
            actions=[{"action": {"status": "completed", "approved_by": "op"}}]
        )
        result = client.wait_for_approval("a1", timeout=5, interval=0)
        self.assertEqual(result["action"]["approved_by"], "op")


# ---------------------------------------------------------------------------
# _evaluate_wait_for_approval_action
# ---------------------------------------------------------------------------

class TestEvaluateWaitForApprovalAction(unittest.TestCase):
    def setUp(self):
        self.client = make_client()

    def test_non_dict_res_treated_as_empty(self):
        resolved, was_pending = self.client._evaluate_wait_for_approval_action(
            "a1", None, False
        )
        self.assertIsNone(resolved)
        self.assertFalse(was_pending)

    def test_pending_sets_flag(self):
        resolved, was_pending = self.client._evaluate_wait_for_approval_action(
            "a1", {"action": {"status": "pending_approval"}}, False
        )
        self.assertIsNone(resolved)
        self.assertTrue(was_pending)

    def test_approved_returns_res(self):
        res = {"action": {"status": "completed", "approved_by": "op"}}
        resolved, _ = self.client._evaluate_wait_for_approval_action("a1", res, True)
        self.assertEqual(resolved, res)

    def test_failed_raises_with_default_message(self):
        with self.assertRaises(ApprovalDeniedError) as ctx:
            self.client._evaluate_wait_for_approval_action(
                "a1", {"action": {"status": "failed"}}, False
            )
        self.assertEqual(str(ctx.exception), "Operator denied the action.")


# ---------------------------------------------------------------------------
# record_x402_purchase
# ---------------------------------------------------------------------------

class TestRecordX402Purchase(unittest.TestCase):
    def _client(self, purchase_response):
        return RecordingDashClaw(
            responses={("POST", "/api/x402/purchases"): purchase_response}
        )

    def test_full_settled_flow_with_receipt(self):
        purchase_response = {
            "action": {"action_id": "act-9"},
            "purchase": {"id": "p1"},
            "decision": {"decision": "allow"},
        }
        client = self._client(purchase_response)
        out = client.record_x402_purchase(
            "agent-1",
            "https://api.example",
            0.25,
            transaction_hash="0xabc",
            request_id="req-1",
        )

        purchase_call = client.calls[0]
        self.assertEqual(purchase_call["path"], "/api/x402/purchases")
        self.assertEqual(purchase_call["method"], "POST")
        body = purchase_call["body"]
        self.assertEqual(body["agent_id"], "agent-1")
        self.assertEqual(body["provider"], "https://api.example")
        self.assertEqual(body["spend_amount"], 0.25)
        self.assertEqual(body["cost_estimate"], 0.25)
        self.assertEqual(body["currency"], "USDC")
        self.assertEqual(body["payment_method"], "x402")
        self.assertEqual(
            body["declared_goal"], "x402 capability call to https://api.example"
        )
        self.assertEqual(
            body["purchase_reason"],
            "Paid x402 capability call to https://api.example",
        )
        self.assertEqual(
            body["context_gap"],
            "Capability gated behind payment at https://api.example",
        )
        self.assertEqual(
            body["expected_value"], "Paid result from https://api.example"
        )

        outcome_call = client.calls[1]
        self.assertEqual(outcome_call["path"], "/api/actions/act-9/outcome")
        self.assertEqual(outcome_call["body"]["status"], "completed")
        self.assertEqual(
            outcome_call["body"]["summary"],
            "x402 settled: $0.25 USDC at https://api.example",
        )

        artifact_call = client.calls[2]
        self.assertEqual(artifact_call["path"], "/api/artifacts")
        self.assertEqual(
            artifact_call["body"]["artifact_type"], "x402_purchase_result"
        )
        self.assertEqual(
            artifact_call["body"]["content_json"]["transactionHash"], "0xabc"
        )
        self.assertEqual(artifact_call["body"]["content_json"]["requestId"], "req-1")
        self.assertEqual(artifact_call["body"]["source_action_id"], "act-9")

        self.assertEqual(out["action"], {"action_id": "act-9"})
        self.assertEqual(out["purchase"], {"id": "p1"})
        self.assertEqual(out["decision"], {"decision": "allow"})
        self.assertIsNotNone(out["outcome"])

    def test_custom_fields_passed_through(self):
        client = self._client({"action": {"action_id": "act-1"}})
        client.record_x402_purchase(
            "agent-1",
            "prov",
            1.5,
            declared_goal="custom goal",
            purchase_reason="custom reason",
            context_gap="custom gap",
            expected_value="custom value",
            currency="USD",
            payment_method="card",
        )
        body = client.calls[0]["body"]
        self.assertEqual(body["declared_goal"], "custom goal")
        self.assertEqual(body["purchase_reason"], "custom reason")
        self.assertEqual(body["context_gap"], "custom gap")
        self.assertEqual(body["expected_value"], "custom value")
        self.assertEqual(body["currency"], "USD")
        self.assertEqual(body["payment_method"], "card")

    def test_no_action_id_skips_outcome_and_artifact(self):
        client = self._client({"purchase": {"id": "p1"}})
        out = client.record_x402_purchase("agent-1", "prov", 1.0)
        self.assertEqual(len(client.calls), 1)
        self.assertIsNone(out["action"])
        self.assertIsNone(out["outcome"])
        self.assertEqual(out["purchase"], {"id": "p1"})

    def test_action_id_fallback_to_id(self):
        client = self._client({"action": {"id": "alt-7"}})
        client.record_x402_purchase("agent-1", "prov", 1.0)
        self.assertEqual(client.calls[1]["path"], "/api/actions/alt-7/outcome")

    def test_no_receipt_skips_artifact(self):
        client = self._client({"action": {"action_id": "act-1"}})
        client.record_x402_purchase("agent-1", "prov", 1.0)
        paths = [c["path"] for c in client.calls]
        self.assertNotIn("/api/artifacts", paths)

    def test_non_dict_response_returns_none_fields(self):
        client = self._client("weird")
        out = client.record_x402_purchase("agent-1", "prov", 1.0)
        self.assertEqual(
            out, {"action": None, "purchase": None, "decision": None, "outcome": None}
        )


# ---------------------------------------------------------------------------
# wrap_client
# ---------------------------------------------------------------------------

class FakeUsageAnthropic:
    input_tokens = 11
    output_tokens = 7


class FakeAnthropicResponse:
    usage = FakeUsageAnthropic()
    model = "claude-test"


class FakeMessages:
    def __init__(self):
        self.create = lambda *a, **k: FakeAnthropicResponse()


class FakeAnthropic:
    def __init__(self):
        self.messages = FakeMessages()


class FakeUsageOpenAI:
    prompt_tokens = 13
    completion_tokens = 5


class FakeOpenAIResponse:
    usage = FakeUsageOpenAI()
    model = "gpt-test"


class FakeCompletions:
    def __init__(self):
        self.create = lambda *a, **k: FakeOpenAIResponse()


class FakeChat:
    def __init__(self):
        self.completions = FakeCompletions()


class FakeOpenAI:
    def __init__(self):
        self.chat = FakeChat()


class TestWrapClient(unittest.TestCase):
    def test_detects_anthropic_and_reports_tokens(self):
        client = RecordingDashClaw()
        llm = FakeAnthropic()
        wrapped = client.wrap_client(llm)
        self.assertIs(wrapped, llm)
        self.assertTrue(llm._dashclaw_wrapped)

        response = llm.messages.create(model="claude-test")
        self.assertIsInstance(response, FakeAnthropicResponse)
        token_call = client.calls[-1]
        self.assertEqual(token_call["path"], "/api/tokens")
        self.assertEqual(token_call["body"]["tokens_in"], 11)
        self.assertEqual(token_call["body"]["tokens_out"], 7)
        self.assertEqual(token_call["body"]["model"], "claude-test")
        self.assertEqual(token_call["body"]["agent_id"], "agent-1")

    def test_detects_openai_and_reports_tokens(self):
        client = RecordingDashClaw()
        llm = FakeOpenAI()
        client.wrap_client(llm)
        llm.chat.completions.create()
        token_call = client.calls[-1]
        self.assertEqual(token_call["path"], "/api/tokens")
        self.assertEqual(token_call["body"]["tokens_in"], 13)
        self.assertEqual(token_call["body"]["tokens_out"], 5)
        self.assertEqual(token_call["body"]["model"], "gpt-test")

    def test_wrap_is_idempotent(self):
        client = RecordingDashClaw()
        llm = FakeAnthropic()
        client.wrap_client(llm)
        first_wrapped = llm.messages.create
        client.wrap_client(llm)
        self.assertIs(llm.messages.create, first_wrapped)

    def test_unknown_provider_raises_value_error(self):
        client = RecordingDashClaw()
        with self.assertRaises(ValueError) as ctx:
            client.wrap_client(object())
        self.assertIn("unable to detect provider", str(ctx.exception))

    def test_explicit_provider_overrides_detection(self):
        client = RecordingDashClaw()
        llm = FakeAnthropic()
        client.wrap_client(llm, provider="anthropic")
        llm.messages.create()
        self.assertEqual(client.calls[-1]["path"], "/api/tokens")

    def test_missing_usage_skips_report(self):
        class NoUsageResponse:
            usage = None
            model = "m"

        client = RecordingDashClaw()
        llm = FakeAnthropic()
        llm.messages.create = lambda *a, **k: NoUsageResponse()
        client.wrap_client(llm)
        llm.messages.create()
        self.assertEqual(client.calls, [])


# ---------------------------------------------------------------------------
# track context manager
# ---------------------------------------------------------------------------

class TestTrack(unittest.TestCase):
    def _client(self, fail_outcome=False):
        responses = {("POST", "/api/actions"): {"action_id": "trk-1"}}
        if fail_outcome:
            responses[("PATCH", "/api/actions/trk-1")] = RuntimeError("patch down")
        return RecordingDashClaw(responses=responses)

    def test_success_records_completed_outcome(self):
        client = self._client()
        with client.track("api_call", "do it") as ctx:
            self.assertEqual(ctx, {"action_id": "trk-1"})
        patch_call = client.calls[-1]
        self.assertEqual(patch_call["path"], "/api/actions/trk-1")
        self.assertEqual(patch_call["method"], "PATCH")
        self.assertEqual(patch_call["body"]["status"], "completed")
        self.assertIn("duration_ms", patch_call["body"])
        self.assertIn("timestamp_end", patch_call["body"])

    def test_failure_records_failed_outcome_and_reraises(self):
        client = self._client()
        with self.assertRaises(ValueError):
            with client.track("api_call", "do it"):
                raise ValueError("kaboom")
        patch_call = client.calls[-1]
        self.assertEqual(patch_call["body"]["status"], "failed")
        self.assertEqual(patch_call["body"]["error_message"], "kaboom")

    def test_outcome_failure_warns_and_reraises_original(self):
        client = self._client(fail_outcome=True)
        with self.assertWarns(UserWarning):
            with self.assertRaises(ValueError):
                with client.track("api_call", "do it"):
                    raise ValueError("original")


# ---------------------------------------------------------------------------
# report_memory_health
# ---------------------------------------------------------------------------

class TestReportMemoryHealth(unittest.TestCase):
    def test_prebuilt_payload_passes_through(self):
        client = RecordingDashClaw()
        prebuilt = {"health": {"score": 0.9}, "entities": [], "topics": []}
        client.report_memory_health(prebuilt)
        self.assertEqual(client.calls[-1]["body"], prebuilt)
        self.assertEqual(client.calls[-1]["path"], "/api/memory")
        self.assertEqual(client.calls[-1]["method"], "POST")

    def test_components_are_wrapped(self):
        client = RecordingDashClaw()
        client.report_memory_health({"score": 0.5}, entities=["e"], topics=["t"])
        self.assertEqual(
            client.calls[-1]["body"],
            {"health": {"score": 0.5}, "entities": ["e"], "topics": ["t"]},
        )

    def test_prebuilt_with_explicit_entities_is_wrapped(self):
        client = RecordingDashClaw()
        payload = {"health": {"score": 0.5}}
        client.report_memory_health(payload, entities=["e"])
        self.assertEqual(
            client.calls[-1]["body"],
            {"health": payload, "entities": ["e"], "topics": None},
        )


# ---------------------------------------------------------------------------
# Public wrapper sample: exact path + method + payload
# ---------------------------------------------------------------------------

class TestPublicWrapperSample(unittest.TestCase):
    def test_create_action(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "goal", session_id="sess-1", risk_score=10)
        call = client.calls[-1]
        self.assertEqual(call["path"], "/api/actions")
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["body"]["action_type"], "api_call")
        self.assertEqual(call["body"]["declared_goal"], "goal")
        self.assertEqual(call["body"]["agent_id"], "agent-1")
        self.assertEqual(call["body"]["session_id"], "sess-1")
        self.assertEqual(call["body"]["risk_score"], 10)

    def test_update_outcome_adds_timestamp_end(self):
        client = RecordingDashClaw()
        client.update_outcome("a1", status="completed", duration_ms=5)
        call = client.calls[-1]
        self.assertEqual(call["path"], "/api/actions/a1")
        self.assertEqual(call["method"], "PATCH")
        self.assertEqual(call["body"]["status"], "completed")
        self.assertTrue(call["body"]["timestamp_end"].endswith("Z"))

    def test_update_outcome_accepts_dict_status(self):
        client = RecordingDashClaw()
        client.update_outcome("a1", {"status": "failed", "error_message": "x"})
        call = client.calls[-1]
        self.assertEqual(call["body"]["status"], "failed")
        self.assertEqual(call["body"]["error_message"], "x")

    def test_heartbeat(self):
        client = RecordingDashClaw(agent_name="Bot")
        client.heartbeat(status="busy", current_task_id="t1")
        call = client.calls[-1]
        self.assertEqual(call["path"], "/api/agents/heartbeat")
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["body"]["agent_id"], "agent-1")
        self.assertEqual(call["body"]["agent_name"], "Bot")
        self.assertEqual(call["body"]["status"], "busy")
        self.assertEqual(call["body"]["current_task_id"], "t1")

    def test_get_actions_builds_query(self):
        client = RecordingDashClaw()
        client.get_actions(status="running", limit=5, skip=None)
        self.assertEqual(client.calls[-1]["path"], "/api/actions?status=running&limit=5")
        self.assertEqual(client.calls[-1]["method"], "GET")

    def test_approve_action_validates_decision(self):
        client = RecordingDashClaw()
        with self.assertRaises(ValueError):
            client.approve_action("a1", "maybe")
        client.approve_action("a1", "allow", reasoning="fine")
        call = client.calls[-1]
        self.assertEqual(call["path"], "/api/actions/a1/approve")
        self.assertEqual(call["body"], {"decision": "allow", "reasoning": "fine"})

    def test_get_pending_approvals_delegates_to_get_actions(self):
        client = RecordingDashClaw()
        client.get_pending_approvals(limit=3, offset=6)
        self.assertEqual(
            client.calls[-1]["path"],
            "/api/actions?status=pending_approval&limit=3&offset=6",
        )

    def test_report_action_success(self):
        client = RecordingDashClaw()
        client.report_action_success("a1", "all good")
        call = client.calls[-1]
        self.assertEqual(call["path"], "/api/actions/a1/outcome")
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["body"], {"status": "completed", "summary": "all good"})


if __name__ == "__main__":
    unittest.main()
