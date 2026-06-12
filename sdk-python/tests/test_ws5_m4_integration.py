import json
import pathlib
import sys
import unittest
import urllib.parse
from unittest.mock import MagicMock

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "docs" / "sdk-critical-contract-harness.json"
sys.path.insert(0, str(ROOT / "sdk-python"))

from dashclaw.client import DashClaw  # noqa: E402


class RecordingDashClaw(DashClaw):
    def __init__(self):
        super().__init__(
            base_url="https://example.test",
            api_key="test-key",
            agent_id="agent-1",
        )
        self.calls = []

    def _request(self, path, method="GET", body=None, json=None):
        payload = json or body
        self.calls.append({"path": path, "method": method, "body": payload})
        # Mock response for wait_for_approval (which calls get_action)
        if path.startswith("/api/actions/"):
            return {"action": {"status": "running", "approved_by": "operator"}}
        return {"ok": True}

    def _connect_sse(self, action_id, timeout):
        return None


def normalize_call(call):
    parsed = urllib.parse.urlsplit(call["path"])
    query = sorted([list(item) for item in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)])
    body = call.get("body")

    if isinstance(body, dict):
        # Mask values that legitimately vary run-to-run so the contract pins
        # the shape, not the volatile value: timestamps and the auto-derived
        # idempotency key (its hash rotates with create_action's hour bucket).
        if isinstance(body.get("timestamp_end"), str):
            body = {**body, "timestamp_end": "<timestamp>"}
        if isinstance(body.get("idempotency_key"), str):
            body = {**body, "idempotency_key": "<idempotency_key>"}

    return {
        "method": str(call.get("method", "")).upper(),
        "pathname": parsed.path,
        "query": query,
        "body": body if body is not None else None,
    }


class WS5M4IntegrationHarnessTests(unittest.TestCase):
    def test_python_sdk_matches_shared_contract_harness(self):
        expected_entries = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        expected = {entry["id"]: entry["call"] for entry in expected_entries}

        client = RecordingDashClaw()

        cases = [
            ("guard", lambda: client.guard({"action_type": "deploy", "risk_score": 55})),
            ("create_action", lambda: client.create_action(action_type="deploy", declared_goal="Ship release")),
            ("update_outcome", lambda: client.update_outcome("act_1", status="completed", output_summary="done")),
            ("record_assumption", lambda: client.record_assumption({"action_id": "act_1", "assumption": "Database is reachable"})),
            ("wait_for_approval", lambda: client.wait_for_approval("act_1", timeout=0.1, interval=0.01)),
        ]

        seen = set()
        for case_id, fn in cases:
            before = len(client.calls)
            fn()
            self.assertGreater(len(client.calls), before, msg=f"no call captured for case {case_id}")

            normalized = normalize_call(client.calls[-1])
            self.assertIn(case_id, expected, msg=f"missing fixture case: {case_id}")
            self.assertEqual(expected[case_id], normalized, msg=f"contract mismatch for {case_id}")
            seen.add(case_id)

        self.assertEqual(set(expected.keys()), seen, msg="fixture and Python case sets differ")


if __name__ == "__main__":
    unittest.main()
