"""Connection evidence from the selected result card, never calendar guesses."""
import re
from datetime import date


def connection_details(label, text):
    raw = f"{label}\n{text}"
    # A tentative/negated label is not positive evidence of a connection.
    # Keep its duration text separate, but never publish its stop count.
    evidence = "\n".join(line for line in raw.splitlines() if not re.search(
        r"(?:확인\s*필요|미확인|여부|unknown|unconfirmed|not\s+confirmed)"
        r"|(?:직항|경유|환승)(?:편)?\s*(?:이\s*)?(?:아님|아닙니다)"
        r"|\bnot\s+(?:a\s+)?(?:direct|non[- ]?stop|connecting)\b",
        line, re.I))
    counts = [int(value) for pattern in (
        r"(?:경유|환승)\s*(\d+)\s*회", r"(\d+)\s*회\s*(?:경유|환승)",
        r"\b(\d+)\s*stops?\b",
    ) for value in re.findall(pattern, evidence, re.I)]
    positive = {value for value in counts if value > 0}
    # A connecting marker takes precedence over a contradictory direct label.
    if positive:
        direct = False
        stops = next(iter(positive)) if len(positive) == 1 else None
    elif re.search(r"(?:경유|환승)(?:편|합니다|하는)|(?:^|\s)(?:경유|환승)\s*$|\bconnecting\b", evidence, re.I | re.M):
        direct, stops = False, None
    elif re.search(r"직항|\bnon[- ]?stop\b|\b0\s*stops?\b|(?:경유|환승)\s*(?:없음|없습니다)", evidence, re.I) or (counts and not any(counts)):
        direct, stops = True, 0
    else:
        direct, stops = None, None

    # Only the itinerary total, not a layover duration or an individual segment.
    duration = re.search(r"((?:\d+\s*시간(?:\s*\d+\s*분)?|\d+\s*분))이?\s*소요", label)
    if not duration:
        totals = re.findall(r"^\s*(?:총\s*)?((?:\d+\s*시간(?:\s*\d+\s*분)?|\d+\s*분))(?:\s+(?:직항|경유|환승)(?:\s*\d+회)?)?\s*$", text, re.M)
        duration_text = totals[0] if len(totals) == 1 else ""
    else:
        duration_text = duration[1]
    hours = re.search(r"(\d+)\s*시간", duration_text)
    minutes = re.search(r"(\d+)\s*분", duration_text)
    total = (int(hours[1]) * 60 if hours else 0) + (int(minutes[1]) if minutes else 0)
    return {"direct": direct, "stopCount": stops,
            "durationMinutes": total if 0 < total <= 7 * 24 * 60 else None}


def endpoint_airports(text, departure_time, arrival_time):
    """With extra airport codes, require each endpoint next to its flight time."""
    airports = re.findall(r"(?<![A-Z])[A-Z]{3}(?![A-Z])", text)
    if len(airports) == 2:
        return airports
    endpoints = []
    for clock in (departure_time, arrival_time):
        matches = re.findall(r"(?<!\d)" + re.escape(clock)
                             + r"(?!\d)\s*(?:\+\d+\s*)?\n\s*([A-Z]{3})\b", text)
        if len(matches) != 1:
            raise ValueError("endpoint_airports_unconfirmed")
        endpoints.append(matches[0])
    if departure_time == arrival_time or endpoints[0] == endpoints[1]:
        raise ValueError("endpoint_airports_unconfirmed")
    return endpoints


def public_leg_details(leg):
    direct = leg.get("direct")
    if direct is not None and type(direct) is not bool:
        raise ValueError("invalid_connection_status")
    stops = leg.get("stopCount")
    if stops is not None and (type(stops) is not int or not 0 <= stops <= 9):
        raise ValueError("invalid_stop_count")
    if stops is not None and stops > 0:
        direct = False
    elif direct is True:
        stops = 0
    elif direct is False and stops == 0:
        stops = None
    # Missing direct status is not inferred from an absent/zero stop counter.
    status = "direct" if direct is True else "connecting" if direct is False else "unknown"
    result = {"status": status, "stopCount": stops if status != "unknown" else None}
    duration = leg.get("durationMinutes")
    if type(duration) is int and 0 < duration <= 7 * 24 * 60:
        result["durationMinutes"] = duration
    if leg.get("arrivalDate"):
        date.fromisoformat(leg["arrivalDate"])
        result["arrivalDate"] = leg["arrivalDate"]
    return result
