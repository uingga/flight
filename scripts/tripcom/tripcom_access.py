"""Observe access restrictions without retries or challenge interaction."""
from urllib.parse import urlsplit
from crawl_tripcom_40destinations import AccessRestricted


class AccessGuard:
    def __init__(self, page):
        self.page = page
        self.reason = None

    def response(self, response):
        host = (urlsplit(response.url).hostname or "").lower()
        if (host == "trip.com" or host.endswith(".trip.com")) and response.status in (401, 403, 429):
            self.reason = f"HTTP {response.status}"

    def check(self):
        if self.reason:
            raise AccessRestricted(self.reason)
        text = self.page.locator('body').inner_text(timeout=3000).lower()
        if any(marker in text for marker in (
            "verify you are human", "access denied", "unusual traffic",
            "로봇이 아닙니다", "보안 인증을 완료", "접근이 제한",
        )):
            raise AccessRestricted("visible_access_challenge")

    def __enter__(self):
        self.page.on('response', self.response)
        return self

    def __exit__(self, exc_type, exc, traceback):
        try:
            # A timeout must not hide a restriction observed while waiting.
            if self.reason:
                raise AccessRestricted(self.reason)
            if exc_type is None:
                self.check()
        finally:
            self.page.remove_listener('response', self.response)
