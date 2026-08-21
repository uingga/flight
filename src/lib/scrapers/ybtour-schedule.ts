import { Page } from 'playwright';

/**
 * 노랑풍선 항공권의 출발·도착 시각을 노랑풍선에서 직접 가져온다.
 *
 * 예전에는 땡처리닷컴의 실시간 운임 검색으로 시각을 채웠다. 노랑풍선 목록 화면의
 * hidden input에는 날짜·공항·좌석·가격만 있고 시각이 없기 때문이다. 그 결과 두 가지가
 * 따라왔다.
 *
 *  - 땡처리로 나가는 요청의 3분의 2가 땡처리와 무관한 노랑풍선 시각 조회였다.
 *    땡처리가 막히면 노랑풍선 시각도 함께 사라진다.
 *  - 빌려온 값이 틀릴 수 있다. 실제로 진에어 부산–후쿠오카 귀국편이 캐시에는 11:00,
 *    노랑풍선에는 10:55로 5분 어긋난 사례를 확인했다. 땡처리 실시간 재고에 뜬 편이
 *    노랑풍선이 파는 편과 미묘하게 다르기 때문이다.
 *
 * 목록 다음 단계인 findDscInvSkdDetail.lts가 편명, 양쪽 다리의 시각, 수하물,
 * 최소 탑승 인원까지 준다. 페이지 이동 없이 POST 한 번이면 되고 응답도 훨씬 빠르다.
 */

export interface ScheduleKey {
    /** 운임 그룹 (예: TW0101ICNBKK-T3) */
    inhId: string;
    inmSeqId: string;
    inpId: string;
    /** YYYYMMDD */
    depDate: string;
    bookingCls: string;
    remainingSeat: string;
}

export interface ScheduleData {
    /** 예: TW0101 */
    flightNumber: string;
    depTime: string;
    arrTime: string;
    retDepTime: string;
    retArrTime: string;
    /** 최소 탑승 인원. 2 이상이면 1인으로는 예약할 수 없다. */
    minPax: number;
    /** 예: "15 Kg" */
    baggage: string;
}

