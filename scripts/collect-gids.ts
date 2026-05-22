/**
 * 모든 마이리얼트립 도착지의 gid를 수집합니다.
 * 1. Bulk API로 전체 도시 목록 수집
 * 2. 파트너 API로 각 도시의 gid 수집
 * 3. data/gid-map.json에 저장
 */
import fs from 'fs';

const BULK_API_URL = 'https://api3.myrealtrip.com/flight/api/price/calendar/bulk-lowest';
const PARTNER_API_BASE = 'https://api3-backoffice.myrealtrip.com';
const LOGIN_BODY = { email: 'ynal@naver.com', password: '48324936Cmg!?' };

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function login(): Promise<string> {
    console.log('🔑 로그인 중...');
    const res = await fetch(`${PARTNER_API_BASE}/partner/v1/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LOGIN_BODY),
    });
    const data = await res.json() as any;
    const token = data?.data?.accessToken;
    if (!token) throw new Error('로그인 실패: ' + JSON.stringify(data));
    console.log('✅ 로그인 성공!');
    return token;
}

async function getBulkCities(): Promise<string[]> {
    console.log('📡 Bulk API로 도시 목록 수집...');
    const res = await fetch(BULK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departureCity: 'ICN', period: -1, airlines: ['ALL'], transfer: -1 }),
    });
    const data = await res.json() as any;
    const fares = data?.lowestPriceInfoList || [];
    const cities = [...new Set(fares.map((f: any) => f.arrivalCity))] as string[];
    console.log(`  ${cities.length}개 도착지 발견`);
    return cities;
}

async function getGid(token: string, arrCode: string): Promise<number | null> {
    try {
        const res = await fetch(`${PARTNER_API_BASE}/flight/api/partner/shopping/fare/query-landing-url`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'partner-access-token': token,
            },
            body: JSON.stringify({
                depAirportCd: 'SEL',
                arrAirportCd: arrCode,
                depDate: '2026-07-01',
                arrDate: '2026-07-04',
                tripTypeCd: 'RT',
                adult: 1, child: 0, infant: 0,
                cabinClass: 'ECONOMY',
            }),
        });
        const data = await res.json() as any;
        return data?.data?.gid || null;
    } catch {
        return null;
    }
}

async function main() {
    // 기존 gid-map 로드 (있으면)
    let existingMap: Record<string, number> = {};
    try {
        const existing = JSON.parse(fs.readFileSync('data/gid-map.json', 'utf8'));
        for (const [code, info] of Object.entries(existing)) {
            existingMap[code] = (info as any).gid;
        }
        console.log(`기존 gid-map: ${Object.keys(existingMap).length}개`);
    } catch {}

    const cities = await getBulkCities();
    const token = await login();
    
    const gidMap: Record<string, number> = { ...existingMap };
    let newCount = 0;
    let failCount = 0;
    
    // 기존 맵에 없는 도시만 수집
    const missing = cities.filter(c => !gidMap[c]);
    console.log(`\n수집 필요: ${missing.length}개 (기존 ${Object.keys(existingMap).length}개 스킵)`);
    
    for (let i = 0; i < missing.length; i++) {
        const code = missing[i];
        const gid = await getGid(token, code);
        if (gid) {
            gidMap[code] = gid;
            newCount++;
            if (newCount % 50 === 0) console.log(`  진행: ${newCount}/${missing.length}`);
        } else {
            failCount++;
        }
        // 429 방지: 300ms 딜레이
        await delay(300);
    }
    
    console.log(`\n📊 결과: 신규 ${newCount}, 실패 ${failCount}, 전체 ${Object.keys(gidMap).length}`);
    
    // 저장
    fs.writeFileSync('data/gid-map.json', JSON.stringify(gidMap, null, 2));
    console.log('✅ data/gid-map.json 저장 완료!');
    
    // TypeScript 상수 출력
    console.log(`\n// ROUTE_GID_MAP: ${Object.keys(gidMap).length}개 노선`);
}

main().catch(console.error);
