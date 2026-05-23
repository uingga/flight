const codes = [
    ['PAR','파리(도시)'], ['CDG','파리(공항)'], ['LON','런던(도시)'], ['LHR','런던(공항)'],
    ['NYC','뉴욕(도시)'], ['JFK','뉴욕(공항)'], ['MIL','밀라노(도시)'], ['MXP','밀라노(공항)'],
    ['PRG','프라하'], ['AMS','암스테르담'], ['BER','베를린'], ['MUC','뮌헨'],
    ['BCN','바르셀로나'], ['LIS','리스본'], ['VIE','빈'], ['BUD','부다페스트'],
    ['ATH','아테네'], ['CPH','코펜하겐'], ['HEL','헬싱키'], ['FRA','프랑크푸르트'],
    ['HNL','호놀룰루'], ['LAS','라스베이거스'], ['SFO','샌프란시스코'],
    ['DEL','델리'], ['KTM','카트만두'], ['MLE','몰디브'], ['KUL','쿠알라룸푸르'],
    ['RGN','양곤'], ['PNH','프놈펜'], ['REP','시엠립'], ['VVO','블라디보스토크'],
    ['ALA','알마티'], ['KBV','끄라비'], ['SDJ','센다이'], ['KMI','미야자키'],
    ['CAN','광저우'], ['KMG','쿤밍'], ['CTU','청두'], ['DBV','두브로브니크'],
    ['JTR','산토리니'], ['ARN','스톡홀름'], ['ZRH','취리히'],
    ['KOJ','가고시마'], ['OIT','오이타'], ['TOY','도야마'],
];

async function test() {
    for (const [code, name] of codes) {
        try {
            const r = await fetch(
                `https://travel.interpark.com/air/air-api/inpark-air-web-api/recommendations/cities/monthly-prices?destinationCity=${code}`,
                { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }
            );
            const d = await r.json();
            const ok = Array.isArray(d) && d.length > 0;
            console.log(ok ? '✅' : '❌', code.padEnd(4), name, ok ? `${d.length}개월` : '없음');
        } catch (e) {
            console.log('❌', code.padEnd(4), name, '에러');
        }
        await new Promise(r => setTimeout(r, 200));
    }
}

test();
