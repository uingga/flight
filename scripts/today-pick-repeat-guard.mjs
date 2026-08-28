const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value) {
    return String(value || '').replace(/\([^)]+\)/g, '').trim();
}

export function previousCalendarDate(kstDate) {
    const timestamp = new Date(`${kstDate}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp - DAY_MS).toISOString().slice(0, 10);
}

export function destinationKey(flight) {
    const airport = cleanText(
        flight?.routeAirports?.outboundArrival
        || flight?.arrival?.airport,
    ).toUpperCase();
    if (airport) return airport;
    return cleanText(flight?.arrival?.city).toLocaleLowerCase('ko-KR');
}

export function snapshotPick(pick, flights = []) {
    if (!pick || typeof pick !== 'object') return null;
    const flight = flights.find(item => item.id === pick.flightId);
    const arrivalCity = cleanText(pick.arrivalCity || flight?.arrival?.city);
    const resolvedDestinationKey = cleanText(pick.destinationKey || destinationKey(flight)).toUpperCase();
    const resolvedPrice = Number(pick.effectivePrice);

    if (!pick.date || !pick.flightId || !resolvedDestinationKey || !Number.isFinite(resolvedPrice)) {
        return null;
    }

    return {
        date: pick.date,
        flightId: pick.flightId,
        source: pick.source || flight?.source || null,
        arrivalCity: arrivalCity || null,
        destinationKey: resolvedDestinationKey,
        effectivePrice: resolvedPrice,
    };
}

export function findPreviousDayPick(storedPick, flights, kstDate) {
    const previousDate = previousCalendarDate(kstDate);
    if (!previousDate) return null;

    if (storedPick?.date === previousDate) {
        return snapshotPick(storedPick, flights);
    }
    if (storedPick?.date === kstDate && storedPick.previousPick?.date === previousDate) {
        return snapshotPick(storedPick.previousPick, flights);
    }
    return null;
}

export function repeatDecision(flight, currentEffectivePrice, previousPick) {
    if (!previousPick) {
        return { repeated: false, blocked: false, priceDropped: false };
    }

    const sameFlight = flight.id === previousPick.flightId;
    const sameDestination = destinationKey(flight) === previousPick.destinationKey;
    const repeated = sameFlight || sameDestination;
    const previousEffectivePrice = Number(previousPick.effectivePrice);
    const priceDropped = repeated
        && Number.isFinite(previousEffectivePrice)
        && currentEffectivePrice < previousEffectivePrice;

    return {
        repeated,
        sameFlight,
        sameDestination,
        blocked: repeated && !priceDropped,
        priceDropped,
        previousEffectivePrice,
        dropAmount: priceDropped ? previousEffectivePrice - currentEffectivePrice : 0,
    };
}
