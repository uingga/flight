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

function calendarDayDistance(olderDate, newerDate) {
    const older = new Date(`${olderDate}T00:00:00.000Z`).getTime();
    const newer = new Date(`${newerDate}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(older) || !Number.isFinite(newer)) return null;
    return Math.round((newer - older) / DAY_MS);
}

export function collectRecentPicks(storedPick, flights, kstDate, lookbackDays = 7) {
    const candidates = [
        storedPick,
        ...(Array.isArray(storedPick?.recentPicks) ? storedPick.recentPicks : []),
        storedPick?.previousPick,
    ];
    const seen = new Set();

    return candidates
        .map(pick => snapshotPick(pick, flights))
        .filter(Boolean)
        .filter((pick) => {
            const distance = calendarDayDistance(pick.date, kstDate);
            return distance !== null && distance >= 1 && distance <= lookbackDays;
        })
        .filter((pick) => {
            const key = `${pick.date}|${pick.flightId}|${pick.destinationKey}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date));
}

export function recentRepeatDecision(flight, currentEffectivePrice, recentPicks = []) {
    const currentDestination = destinationKey(flight);
    const currentCity = cleanText(flight?.arrival?.city).toLocaleLowerCase('ko-KR');
    const matches = recentPicks.filter((pick) => {
        const previousCity = cleanText(pick.arrivalCity).toLocaleLowerCase('ko-KR');
        return pick.flightId === flight.id
            || pick.destinationKey === currentDestination
            || (currentCity && previousCity && currentCity === previousCity);
    });
    if (matches.length === 0) {
        return { repeated: false, blocked: false, priceDropped: false, matches: [] };
    }

    const comparableMatches = matches.filter(pick => Number.isFinite(Number(pick.effectivePrice)));
    const lowestPreviousPick = comparableMatches
        .slice()
        .sort((a, b) => Number(a.effectivePrice) - Number(b.effectivePrice))[0] || null;
    const previousEffectivePrice = lowestPreviousPick
        ? Number(lowestPreviousPick.effectivePrice)
        : null;
    const priceDropped = Number.isFinite(previousEffectivePrice)
        && currentEffectivePrice < previousEffectivePrice;

    return {
        repeated: true,
        sameFlight: matches.some(pick => pick.flightId === flight.id),
        sameDestination: matches.some((pick) => {
            const previousCity = cleanText(pick.arrivalCity).toLocaleLowerCase('ko-KR');
            return pick.destinationKey === currentDestination
                || (currentCity && previousCity && currentCity === previousCity);
        }),
        blocked: !priceDropped,
        priceDropped,
        previousEffectivePrice,
        previousDate: lowestPreviousPick?.date || null,
        dropAmount: priceDropped ? previousEffectivePrice - currentEffectivePrice : 0,
        matches,
    };
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
