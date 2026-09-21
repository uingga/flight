import tempfile
import unittest
from tripcom_runner import run_admitted


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.events = []

    def args(self):
        return dict(state_root=self.directory.name, run_id="slot", host="B",
            destinations=[{"city_code": "fuk"}],
            browser_factory=lambda: (self.events.append("open") or "browser", "page"),
            assert_owner=lambda *args: self.events.append("owner"),
            close_browser=lambda browser: self.events.append("closed"),
            scan=lambda page, dest, *args: {**dest, "status": "search_quote_observed"})

    def test_browser_closes_and_result_is_not_published(self):
        result = run_admitted(**self.args())
        self.assertEqual(self.events, ["owner", "owner", "open", "closed"])
        self.assertEqual(result["publication"], "not_submitted")

    def test_no_browser_when_admission_fails(self):
        args = self.args()
        def refuse(*args):
            raise RuntimeError("admission_unavailable")
        args["assert_owner"] = refuse
        with self.assertRaisesRegex(RuntimeError, "admission_unavailable"):
            run_admitted(**args)
        self.assertEqual(self.events, [])

    def test_no_browser_when_same_run_already_finished(self):
        run_admitted(**self.args())
        self.events.clear()
        with self.assertRaisesRegex(RuntimeError, "already_terminal"):
            run_admitted(**self.args())
        self.assertNotIn("open", self.events)

    def test_cleanup_failure_propagates(self):
        args = self.args()
        def fail_close(browser):
            raise RuntimeError("browser_cleanup_unknown")
        args["close_browser"] = fail_close
        with self.assertRaisesRegex(RuntimeError, "cleanup_unknown"):
            run_admitted(**args)

    def test_ownership_loss_stops_all_remaining_cities(self):
        args = self.args()
        args["destinations"] = [{"city_code": "fuk"}, {"city_code": "osa"}, {"city_code": "tyo"}]
        checks = []
        def owner(*unused):
            checks.append(True)
            if len(checks) == 3:
                raise RuntimeError("owner lost")
        args["assert_owner"] = owner
        with self.assertRaisesRegex(RuntimeError, "central_ownership_unconfirmed"):
            run_admitted(**args)
        self.assertEqual(len(checks), 3)
        self.assertEqual(self.events, ["open", "closed"])


if __name__ == "__main__":
    unittest.main()
