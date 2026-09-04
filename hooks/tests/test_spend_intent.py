"""Spend intent detection (2026-09-04 incident: `node
tmp/tradesdesk-launch/domain-buy.mjs truckside.io` bought two domains — the
classifier graded it interpreter/35, the server graded the command TEXT
other/30, and neither route ever reached the org's spend policy).

Covers:
- bash_classifier: a purchase URL in command text, or a purchase-shaped CLI
  invocation in command position, grades "spend" (irreversible, risk >= 75).
- written_paths_ledger.grade_script_content: a script whose CONTENT names a
  purchase endpoint grades the same way, independent of extension.
"""

import os
import shutil
import tempfile
import unittest

from dashclaw_agent_intel.bash_classifier import classify_bash
from dashclaw_agent_intel.written_paths_ledger import grade_script_content


class TestBashClassifierSpendIntent(unittest.TestCase):
    def test_script_invocation_with_no_url_in_text_stays_interpreter(self):
        r = classify_bash("node tmp/domain-buy.mjs x.com")
        self.assertEqual(r["intent"], "interpreter")

    def test_curl_post_to_registrar_buy_endpoint_is_spend(self):
        r = classify_bash(
            "curl -X POST https://api.vercel.com/v1/registrar/domains/x.com/buy"
        )
        self.assertEqual(r["intent"], "spend")
        self.assertGreaterEqual(r["risk_score"], 75)
        self.assertFalse(r["reversible"])

    def test_curl_get_to_registrar_price_endpoint_is_not_spend(self):
        r = classify_bash(
            "curl https://api.vercel.com/v1/registrar/domains/x.com/price"
        )
        self.assertNotEqual(r["intent"], "spend")

    def test_echo_of_a_buy_url_is_readonly(self):
        r = classify_bash(
            "echo https://api.vercel.com/v1/registrar/domains/x.com/buy"
        )
        self.assertEqual(r["intent"], "readonly")

    def test_vercel_domains_buy_cli_is_spend(self):
        r = classify_bash("vercel domains buy x.com")
        self.assertEqual(r["intent"], "spend")
        self.assertFalse(r["reversible"])

    def test_stripe_payment_intents_create_is_spend(self):
        r = classify_bash("stripe payment_intents create --amount 100")
        self.assertEqual(r["intent"], "spend")
        self.assertGreaterEqual(r["risk_score"], 75)

    def test_git_clone_of_a_repo_named_checkout_is_not_spend(self):
        r = classify_bash("git clone https://github.com/actions/checkout")
        self.assertNotEqual(r["intent"], "spend")

    def test_docs_page_mentioning_checkout_is_not_spend(self):
        r = classify_bash("curl https://stripe.com/docs/checkout")
        self.assertNotEqual(r["intent"], "spend")

    def test_purchase_path_under_versioned_api_shape_is_spend(self):
        r = classify_bash("curl -X POST https://api.shop.example/v1/checkout")
        self.assertEqual(r["intent"], "spend")

    def test_purchase_path_on_payment_shaped_host_is_spend(self):
        r = classify_bash("curl -X POST https://pay.example.com/checkout")
        self.assertEqual(r["intent"], "spend")

    def test_purchase_path_under_api_path_shape_is_spend(self):
        r = classify_bash("curl -X POST https://example.com/api/purchase")
        self.assertEqual(r["intent"], "spend")


class TestGradeScriptContentSpendEndpoint(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dashclaw_spend_")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_mjs_script_naming_a_registrar_buy_url_grades_high(self):
        path = os.path.join(self.dir, "domain-buy.mjs")
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                "const res = await fetch("
                "'https://api.vercel.com/v1/registrar/domains/' + name + '/buy', "
                "{method: 'POST'});\n"
            )
        graded = grade_script_content(path)
        self.assertTrue(graded["readable"])
        self.assertGreaterEqual(graded["risk_score"], 75)
        checks = [v["check"] for v in graded["validations"]]
        self.assertIn("spend_endpoint", checks)


if __name__ == "__main__":
    unittest.main()
