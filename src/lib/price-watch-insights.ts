import { normalizeCity } from './utils/flight-helpers';
export interface PricePoint {
    date: string;
    minPrice: number;
    avgPrice: number;
    count: number;
}

interface RouteInsight {
    route: string;
    departure: string;
    arrival: string;
    observations: number;
    firstDate: string;
    latestDate: string;
    firstPrice: number;
    latestPrice: number;
    low: number;
    high: number;
    change: number;
    changeRate: number;
}


/** Old city-only records cannot establish that Seoul means ICN or Boracay means KLO. */
export function splitRoute(route: string) {
    const [origin, ...rest] = route.split('-');
    const destination = rest.join('-');
    if (!origin || !destination) return null;
    const originCode = origin.match(/\(([A-Z]{3})\)/)?.[1];
    if (origin === '서울' || (origin.startsWith('서울') && !originCode && !origin.includes('인천') && !origin.includes('김포'))) return null;
    const departure = normalizeCity(origin).replace(/\([^)]*\)/g, '').trim();
    const explicitAirport = destination.match(/\(([A-Z]{3})\)/)?.[1];
    const boracay = /보라카이|칼리보|깔리보/.test(destination);
    if (boracay && explicitAirport && explicitAirport !== 'KLO') return null;
    if (boracay && !/칼리보|깔리보|\(KLO\)/.test(destination)) return null;
    const arrival = boracay ? '보라카이' : normalizeCity(destination).replace(/\([^)]*\)/g, '').trim();
    const airport = boracay ? 'KLO' : destination.match(/\(([A-Z]{3})\)/)?.[1] || '';
    return { departure, arrival, airport, key: `${departure}-${arrival}${airport ? `(${airport})` : ''}` };
}
function representativeHistory(raw: Record<string, PricePoint[]>) {
    const chosen = new Map<string, { original: string; points: PricePoint[] }>();
    for (const [route, source] of Object.entries(raw)) {
        const normalized = splitRoute(route);
        if (!normalized) continue;
        const points = source.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.minPrice) && p.minPrice > 0)
            .sort((a,b) => a.date.localeCompare(b.date));
        if (!points.length || new Set(points.map(p => p.date)).size !== points.length) continue;
        const old = chosen.get(normalized.key);
        // Select one intact series before checking decline. Never combine minima or cherry-pick discount.
        if (!old || points.at(-1)!.date > old.points.at(-1)!.date
            || (points.at(-1)!.date === old.points.at(-1)!.date && (points.length > old.points.length
                || (points.length === old.points.length && route.localeCompare(old.original) < 0)))) {
            chosen.set(normalized.key, { original: route, points });
        }
    }
    return Object.fromEntries(Array.from(chosen.values()).map(item => [item.original, item.points]));
}

export function buildInsights(raw: Record<string, PricePoint[]>) {
    const history = representativeHistory(raw);
    const allPoints = Object.values(history).flat();
    const latestDate = allPoints.map(point => point.date).sort().at(-1) || '';
    const candidates: RouteInsight[] = Object.entries(history).flatMap(([route, points]) => {
        const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
        const first = ordered[0];
        const latest = ordered.at(-1);
        const windowDays = first && latest ? (Date.parse(latest.date) - Date.parse(first.date)) / 86_400_000 : Infinity;
        const { departure, arrival } = splitRoute(route)!;
        const featuredDestination = /호치민|오키나와|오사카|사이판|자카르타|하노이|푸꾸옥|후쿠오카|클락|보라카이/.test(arrival);
        if (!first || !latest || latest.date !== latestDate || ordered.length < 7 || latest.minPrice >= first.minPrice || windowDays > 20 || !featuredDestination) return [];
        const prices = ordered.map(point => point.minPrice).filter(price => price > 0);
        return [{
            route,
            departure,
            arrival,
            observations: ordered.length,
            firstDate: first.date,
            latestDate: latest.date,
            firstPrice: first.minPrice,
            latestPrice: latest.minPrice,
            low: Math.min(...prices),
            high: Math.max(...prices),
            change: latest.minPrice - first.minPrice,
            changeRate: ((latest.minPrice - first.minPrice) / first.minPrice) * 100,
        }];
    });
    const byDisplayRoute = new Map<string, RouteInsight>();
    for (const candidate of candidates) {
        const key = splitRoute(candidate.route)!.key;
        const existing = byDisplayRoute.get(key);
        if (!existing
            || candidate.observations > existing.observations
            || (candidate.observations === existing.observations && candidate.changeRate < existing.changeRate)) {
            byDisplayRoute.set(key, candidate);
        }
    }
    const rows = Array.from(byDisplayRoute.values())
        .sort((a, b) => a.changeRate - b.changeRate)
        .slice(0, 8);

    return {
        latestDate,
        rows,
        trackedRoutes: Object.keys(history).length,
        currentRoutes: Object.values(history).filter(points => points.at(-1)?.date === latestDate).length,
    };
}
