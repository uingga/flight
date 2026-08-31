import { createHash } from 'node:crypto';
import type { Flight } from '../../src/types/flight';

export const LIFECYCLE_IDENTITY_VERSION = 1;
export const TTANG_TICKETING_FEE = 20_000;

export type SeatCountKind = 'exact' | 'at_least' | 'unknown';

export interface LifecycleIdentity {
    offerKey: string;
    itineraryKey: string;
    sourceProductRef: string | null;
}

export interface LifecycleSnapshot extends LifecycleIdentity {
    identityVersion: number;
    source: Flight['source'];
    sourceFlightId: string;
    departureCity: string;
    departureAirport: string | null;
    arrivalCity: string;
    arrivalAirport: string | null;
    departureDate: string | null;
    returnDate: string | null;
    outboundTime: string | null;
    outboundArrivalTime: string | null;
    returnTime: string | null;
    returnArrivalTime: string | null;
    airline: string | null;
    flightNumber: string | null;
    returnFlightNumber: string | null;
    listedPrice: number;
    effectivePrice: number;
    availableSeats: number | null;
    seatCountKind: SeatCountKind;
    region: string | null;
    bookingUrl: string | null;
    priceCheckedAt: string | null;
    comparisonPrice: number | null;
    comparisonCheckedAt: string | null;
    isVisible: boolean;
}

export function cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/\s+/g, ' ');
    return cleaned || null;
}

