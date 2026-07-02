"""Risk-calibration golden vectors, client layer.

Runs the shared fixture's bash_command vectors through the pure
classify_bash() classifier. The JS mirror
(__tests__/unit/risk-calibration-golden.test.js) runs the same fixture's
server_context vectors through computeRiskScore. Two-sided contract:
benign vectors must stay at/below max_risk, risky vectors at/above
min_risk. Add cases per the fixture header comment.
"""

import json
import os
import sys
import unittest

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_HOOKS_DIR)
sys.path.insert(0, _HOOKS_DIR)

from dashclaw_agent_intel.bash_classifier import classify_bash  # noqa: E402

_FIXTURE = os.path.join(
    _REPO_ROOT, "__tests__", "fixtures", "risk-calibration-golden-vectors.json"
)


def _load_vectors():
    with open(_FIXTURE, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return [
        v for v in data["vectors"]
        if v.get("bash_command") and v.get("client_expected")
    ]


class TestRiskCalibrationGolden(unittest.TestCase):
    def test_fixture_has_both_sides(self):
        vectors = _load_vectors()
        labels = {v["label"] for v in vectors}
        self.assertIn("benign", labels)
        self.assertIn("risky", labels)

    def test_client_vectors(self):
        for v in _load_vectors():
            with self.subTest(name=v["name"], label=v["label"]):
                result = classify_bash(v["bash_command"])
                expected = v["client_expected"]
                if "intent" in expected:
                    self.assertEqual(
                        result.get("intent"), expected["intent"],
                        f"{v['name']}: intent drifted (source: {v['source']})",
                    )
                score = result.get("risk_score")
                self.assertIsInstance(score, (int, float))
                if "max_risk" in expected:
                    self.assertLessEqual(
                        score, expected["max_risk"],
                        f"{v['name']}: benign vector drifted above its band "
                        f"(source: {v['source']})",
                    )
                if "min_risk" in expected:
                    self.assertGreaterEqual(
                        score, expected["min_risk"],
                        f"{v['name']}: risky vector fell below its floor "
                        f"(source: {v['source']})",
                    )


if __name__ == "__main__":
    unittest.main()
