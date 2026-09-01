import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import {
    buildStableFlightId,
    getAirportCode,
    normalizeAirline,
} from '@/lib/utils/flight-helpers';

const MODETOUR_URL = 'https://www.modetour.com/flights/discount-flight';

export const MODETOUR_CONTINENT_CODES = ['ASIA', 'JPN', 'SOPA', 'EUR', 'CHI', 'AMCA'] as const;
export type ModetourContinentCode = typeof MODETOUR_CONTINENT_CODES[number];

export interface ModetourManualCard {
    airline: string;
    departureTime: string;
    departureCity: string;
    departureMonthDay: string;
    returnTime: string;
    arrivalCity: string;
    returnMonthDay: string;
    flyingTime?: string;
    isDirect: boolean;
    seats?: number;
    price: number;
    normalPrice?: number;
    sourceDiscountRate?: number;
}

export interface ModetourManualRegion {
    continentCode: ModetourContinentCode | string;
    cards: ModetourManualCard[];
}

export interface ModetourManualCapture {
    capturedAt: string;
    /**
     * 목록의 처음부터 끝까지 빠짐없이 캡처한 지역만 지정한다.
     * 지정된 지역은 검증을 모두 통과했을 때 기존 캐시를 이번 캡처 결과로 교체한다.
     */
    completeRegions?: ModetourContinentCode[];
    /** 화면 오류 등으로 이번 반영에서 의도적으로 제외한 지역. */
    excludedRegions?: ModetourContinentCode[];
    regions: ModetourManualRegion[];
}

export type ModetourManualValidation =
    | { status: 'accepted'; flight: Flight }
    | { status: 'review'; reasons: string[] };

function kstDateParts(now: Date): { year: number; month: number; day: number } {
    const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

function parseMonthDay(monthDay: string, capturedAt: Date): string {
    const match = String(monthDay || '').trim().match(/^(\d{2})\/(\d{2})$/);
    if (!match) return '';

    const month = Number(match[1]);
    const day = Number(match[2]);
    const start = kstDateParts(capturedAt);
    let year = start.year;
    const candidate = Date.UTC(year, month - 1, day);
    const startDate = Date.UTC(start.year, start.month - 1, start.day);
    if (candidate < startDate - 2 * 24 * 60 * 60 * 1000) year += 1;

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() + 1 !== month
        || parsed.getUTCDate() !== day
    ) {
        return '';
    }
    return `${year}-${match[1]}-${match[2]}`;
}

