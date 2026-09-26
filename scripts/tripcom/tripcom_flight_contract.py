"""Fail-closed conversion boundary; not wired to the production writer yet."""
import hashlib
import re
from datetime import date, datetime
from urllib.parse import urlparse, parse_qs
from tripcom_connections import public_leg_details

CITY_CODES = {"SEL", "TYO", "OSA", "BJS", "SPK", "NHA"}


def to_flight(quote):
    if quote.get("status") != "verified_roundtrip" or quote.get("price_basis") != "adult_roundtrip_total_including_taxes":
        raise ValueError("unverified_roundtrip_price")
    price = quote.get("price")
    if type(price) is not int or price <= 0 or quote.get("currency") != "KRW":
        raise ValueError("invalid_price")
    if quote.get("adult_count") != 1 or quote.get("cabin") != "economy":
        raise ValueError("unexpected_passenger_or_cabin")
    payment = quote.get("payment_condition")
    if not isinstance(payment, dict) or payment.get("kind") not in ("unrestricted", "bank_account"):
        raise ValueError("unsupported_or_unknown_payment_condition")
    if payment["kind"] == "bank_account" and payment.get("raw") != "내통장결제":
        raise ValueError("unverified_bank_payment_label")
    if payment["kind"] == "unrestricted" and payment.get("verified") is not True:
        raise ValueError("unrestricted_payment_not_verified")
    airports = quote.get("routeAirports", {})
    keys = ("outboundDeparture", "outboundArrival", "returnDeparture", "returnArrival")
    for key in keys:
        code = airports.get(key, "")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z]{3}", code) or code in CITY_CODES:
            raise ValueError("actual_airport_required")
    if airports["outboundDeparture"] not in {"ICN", "GMP"} or airports["returnArrival"] not in {"ICN", "GMP"}:
        raise ValueError("not_seoul_roundtrip")
    if airports["outboundArrival"] != airports["returnDeparture"]:
        raise ValueError("open_jaw_not_supported")
    outbound, inbound = quote.get("outbound", {}), quote.get("inbound", {})
    for leg in (outbound, inbound):
        date.fromisoformat(leg.get("date", ""))
        for key in ("departureTime", "arrivalTime"):
            if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", leg.get(key, "")):
                raise ValueError("flight_times_required")
        if not leg.get("airline"):
            raise ValueError("leg_details_required")
        public_leg_details(leg)
    nights = (date.fromisoformat(inbound["date"]) - date.fromisoformat(outbound["date"])).days
    if not 2 <= nights <= 7:
        raise ValueError("invalid_trip_length")
    checked = datetime.fromisoformat(quote.get("checked_at", ""))
    if checked.tzinfo is None:
        raise ValueError("timezone_required")
    url = urlparse(quote.get("booking_url", ""))
    query = parse_qs(url.query)
    if url.scheme != "https" or url.hostname != "kr.trip.com" or url.path != "/flights/showfarefirst":
        raise ValueError("invalid_booking_url")
    if query.get("triptype") != ["RT"] or query.get("ddate") != [outbound["date"]] or query.get("rdate") != [inbound["date"]]:
        raise ValueError("booking_schedule_mismatch")
    seats = quote.get("availableSeats")
    if seats is not None and (type(seats) is not int or seats < 0):
        raise ValueError("invalid_seats")
    if seats == 0 or quote.get("seats") in ("0석", "0"):
        raise ValueError("sold_out")
    # Unparsed seat strings must not turn into a numeric zero.
    if quote.get("seats") not in (None, "") and seats is None:
        raise ValueError("seat_value_requires_parsing")
    identity = "|".join([airports[k] for k in keys] + [outbound["date"], inbound["date"],
        outbound["departureTime"], inbound["departureTime"], outbound["airline"], inbound["airline"]])
    result = {"id": "tripcom-" + hashlib.sha256(identity.encode()).hexdigest()[:20],
        "source": "tripcom", "airline": outbound["airline"] if outbound["airline"] == inbound["airline"] else outbound["airline"] + " / " + inbound["airline"],
        "departure": {"city": "서울", "airport": airports["outboundDeparture"], "date": outbound["date"], "time": outbound["departureTime"], "arrivalTime": outbound["arrivalTime"]},
        "arrival": {"city": quote["destination"], "airport": airports["outboundArrival"], "date": inbound["date"], "time": inbound["departureTime"], "arrivalTime": inbound["arrivalTime"]},
        "routeAirports": {key: airports[key] for key in keys}, "price": price, "currency": "KRW",
        "link": quote["booking_url"], "priceCheckedAt": quote["checked_at"], "minPax": 1}
    if seats is not None:
        result.update(availableSeats=seats, seats=f"{seats}석")
    result["tripcomDetail"] = {
        "legs": {"outbound": public_leg_details(outbound), "inbound": public_leg_details(inbound)},
        "paymentCondition": dict(payment),
        "paymentNotice": "내통장결제 기준" if payment["kind"] == "bank_account" else None,
        "paymentNoticePlacement": "detail_only",
    }
    return result
