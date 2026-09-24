import copy
import unittest
from tripcom_publication import prepare_publication
from test_tripcom_contract import fixture


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.cache = {"flights": [{"id": "naver-source", "source": "myrealtrip", "price": 99999},
            {"id": "old-tao", "source": "tripcom", "arrival": {"city": "칭다오"}},
            {"id": "old-fuk", "source": "tripcom", "arrival": {"city": "후쿠오카"}}],
            "naverState": {"used": 240, "limit": 400}, "other": {"preserve": True}}
        self.artifact = {"publication": "not_submitted", "naverQueries": 0, "runId": "fixture",
            "host": "B", "status": "collected", "observations": [fixture()], "flights": [{"forged": True}]}

    def test_other_sources_and_naver_state_unchanged(self):
        before = copy.deepcopy(self.cache)
        result = prepare_publication(self.cache, self.artifact)["cache"]
        self.assertEqual(self.cache, before)
        self.assertEqual(result["naverState"], before["naverState"])
        self.assertIn(before["flights"][0], result["flights"])
        self.assertIn(before["flights"][2], result["flights"])
        self.assertNotIn(before["flights"][1], result["flights"])
        self.assertFalse(any(f.get("forged") for f in result["flights"]))

    def test_unconfirmed_price_does_not_erase_old_city(self):
        self.artifact["observations"][0]["status"] = "search_quote_observed"
        result = prepare_publication(self.cache, self.artifact)["cache"]
        self.assertEqual(result["flights"], self.cache["flights"])

    def test_blocked_run_preserves_all_existing_prices(self):
        self.artifact["status"] = "blocked"
        result = prepare_publication(self.cache, self.artifact)["cache"]
        self.assertEqual(result["flights"], self.cache["flights"])

    def test_repeated_artifact_has_identical_request_id(self):
        a = prepare_publication(self.cache, self.artifact)
        b = prepare_publication(self.cache, self.artifact)
        self.assertEqual(a["requestId"], b["requestId"])

    def test_multiple_quotes_for_same_city_rejected(self):
        self.artifact["observations"].append(fixture())
        with self.assertRaisesRegex(ValueError, "one_flight_per_city"):
            prepare_publication(self.cache, self.artifact)

    def test_inconclusive_stop_preserves_other_cities_and_publishes_verified_quote(self):
        self.artifact.update(status="inconclusive", expectedCities=40, attemptedCities=4,
            stopReason="repeated_outbound_cards_timeout")
        self.artifact["observations"].extend({"city_code": code, "status": "collector_error",
            "reason": "stage_timeout", "stage": "outbound_cards_wait"} for code in ("osa", "fuk", "tyo"))
        prepared = prepare_publication(self.cache, self.artifact)
        self.assertEqual(prepared["verifiedCount"], 1)
        self.assertEqual(prepared["cache"]["tripcomPrimary"]["status"], "partial")
        self.assertEqual(prepared["cache"]["tripcomPrimary"]["unconfirmedCities"], 39)
        self.assertIn(self.cache["flights"][2], prepared["cache"]["flights"])

    def test_inconclusive_requires_three_card_timeout_observations(self):
        self.artifact.update(status="inconclusive", expectedCities=40, attemptedCities=3,
            stopReason="repeated_outbound_cards_timeout",
            observations=[{"city_code": code, "status": "collector_error",
                "reason": "stage_timeout", "stage": "outbound_cards_wait"} for code in ("osa", "fuk", "tyo")])
        self.artifact["observations"][-1]["stage"] = "calendar_wait"
        with self.assertRaisesRegex(ValueError, "invalid_inconclusive_stop_evidence"):
            prepare_publication(self.cache, self.artifact)


if __name__ == "__main__":
    unittest.main()
