import copy
import unittest
from tripcom_connections import connection_details, endpoint_airports, public_leg_details
from tripcom_dom import parse_card, cheapest_card, verify_route
from tripcom_flight_contract import to_flight
from test_tripcom_contract import fixture
import test_tripcom_dom


class ConnectionTests(unittest.TestCase):
    def card(self, marker):
        card = test_tripcom_dom.DomTests().card()
        card['label'] = card['label'].replace('직항편', marker)
        card['text'] = card['text'].replace('직항', marker)
        return card

    def test_explicit_direct(self):
        leg = parse_card(self.card('직항편'))
        self.assertEqual((leg['direct'], leg['stopCount'], leg['durationMinutes']), (True, 0, 100))

    def test_connecting_quotes_are_not_rejected(self):
        for marker in ('경유 1회', '1회 경유', '환승 2회', '2 stops'):
            with self.subTest(marker=marker):
                leg = parse_card(self.card(marker))
                self.assertIs(leg['direct'], False)
                self.assertIn(leg['stopCount'], (1, 2))

    def test_unknown_is_not_direct_and_does_not_reject(self):
        leg = parse_card(self.card('항공편'))
        self.assertIsNone(leg['direct'])
        self.assertIsNone(leg['stopCount'])

    def test_connecting_without_count(self):
        leg = parse_card(self.card('경유편'))
        self.assertIs(leg['direct'], False)
        self.assertIsNone(leg['stopCount'])

    def test_cheapest_connecting_card_kept(self):
        cheapest = self.card('경유 1회')
        cheapest['label'] = cheapest['label'].replace('154,500', '100,000')
        self.assertEqual(cheapest_card([self.card('직항편'), cheapest])['price'], 100000)

    def test_extra_airport_requires_endpoint_evidence(self):
        text = '항공사\n07:15\nICN T1\n10시간\n경유 1회\nPVG\n17:15\nDYG'
        self.assertEqual(endpoint_airports(text, '07:15', '17:15'), ['ICN', 'DYG'])
        with self.assertRaisesRegex(ValueError, 'endpoint_airports'):
            endpoint_airports('ICN\nPVG\nDYG', '07:15', '17:15')

    def test_positive_connection_wins_over_direct(self):
        self.assertEqual(connection_details('직항편', '경유 1회')['direct'], False)
        self.assertEqual(public_leg_details({'direct': True, 'stopCount': 1})['status'], 'connecting')

    def test_negated_direct_not_claimed_as_direct(self):
        self.assertIsNone(connection_details('직항편이 아닙니다', '')['direct'])
        self.assertIsNone(connection_details('', '경유 여부 확인 필요')['direct'])
        self.assertEqual(connection_details('경유 0회', '경유 0회')['direct'], True)

    def test_tentative_or_negated_connections_are_not_labelled(self):
        for text in ('경유 1회 여부 확인 필요', '환승 2회 미확인', '경유편이 아닙니다',
                     '1 stop unconfirmed', 'not a connecting flight'):
            with self.subTest(text=text):
                self.assertIsNone(connection_details(text, '')['direct'])
                self.assertIsNone(connection_details(text, '')['stopCount'])

    def test_failed_city_shapes_reach_flight_mapping_without_direct_only_gate(self):
        # Synthetic shapes exercising the guard hit by the saved KUL/DLI/HKT
        # errors. No original failed DOM was retained; these are not live quotes.
        for code, name, country in (('KUL', '쿠알라룸푸르', '말레이시아'),
                                    ('DLI', '달랏', '베트남'), ('HKT', '푸껫', '태국')):
            for marker, status in (('경유 1회', 'connecting'), ('항공편', 'unknown')):
                with self.subTest(code=code, marker=marker):
                    outgoing = self.card(marker)
                    outgoing['text'] = outgoing['text'].replace('TAO', code)
                    returning = copy.deepcopy(outgoing)
                    returning['label'] = returning['label'].replace('2026-09-30', '2026-10-03')
                    returning['text'] = returning['text'].replace('ICN', 'TMP').replace(code, 'ICN').replace('TMP', code)
                    out, inc = parse_card(outgoing), parse_card(returning)
                    verify_route({'iata': code}, out, inc)
                    row = fixture()
                    row.update(destination=name, country=country, city_code=code.lower(),
                               outbound=out, inbound=inc)
                    row['routeAirports'].update(outboundArrival=code, returnDeparture=code)
                    result = to_flight(row)
                    self.assertEqual(result['price'], 154500)
                    self.assertEqual(result['arrival']['airport'], code)
                    self.assertEqual(result['tripcomDetail']['legs']['outbound']['status'], status)
                    self.assertEqual(result['tripcomDetail']['legs']['inbound']['status'], status)

    def test_price_route_and_dates_remain_mandatory_for_connections(self):
        leg = parse_card(self.card('경유 1회'))
        with self.assertRaisesRegex(ValueError, 'selected_route_mismatch'):
            verify_route({'iata': 'KUL'}, leg, {**leg, 'departureAirport': 'TAO', 'arrivalAirport': 'ICN'})
        missing = self.card('경유 1회')
        missing['label'] = missing['label'].replace('왕복 요금: 154,500원', '')
        with self.assertRaises(ValueError):
            parse_card(missing)

    def test_ambiguous_durations_not_summed_or_guessed(self):
        self.assertIsNone(connection_details('', '2시간\n3시간\n환승 4시간')['durationMinutes'])
        self.assertEqual(connection_details('총 28시간 10분이 소요', '')['durationMinutes'], 1690)

    def test_mixed_legs_and_arrival_date_preserved_in_flight(self):
        quote = fixture()
        quote['outbound'].update(direct=False, stopCount=1, durationMinutes=1690, arrivalDate='2026-10-01')
        del quote['inbound']['direct']
        flight = to_flight(quote)
        self.assertEqual(flight['tripcomDetail']['legs']['outbound'], {
            'status': 'connecting', 'stopCount': 1, 'durationMinutes': 1690, 'arrivalDate': '2026-10-01'})
        self.assertEqual(flight['tripcomDetail']['legs']['inbound'], {'status': 'unknown', 'stopCount': None})

    def test_old_direct_fixture_still_maps_to_direct(self):
        self.assertEqual(to_flight(fixture())['tripcomDetail']['legs']['outbound'], {'status': 'direct', 'stopCount': 0})

    def test_calendar_direct_flag_does_not_override_legs(self):
        quote = fixture()
        quote['direct'] = True
        quote['outbound']['direct'] = None
        self.assertEqual(to_flight(quote)['tripcomDetail']['legs']['outbound']['status'], 'unknown')

    def test_invalid_types_and_required_fields_still_rejected(self):
        for change in ({'direct': 'true'}, {'stopCount': -1}, {'departureTime': ''}, {'airline': ''}):
            quote = copy.deepcopy(fixture())
            quote['outbound'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                to_flight(quote)
        quote = fixture()
        quote['availableSeats'] = 0
        with self.assertRaisesRegex(ValueError, 'sold_out'):
            to_flight(quote)


if __name__ == '__main__':
    unittest.main()
