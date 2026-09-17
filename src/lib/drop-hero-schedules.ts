import type { Flight } from '@/types/flight';

const scheduleKey = (flight: Flight) => [flight.departure.date, flight.departure.time, flight.arrival.date, flight.arrival.time].join('|');
export const dropSelectionKey = (flight: Flight) => `${flight.source}|${flight.id}|${scheduleKey(flight)}`;
export const dropSelectionGroup = (flight: Flight, price: number) => JSON.stringify([
    flight.routeAirports?.outboundDeparture || flight.departure.airport || flight.departure.city,
    flight.routeAirports?.outboundArrival || flight.arrival.airport || flight.arrival.city,
    flight.source, flight.airline, price,
]);

export function resolveDropSelection(flights: Flight[], keys: string[], priceOf: (flight: Flight) => number, today: string): Flight[] {
    if (!keys.length || keys.length > 50 || new Set(keys).size !== keys.length) throw new Error('선정할 일정을 1~50개 선택해주세요.');
    const selected = keys.map(key => {
        const flight = flights.find(item => dropSelectionKey(item) === key);
        if (!flight || flight.departure.date < today || flight.arrival.date <= flight.departure.date || priceOf(flight) <= 0) {
            throw new Error('선택한 일정이 최신 목록에서 사라졌거나 만료됐습니다. 다시 확인해주세요.');
        }
        return flight;
    });
    if (selected.some(flight => dropSelectionGroup(flight, priceOf(flight)) !== dropSelectionGroup(selected[0], priceOf(selected[0])))) {
        throw new Error('같은 출발지·목적지·여행사·항공사·가격의 일정만 함께 선정할 수 있습니다.');
    }
    return selected.sort((a, b) => b.departure.date.localeCompare(a.departure.date) || b.departure.time.localeCompare(a.departure.time));
}

/** Keep the hero's price and seller applicable to every displayed alternative. */
export function dropHeroAlternatives(flights: Flight[], selected: Flight, priceOf: (flight: Flight) => number, selectedKeys?: string[] | null): Flight[] {
    const price = priceOf(selected);
    const selectedKey = scheduleKey(selected);
    const choices = flights.filter(flight =>
        (!selectedKeys || selectedKeys.includes(dropSelectionKey(flight)))
        &&
        (flight.departure.airport || flight.departure.city) === (selected.departure.airport || selected.departure.city)
        && (flight.arrival.airport || flight.arrival.city) === (selected.arrival.airport || selected.arrival.city)
        && flight.source === selected.source
        && flight.airline === selected.airline
        && priceOf(flight) === price
        && scheduleKey(flight) !== selectedKey
    );
    return Array.from(new Map(choices.map(flight => [scheduleKey(flight), flight])).values())
        .sort((a, b) => scheduleKey(a).localeCompare(scheduleKey(b)));
}
