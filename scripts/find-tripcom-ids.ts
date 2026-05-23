// Trip.com 자동완성 API로 도시 ID 조회
const cities: [string, string][] = [
    ['웨이하이', 'Weihai'], ['대련', 'Dalian'], ['장가계', 'Zhangjiajie'],
    ['칭다오', 'Qingdao'], ['옌타이', 'Yantai'], ['파리', 'Paris'],
    ['런던', 'London'], ['뮌헨', 'Munich'], ['베를린', 'Berlin'],
    ['부다페스트', 'Budapest'], ['프라하', 'Prague'], ['암스테르담', 'Amsterdam'],
    ['바르셀로나', 'Barcelona'], ['리스본', 'Lisbon'], ['아테네', 'Athens'],
    ['뉴욕', 'New York'], ['라스베이거스', 'Las Vegas'], ['호놀룰루', 'Honolulu'],
    ['샌프란시스코', 'San Francisco'], ['시카고', 'Chicago'],
    ['끄라비', 'Krabi'], ['자카르타', 'Jakarta'], ['양곤', 'Yangon'],
    ['시엠립', 'Siem Reap'], ['프놈펜', 'Phnom Penh'],
    ['코사무이', 'Ko Samui'], ['랑카위', 'Langkawi'], ['페낭', 'Penang'],
    ['루앙프라방', 'Luang Prabang'], ['달랏', 'Da Lat'], ['후에', 'Hue'],
    ['광저우', 'Guangzhou'], ['선전', 'Shenzhen'], ['청두', 'Chengdu'],
    ['충칭', 'Chongqing'], ['쿤밍', 'Kunming'], ['시안', 'Xian'],
    ['난징', 'Nanjing'], ['항저우', 'Hangzhou'],
    ['블라디보스토크', 'Vladivostok'], ['울란바토르', 'Ulaanbaatar'],
    ['알마티', 'Almaty'], ['델리', 'New Delhi'], ['카트만두', 'Kathmandu'],
    ['몰디브', 'Maldives'], ['센다이', 'Sendai'], ['미야자키', 'Miyazaki'],
    ['헬싱키', 'Helsinki'], ['코펜하겐', 'Copenhagen'],
    ['프랑크푸르트', 'Frankfurt'], ['두브로브니크', 'Dubrovnik'],
    ['산토리니', 'Santorini'], ['스톡홀름', 'Stockholm'], ['취리히', 'Zurich'],
    ['마드리드', 'Madrid'], ['베네치아', 'Venice'], ['브뤼셀', 'Brussels'],
    ['바르샤바', 'Warsaw'], ['더블린', 'Dublin'], ['에든버러', 'Edinburgh'],
    ['니스', 'Nice'], ['피렌체', 'Florence'], ['캔쿤', 'Cancun'],
    ['밴쿠버', 'Vancouver'], ['니가타', 'Niigata'], ['오카야마', 'Okayama'],
    ['도쿠시마', 'Tokushima'], ['아키타', 'Akita'], ['도야마', 'Toyama'],
    ['밀라노', 'Milan'], ['빈', 'Vienna'],
    // 검증용
    ['오사카', 'Osaka'], ['도쿄', 'Tokyo'], ['방콕', 'Bangkok'],
];

async function findCityId(keyword: string): Promise<{ id: number; name: string; type: string } | null> {
    // Trip.com htlsearch API
    const url = `https://kr.trip.com/htls/getHTLSuggest?keyword=${encodeURIComponent(keyword)}&locale=ko_KR`;
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
            },
        });
        const data = await res.json();
        // 여러 형태의 응답 구조 확인
        const suggestions = data?.data?.suggests || data?.suggests || data?.data || [];
        if (Array.isArray(suggestions) && suggestions.length > 0) {
            const city = suggestions.find((s: any) => s.type === 'city' || s.type === 'CT') || suggestions[0];
            return { id: city.cityId || city.id, name: city.cityName || city.name || keyword, type: city.type || '?' };
        }
        return null;
    } catch { return null; }
}

async function findCityIdV2(keyword: string): Promise<number | null> {
    // Trip.com global search API
    const url = `https://kr.trip.com/hotels/api/searchSuggest?keyword=${encodeURIComponent(keyword)}&locale=ko-KR&currency=KRW`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ keyword, locale: 'ko_KR' }),
        });
        const data = await res.json();
        // 다양한 구조 탐색
        const items = data?.data?.result || data?.result || data?.data?.hotelSuggests || [];
        if (Array.isArray(items) && items.length > 0) {
            return items[0].cityId || items[0].id || null;
        }
        return null;
    } catch { return null; }
}

async function findCityIdV3(keyword: string): Promise<number | null> {
    // Trip.com IBUHOTEL htl suggest API
    const url = 'https://kr.trip.com/restapi/soa2/28027/htlSuggest';
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                keyword,
                pageIndex: 1,
                pageSize: 10,
                needHotel: false,
                locale: 'ko_KR',
            }),
        });
        const text = await res.text();
        // cityId 추출
        const match = text.match(/"cityId"\s*:\s*(\d+)/);
        if (match) return parseInt(match[1]);
        return null;
    } catch { return null; }
}

async function main() {
    console.log('=== Trip.com 도시 ID 조사 ===\n');

    // 먼저 API v3 테스트
    console.log('--- API v3 (htlSuggest) 테스트 ---');
    const testId = await findCityIdV3('Osaka');
    console.log('Osaka test:', testId);
    const testId2 = await findCityIdV3('Weihai');
    console.log('Weihai test:', testId2);
    console.log();

    if (testId) {
        console.log('--- v3 API로 전체 조회 ---\n');
        for (const [kr, en] of cities) {
            const id = await findCityIdV3(en);
            if (id) {
                console.log(`    '${kr}': { id: ${id}, name: '${kr}' },`);
            } else {
                console.log(`    // ❌ ${kr} (${en}) - ID 못찾음`);
            }
            await new Promise(r => setTimeout(r, 200));
        }
    } else {
        console.log('--- v1 API 테스트 ---');
        const t1 = await findCityId('Osaka');
        console.log('v1 Osaka:', JSON.stringify(t1));
        console.log('--- v2 API 테스트 ---');
        const t2 = await findCityIdV2('Osaka');
        console.log('v2 Osaka:', t2);
    }
}

main();
