// 모든 TRIPCOM_CITY_DATA ID를 검증하고 올바른 ID 확인
const ids: [string, number][] = [
    // 기존 TRIPCOM_CITY_DATA
    ['도쿄', 228], ['오사카', 219], ['후쿠오카', 248], ['삿포로', 641],
    ['나고야', 360], ['오키나와', 207], ['방콕', 359], ['싱가포르', 73],
    ['홍콩', 58], ['파리', 418], ['런던', 181], ['웨이하이', 386],
    ['칭다오', 7], ['두바이', 220], ['괌', 753], ['세부', 1239],
    ['다낭', 1356], ['발리', 723], ['로마', 343],
    // 웹검색에서 확인된 ID
    ['오사카_new', 468], ['도쿄_new', 226], ['방콕_new', 156],
    ['싱가포르_new', 42], ['홍콩_new', 199], ['파리_new', 131],
    ['런던_new', 198], ['웨이하이_new', 555],
];

async function test(name: string, id: number): Promise<boolean> {
    try {
        const r = await fetch(`https://kr.trip.com/hotels/list?city=${id}&locale=ko-KR`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow',
        });
        return r.ok;
    } catch { return false; }
}

async function main() {
    for (const [name, id] of ids) {
        const ok = await test(name, id);
        console.log(`${ok ? '✅' : '❌'} ${name.padEnd(12)} city=${id}`);
        await new Promise(r => setTimeout(r, 200));
    }
}
main();
