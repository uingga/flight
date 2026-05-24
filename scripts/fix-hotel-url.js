const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const startMarker = 'const getTripcomHotelUrl = ';
const startIdx = code.indexOf(startMarker);
let braceCount = 0;
let endIdx = -1;
for (let i = code.indexOf('{', startIdx); i < code.length; i++) {
    if (code[i] === '{') braceCount++;
    if (code[i] === '}') braceCount--;
    if (braceCount === 0) { endIdx = i + 2; break; }
}

console.log('Found function at', startIdx, '-', endIdx);

// 기존 검증된 city ID 방식 복원 + IATA로 폴백
const newFn = `const getTripcomHotelUrl = (arrCity: string, depDate?: string, arrDate?: string, arrAirport?: string): string | null => {
    let cityName = normalizeCity(arrCity);
    const bm = cityName.match(/^(.+?)[(](.+?)[)]$/);
    if (bm) cityName = bm[1];
    let checkinStr = '';
    let checkoutStr = '';
    if (depDate) {
        const ci = new Date(depDate);
        const co = new Date(ci);
        co.setDate(co.getDate() + 1);
        const fmt = (d: Date) => d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
        checkinStr = fmt(ci);
        checkoutStr = fmt(co);
    }
    const dateQs = checkinStr ? '&checkin=' + checkinStr + '&checkout=' + checkoutStr : '';
    const affQs = '&Allianceid=' + TRIPCOM_ALLIANCE_ID + '&SID=' + TRIPCOM_SID + '&trip_sub1=&trip_sub3=' + TRIPCOM_HOTEL_SUB3;
    // 1순위: TRIPCOM_CITY_DATA (검증된 city ID)
    const cityData = TRIPCOM_CITY_DATA[cityName];
    if (cityData) {
        const n = encodeURIComponent(cityData.name);
        const prov = cityData.provinceId ? '&provinceId=' + cityData.provinceId : '';
        return 'https://kr.trip.com/hotels/list?city=' + cityData.id + '&cityName=' + n + '&searchType=CT&searchWord=' + n + prov + dateQs + '&locale=ko-KR&curr=KRW' + affQs;
    }
    // 2순위: IATA 영문 도시명으로 searchWord 검색 (모든 항공권 커버)
    const en = arrAirport ? IATA_TO_ENGLISH[arrAirport] : null;
    const searchWord = encodeURIComponent(en || cityName);
    return 'https://kr.trip.com/hotels/list?searchType=CT&searchWord=' + searchWord + dateQs + '&locale=ko-KR&curr=KRW' + affQs;
};`;

code = code.substring(0, startIdx) + newFn + code.substring(endIdx);
fs.writeFileSync('src/components/Dashboard.tsx', code, 'utf8');
console.log('Done!');
