"""Use a valid regional stay for the existing single calendar navigation."""
from datetime import datetime, timedelta


def calendar_seed_dates(today, allowed_nights):
    stays = set(allowed_nights)
    if not stays or any(type(n) is not int or not 1 <= n <= 30 for n in stays):
        raise ValueError('invalid_calendar_stay_policy')
    # Preserve the existing three-night seed for short-haul. A three-night
    # long-haul calendar response can contain no allowed five-to-twelve-night row.
    nights = min(stays, key=lambda n: (abs(n - 3), n))
    departure = today + timedelta(days=7)
    returning = departure + timedelta(days=nights)
    return departure.strftime('%Y-%m-%d'), returning.strftime('%Y-%m-%d'), nights


def calendar_rejection_summary(items, today, max_departure, allowed_nights):
    """Record why existing response rows were rejected, without extra requests."""
    summary = {'invalidRows': 0, 'priceRejected': 0, 'departureRejected': 0,
               'stayRejected': 0, 'eligibleRows': 0, 'observedNights': {}}
    seen = set()
    for item in items:
        try:
            price, departure_ts, return_ts = item.get('currencyPrice'), item.get('dDate'), item.get('aDate')
            if not isinstance(price, (float, int)) or not price or price <= 30000:
                summary['priceRejected'] += 1
                continue
            if not departure_ts or not return_ts:
                summary['invalidRows'] += 1
                continue
            key = (departure_ts, return_ts)
            if key in seen:
                continue
            seen.add(key)
            departure = datetime.fromtimestamp(departure_ts).date()
            returning = datetime.fromtimestamp(return_ts).date()
            nights = (returning - departure).days
            bucket = str(nights) if 0 <= nights <= 30 else 'outside_0_30'
            summary['observedNights'][bucket] = summary['observedNights'].get(bucket, 0) + 1
            if not today.date() <= departure <= max_departure.date():
                summary['departureRejected'] += 1
            elif nights not in allowed_nights:
                summary['stayRejected'] += 1
            else:
                summary['eligibleRows'] += 1
        except (AttributeError, TypeError, ValueError, OverflowError, OSError):
            summary['invalidRows'] += 1
    return summary
