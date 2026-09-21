"""DOM-only roundtrip quote verification. Never enters booking/payment forms."""
import re
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
CITY_AIRPORTS = {'SEL': {'ICN','GMP'}, 'TYO': {'NRT','HND'}, 'OSA': {'KIX','ITM'},
    'SPK': {'CTS','OKD'}, 'BJS': {'PEK','PKX'}, 'SHA': {'SHA','PVG'},
    'NHA': {'CXR'}, 'ULN': {'ULN','UBN'}}


def verify_route(candidate, outgoing, returning):
    expected = str(candidate['iata']).upper()
    allowed = CITY_AIRPORTS.get(expected, {expected})
    if (outgoing['departureAirport'] not in {'ICN','GMP'}
        or returning['arrivalAirport'] not in {'ICN','GMP'}
        or outgoing['arrivalAirport'] not in allowed
        or returning['departureAirport'] != outgoing['arrivalAirport']):
        raise ValueError('selected_route_mismatch')

CARD_SCRIPT = """() => Array.from(document.querySelectorAll('.f-info-content')).map((card, index) => {
 const info=card.querySelector('.flight-info[aria-label]');
 return {index,label:info?.getAttribute('aria-label') || '',text:info?.innerText || ''};
})"""
FARE_SCRIPT = """() => Array.from(document.querySelectorAll('.J_brandedFarePolicy')).map((card,index)=>({
 index,text:card.innerText,price:card.querySelector('[data-testid="u_price_info"]')?.getAttribute('data-total-price')
}))"""


def parse_card(card):
    label, text = card.get("label", ""), card.get("text", "")
    dates = re.findall(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}", label)
    amount = re.search(r"왕복 요금:\s*([\d,]+)원", label)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    airports = [line for line in lines if re.fullmatch(r"[A-Z]{3}", line)]
    if len(dates) != 2 or not amount or len(airports) != 2 or not lines:
        raise ValueError("unrecognized_flight_card")
    if "직항편" not in label:
        raise ValueError("connecting_leg_not_verified")
    return {"index": card["index"], "date": dates[0][0], "arrivalDate": dates[1][0],
        "departureTime": dates[0][1], "arrivalTime": dates[1][1],
        "departureAirport": airports[0], "arrivalAirport": airports[1],
        "airline": lines[0], "direct": True, "price": int(amount[1].replace(",", ""))}


def cheapest_card(cards):
    # Do not skip an unrecognized cheaper card and call a higher price cheapest.
    prices = []
    for card in cards:
        amount = re.search(r"왕복 요금:\s*([\d,]+)원", card.get("label", ""))
        if amount:
            prices.append((int(amount[1].replace(",", "")), card))
    if not prices:
        raise ValueError("no_roundtrip_cards")
    return parse_card(min(prices, key=lambda item: item[0])[1])


def parse_fare(fares):
    candidates = []
    for fare in fares:
        text = fare.get("text", "")
        if "결제 방법: 내통장결제" not in text or "일반석" not in text or "왕복" not in text:
            continue
        # Optional bundle pricing must not be confused with the base quote.
        if "트립플렉스" in text or "전용 특가" in text:
            continue
        price = fare.get("price", "")
        if not isinstance(price, str) or not price.isdigit() or int(price) <= 0:
            continue
        seats_match = re.search(r"(?<!\d)(\d+)석 남음", text)
        seats = int(seats_match[1]) if seats_match else None
        if seats == 0:
            continue
        candidates.append({"index": fare["index"], "price": int(price), "availableSeats": seats,
            "payment_condition": {"kind": "bank_account", "raw": "내통장결제"}})
    if not candidates:
        raise ValueError("eligible_fare_unconfirmed")
    return min(candidates, key=lambda fare: fare["price"])


def verify_fee_breakdown(text, price):
    total = re.search(r"왕복 총금액\s*([\d,]+)원", text)
    if not total or int(total[1].replace(",", "")) != price:
        raise ValueError("roundtrip_total_mismatch")
    if not all(term in text for term in ("성인 1인 기준", "유류할증료", "기타 세금 및 수수료", "발권수수료", "내통장결제 할인")):
        raise ValueError("fee_breakdown_incomplete")


def collect_roundtrip(page, candidate, live_url, access_check):
    from tripcom_access import AccessGuard
    guard = AccessGuard(page)
    response = page.goto(live_url, wait_until="domcontentloaded", timeout=20000)
    if response is not None and response.status in (401, 403, 429):
        access_check(response)
    page.locator('.f-info-content .flight-info[aria-label]').first.wait_for(timeout=25000)
    guard.check()
    outgoing = cheapest_card(page.evaluate(CARD_SCRIPT))
    if outgoing["date"] != candidate["ddate"]:
        raise ValueError("outbound_date_mismatch")
    page.locator('.f-info-content').nth(outgoing["index"]).get_by_role('button', name='이 운임 선택', exact=True).click()
    page.get_by_role('heading', name=re.compile(r'^2\. .*오는편')).wait_for(timeout=25000)
    page.locator('.f-info-content .flight-info[aria-label]').first.wait_for(timeout=25000)
    guard.check()
    returning = cheapest_card(page.evaluate(CARD_SCRIPT))
    if returning["date"] != candidate["rdate"]:
        raise ValueError("return_date_mismatch")
    verify_route(candidate, outgoing, returning)
    page.locator('.f-info-content').nth(returning["index"]).get_by_role('button', name='이 운임 선택', exact=True).click()
    page.locator('.J_brandedFarePolicy').first.wait_for(timeout=15000)
    guard.check()
    fare = parse_fare(page.evaluate(FARE_SCRIPT))
    price_element = page.locator('.J_brandedFarePolicy').nth(fare["index"]).get_by_test_id('u_price_info')
    price_element.click()
    tooltip = page.get_by_role('tooltip').filter(has_text='왕복 총금액')
    tooltip.wait_for(timeout=5000)
    guard.check()
    verify_fee_breakdown(tooltip.inner_text(), fare["price"])
    return {**candidate, **fare, "status": "verified_roundtrip",
        "price_basis": "adult_roundtrip_total_including_taxes", "currency": "KRW",
        "adult_count": 1, "cabin": "economy", "booking_url": live_url,
        "outbound": outgoing, "inbound": returning,
        "routeAirports": {"outboundDeparture": outgoing["departureAirport"], "outboundArrival": outgoing["arrivalAirport"],
            "returnDeparture": returning["departureAirport"], "returnArrival": returning["arrivalAirport"]},
        "checked_at": datetime.now(KST).isoformat()}
