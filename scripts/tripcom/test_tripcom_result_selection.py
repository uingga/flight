import unittest
from datetime import datetime, timedelta

from tripcom_result_selection import flight_label_selector, identity_failure_evidence
from tripcom_calendar_seed import calendar_seed_dates, calendar_rejection_summary


class ResultSelectionTests(unittest.TestCase):
    def test_full_multiline_label_includes_price(self):
        label = '같은 항공편\n직항편입니다\n왕복 요금: 451,400원'
        selector = flight_label_selector(label)
        self.assertIn('\\a ', selector)
        self.assertIn('451,400원', selector)
        self.assertNotIn('\n', selector)
        self.assertNotIn('aria-label*=', selector)
        self.assertNotIn('aria-label^=', selector)

    def test_quotes_backslashes_and_controls_are_css_escaped(self):
        selector = flight_label_selector('"T1"\\편\r\n\t왕복 요금: 100,000원')
        self.assertIn('\\"T1\\"', selector)
        self.assertIn('\\\\편', selector)
        self.assertIn('\\d \\a \\9 ', selector)

    def test_incomplete_and_invalid_labels_fail_closed(self):
        for label in ('', 'same flight', None, '\x00왕복 요금: 100,000원', 'x' * 8200):
            with self.subTest(label=repr(label)[:60]), self.assertRaisesRegex(ValueError, 'selected_identity_unconfirmed'):
                flight_label_selector(label)

    def test_evidence_has_no_flight_or_account_text(self):
        evidence = identity_failure_evidence('private-value\n왕복 요금: 100,000원', 10000)
        self.assertEqual(evidence['exactLabelMatches'], 1000)
        self.assertEqual(evidence['labelLines'], 2)
        self.assertNotIn('private-value', str(evidence))


class CalendarSeedTests(unittest.TestCase):
    def test_short_haul_keeps_existing_three_nights(self):
        self.assertEqual(calendar_seed_dates(datetime(2026, 9, 26), range(2, 5)),
                         ('2026-10-03', '2026-10-06', 3))

    def test_long_haul_seed_is_inside_five_to_twelve_nights(self):
        self.assertEqual(calendar_seed_dates(datetime(2026, 9, 26), range(5, 13)),
                         ('2026-10-03', '2026-10-08', 5))

    def test_month_and_year_boundaries(self):
        self.assertEqual(calendar_seed_dates(datetime(2026, 12, 28), range(5, 13)),
                         ('2027-01-04', '2027-01-09', 5))

    def test_invalid_policy_is_rejected_before_navigation(self):
        for stays in ([], [False], [0], [31], ['5']):
            with self.subTest(stays=stays), self.assertRaisesRegex(ValueError, 'invalid_calendar_stay_policy'):
                calendar_seed_dates(datetime(2026, 9, 26), stays)

    def test_rejections_distinguish_wrong_stay_from_empty_inventory(self):
        today = datetime(2026, 9, 26)
        def row(offset, nights, price=100000):
            departure = today + timedelta(days=offset)
            return {'dDate': departure.timestamp(), 'aDate': (departure + timedelta(days=nights)).timestamp(), 'currencyPrice': price}
        rows = [row(7, 3), row(7, 5), row(8, 12), row(9, 13), row(61, 5), row(7, 3, -1), None]
        summary = calendar_rejection_summary(rows, today, today+timedelta(days=60), range(5, 13))
        self.assertEqual(summary['stayRejected'], 2)
        self.assertEqual(summary['eligibleRows'], 2)
        self.assertEqual(summary['departureRejected'], 1)
        self.assertEqual(summary['invalidRows'], 1)
        self.assertEqual(summary['priceRejected'], 1)
        self.assertEqual(summary['observedNights']['3'], 1)

    def test_duplicate_dates_do_not_inflate_diagnostics(self):
        today = datetime(2026, 9, 26)
        row = {'dDate': today.timestamp(), 'aDate': (today+timedelta(days=5)).timestamp(), 'currencyPrice': 100000}
        self.assertEqual(calendar_rejection_summary([row, row], today, today+timedelta(days=60), range(5, 13))['eligibleRows'], 1)


if __name__ == '__main__':
    unittest.main()
