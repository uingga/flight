"""Offline installed-runtime regressions; no navigation to travel websites."""
import html
import importlib.util
import os
import unittest


@unittest.skipUnless(os.environ.get('TRIPCOM_OFFLINE_BROWSER_TEST') == '1',
                     'Explicit offline browser fixture run only')
class SelectionBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        import tripcom_dom
        cls.dom = tripcom_dom
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True,
            executable_path=os.environ.get('TRIPCOM_TEST_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context()
        self.requests = []
        def deny(route):
            self.requests.append(route.request.url)
            route.abort()
        self.context.route('**/*', deny)
        self.page = self.context.new_page()

    def tearDown(self):
        self.assertEqual(self.requests, [])
        self.context.close()

    def fixture(self, prices=(451400, 461400), hidden_duplicate=False, prefix='인천국제공항 T1'):
        # Synthetic cards based on the shape of a saved successful DPS observation.
        # The failed TPE page was not retained; this is not a reconstruction of it.
        label = (prefix + '에서 2026-10-30 15:10:00에 출발하여 응우라라이 국제공항 I에 '
                 '2026-10-30 21:50:00에 도착하는 항공편.\n'
                 '이 항공편은 7시간 40분이 소요되는 직항편입니다\n왕복 요금: {price:,}원')
        text = '제주항공\n저비용 항공사\n15:10\nICN\nT1\n7시간 40분\n직항\n21:50\nDPS\nI'
        cards = []
        for i, price in enumerate(prices):
            display = 'display:none;' if hidden_duplicate and i == len(prices)-1 else ''
            cards.append(f'<div class="result-item" style="{display}"><div class="f-info-content" data-fixture="{i}">'
                         f'<div class="flight-info" aria-label="{html.escape(label.format(price=price), quote=True)}">'
                         f'{html.escape(text)}</div><button onclick="window.selected={i}">선택</button></div></div>')
        self.page.set_content('<style>.flight-info{white-space:pre-line}</style>' + ''.join(cards))
        return self.dom.cheapest_card(self.page.evaluate(self.dom.CARD_SCRIPT), '2026-10-30')

    def test_old_prefix_selector_reproduces_ambiguous_failure(self):
        baseline = os.environ.get('TRIPCOM_BASELINE_DOM')
        if not baseline:
            self.skipTest('Baseline path is needed for explicit before/after reproduction')
        spec = importlib.util.spec_from_file_location('tripcom_before_identity_fix', baseline)
        old = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(old)
        leg = self.fixture()
        with self.assertRaisesRegex(ValueError, 'selected_identity_ambiguous'):
            old.select_leg(self.page, leg, '2026-10-30')
        self.assertIsNone(self.page.evaluate('window.selected'))

    def test_complete_multiline_label_selects_observed_cheapest_fare(self):
        leg = self.fixture((461400, 451400))
        self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertEqual(self.page.evaluate('window.selected'), 1)

    def test_reordering_does_not_select_a_different_fare(self):
        leg = self.fixture()
        self.page.evaluate('document.body.append(document.querySelector(".result-item"))')
        self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertEqual(self.page.evaluate('window.selected'), 0)

    def test_hidden_duplicate_does_not_count_as_visible_fare(self):
        leg = self.fixture((451400, 451400), hidden_duplicate=True)
        self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertEqual(self.page.evaluate('window.selected'), 0)

    def test_exact_duplicates_remain_unconfirmed(self):
        leg = self.fixture((451400, 451400))
        with self.assertRaisesRegex(ValueError, 'selected_identity_ambiguous') as error:
            self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertEqual(error.exception.tripcom_evidence['exactLabelMatches'], 2)
        self.assertIsNone(self.page.evaluate('window.selected'))

    def test_changed_price_is_not_silently_selected(self):
        leg = self.fixture((451400,))
        self.page.locator('.flight-info').evaluate('el => el.setAttribute("aria-label", el.getAttribute("aria-label").replace("451,400", "551,400"))')
        with self.assertRaisesRegex(ValueError, 'selected_identity_missing'):
            self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertIsNone(self.page.evaluate('window.selected'))

    def test_quotes_and_backslashes_cannot_broaden_css_selector(self):
        leg = self.fixture((461400, 451400), prefix='인천국제공항 "T1"\\국제선')
        self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertEqual(self.page.evaluate('window.selected'), 1)

    def test_no_aria_label_card_keeps_existing_scoped_validation(self):
        self.page.set_content('<div class="f-info-content" style="white-space:pre-line">'
            '<img alt="피치항공">22:30\nICN T1\n00:20 +1\nKIX T1\n1시간 50분 직항\n189,500원\n왕복'
            '<button onclick="window.selected=0">선택</button></div>')
        leg = self.dom.cheapest_card(self.page.evaluate(self.dom.CARD_SCRIPT), '2026-10-30')
        self.dom.select_leg(self.page, leg, '2026-10-30')
        self.assertEqual(self.page.evaluate('window.selected'), 0)


if __name__ == '__main__':
    unittest.main()
