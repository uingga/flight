import unittest
from types import SimpleNamespace
from tripcom_access import AccessGuard
from crawl_tripcom_40destinations import AccessRestricted


class Page:
    def __init__(self, text='항공권 검색'):
        self.text = text
        self.listeners = []
    def on(self, event, handler):
        self.listeners.append(handler)
    def remove_listener(self, event, handler):
        self.listeners.remove(handler)
    def locator(self, selector):
        return self
    def inner_text(self, **unused):
        return self.text


class AccessTests(unittest.TestCase):
    def test_body_timeout_has_exact_stage_and_removes_listener(self):
        class UnloadedPage(Page):
            def inner_text(self, **kwargs):
                raise TimeoutError('fixture')
        page = UnloadedPage()
        with self.assertRaises(TimeoutError) as caught:
            with AccessGuard(page):
                pass
        self.assertEqual(caught.exception.tripcom_stage, 'access_page_read')
        self.assertEqual(page.listeners, [])

    def test_restriction_overrides_timeout_and_removes_listener(self):
        page = Page()
        with self.assertRaises(AccessRestricted):
            with AccessGuard(page) as guard:
                guard.response(SimpleNamespace(url='https://kr.trip.com/api', status=429))
                raise TimeoutError()
        self.assertEqual(page.listeners, [])

    def test_unrelated_domain_is_not_tripcom_block(self):
        page = Page()
        with AccessGuard(page) as guard:
            guard.response(SimpleNamespace(url='https://trip.com.example.org/ad', status=403))
        self.assertEqual(page.listeners, [])

    def test_marketing_pixel_403_does_not_open_access_circuit(self):
        page = Page()
        with AccessGuard(page) as guard:
            guard.response(SimpleNamespace(url='https://kr.trip.com/marketing/pixel',
                status=403, request=SimpleNamespace(resource_type='image')))
        self.assertEqual(page.listeners, [])

    def test_core_api_403_still_stops(self):
        page = Page()
        with self.assertRaises(AccessRestricted):
            with AccessGuard(page) as guard:
                guard.response(SimpleNamespace(url='https://kr.trip.com/restapi/flight',
                    status=403, request=SimpleNamespace(resource_type='xhr')))
        self.assertEqual(page.listeners, [])

    def test_visible_challenge_stops(self):
        with self.assertRaises(AccessRestricted):
            with AccessGuard(Page('Please verify you are human')):
                pass

    def test_korean_challenge_stops(self):
        with self.assertRaises(AccessRestricted):
            with AccessGuard(Page('죄송합니다. 시도 가능 횟수를 초과했습니다. 아래 인증을 완료해 주세요')):
                pass

    def test_visible_challenge_overrides_card_timeout(self):
        page = Page('Please verify you are human')
        with self.assertRaises(AccessRestricted):
            with AccessGuard(page):
                raise TimeoutError()
        self.assertEqual(page.listeners, [])

    def test_plain_card_timeout_is_not_assumed_to_be_a_block(self):
        page = Page()
        with self.assertRaises(TimeoutError):
            with AccessGuard(page):
                raise TimeoutError()
        self.assertEqual(page.listeners, [])

    def test_normal_result_removes_listener(self):
        page = Page()
        with AccessGuard(page):
            pass
        self.assertEqual(page.listeners, [])
