"""Staged execution adapter. Not a scheduler and not a publication client.

An existing central dispatcher must own admission across B/C before invoking
run_admitted. Do not expose a standalone CLI that bypasses that dispatcher.
"""
from tripcom_pipeline import execute_run, AdmissionLost
from crawl_tripcom_40destinations import scan_destination, TOP_40_DESTINATIONS


def scan_verified(page, dest, index, total):
    from tripcom_access import AccessGuard
    with AccessGuard(page):
        return scan_destination(page, dest, index, total, verify_roundtrip=True)


def run_admitted(*, state_root, run_id, host, browser_factory, assert_owner,
                 close_browser, scan=scan_verified, destinations=None):
    browser = None
    page = None
    destinations = TOP_40_DESTINATIONS if destinations is None else destinations

    def scan_one(dest, index, total):
        nonlocal browser, page
        # Verify central ownership immediately before a city, including resume.
        # The central adapter must fail closed if its server is unavailable.
        try:
            assert_owner(run_id, host)
        except Exception as error:
            raise AdmissionLost("central_ownership_unconfirmed") from error
        if browser is None:
            browser, page = browser_factory()
        return scan(page, dest, index, total)

    assert_owner(run_id, host)
    try:
        return execute_run(state_root, run_id, host, destinations, scan_one)
    finally:
        if browser is not None:
            # A failed close must propagate; the dispatcher must retain its
            # central lock rather than assume the browser has stopped.
            close_browser(browser)
