"""In-memory calendar navigation regressions against the staged installed runtime."""
import os
import unittest
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch


@unittest.skipUnless(os.environ.get('TRIPCOM_INSTALLED_RUNTIME_TEST') == '1',
                     'Explicit staged installed-runtime test only')
class CalendarRuntimeTests(unittest.TestCase):
    def setUp(self):
        import crawl_tripcom_40destinations
        self.crawler = crawl_tripcom_40destinations

    def page(self, status=200, returned_nights=None):
        class Response:
            url = 'https://kr.trip.com/GetLowPriceInCalender'
            def __init__(self, data):
                self.status, self.data = status, data
            def json(self):
                return self.data

        class Page:
            listener = None
            def __init__(self):
                self.visits = []
            def on(self, event, callback):
                self.listener = callback
            def remove_listener(self, event, callback):
                self.listener = None
            def goto(self, url, **kwargs):
                self.visits.append(url)
                query = parse_qs(urlparse(url).query)
                departure = datetime.fromisoformat(query['ddate'][0])
                returning = datetime.fromisoformat(query['rdate'][0])
                if returned_nights is not None:
                    returning = departure + timedelta(days=returned_nights)
                response = Response({'lowPriceInCalenderDtoInfoList': [{
                    'currencyPrice': 100000, 'dDate': departure.timestamp(),
                    'aDate': returning.timestamp()}]})
                self.listener(response)
                return response
        return Page()

    def scan(self, code, page):
        city = next(x for x in self.crawler.TOP_40_DESTINATIONS if x['city_code'] == code)
        return self.crawler.scan_destination(page, city, 1, 1, collect_roundtrip_list=True)

    def test_long_haul_uses_valid_seed_and_one_calendar_navigation(self):
        for code in ('syd', 'hnl'):
            page = self.page()
            with patch('tripcom_dom.collect_roundtrip', side_effect=lambda p, candidate, url, check: candidate) as collect:
                result = self.scan(code, page)
            self.assertEqual(len(page.visits), 1)
            self.assertEqual(result['nights'], 5)
            self.assertEqual(collect.call_count, 1)
            self.assertIsNone(page.listener)

    def test_short_haul_seed_does_not_change(self):
        page = self.page()
        with patch('tripcom_dom.collect_roundtrip', side_effect=lambda p, candidate, url, check: candidate):
            result = self.scan('fuk', page)
        self.assertEqual(result['nights'], 3)
        self.assertEqual(len(page.visits), 1)

    def test_wrong_stay_response_is_diagnosed_not_published(self):
        page = self.page(returned_nights=3)
        with patch('tripcom_dom.collect_roundtrip') as collect:
            result = self.scan('syd', page)
        self.assertEqual(result['status'], 'no_matching_candidates')
        self.assertEqual(result['diagnostics']['initialNights'], 5)
        self.assertEqual(result['diagnostics']['observedNights'], {'3': 1})
        self.assertEqual(result['diagnostics']['stayRejected'], 1)
        self.assertEqual(result['diagnostics']['eligibleRows'], 0)
        collect.assert_not_called()
        self.assertEqual(len(page.visits), 1)

    def test_access_restriction_still_stops_without_retry(self):
        for status in (401, 403, 429):
            page = self.page(status=status)
            with patch('tripcom_dom.collect_roundtrip') as collect:
                with self.assertRaises(self.crawler.AccessRestricted):
                    self.scan('syd', page)
                collect.assert_not_called()
            self.assertEqual(len(page.visits), 1)


if __name__ == '__main__':
    unittest.main()
