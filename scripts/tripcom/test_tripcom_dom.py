import unittest
from tripcom_dom import parse_card, parse_fare, verify_fee_breakdown, cheapest_card


class DomTests(unittest.TestCase):
    def card(self):
        return {"index": 0, "label": "인천국제공항 T2에서 2026-09-30 07:15:00에 출발하여 칭다오 자오둥 국제공항 에 2026-09-30 07:55:00에 도착하는 항공편. 이 항공편은 1시간 40분이 소요되는 직항편입니다 왕복 요금: 154,500원",
            "text": "진에어\n저비용 항공사\n07:15\nICN\nT2\n1시간 40분\n직항\n07:55\nTAO"}

    def test_observed_card(self):
        card = parse_card(self.card())
        self.assertEqual((card["price"], card["departureAirport"], card["arrivalAirport"]), (154500, "ICN", "TAO"))

    def test_cheaper_unsupported_card_not_silently_skipped(self):
        card = self.card()
        card["text"] = "unknown"
        card["label"] = card["label"].replace("154,500", "100,000")
        with self.assertRaises(ValueError):
            cheapest_card([self.card(), card])

    def test_fare_uses_structured_total_not_cancellation_fee(self):
        fare = parse_fare([{"index": 0, "price": "154500", "text": "154,500원\n155,900원\n왕복\n2석 남음\n일반석\n변경 수수료: 60,000원부터\n결제 방법: 내통장결제"}])
        self.assertEqual(fare["price"], 154500)
        self.assertEqual(fare["availableSeats"], 2)

    def test_optional_bundle_not_base_fare(self):
        with self.assertRaises(ValueError):
            parse_fare([{"index": 0, "price": "154500", "text": "왕복 일반석 트립플렉스 결제 방법: 내통장결제"}])

    def test_observed_fees_and_total(self):
        text = "154,500원 (성인 1인 기준) 유류할증료 80,500원 기타 세금 및 수수료 42,700원 내통장결제 할인 - 1,400원 트립닷컴 발권수수료 10,000원 왕복 총금액 154,500원"
        verify_fee_breakdown(text, 154500)
        with self.assertRaises(ValueError):
            verify_fee_breakdown(text, 155900)


if __name__ == "__main__":
    unittest.main()
