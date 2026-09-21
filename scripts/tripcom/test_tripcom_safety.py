import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import crawl_tripcom_40destinations as crawler


class Response:
    url = "https://kr.trip.com/GetLowPriceInCalender"

    def __init__(self, status=200, data=None):
        self.status = status
        self.data = data

    def json(self):
        return self.data


class Page:
    def __init__(self, card=None, status=200, navigation_error=False):
        self.card = card
        self.status = status
        self.navigation_error = navigation_error
        self.listener = None
        self.visits = 0

    def on(self, event, listener):
        self.listener = listener

    def remove_listener(self, event, listener):
        self.listener = None

    def goto(self, *args, **kwargs):
        self.visits += 1
        if self.navigation_error:
            raise TimeoutError("fixture")
        if self.listener:
            day = crawler.TODAY + crawler.timedelta(days=7)
            self.listener(Response(self.status, {"lowPriceInCalenderDtoInfoList": [{
                "currencyPrice": 100000, "dDate": day.timestamp(),
                "aDate": (day + crawler.timedelta(days=3)).timestamp()
            }]}))
        return Response(self.status)

    def wait_for_selector(self, *args, **kwargs):
        pass

    def wait_for_timeout(self, *args):
        pass

    def evaluate(self, script):
        return self.card


class SafetyTests(unittest.TestCase):
    def scan(self, page):
        return crawler.scan_destination(page, crawler.TOP_40_DESTINATIONS[0], 1, 40)

    def test_missing_card_never_uses_calendar_as_live_price(self):
        row = self.scan(Page())
        self.assertEqual(row["status"], "live_price_unconfirmed")
        self.assertIsNone(row["price"])
        self.assertFalse(row["publishable"])

    def test_observed_search_quote_is_not_publishable_or_naver_eligible(self):
        row = self.scan(Page({"minPrice": 120000, "airline": "진에어", "isDirect": True, "summaryText": "fixture"}))
        self.assertEqual(row["status"], "search_quote_observed")
        self.assertEqual(row["live_price"], 120000)
        self.assertFalse(row["naver_eligible"])
        self.assertFalse(row["publishable"])

    def test_navigation_failure_does_not_read_stale_card(self):
        page = Page(navigation_error=True)
        self.assertEqual(self.scan(page)["status"], "calendar_navigation_failed")
        self.assertEqual(page.visits, 1)
        self.assertIsNone(page.listener)

    def test_access_restriction_stops_before_second_navigation(self):
        for status in (401, 403, 429):
            page = Page(status=status)
            with self.assertRaises(crawler.AccessRestricted):
                self.scan(page)
            self.assertEqual(page.visits, 1)

    def test_atomic_checkpoint_keeps_latest_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            latest = Path(directory) / "tripcom_40destinations_latest.json"
            crawler.write_json_atomic(str(latest), [{"old": True}])
            checkpoint = Path(directory) / "tripcom_40destinations_checkpoint.json"
            crawler.write_json_atomic(str(checkpoint), [{"partial": True}])
            self.assertEqual(json.loads(latest.read_text()), [{"old": True}])
            self.assertFalse(list(Path(directory).glob("*.tmp")))


if __name__ == "__main__":
    unittest.main()
