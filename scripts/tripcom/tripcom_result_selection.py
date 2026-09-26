"""Exact flight-label identity; no truncated descriptions or positional fallback."""
import re


def flight_label_selector(label):
    """Encode a complete aria-label as a CSS string, including CSS newline escapes.

    JSON string escaping is not CSS string escaping: ``\\n`` in a CSS selector
    matches the letter n. Truncating at that newline instead matches other fares
    for the same flight. Include the observed roundtrip price as part of identity.
    """
    if (not isinstance(label, str) or not label.strip() or len(label) > 8192
            or not re.search(r'왕복 요금:\s*[\d,]+원', label)):
        raise ValueError('selected_identity_unconfirmed')
    encoded = []
    for char in label:
        if char in ('"', '\\'):
            encoded.append('\\' + char)
        elif ord(char) < 32 or ord(char) == 127:
            if char == '\x00':
                raise ValueError('selected_identity_unconfirmed')
            encoded.append('\\' + format(ord(char), 'x') + ' ')
        else:
            encoded.append(char)
    return '.flight-info[aria-label="' + ''.join(encoded) + '"]'


def identity_failure_evidence(label, matches):
    """Bounded structure only: no browser exception, URL, account or page body."""
    return {'identityStrategy': 'complete_label_including_price',
            'exactLabelMatches': min(max(matches, 0), 1000),
            'labelLines': min(len(label.splitlines()), 100),
            'labelLength': min(len(label), 8192)}
