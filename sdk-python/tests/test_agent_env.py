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

    def _request(self, path, method="GET", body=None, params=None, json_payload=None, **kwargs):
        self.calls.append({"path": path, "method": method, "params": params})
        return {"env": {"API_TOKEN": "live-value"}, "count": 1, "delivered": ["API_TOKEN"]}


class AgentEnvTests(unittest.TestCase):
    def test_get_agent_env_defaults_to_client_agent_id(self):
        client = RecordingDashClaw()
        client.get_agent_env()

        call = client.calls[-1]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["path"], "/api/secrets/env")
        self.assertEqual(call["params"], {"agent_id": "agent-1"})

    def test_get_agent_env_accepts_explicit_agent_id(self):
        client = RecordingDashClaw()
        client.get_agent_env(agent_id="agent-9")

        self.assertEqual(client.calls[-1]["params"], {"agent_id": "agent-9"})

    def test_get_agent_env_returns_bundle_untouched(self):
        client = RecordingDashClaw()
        result = client.get_agent_env()

        self.assertEqual(
            result,
            {"env": {"API_TOKEN": "live-value"}, "count": 1, "delivered": ["API_TOKEN"]},
        )


if __name__ == "__main__":
    unittest.main()
