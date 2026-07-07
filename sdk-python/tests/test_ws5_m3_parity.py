import unittest

from dashclaw.client import DashClaw


class RecordingDashClaw(DashClaw):
    def __init__(self):
        super().__init__(
            base_url="https://example.test",
            api_key="test-key",
            agent_id="agent-1",
        )
        self.calls = []
        self.stub_responses = {}

    def _request(self, path, method="GET", body=None, json=None):
        payload = json or body
        self.calls.append({"path": path, "method": method, "body": payload})
        return self.stub_responses.get(path, {"ok": True, "path": path, "method": method, "body": payload})


class WS5M3ParityTests(unittest.TestCase):
    def test_report_memory_health_accepts_composed_report(self):
        client = RecordingDashClaw()
        client.report_memory_health({"health": {"score": 90}, "entities": [{"name": "Repo"}], "topics": []})
        self.assertEqual(client.calls[-1]["path"], "/api/memory")
        self.assertEqual(client.calls[-1]["method"], "POST")
        self.assertEqual(client.calls[-1]["body"]["health"]["score"], 90)

    def test_report_memory_health_accepts_split_arguments(self):
        client = RecordingDashClaw()
        client.report_memory_health({"score": 88}, entities=[{"name": "Agent"}], topics=[{"name": "Ops"}])
        self.assertEqual(
            client.calls[-1]["body"],
            {"health": {"score": 88}, "entities": [{"name": "Agent"}], "topics": [{"name": "Ops"}]},
        )


if __name__ == "__main__":
    unittest.main()
