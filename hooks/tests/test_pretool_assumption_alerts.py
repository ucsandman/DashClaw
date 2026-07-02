"""Advocate v2a: _warn_assumption_alerts surfaces operator invalidations and
acknowledges them (marks the inbox message read) so the alert stops riding
future guard responses.

Pins: advisory prints even on allow; the ack PATCH fires ONLY when alerts are
present (pretool single-HTTP-call rule holds on the common path); ack failure
is fail-silent (the alert simply rides again next call).
"""

import os
import sys
import unittest
from unittest import mock

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HOOKS_DIR)

import dashclaw_pretool  # noqa: E402


_ALERT = {
    "message_id": "msg_1",
    "assumption": "flag is on",
    "invalidated_reason": "flag is OFF",
}


class TestWarnAssumptionAlerts(unittest.TestCase):
    def test_prints_and_acks_when_alerts_present(self):
        logs, calls = [], []
        with mock.patch.object(dashclaw_pretool, "log", side_effect=lambda m: logs.append(m)), \
             mock.patch.object(dashclaw_pretool, "api_request", side_effect=lambda *a, **k: calls.append((a, k)) or {}):
            dashclaw_pretool._warn_assumption_alerts({
                "decision": "allow",
                "assumption_alerts": [_ALERT],
            })
        self.assertTrue(any("invalidated an assumption" in m for m in logs), logs)
        self.assertTrue(any("flag is OFF" in m for m in logs), logs)
        self.assertEqual(len(calls), 1, calls)
        args, kwargs = calls[0]
        self.assertEqual(args[0], "PATCH")
        self.assertEqual(args[1], "/api/messages")
        self.assertEqual(kwargs["body"]["message_ids"], ["msg_1"])
        self.assertEqual(kwargs["body"]["action"], "read")

    def test_no_alerts_no_output_no_http(self):
        logs, calls = [], []
        with mock.patch.object(dashclaw_pretool, "log", side_effect=lambda m: logs.append(m)), \
             mock.patch.object(dashclaw_pretool, "api_request", side_effect=lambda *a, **k: calls.append(1)):
            dashclaw_pretool._warn_assumption_alerts({"decision": "allow"})
        self.assertEqual(logs, [])
        self.assertEqual(calls, [])

    def test_ack_failure_is_silent(self):
        logs = []

        def boom(*a, **k):
            raise RuntimeError("network down")

        with mock.patch.object(dashclaw_pretool, "log", side_effect=lambda m: logs.append(m)), \
             mock.patch.object(dashclaw_pretool, "api_request", side_effect=boom):
            dashclaw_pretool._warn_assumption_alerts({"assumption_alerts": [_ALERT]})
        self.assertTrue(any("invalidated an assumption" in m for m in logs), logs)


if __name__ == "__main__":
    unittest.main()
