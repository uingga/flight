"""Bounded failure codes. Never persist browser exception text or page content."""
import re
from contextlib import contextmanager


@contextmanager
def stage(name):
    try:
        yield
    except Exception as error:
        error.tripcom_stage = getattr(error, 'tripcom_stage', name)
        raise


def failure_details(error):
    message = str(error)
    code = message if isinstance(error, ValueError) and re.fullmatch(r'[a-z][a-z0-9_]{0,79}', message) else (
        'stage_timeout' if type(error).__name__ == 'TimeoutError' else 'unexpected_collector_error')
    result = {'errorType': type(error).__name__, 'reason': code,
              'stage': getattr(error, 'tripcom_stage', 'calendar_or_navigation')}
    if hasattr(error, 'tripcom_evidence'):
        result['evidence'] = error.tripcom_evidence
    if hasattr(error, 'tripcom_click_cause'):
        result['clickCause'] = error.tripcom_click_cause
    return result
