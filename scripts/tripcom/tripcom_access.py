"""Observe access restrictions without retries or challenge interaction."""
from urllib.parse import urlsplit
from crawl_tripcom_40destinations import AccessRestricted
from tripcom_diagnostics import stage


class AccessGuard:
    def __init__(self, page):
        self.page = page
        self.reason = None

    def response(self, response):
        parsed = urlsplit(response.url)
        host = (parsed.hostname or "").lower()
        path = parsed.path.lower()
        if (host == "trip.com" or host.endswith(".trip.com")) and response.status in (401, 403, 429):
            # A blocked marketing pixel must not stop flight collection.
            request = getattr(response, "request", None)
            is_core = any(part in path for part in ("/flights", "/restapi", "/api", "/soa2"))
            if is_core or getattr(request, "resource_type", None) == "document":
                self.reason = f"HTTP {response.status}"

    def check(self):
        if self.reason:
            raise AccessRestricted(self.reason)
        with stage("access_page_read"):
            text = self.page.locator('body').inner_text(timeout=3000).lower()
        if any(marker in text for marker in (
            "verify you are human", "access denied", "unusual traffic",
            "로봇이 아닙니다", "보안 인증을 완료", "접근이 제한",
            "시도 가능 횟수를 초과", "시도 제한 횟수를 초과", "밀어서 인증",
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
            else:
                # A missing flight-card timeout can be the visible challenge
                # itself. Inspect the page once before classifying it as a
                # transient collector error, without masking the original
                # failure if the page is already unavailable.
                try:
                    self.check()
                except AccessRestricted:
                    raise
                except Exception:
                    pass
        finally:
            self.page.remove_listener('response', self.response)
