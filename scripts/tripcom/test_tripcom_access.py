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

    def test_visible_challenge_stops(self):
        with self.assertRaises(AccessRestricted):
            with AccessGuard(Page('Please verify you are human')):
                pass

    def test_normal_result_removes_listener(self):
        page = Page()
        with AccessGuard(page):
            pass
        self.assertEqual(page.listeners, [])
