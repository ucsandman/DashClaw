"""Cross-language idempotency key derivation + transient-only retries
(Organ 3, Phase 3).

The golden vectors in __tests__/fixtures/idempotency-golden-vectors.json pin
the derivation algorithm — sorted "k=v" pairs joined with "|", SHA-256 hex —
across every surface. sdk/dashclaw.js deriveIdempotencyKey is the reference
implementation; this file asserts the Python mirrors (hook + sdk-python)
produce identical digests for identical fixtures. The JS side of the same
vectors is asserted in __tests__/unit/idempotency-golden.test.js.

Also pins request_with_retry's transient-only classification: non-transient
4xx (except 408/429) raise immediately with a single attempt; 5xx/408/429
and connectivity errors keep the retry+backoff behavior. api_request's
AUTH_FAILED sentinel (401/403 with distinguish_auth) is preserved.
"""

import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_HOOKS_DIR)
sys.path.insert(0, _HOOKS_DIR)
sys.path.insert(0, os.path.join(_REPO_ROOT, "sdk-python"))

import dashclaw_pretool  # noqa: E402
from dashclaw_agent_intel import http_client  # noqa: E402

_VECTORS_PATH = os.path.join(_REPO_ROOT, "__tests__", "fixtures", "idempotency-golden-vectors.json")
with io.open(_VECTORS_PATH, encoding="utf-8") as f:
    VECTORS = json.load(f)


class TestGoldenVectors(unittest.TestCase):
    def test_vector_count(self):
        self.assertGreaterEqual(len(VECTORS), 4)

    def test_hook_derivation_matches_vectors(self):
        for vector in VECTORS:
            with self.subTest(vector["name"]):
                self.assertEqual(
                    dashclaw_pretool.derive_idempotency_key(vector["parts"]),
                    vector["expected"],
                )

    def test_sdk_python_derivation_matches_vectors(self):
        from dashclaw.client import DashClaw

        for vector in VECTORS:
            with self.subTest(vector["name"]):
                self.assertEqual(
                    DashClaw.derive_idempotency_key(vector["parts"]),
                    vector["expected"],
                )

    def test_tool_use_id_discriminates(self):
        a = dashclaw_pretool.derive_idempotency_key(
            {"agent_id": "agt_1", "action_type": "deploy", "tool_use_id": "tu_1"}
        )
        b = dashclaw_pretool.derive_idempotency_key(
            {"agent_id": "agt_1", "action_type": "deploy", "tool_use_id": "tu_2"}
        )
        self.assertNotEqual(a, b)


def _http_error(code):
    return urllib.error.HTTPError("http://x", code, "err", hdrs=None, fp=None)


class TestTransientOnlyRetries(unittest.TestCase):
    def _run(self, side_effects, retries=2):
        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req)
            effect = side_effects[min(len(calls) - 1, len(side_effects) - 1)]
            raise effect

        with mock.patch.object(http_client.urllib.request, "urlopen", fake_urlopen), \
                mock.patch.object(http_client.time, "sleep"):
            try:
                http_client.request_with_retry(object(), timeout=1, retries=retries)
            except Exception as exc:  # noqa: BLE001 - the exception IS the assertion target
                return calls, exc
        return calls, None

    def test_non_transient_4xx_raises_immediately(self):
        calls, exc = self._run([_http_error(400)])
        self.assertEqual(len(calls), 1)
        self.assertEqual(exc.code, 400)

    def test_auth_4xx_raises_immediately(self):
        calls, exc = self._run([_http_error(401)])
        self.assertEqual(len(calls), 1)
        self.assertEqual(exc.code, 401)

    def test_429_is_retried(self):
        calls, exc = self._run([_http_error(429)])
        self.assertEqual(len(calls), 3)
        self.assertEqual(exc.code, 429)

    def test_408_is_retried(self):
        calls, exc = self._run([_http_error(408)])
        self.assertEqual(len(calls), 3)

    def test_5xx_is_retried(self):
        calls, exc = self._run([_http_error(503)])
        self.assertEqual(len(calls), 3)

    def test_connectivity_error_is_retried(self):
        calls, exc = self._run([urllib.error.URLError("refused")])
        self.assertEqual(len(calls), 3)

    def test_auth_failed_sentinel_preserved(self):
        # api_request(distinguish_auth=True) must still map the immediately
        # raised 401 to the AUTH_FAILED sentinel, not None.
        # BASE_URL is captured at module import from DASHCLAW_URL; on a clean
        # environment (CI) it is "" and urllib rejects the relative URL before
        # the mocked retry layer is reached — pin it so the test is hermetic.
        with mock.patch.object(dashclaw_pretool, "BASE_URL", "http://localhost:3000"), \
                mock.patch.object(dashclaw_pretool, "request_with_retry", side_effect=_http_error(401)):
            result = dashclaw_pretool.api_request(
                "POST", "/api/guard", body={}, timeout=1, retries=0, distinguish_auth=True
            )
        self.assertIs(result, dashclaw_pretool.AUTH_FAILED)


class TestPretoolKeyWiring(unittest.TestCase):
    def test_context_key_derivation_is_stable_and_discriminated(self):
        # The key main() injects: (agent_id, action_type, tool_use_id).
        parts = {"agent_id": "claude-code", "action_type": "execute", "tool_use_id": "tu_x"}
        self.assertEqual(
            dashclaw_pretool.derive_idempotency_key(parts),
            dashclaw_pretool.derive_idempotency_key(dict(parts)),
        )


if __name__ == "__main__":
    unittest.main()
