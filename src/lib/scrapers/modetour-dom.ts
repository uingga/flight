import { chromium, type Page, type Response } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import {
    buildStableFlightId,
    getAirportCode,
    normalizeAirline,
} from '@/lib/utils/flight-helpers';
import {
    assertNoSourceAccessBlockText,
    SourceResponseError,
} from './source-response';

const MODETOUR_URL = 'https://www.modetour.com/flights/discount-flight';
const MODETOUR_DATA_PATH = '/DiscountFlight/GetList';
export const MODETOUR_DOM_DATA_REQUEST_LIMIT = 6;

const REGIONS = [
    { code: 'ASIA', label: '동남아', cacheRegions: ['동남아', '기타'] },
    { code: 'JPN', label: '일본', cacheRegions: ['일본'] },
    { code: 'SOPA', label: '남태평양', cacheRegions: ['남태평양'] },
    { code: 'EUR', label: '유럽', cacheRegions: ['유럽'] },
    { code: 'CHI', label: '중국', cacheRegions: ['중국'] },
    { code: 'AMCA', label: '미주', cacheRegions: ['미주'] },
] as const;

export interface ModetourDomSnapshot {
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

export interface ModetourDomStats {
    pageLoads: number;
    regionSelections: number;
    fareDataRequests: number;
    totalBrowserRequests: number;
    blockedStaticRequests: number;
    requestLimit: number;
}

let lastStats: ModetourDomStats | null = null;

export function getLastModetourDomStats(): ModetourDomStats | null {
    return lastStats ? { ...lastStats } : null;
}

const randomDelay = (minSeconds: number, maxSeconds: number) =>
    new Promise(resolve => setTimeout(
        resolve,
        (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000,
    ));

function kstDateParts(now: Date): { year: number; month: number; day: number } {
    const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

function formatKstDate(now: Date): string {
    const { year, month, day } = kstDateParts(now);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addKstMonth(now: Date): string {
    const { year, month, day } = kstDateParts(now);
    const result = new Date(Date.UTC(year, month - 1, day));
    result.setUTCMonth(result.getUTCMonth() + 1);
    return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

function parseMonthDay(monthDay: string, windowStart: Date): string {
    const match = monthDay.match(/^(\d{2})\/(\d{2})$/);
    if (!match) return '';

    const month = Number(match[1]);
    const day = Number(match[2]);
    const start = kstDateParts(windowStart);
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

function getMaxPriceForDestination(destination: string): number {
    const dest = destination.toUpperCase();
    if (
        /도쿄|오사카|후쿠오카|나고야|삿포로|TOKYO|OSAKA|NRT|KIX|FUK|NGO/.test(dest)
    ) return 450_000;
    if (
        /방콕|푸켓|다낭|호치민|세부|마닐라|싱가포르|BANGKOK|DANANG|CEBU|SINGAPORE/.test(dest)
    ) return 500_000;
    if (/베이징|상하이|광저우|BEIJING|SHANGHAI|PEK|PVG/.test(dest)) return 500_000;
    if (/괌|사이판|하와이|GUAM|SAIPAN|HAWAII|GUM|HNL/.test(dest)) return 800_000;
    if (/파리|런던|로마|프랑크푸르트|PARIS|LONDON|ROME|CDG|LHR|FCO/.test(dest)) return 1_000_000;
    if (/뉴욕|LA|시애틀|밴쿠버|토론토|NEW YORK|LOS ANGELES|JFK|LAX|YVR/.test(dest)) return 1_000_000;
    return 1_000_000;
}

function buildPageUrl(continentCode: string, now: Date): string {
    const query = JSON.stringify({
        departureCity: '',
        continentCode,
        arrivalCity: '',
        departureDate: formatKstDate(now),
        arrivalDate: addKstMonth(now),
        page: 1,
        itemCount: 200,
        sort: 'Lowest',
    });
    return `${MODETOUR_URL}?query=${encodeURIComponent(query)}`;
}

function buildBookingLink(
    continentCode: string,
    departureAirport: string,
    arrivalAirport: string,
    departureDate: string,
): string {
    if (!departureAirport || !arrivalAirport || !departureDate) {
        return MODETOUR_URL;
    }

    const nextDay = new Date(`${departureDate}T00:00:00+09:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const query = JSON.stringify({
        departureCity: departureAirport,
        continentCode,
        arrivalCity: arrivalAirport,
        departureDate,
        arrivalDate: nextDay.toISOString().slice(0, 10),
        page: 1,
        itemCount: 200,
        sort: 'Lowest',
    });
    return `${MODETOUR_URL}?query=${encodeURIComponent(query)}`;
}

export function parseModetourDomSnapshot(
    snapshot: ModetourDomSnapshot,
    continentCode: string,
    now = new Date(),
): Flight | null {
    const departureDate = parseMonthDay(snapshot.departureMonthDay, now);
    const returnDate = parseMonthDay(snapshot.returnMonthDay, now);
    const price = Number(snapshot.price || 0);
    const airline = normalizeAirline(snapshot.airline.trim());
    const departureCity = snapshot.departureCity.trim();
    const arrivalCity = snapshot.arrivalCity.trim();
    if (
        !airline
        || !departureCity
        || !arrivalCity
        || !departureDate
        || !returnDate
        || departureDate === returnDate
        || !Number.isFinite(price)
        || price <= 0
        || price > getMaxPriceForDestination(arrivalCity)
    ) {
        return null;
    }

    const departureAirport = getAirportCode(departureCity) || '';
    const arrivalAirport = getAirportCode(arrivalCity) || '';
    const id = buildStableFlightId('modetour-dom', [
        continentCode,
        airline,
        departureCity,
        arrivalCity,
        departureDate,
        returnDate,
        snapshot.departureTime,
        snapshot.returnTime,
        price,
    ]);

    return {
        id,
        source: 'modetour',
        airline,
        departure: {
            city: departureCity,
            airport: departureAirport,
            date: departureDate,
            time: snapshot.departureTime,
        },
        arrival: {
            city: arrivalCity,
            airport: arrivalAirport,
            date: returnDate,
            time: snapshot.returnTime,
        },
        price,
        currency: 'KRW',
        link: buildBookingLink(
            continentCode,
            departureAirport,
            arrivalAirport,
            departureDate,
        ),
        availableSeats: snapshot.seats,
        region: getRegionByCity(arrivalCity),
        modetourDetail: {
            flyingTime: snapshot.flyingTime,
            isDirect: snapshot.isDirect,
            isReturnDirect: snapshot.isDirect,
            normalPrice: snapshot.normalPrice,
            sourceDiscountRate: snapshot.sourceDiscountRate,
            returnDepartureTime: snapshot.returnTime,
            returnDepartureAirport: arrivalAirport || undefined,
            returnArrivalAirport: departureAirport || undefined,
        },
    };
}

function isFareDataResponse(response: Response): boolean {
    try {
        return new URL(response.url()).pathname.includes(MODETOUR_DATA_PATH);
    } catch {
        return false;
    }
}

async function assertFareResponse(response: Response, label: string): Promise<void> {
    const status = response.status();
    if (status === 401 || status === 403 || status === 429 || !response.ok()) {
        throw new SourceResponseError(
            'http-status',
            `${label} 브라우저 목록 HTTP ${status}`,
            status,
            response.headers()['content-type'] || '',
            undefined,
            response.url(),
        );
    }
}

async function readVisibleCards(page: Page): Promise<ModetourDomSnapshot[]> {
    return page.locator('div').evaluateAll((divs) => divs
        .filter((element) => {
            const className = String(element.className || '');
            const text = (element.textContent || '').trim();
            return className.includes('min-h-[194px]')
                && className.includes('rounded-[10px]')
                && /[\d,]+원/.test(text);
        })
        .map((card) => {
            const top = card.querySelector(':scope > div[role="presentation"]') || card;
            const spans = Array.from(top.querySelectorAll('span'));
            const spanText = (element: Element | null | undefined) => (element?.textContent || '').replace(/\s+/g, ' ').trim();
            const dates = spans.filter(element => /^\d{2}\/\d{2}(?:\s|$)/.test(spanText(element)));
            const times = spans.map(spanText).filter(value => /^\d{2}:\d{2}$/.test(value));
            const airline = spans.find(element => String(element.className).includes('font-bold'));
            const priceElement = Array.from(card.querySelectorAll('span'))
                .find(element => /^\d{1,3}(?:,\d{3})+원$/.test(spanText(element)));
            const normalPriceElement = Array.from(card.querySelectorAll('span'))
                .find(element => String(element.className).includes('line-through'));
            const discountElement = Array.from(card.querySelectorAll('span'))
                .find(element => /^\d{1,3}%$/.test(spanText(element)));
            const topText = (top.textContent || '').replace(/\s+/g, ' ');
            const seatMatch = topText.match(/좌석\s*(\d+)석/);
            const flyingTimeMatch = topText.match(/(\d{2}시간\s*\d{2}분)/);
            const price = Number(spanText(priceElement).replace(/[^\d]/g, ''));
            const normalPrice = Number(spanText(normalPriceElement).replace(/[^\d]/g, ''));
            const sourceDiscountRate = Number(spanText(discountElement).replace(/[^\d]/g, ''));

            return {
                airline: spanText(airline),
                departureTime: times[0] || '',
                departureCity: spanText(dates[0]?.previousElementSibling),
                departureMonthDay: spanText(dates[0]).slice(0, 5),
                returnTime: times[1] || '',
                arrivalCity: spanText(dates[1]?.previousElementSibling),
                returnMonthDay: spanText(dates[1]).slice(0, 5),
                flyingTime: flyingTimeMatch?.[1]?.replace(/\s+/g, ' '),
                isDirect: /직항/.test(topText),
                seats: seatMatch ? Number(seatMatch[1]) : undefined,
                price,
                normalPrice: normalPrice > 0 ? normalPrice : undefined,
                sourceDiscountRate: sourceDiscountRate > 0 ? sourceDiscountRate : undefined,
            };
        }));
}

function cacheHadRegion(prevFlights: any[], cacheRegions: readonly string[]): boolean {
    return prevFlights.some(flight =>
        flight?.source === 'modetour'
        && cacheRegions.includes(flight.region || getRegionByCity(flight.arrival?.city || '')),
    );
}

async function waitForVisibleRegion(page: Page, label: string): Promise<void> {
    await page.waitForFunction((expectedLabel) => {
        const selected = Array.from(document.querySelectorAll('[role="button"]')).find((element) => {
            const style = window.getComputedStyle(element);
            return (element.textContent || '').trim() === expectedLabel
                && element.getBoundingClientRect().width > 0
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && style.pointerEvents === 'none';
        });
        const hasCards = Array.from(document.querySelectorAll('div')).some((element) =>
            String(element.className || '').includes('min-h-[194px]')
            && /[\d,]+원/.test(element.textContent || ''),
        );
        const bodyText = document.body?.innerText || '';
        const empty = /검색\s*결과가?\s*(?:없|0건)|조회된\s*항공권이?\s*없/.test(bodyText);
        return Boolean(selected && (hasCards || empty));
    }, label, { timeout: 20_000 });
}

/**
 * GitHub의 모두투어 차단 회로가 열렸을 때 Windows PC에서만 사용하는 공개 DOM 수집기.
 * API 응답 본문은 읽지 않고 화면에 렌더링된 카드만 읽는다.
 */
export async function scrapeModetourDom(prevFlights: any[] = []): Promise<Flight[]> {
    if (process.env.LOCAL_SOURCE_FALLBACK !== '1') {
        throw new Error('모두투어 DOM 수집은 LOCAL_SOURCE_FALLBACK=1인 PC 대체 수집에서만 허용됩니다.');
    }

    const stats: ModetourDomStats = {
        pageLoads: 0,
        regionSelections: 0,
        fareDataRequests: 0,
        totalBrowserRequests: 0,
        blockedStaticRequests: 0,
        requestLimit: MODETOUR_DOM_DATA_REQUEST_LIMIT,
    };
    lastStats = stats;
    let requestLimitExceeded = false;
    const browser = await chromium.launch({
        headless: process.env.MODETOUR_DOM_HEADLESS === '1' || !!process.env.CI,
    });

    try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            locale: 'ko-KR',
            extraHTTPHeaders: {
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        await context.route('**/*', async (route) => {
            const request = route.request();
            stats.totalBrowserRequests += 1;
            if (['image', 'media', 'font'].includes(request.resourceType())) {
                stats.blockedStaticRequests += 1;
                await route.abort('blockedbyclient');
                return;
            }
            if (request.url().includes(MODETOUR_DATA_PATH)) {
                if (stats.fareDataRequests >= MODETOUR_DOM_DATA_REQUEST_LIMIT) {
                    requestLimitExceeded = true;
                    await route.abort('blockedbyclient');
                    return;
                }
                stats.fareDataRequests += 1;
            }
            await route.continue();
        });

        const page = await context.newPage();
        const now = new Date();
        const allFlights: Flight[] = [];

        for (let index = 0; index < REGIONS.length; index += 1) {
            const region = REGIONS[index];
            let responsePromise: Promise<Response>;

            if (index === 0) {
                responsePromise = page.waitForResponse(isFareDataResponse, { timeout: 25_000 });
                stats.pageLoads += 1;
                const landingResponse = await page.goto(buildPageUrl(region.code, now), {
                    waitUntil: 'domcontentloaded',
                    timeout: 30_000,
                });
                if (landingResponse && !landingResponse.ok()) {
                    throw new SourceResponseError(
                        'http-status',
                        `모두투어 PC DOM 초기 페이지 HTTP ${landingResponse.status()}`,
                        landingResponse.status(),
                        landingResponse.headers()['content-type'] || '',
                        undefined,
                        landingResponse.url(),
                    );
                }
            } else {
                await randomDelay(3, 6);
                const button = page.locator('[role="button"][class*="h-[60px]"]', {
                    hasText: region.label,
                });
                if (await button.count() === 0 || !(await button.first().isVisible().catch(() => false))) {
                    throw new SourceResponseError(
                        'schema-mismatch',
                        `모두투어 PC DOM ${region.label} 지역 버튼을 찾지 못했습니다.`,
                    );
                }
                responsePromise = page.waitForResponse(isFareDataResponse, { timeout: 25_000 });
                stats.regionSelections += 1;
                try {
                    await button.first().click({ timeout: 5_000 });
                } catch (error) {
                    void responsePromise.catch(() => undefined);
                    throw new SourceResponseError(
                        'network',
                        `모두투어 PC DOM ${region.label} 지역 버튼을 누르지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            let fareResponse: Response;
            try {
                fareResponse = await responsePromise;
            } catch (error) {
                if (requestLimitExceeded) {
                    throw new SourceResponseError(
                        'schema-mismatch',
                        `모두투어 PC DOM 운임 요청 ${MODETOUR_DOM_DATA_REQUEST_LIMIT}회 상한에 도달해 중단했습니다.`,
                    );
                }
                throw new SourceResponseError(
                    'network',
                    `모두투어 PC DOM ${region.label} 목록을 기다리지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            await assertFareResponse(fareResponse, `모두투어 PC DOM ${region.label}`);
            await waitForVisibleRegion(page, region.label);

            const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
            assertNoSourceAccessBlockText(`모두투어 PC DOM ${region.label}`, bodyText, page.url());
            if (requestLimitExceeded) {
                throw new SourceResponseError(
                    'schema-mismatch',
                    `모두투어 PC DOM 운임 요청 ${MODETOUR_DOM_DATA_REQUEST_LIMIT}회 상한을 초과하려 해 중단했습니다.`,
                );
            }

            const snapshots = await readVisibleCards(page);
            if (snapshots.length === 0 && cacheHadRegion(prevFlights, region.cacheRegions)) {
                throw new SourceResponseError(
                    'soft-block',
                    `모두투어 PC DOM ${region.label} 카드가 0건으로 감소했습니다.`,
                    200,
                    'text/html',
                    undefined,
                    page.url(),
                );
            }

            const parsed = snapshots
                .map(snapshot => parseModetourDomSnapshot(snapshot, region.code, now))
                .filter((flight): flight is Flight => Boolean(flight));
            if (snapshots.length > 0 && parsed.length === 0) {
                throw new SourceResponseError(
                    'schema-mismatch',
                    `모두투어 PC DOM ${region.label} 카드 ${snapshots.length}건을 항공권으로 해석하지 못했습니다.`,
                );
            }
            allFlights.push(...parsed);
            console.log(
                `모두투어 PC DOM ${region.label}: 화면 카드 ${snapshots.length}건, 가격 필터 후 ${parsed.length}건`,
            );
        }

        const unique = Array.from(new Map(allFlights.map(flight => [flight.id, flight])).values());
        if (unique.length === 0 && prevFlights.some(flight => flight?.source === 'modetour')) {
            throw new SourceResponseError('soft-block', '모두투어 PC DOM 전체 카드가 0건입니다.', 200);
        }
        console.log(
            `모두투어 PC DOM 완료: 공개 페이지 ${stats.pageLoads}회, 지역 전환 ${stats.regionSelections}회, `
            + `운임 데이터 요청 ${stats.fareDataRequests}/${stats.requestLimit}회, 항공권 ${unique.length}건`,
        );
        return unique;
    } finally {
        lastStats = { ...stats };
        await browser.close();
    }
}