function validTime(value: string): boolean {
    const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
    return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function getMaxPriceForContinent(continentCode: string): number {
    // 가격 상한은 OCR 자릿수 오인 방지용이다. 실제 비싼 표 제외는 아래 벤치마크 단계가 맡는다.
    if (continentCode === 'EUR' || continentCode === 'AMCA') return 5_000_000;
    if (continentCode === 'SOPA') return 3_000_000;
    return 2_000_000;
}

function buildBookingLink(
    continentCode: string,
    departureAirport: string,
    arrivalAirport: string,
    departureDate: string,
    returnDate: string,
): string {
    const query = JSON.stringify({
        departureCity: departureAirport,
        continentCode,
        arrivalCity: arrivalAirport,
        departureDate,
        arrivalDate: returnDate,
        page: 1,
        itemCount: 200,
        sort: 'Lowest',
    });
    return `${MODETOUR_URL}?query=${encodeURIComponent(query)}`;
}

/**
 * 일반 Chrome 캡처에서 사람이/OCR이 옮긴 카드 한 장을 fail-closed로 검증한다.
 * 하나라도 모호하면 추측하지 않고 review로 남긴다.
 */
export function validateModetourManualCard(
    card: ModetourManualCard,
    continentCode: string,
    capturedAt = new Date(),
): ModetourManualValidation {
    const reasons: string[] = [];
    const airline = normalizeAirline(String(card.airline || '').trim());
    const departureCity = String(card.departureCity || '').trim();
    const arrivalCity = String(card.arrivalCity || '').trim();
    const departureTime = String(card.departureTime || '').trim();
    const returnTime = String(card.returnTime || '').trim();
    const departureDate = parseMonthDay(card.departureMonthDay, capturedAt);
    const returnDate = parseMonthDay(card.returnMonthDay, capturedAt);
    const departureAirport = getAirportCode(departureCity) || '';
    const arrivalAirport = getAirportCode(arrivalCity) || '';
    const price = Number(card.price);

    if (!MODETOUR_CONTINENT_CODES.includes(continentCode as ModetourContinentCode)) reasons.push('지역 코드가 확실하지 않음');
    if (!airline) reasons.push('항공사 판독 불가');
    if (!departureCity || !departureAirport) reasons.push('출발 도시/공항 판독 불가');
    if (!arrivalCity || !arrivalAirport) reasons.push('도착 도시/공항 판독 불가');
    if (!validTime(departureTime)) reasons.push('가는편 출발시각 판독 불가');
    if (!validTime(returnTime)) reasons.push('오는편 출발시각 판독 불가');
    if (!departureDate) reasons.push('출발일 판독 불가');
    if (!returnDate) reasons.push('귀국일 판독 불가');
    if (departureDate && returnDate && returnDate <= departureDate) reasons.push('귀국일이 출발일보다 늦지 않음');
    if (!Number.isInteger(price) || price <= 0) reasons.push('가격 판독 불가');
    if (Number.isInteger(price) && price > getMaxPriceForContinent(continentCode)) reasons.push('운영 가격 상한 초과');
    if (typeof card.isDirect !== 'boolean') reasons.push('직항 여부 판독 불가');
    if (card.seats !== undefined && (!Number.isInteger(card.seats) || card.seats <= 0 || card.seats > 999)) {
        reasons.push('좌석 수 판독 불가');
    }
    if (card.normalPrice !== undefined) {
        if (!Number.isInteger(card.normalPrice) || card.normalPrice <= price) {
            reasons.push('정상가가 현재가보다 높다는 점을 확인할 수 없음');
        } else if (card.sourceDiscountRate !== undefined) {
            const expected = Math.round((1 - price / card.normalPrice) * 100);
            if (!Number.isInteger(card.sourceDiscountRate) || Math.abs(expected - card.sourceDiscountRate) > 1) {
                reasons.push('정상가·현재가·할인율이 서로 맞지 않음');
            }
        }
    } else if (card.sourceDiscountRate !== undefined) {
        reasons.push('정상가 없이 할인율만 있어 교차 검증 불가');
    }

    if (reasons.length > 0) return { status: 'review', reasons };

    const id = buildStableFlightId('modetour-manual', [
        continentCode,
        airline,
        departureAirport,
        arrivalAirport,
        departureDate,
        returnDate,
        departureTime,
        returnTime,
    ]);

    return {
        status: 'accepted',
        flight: {
            id,
            source: 'modetour',
            airline,
            departure: {
                city: departureCity,
                airport: departureAirport,
                date: departureDate,
                time: departureTime,
            },
            arrival: {
                city: arrivalCity,
                airport: arrivalAirport,
                date: returnDate,
                time: returnTime,
            },
            price,
            currency: 'KRW',
            link: buildBookingLink(continentCode, departureAirport, arrivalAirport, departureDate, returnDate),
            availableSeats: card.seats,
            region: getRegionByCity(arrivalCity),
            modetourDetail: {
                flyingTime: card.flyingTime,
                isDirect: card.isDirect,
                isReturnDirect: card.isDirect,
                normalPrice: card.normalPrice,
                sourceDiscountRate: card.sourceDiscountRate,
                returnDepartureTime: returnTime,
                returnDepartureAirport: arrivalAirport,
                returnArrivalAirport: departureAirport,
            },
        },
    };
}

export function modetourManualMatchKey(flight: Flight): string {
    const departure = flight.departure.airport || flight.departure.city;
    const arrival = flight.arrival.airport || flight.arrival.city;
    const airline = normalizeAirline(flight.airline || '').replace(/\s+/g, '');
    return [
        departure,
        arrival,
        flight.departure.date,
        flight.arrival.date,
        flight.departure.time,
        flight.arrival.time,
        airline,
    ].join('|').toUpperCase();
}
