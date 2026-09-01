import type { Page } from 'playwright';
import {
    assertNoSourceAccessBlockText,
    isExplicitAccessRestrictionStatus,
    SourceResponseError,
} from '../../src/lib/scrapers/source-response';

export interface FlightResult {
    price: number;
    airline: string;
    isDirect: boolean;
    availableSeats?: number;
    depTime: string;
    arrTime: string;
    duration: string;
    retDepTime: string;
    retArrTime: string;
    retDuration: string;
    routeAirports?: {
        outboundDeparture: string;
        outboundArrival: string;
        returnDeparture: string;
        returnArrival: string;
    };
}

const RESULT_BUTTON_SELECTOR = 'button[aria-label*="항공권"][aria-label*="원 선택"]';
const SEAT_PATTERN_SOURCE = String.raw`(?:잔여\s*(\d{1,3})석|(\d{1,3})석\s*남음)`;
const AIRPORT_LINE_PATTERN_SOURCE = String.raw`^([A-Z]{3})(?:\s+T[A-Z0-9]+)?$`;

export function parseMyrealtripRouteAirports(text: string): FlightResult['routeAirports'] {
    const airportPattern = new RegExp(AIRPORT_LINE_PATTERN_SOURCE);
    const codes = text.split('\n')
        .map(line => line.trim().match(airportPattern)?.[1])
        .filter((code): code is string => Boolean(code));
    if (codes.length < 4) return undefined;
    return {
        outboundDeparture: codes[0],
        outboundArrival: codes[1],
        returnDeparture: codes[2],
        returnArrival: codes[3],
    };
}

export function parseMyrealtripAvailableSeats(text: string): number | undefined {
    const match = text.match(new RegExp(SEAT_PATTERN_SOURCE));
    const seats = Number(match?.[1] || match?.[2]);
    return Number.isInteger(seats) && seats > 0 && seats <= 999 ? seats : undefined;
}

/**
 * 마이리얼트립 검색 결과에서 왕복 최저가와 시간을 읽는다.
 *
 * offers.k1 주소는 현재 air-web.myrealtrip.com/results로 이동한다. 새 화면은
 * 각 결과 카드의 선택 버튼 aria-label에 항공사와 결제 가격을 함께 제공하므로,
 * 화면 전체 텍스트나 좌석 문구보다 이 값을 우선 사용한다.
 */
