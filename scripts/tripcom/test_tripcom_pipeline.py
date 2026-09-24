import tempfile
import unittest
from pathlib import Path
from tripcom_pipeline import execute_run
from crawl_tripcom_40destinations import AccessRestricted


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.destinations = [{"city_code": "fuk"}, {"city_code": "osa"}]

    def run_fixture(self, scan, run="test-1"):
        return execute_run(self.directory.name, run, "B", self.destinations, scan)

    def test_exactly_one_scan_per_city_and_no_publication(self):
        calls = []
        def scan(dest, *args):
            calls.append(dest["city_code"])
            return {**dest, "status": "search_quote_observed"}
        result = self.run_fixture(scan)
        self.assertEqual(calls, ["fuk", "osa"])
        self.assertEqual(result["flights"], [])
        self.assertEqual(result["publication"], "not_submitted")
        self.assertEqual(result["naverQueries"], 0)
        self.assertFalse(Path(self.directory.name, "tripcom_40destinations_latest.json").exists())

    def test_block_prevents_next_city_and_new_run(self):
        calls = []
        def scan(dest, *args):
            calls.append(dest)
            raise AccessRestricted("http_429")
        self.assertEqual(self.run_fixture(scan)["status"], "blocked")
        self.assertEqual(len(calls), 1)
        with self.assertRaisesRegex(RuntimeError, "circuit_open"):
            self.run_fixture(scan, "test-2")
        self.assertEqual(len(calls), 1)

    def test_finished_run_not_repeated(self):
        self.run_fixture(lambda dest, *args: {**dest, "status": "search_quote_observed"})
        with self.assertRaisesRegex(RuntimeError, "already_terminal"):
            self.run_fixture(lambda *args: self.fail("must not request"))

    def test_more_than_40_cities_rejected_before_requests(self):
        with self.assertRaisesRegex(ValueError, "limit_exceeded"):
            execute_run(self.directory.name, "test", "B", [{"city_code": str(i)} for i in range(41)],
                lambda *args: self.fail("must not request"))

    def test_individual_error_is_saved_not_success(self):
        def scan(*args):
            raise TimeoutError("fixture")
        result = self.run_fixture(scan)
        self.assertEqual(len(result["rejected"]), 2)
        self.assertTrue(all(r["status"] == "collector_error" for r in result["observations"]))

    def test_three_missing_card_timeouts_stop_only_this_run(self):
        self.destinations = [{"city_code": str(i)} for i in range(5)]
        calls = []
        def scan(dest, *args):
            calls.append(dest["city_code"])
            error = TimeoutError("browser page details must not be saved")
            error.tripcom_stage = "outbound_cards_wait"
            raise error
        result = self.run_fixture(scan)
        self.assertEqual(calls, ["0", "1", "2"])
        self.assertEqual(result["status"], "inconclusive")
        self.assertEqual(result["attemptedCities"], 3)
        self.assertEqual(result["stopReason"], "repeated_outbound_cards_timeout")
        self.assertFalse(Path(self.directory.name, "circuit.json").exists())
        self.assertNotIn("browser page details", str(result))

    def test_success_between_timeouts_resets_missing_card_streak(self):
        self.destinations = [{"city_code": str(i)} for i in range(4)]
        def scan(dest, *args):
            if dest["city_code"] == "1":
                return {**dest, "status": "no_matching_candidates"}
            error = TimeoutError("fixture")
            error.tripcom_stage = "outbound_cards_wait"
            raise error
        result = self.run_fixture(scan)
        self.assertEqual(result["status"], "collected")
        self.assertEqual(result["attemptedCities"], 4)


if __name__ == "__main__":
    unittest.main()
