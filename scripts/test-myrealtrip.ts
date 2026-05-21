// 마이리얼트립 API 테스트 v3 - period 추가
const API_KEY = 'gRA9zPs6zdXf-tapAa6PTukmZzNYZ87G21sw-7_X7EienGgsbYxQ4SPX4h8_pL1P';
const BASE_URL = 'https://partner-ext-api.myrealtrip.com';

async function test() {
    console.log('=== 마이리얼트립 캘린더 API 테스트 (period 포함) ===\n');

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);

    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`기간: ${startDateStr} ~ ${endDateStr}`);

    // ICN → NRT 테스트
    const routes = [
        { dep: 'SEL', arr: 'TYO', name: '서울→도쿄' },
        { dep: 'SEL', arr: 'OSA', name: '서울→오사카' },
    ];

    for (const route of routes) {
        console.log(`\n--- ${route.name} (${route.dep}→${route.arr}) ---`);
        try {
            const res = await fetch(`${BASE_URL}/v1/products/flight/calendar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    depCityCd: route.dep,
                    arrCityCd: route.arr,
                    startDate: startDateStr,
                    endDate: endDateStr,
                    period: 3,
                }),
            });

            console.log(`Status: ${res.status}`);
            const data = await res.json();
            
            if (data?.result?.status === 200 && data?.data) {
                // data가 날짜 → 가격 맵인지 배열인지 확인
                if (Array.isArray(data.data)) {
                    console.log(`배열 형태: ${data.data.length}개`);
                    data.data.slice(0, 3).forEach((item: any, i: number) => {
                        console.log(`  [${i+1}]`, JSON.stringify(item));
                    });
                } else if (typeof data.data === 'object') {
                    const keys = Object.keys(data.data);
                    console.log(`객체 형태: ${keys.length}개 키`);
                    keys.slice(0, 5).forEach(k => {
                        console.log(`  ${k}:`, JSON.stringify(data.data[k]));
                    });
                }
            } else {
                console.log('응답:', JSON.stringify(data, null, 2).slice(0, 800));
            }
        } catch (e) {
            console.error('실패:', e);
        }
    }
}

test();