export async function getMyrealtripSearchPrice(
    page: Page,
    gid: number,
    depDate: string,
    arrDate: string,
): Promise<FlightResult | null> {
    const url = `https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=${gid}&depdt=${depDate}&arrdt=${arrDate}&cabin=Y&adult=1&child=0&infant=0`;

    try {
        const landingResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (landingResponse && isExplicitAccessRestrictionStatus(landingResponse.status())) {
            throw new SourceResponseError(
                'http-status',
                `마이리얼트립 검색 페이지 HTTP ${landingResponse.status()}`,
                landingResponse.status(),
                landingResponse.headers()['content-type'] || '',
                undefined,
                landingResponse.url(),
            );
        }
        const newResultCard = await page.waitForSelector(RESULT_BUTTON_SELECTOR, { timeout: 15000 })
            .catch(() => null);
        const pageText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        assertNoSourceAccessBlockText('마이리얼트립 검색 페이지', pageText, page.url());

        // 새 화면은 기본값이 추천순이라 화면에 아직 붙지 않은 더 싼 표가 있을 수 있다.
        // 가격 낮은 순으로 바꾼 뒤 읽어 첫 화면만 읽더라도 실제 최저가가 포함되게 한다.
        if (newResultCard) {
            try {
                const currentSort = page.getByRole('button', { name: '추천순', exact: true });
                if (await currentSort.isVisible()) {
                    await currentSort.click();
                    const lowestPriceSort = page.getByRole('button', { name: '가격 낮은 순', exact: true });
                    await lowestPriceSort.click({ timeout: 5000 });
                }
            } catch {
                // 정렬 UI가 바뀌어도 현재 로드된 결과에서 가격을 읽는 폴백은 유지한다.
            }
        }
        // 첫 카드가 보인 뒤 3~6초를 쉬어 나머지 결과를 받고, 다음 노선으로 너무
        // 빠르게 넘어가 차단 가능성을 높이지 않도록 요청 간격도 확보한다.
        await page.waitForTimeout(3000 + Math.random() * 3000);

        const results: FlightResult[] = await page.evaluate(({ buttonSelector, seatPatternSource, airportLinePatternSource }) => {
            type ParsedFlight = {
                price: number;
                airline: string;
                availableSeats?: number;
                depTime: string;
                arrTime: string;
                duration: string;
                retDepTime: string;
                retArrTime: string;
                retDuration: string;
                routeAirports?: {
                    outboundDeparture: string;
                    outboundArrival: string;
                    returnDeparture: string;
                    returnArrival: string;
                };
                isDirect: boolean;
            };

            const directFlights: ParsedFlight[] = [];
            const allFlights: ParsedFlight[] = [];

            // 2026-08 현재 화면: 선택 버튼에 "항공사 항공권 278,600원 선택"이 들어간다.
            document.querySelectorAll<HTMLButtonElement>(buttonSelector).forEach((button) => {
                const label = button.getAttribute('aria-label') || '';
                const priceMatch = label.match(/([\d,]+)원\s*선택\s*$/);
                if (!priceMatch) return;

                const price = Number(priceMatch[1].replace(/,/g, ''));
                if (!Number.isFinite(price) || price < 100000 || price > 5000000) return;

                // 버튼의 바로 위 요소가 한 항공권의 접힌 요약 카드다. 더 위로 올라가면
                // 다른 항공권 텍스트까지 섞이므로 parentElement 한 단계만 사용한다.
                const summaryText = button.parentElement?.innerText || '';
                const airline = label
                    .replace(/\s*항공권\s+[\d,]+원\s*선택\s*$/, '')
                    .trim();
                const timeMatches = summaryText.match(/\b\d{2}:\d{2}\b/g) || [];
                const durationMatches = summaryText.match(/\d+시간(?:\s*\d+분)?/g) || [];
                const seatMatch = summaryText.match(new RegExp(seatPatternSource));
                const parsedSeats = Number(seatMatch?.[1] || seatMatch?.[2]);
                const airportPattern = new RegExp(airportLinePatternSource);
                const airportCodes = summaryText.split('\n')
                    .map(line => line.trim().match(airportPattern)?.[1])
                    .filter((code): code is string => Boolean(code));

                const isDirect = summaryText.includes('직항') && !/경유|[12]회/.test(summaryText);
                const flight = {
                    price,
                    airline,
                    isDirect,
                    availableSeats: Number.isInteger(parsedSeats) && parsedSeats > 0 && parsedSeats <= 999
                        ? parsedSeats
                        : undefined,
                    depTime: timeMatches[0] || '',
                    arrTime: timeMatches[1] || '',
                    duration: durationMatches[0] || '',
                    retDepTime: timeMatches[2] || '',
                    retArrTime: timeMatches[3] || '',
                    retDuration: durationMatches[1] || '',
                    routeAirports: airportCodes.length >= 4 ? {
                        outboundDeparture: airportCodes[0],
                        outboundArrival: airportCodes[1],
                        returnDeparture: airportCodes[2],
                        returnArrival: airportCodes[3],
                    } : undefined,
                };
                if (isDirect && !directFlights.some(item => item.price === flight.price)) {
                    directFlights.push(flight);
                }
                if (!allFlights.some(item => item.price === flight.price)) {
                    allFlights.push(flight);
                }
            });

            // 예전 offers.k1 화면이 다시 제공될 경우를 위한 제한적인 폴백.
            if (allFlights.length === 0) {
                document.querySelectorAll<HTMLElement>('*').forEach((element) => {
                    const text = element.innerText || '';
                    if (!text.includes('석 남음') || !text.includes('원') || text.length <= 50 || text.length >= 500) return;

                    const priceMatch = text.match(/([\d,]+)원/);
                    if (!priceMatch) return;
                    const price = Number(priceMatch[1].replace(/,/g, ''));
                    if (!Number.isFinite(price) || price < 100000 || price > 5000000) return;

                    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
                    const airline = lines.find(line =>
                        !line.includes('항공권')
                        && !line.includes('원')
                        && !line.includes('남음')
                        && line.length >= 2
                        && line.length <= 40
                    ) || '';
                    const timeMatches = text.match(/\b\d{2}:\d{2}\b/g) || [];
                    const durationMatches = text.match(/\d+시간(?:\s*\d+분)?/g) || [];
                    const seatMatch = text.match(new RegExp(seatPatternSource));
                    const parsedSeats = Number(seatMatch?.[1] || seatMatch?.[2]);
                    const airportPattern = new RegExp(airportLinePatternSource);
                    const airportCodes = text.split('\n')
                        .map(line => line.trim().match(airportPattern)?.[1])
                        .filter((code): code is string => Boolean(code));

                    const isDirect = text.includes('직항') && !/경유|[12]회/.test(text);
                    const flight = {
                        price,
                        airline,
                        isDirect,
                        availableSeats: Number.isInteger(parsedSeats) && parsedSeats > 0 && parsedSeats <= 999
                            ? parsedSeats
                            : undefined,
                        depTime: timeMatches[0] || '',
                        arrTime: timeMatches[1] || '',
                        duration: durationMatches[0] || '',
                        retDepTime: timeMatches[2] || '',
                        retArrTime: timeMatches[3] || '',
                        retDuration: durationMatches[1] || '',
                        routeAirports: airportCodes.length >= 4 ? {
                            outboundDeparture: airportCodes[0],
                            outboundArrival: airportCodes[1],
                            returnDeparture: airportCodes[2],
                            returnArrival: airportCodes[3],
                        } : undefined,
                    };
                    if (isDirect && !directFlights.some(item => item.price === flight.price)) {
                        directFlights.push(flight);
                    }
                    if (!allFlights.some(item => item.price === flight.price)) {
                        allFlights.push(flight);
                    }
                });
            }

            const target = directFlights.length > 0 ? directFlights : allFlights;
            target.sort((a, b) => a.price - b.price);
            return target.slice(0, 3);
        }, {
            buttonSelector: RESULT_BUTTON_SELECTOR,
            seatPatternSource: SEAT_PATTERN_SOURCE,
            airportLinePatternSource: AIRPORT_LINE_PATTERN_SOURCE,
        });

        return results[0] || null;
    } catch (error) {
        if (
            error instanceof SourceResponseError
            && (isExplicitAccessRestrictionStatus(error.status) || error.kind === 'html-response')
        ) {
            throw error;
        }
        console.warn(
            `[마이리얼트립] 실제 가격 조회 실패: gid=${gid}, ${depDate}~${arrDate} -`,
            error instanceof Error ? error.message : error,
        );
        return null;
    }
}
