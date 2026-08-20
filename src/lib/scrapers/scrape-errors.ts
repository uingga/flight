import type { Flight } from '@/types/flight';

/**
 * 스크래퍼가 "일부만 긁고 정상 종료"하는 것을 막기 위한 예외.
 *
 * 여행사 사이트의 지역 탭 하나가 안 열리면 그 지역 항공권이 통째로 빠지는데,
 * 결과 배열은 여전히 0건이 아니라 정상처럼 보인다. 호출부(crawl-all)가 이를
 * 받아들이면 멀쩡한 이전 캐시를 반쪽 데이터로 덮어써 사용자에게 노선이 사라진다.
 * 그래서 불완전이 확인되면 데이터를 넘기지 않고 이 예외를 던져 실패로 처리한다.
 *
 * 실제 사고: 노랑풍선 아시아 탭 실패로 250건→87건(동남아·중국 전멸),
 * 온라인투어 2026-08-20 오후 81건→13건(13개 도시→6개).
 */
export class IncompleteScrapeError extends Error {
    readonly missingParts: string[];

    constructor(message: string, missingParts: string[]) {
        super(message);
        this.name = 'IncompleteScrapeError';
        this.missingParts = missingParts;
    }
}

/**
 * 수집에 실패한 구간을 모아 두었다가, 직전 크롤에 실제로 항공권이 있었던 구간만
 * "진짜 고장"으로 판정한다.
 *
 * 원래 비어 있던 지역까지 실패로 치면 여행사가 노선을 접을 때마다 오탐이 나므로,
 * 반드시 이전 결과를 근거로 삼는다.
 */
export class ScrapeCompleteness {
    private readonly broken: string[] = [];
    private readonly harmless: string[] = [];

    constructor(
        private readonly sourceName: string,
        private readonly source: Flight['source'],
        private readonly prevFlights: any[] = [],
    ) { }

    /**
     * 한 구간(지역·도시·날짜 등)의 수집 실패를 기록한다.
     *
     * @param label 사람이 읽을 구간 이름
     * @param hadFlights 직전 크롤에 이 구간 항공권이 있었는지 판별하는 함수.
     *                   생략하면 항상 고장으로 간주한다(구간을 특정할 수 없는 경우).
     */
    recordFailure(label: string, hadFlights?: (flight: any) => boolean): void {
        const previouslyHad = hadFlights
            ? this.prevFlights.some(f => f?.source === this.source && hadFlights(f))
            : true;

        if (previouslyHad) {
            console.error(`[FAIL] ${this.sourceName} ${label} 수집 실패 — 직전 크롤엔 항공권이 있던 구간`);
            this.broken.push(label);
        } else {
            console.log(`[SKIP] ${this.sourceName} ${label} 수집 실패 (직전에도 항공권 없음 — 무시)`);
            this.harmless.push(label);
        }
    }

    /** 고장으로 판정된 구간이 하나라도 있으면 예외를 던진다. 수집 종료 직전에 호출한다. */
    assertComplete(collected: number): void {
        if (this.broken.length === 0) {
            if (this.harmless.length > 0) {
                console.log(`${this.sourceName}: 빈 구간 ${this.harmless.length}개 건너뜀 (정상)`);
            }
            return;
        }
        throw new IncompleteScrapeError(
            `${this.sourceName} 수집 실패 구간: ${this.broken.join(', ')} (수집된 ${collected}건은 불완전해 폐기)`,
            this.broken,
        );
    }
}
