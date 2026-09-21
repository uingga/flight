import copy
import unittest
from tripcom_flight_contract import to_flight


def fixture():
    # Synthetic contract fixture, not a claim of live tax-inclusive validation.
    return {"status": "verified_roundtrip", "price_basis": "adult_roundtrip_total_including_taxes",
        "price": 154500, "currency": "KRW", "adult_count": 1, "cabin": "economy",
        "payment_condition": {"kind": "bank_account", "raw": "내통장결제"},
        "destination": "칭다오", "checked_at": "2026-09-21T18:55:00+09:00",
        "routeAirports": {"outboundDeparture": "ICN", "outboundArrival": "TAO", "returnDeparture": "TAO", "returnArrival": "ICN"},
        "outbound": {"date": "2026-09-30", "departureTime": "07:15", "arrivalTime": "07:55", "airline": "진에어", "direct": True},
        "inbound": {"date": "2026-10-03", "departureTime": "01:05", "arrivalTime": "03:40", "airline": "진에어", "direct": True},
        "booking_url": "https://kr.trip.com/flights/showfarefirst?triptype=RT&ddate=2026-09-30&rdate=2026-10-03"}


class ContractTests(unittest.TestCase):
    def test_bank_condition_preserved_for_detail_only(self):
        flight = to_flight(fixture())
        self.assertEqual(flight["tripcomDetail"]["paymentNotice"], "내통장결제 기준")
        self.assertEqual(flight["tripcomDetail"]["paymentNoticePlacement"], "detail_only")
        self.assertEqual(flight["price"], 154500)

    def test_specific_card_cannot_silently_become_general_price(self):
        row = fixture()
        row["payment_condition"] = {"kind": "card", "raw": "현대카드"}
        with self.assertRaisesRegex(ValueError, "payment_condition"):
            to_flight(row)

    def test_missing_payment_is_not_unrestricted(self):
        row = fixture()
        del row["payment_condition"]
        with self.assertRaisesRegex(ValueError, "payment_condition"):
            to_flight(row)

    def test_verified_fixture_maps_times_and_preserves_unknown_seats(self):
        flight = to_flight(fixture())
        self.assertEqual(flight["arrival"]["time"], "01:05")
        self.assertNotIn("availableSeats", flight)
        self.assertNotIn("seats", flight)

    def test_unverified_search_price_rejected(self):
        row = fixture()
        row["status"] = "search_quote_observed"
        with self.assertRaisesRegex(ValueError, "unverified"):
            to_flight(row)

    def test_city_code_cannot_be_airport(self):
        row = fixture()
        row["routeAirports"]["outboundArrival"] = "TYO"
        with self.assertRaisesRegex(ValueError, "actual_airport"):
            to_flight(row)

    def test_seat_conflict_zero_wins(self):
        row = fixture()
        row.update(availableSeats=2, seats="0석")
        with self.assertRaisesRegex(ValueError, "sold_out"):
            to_flight(row)

    def test_less_than_nine_is_not_nine(self):
        row = fixture()
        row["seats"] = "9석 미만 남음"
        with self.assertRaisesRegex(ValueError, "requires_parsing"):
            to_flight(row)

    def test_price_change_does_not_change_flight_identity(self):
        row = fixture()
        changed = copy.deepcopy(row)
        changed["price"] += 1000
        self.assertEqual(to_flight(row)["id"], to_flight(changed)["id"])

    def test_date_mismatch_rejected(self):
        row = fixture()
        row["booking_url"] = row["booking_url"].replace("2026-10-03", "2026-10-04")
        with self.assertRaisesRegex(ValueError, "schedule_mismatch"):
            to_flight(row)


if __name__ == "__main__":
    unittest.main()