export function cleanDate(value: unknown): string | null {
    const match = String(value || '').match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function safeIso(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizedAirport(value: unknown): string | null {
    const cleaned = cleanText(value)?.toUpperCase() || null;
    return cleaned && /^[A-Z0-9]{3,4}$/.test(cleaned) ? cleaned : null;
}

function normalizedIdentityText(value: unknown): string {
    return (cleanText(value) || 'UNKNOWN')
        .normalize('NFKC')
        .toUpperCase()
        .replace(/[\s()\[\]{}._/-]+/g, '');
}

function digest(parts: Array<string | null | undefined>): string {
    return createHash('sha256').update(parts.map(part => part || 'UNKNOWN').join('|')).digest('hex');
}

function trustedSourceProductRef(flight: Flight): string | null {
    const id = cleanText(flight.id);
    if (!id) return null;

    if (flight.source === 'modetour' || flight.source === 'onlinetour' || flight.source === 'ttang') {
        return id;
    }

    // 마이리얼트립 시딩 ID의 마지막 숫자는 가격이라 그대로 쓰면 가격 변경이
    // 새 상품으로 기록된다. 노선·출발일까지만 남겨 같은 판매 회차를 이어 간다.
    if (flight.source === 'myrealtrip') return id.replace(/-\d+$/, '');

    // 하나투어와 노랑풍선의 현재 해시 ID에도 가격이 들어가므로 사용하지 않는다.
    return null;
}

function flightNumbers(flight: Flight): { outbound: string | null; inbound: string | null } {
    const combined = cleanText(flight.flightNumber);
    const tokens = combined?.split(/[\s,/|]+/).filter(Boolean) || [];
    return {
        outbound: cleanText(flight.modetourDetail?.departureFlightNo) || tokens[0] || null,
        inbound: cleanText(flight.modetourDetail?.returnFlightNo) || tokens[1] || null,
    };
}

export function buildLifecycleIdentity(flight: Flight): LifecycleIdentity {
    const departure = normalizedAirport(flight.departure?.airport)
        || normalizedIdentityText(flight.departure?.city);
    const arrival = normalizedAirport(flight.arrival?.airport)
        || normalizedIdentityText(flight.arrival?.city);
    const departureDate = cleanDate(flight.departure?.date);
    const returnDate = cleanDate(flight.arrival?.date);
    const airline = normalizedIdentityText(flight.airline);
    const numbers = flightNumbers(flight);
    const itineraryKey = digest([
        departure,
        arrival,
        departureDate,
        returnDate,
        airline,
        normalizedIdentityText(numbers.outbound),
        normalizedIdentityText(numbers.inbound),
    ]);
    const sourceProductRef = trustedSourceProductRef(flight);

    const offerKey = sourceProductRef
        ? flight.source === 'myrealtrip'
            ? digest([
                flight.source,
                sourceProductRef,
                returnDate,
                airline,
                normalizedIdentityText(numbers.outbound || flight.departure?.time),
                normalizedIdentityText(numbers.inbound || flight.arrival?.time),
            ])
            : digest([flight.source, sourceProductRef])
        : digest([
            flight.source,
            departure,
            arrival,
            departureDate,
            returnDate,
            airline,
            normalizedIdentityText(numbers.outbound || flight.departure?.time),
            normalizedIdentityText(numbers.inbound || flight.arrival?.time),
        ]);

    return { offerKey, itineraryKey, sourceProductRef };
}

export function effectivePrice(flight: Flight): number {
    return Math.round(Number(flight.price) + (flight.source === 'ttang' ? TTANG_TICKETING_FEE : 0));
}

export function seatAvailability(flight: Flight): { value: number | null; kind: SeatCountKind } {
    const raw = cleanText(flight.seats) || '';
    const parsed = Number(flight.availableSeats ?? raw.match(/\d+/)?.[0]);
    if (!Number.isFinite(parsed) || parsed <= 0) return { value: null, kind: 'unknown' };

    const value = Math.round(parsed);
    const explicitLowerBound = /이상|\+/.test(raw);
    // 항공 예약 화면은 9석 이상을 단순히 9석으로 표시하는 경우가 흔하다.
    // 마이리얼트립의 9석 표시는 정확한 상한으로 단정하지 않는다.
    const cappedMyRealTrip = flight.source === 'myrealtrip' && value >= 9;
    return { value, kind: explicitLowerBound || cappedMyRealTrip ? 'at_least' : 'exact' };
}

export function toLifecycleSnapshot(flight: Flight, isVisible: boolean): LifecycleSnapshot {
    const identity = buildLifecycleIdentity(flight);
    const numbers = flightNumbers(flight);
    const seats = seatAvailability(flight);
    const comparisonPrice = Number(flight.naverLowest);
    // 검색에 사용한 대표 공항보다 예약 결과에서 확인한 실제 공항을 우선한다.
    // 식별 키는 기존 판매 회차와 이어지도록 그대로 두고, 분석용 노선 필드만
    // 실제 왕복 여정 기준으로 기록한다.
    const departureAirport = normalizedAirport(flight.routeAirports?.outboundDeparture)
        || normalizedAirport(flight.departure?.airport);
    const arrivalAirport = normalizedAirport(flight.routeAirports?.outboundArrival)
        || normalizedAirport(flight.arrival?.airport);
    return {
        ...identity,
        identityVersion: LIFECYCLE_IDENTITY_VERSION,
        source: flight.source,
        sourceFlightId: cleanText(flight.id) || identity.offerKey,
        departureCity: cleanText(flight.departure?.city) || '알 수 없음',
        departureAirport,
        arrivalCity: cleanText(flight.arrival?.city) || '알 수 없음',
        arrivalAirport,
        departureDate: cleanDate(flight.departure?.date),
        returnDate: cleanDate(flight.arrival?.date),
        outboundTime: cleanText(flight.departure?.time),
        outboundArrivalTime: cleanText(flight.departure?.arrivalTime),
        returnTime: cleanText(flight.arrival?.time),
        returnArrivalTime: cleanText(flight.arrival?.arrivalTime),
        airline: cleanText(flight.airline),
        flightNumber: numbers.outbound,
        returnFlightNumber: numbers.inbound,
        listedPrice: Math.round(Number(flight.price)),
        effectivePrice: effectivePrice(flight),
        availableSeats: seats.value,
        seatCountKind: seats.kind,
        region: cleanText(flight.region),
        bookingUrl: cleanText(flight.link),
        priceCheckedAt: safeIso(flight.priceCheckedAt),
        comparisonPrice: Number.isFinite(comparisonPrice) && comparisonPrice > 0
            ? Math.round(comparisonPrice)
            : null,
        comparisonCheckedAt: safeIso(flight.naverCheckedAt),
        isVisible,
    };
}