export function scheduleKeyOf(k: ScheduleKey): string {
    return `${k.inhId}|${k.inmSeqId}|${k.depDate}`;
}

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/** 응답 본문이 아니라 그 안의 JS 문자열 조립을 읽는다. 마크업이 바뀌면 조용히 깨지므로 검증이 필수다. */
const LEG_PATTERN = /'(\d{2}\/\d{2})'\+'\('\+'[^']*'\+'\) '\+'(\d{2}:\d{2})'\+' '\+'([^']+)'/g;

interface Leg {
    date: string;   // MM/DD
    time: string;   // HH:MM
    city: string;
}

function readLegs(section: string): Leg[] {
    LEG_PATTERN.lastIndex = 0;
    return Array.from(section.matchAll(LEG_PATTERN)).map(m => ({
        date: m[1], time: m[2], city: m[3].trim(),
    }));
}

/**
 * 응답을 뜯어 스케줄을 만든다. 조금이라도 어긋나면 null을 돌려준다.
 * 시각이 비는 것보다 틀린 시각이 붙는 것이 훨씬 비싸기 때문이다.
 */
export function parseScheduleDetail(html: string, expectedDepDate: string): ScheduleData | null {
    const outIdx = html.indexOf('출국</td>');
    const inIdx = html.indexOf('귀국</td>');
    if (outIdx < 0 || inIdx < 0 || inIdx <= outIdx) return null;

    const outbound = readLegs(html.slice(outIdx, inIdx));
    const inbound = readLegs(html.slice(inIdx));
    if (outbound.length < 2 || inbound.length < 2) return null;

    // 요청한 출발일과 응답의 출국 날짜가 같아야 한다 (엉뚱한 편을 붙이지 않기 위한 최소 확인)
    const expectedMmdd = `${expectedDepDate.slice(4, 6)}/${expectedDepDate.slice(6, 8)}`;
    if (outbound[0].date !== expectedMmdd) return null;

    // 왕복이므로 가는 편 도착지와 오는 편 출발지가 같아야 한다
    if (!outbound[1].city || outbound[1].city !== inbound[0].city) return null;

    const carrier = (html.match(/carrier_logo\/30\/'\+'([A-Z0-9]{2})'/) || [])[1] || '';
    const number = (html.match(/'(\d{3,4})'\+'편/) || [])[1] || '';

    return {
        flightNumber: carrier && number ? `${carrier}${number}` : '',
        depTime: outbound[0].time,
        arrTime: outbound[1].time,
        retDepTime: inbound[0].time,
        retArrTime: inbound[1].time,
        minPax: Number((html.match(/minpax\s*=\s*Number\('(\d+)'\)/) || [])[1] || 1) || 1,
        baggage: (html.match(/'(\d+\s*Kg)'/i) || [])[1] || '',
    };
}

/**
 * 상대 서버가 막기 시작하면 남은 것을 계속 두드려도 얻는 것이 없다.
 * 이만큼 연속으로 실패하면 이번 회차 조회를 접는다. 시각이 없는 항공권도
 * 목록에서 사라지지 않고 다음 크롤에서 채워진다.
 */
const MAX_CONSECUTIVE_FAILURES = 8;

export async function fetchYbtourSchedules(
    page: Page,
    keys: ScheduleKey[],
): Promise<Map<string, ScheduleData>> {
    const result = new Map<string, ScheduleData>();

    // 같은 편을 두 번 묻지 않는다
    const unique = new Map<string, ScheduleKey>();
    for (const k of keys) {
        if (k.inhId && k.inmSeqId && k.depDate) unique.set(scheduleKeyOf(k), k);
    }

    const entries = Array.from(unique.entries());
    console.log(`[노랑풍선] 자체 스케줄 조회: ${entries.length}개`);

    let ok = 0;
    let failed = 0;
    let rejected = 0;
    let consecutiveFailures = 0;
    let idx = 0;

    for (const [id, key] of entries) {
        idx++;
        let succeeded = false;

        try {
            const res = await page.evaluate(async (body: Record<string, string>) => {
                const r = await fetch('/booking/findDscInvSkdDetail.lts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                    body: new URLSearchParams(body).toString(),
                });
                return { status: r.status, text: await r.text() };
            }, {
                inmInhId: key.inhId,
                inmSeqId: key.inmSeqId,
                inmInpId: key.inpId,
                inmDepDate: key.depDate,
                bookingCls: key.bookingCls,
                // 화면 위치를 가리키는 값인데 서버가 보지 않는다 (다른 노선을 조회해도 그 노선이 온다)
                skdLoc: '1',
                skdSeq: '1',
                remainingSeat: key.remainingSeat,
                viewType: '',
            });

            if (res.status === 200 && res.text) {
                succeeded = true;
                const parsed = parseScheduleDetail(res.text, key.depDate);
                if (parsed) {
                    result.set(id, parsed);
                    ok++;
                } else {
                    // 응답은 받았는데 읽지 못했다. 서버 탓이 아니므로 차단 판단에는 쓰지 않는다.
                    rejected++;
                }
            }
        } catch {
            succeeded = false;
        }

        if (succeeded) {
            consecutiveFailures = 0;
        } else {
            failed++;
            consecutiveFailures++;
        }

        if (idx % 25 === 0 || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`[노랑풍선]   ... ${idx}/${entries.length} (성공: ${ok}, 실패: ${failed}, 형식 불일치: ${rejected})`);
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`[노랑풍선] 연속 ${consecutiveFailures}건 실패 — 남은 ${entries.length - idx}개는 건너뜁니다`);
            break;
        }

        if (idx < entries.length) {
            const wait = consecutiveFailures > 0
                ? Math.min(2 * Math.pow(2, consecutiveFailures - 1), 30)
                : 0.4;
            await randomDelay(wait, wait * 1.8);
        }
    }

    if (rejected > 0) {
        console.log(`[노랑풍선] 응답 형식을 읽지 못한 건 ${rejected}개 — 페이지 구조가 바뀌었는지 확인이 필요합니다`);
    }
    console.log(`[노랑풍선] 자체 스케줄 완료: ${ok}건 (조회 ${idx}/${entries.length}, 실패 ${failed}, 형식 불일치 ${rejected})`);

    return result;
}
