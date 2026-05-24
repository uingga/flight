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

// 한국어 도시명 → Trip.com SEO slug 매핑 (검증 불필요, slug만으로 동작)
const newFn = `const getTripcomHotelUrl = (arrCity: string, depDate?: string, arrDate?: string, arrAirport?: string): string | null => {
    let cityName = normalizeCity(arrCity);
    const bm = cityName.match(/^(.+?)[(\\(](.+?)[)\\)]$/);
    if (bm) cityName = bm[1];
    // 날짜: 체크인=출발일, 체크아웃=출발일+1 (1박)
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
    const dateQs = checkinStr ? 'checkin=' + checkinStr + '&checkout=' + checkoutStr + '&' : '';
    const affQs = 'Allianceid=' + TRIPCOM_ALLIANCE_ID + '&SID=' + TRIPCOM_SID + '&trip_sub1=&trip_sub3=' + TRIPCOM_HOTEL_SUB3;
    // 한국어→영문 도시명 매핑 (Trip.com SEO slug용)
    const CITY_SLUG: Record<string, string> = {
        // 일본
        '도쿄': 'tokyo', '오사카': 'osaka', '후쿠오카': 'fukuoka', '삿포로': 'sapporo',
        '나고야': 'nagoya', '오키나와': 'okinawa', '교토': 'kyoto', '하코다테': 'hakodate',
        '나가사키': 'nagasaki', '구마모토': 'kumamoto', '가고시마': 'kagoshima',
        '다카마쓰': 'takamatsu', '히로시마': 'hiroshima', '마츠야마': 'matsuyama',
        '시즈오카': 'shizuoka', '사가': 'saga', '요나고': 'yonago', '아오모리': 'aomori',
        '고베': 'kobe', '기타큐슈': 'kitakyushu', '오이타': 'oita', '도야마': 'toyama',
        '센다이': 'sendai', '미야자키': 'miyazaki', '니가타': 'niigata', '오카야마': 'okayama',
        '도쿠시마': 'tokushima', '아키타': 'akita', '이시가키': 'ishigaki',
        '미야코지마': 'miyakojima', '미야코': 'miyakojima', '시모지시마': 'miyakojima',
        '하나마키': 'hanamaki', '마츠모토': 'matsumoto',
        // 동남아
        '방콕': 'bangkok', '치앙마이': 'chiang-mai', '푸켓': 'phuket', '다낭': 'da-nang',
        '호치민': 'ho-chi-minh-city', '하노이': 'hanoi', '나트랑': 'nha-trang',
        '세부': 'cebu', '마닐라': 'manila', '발리': 'bali', '싱가포르': 'singapore',
        '코타키나발루': 'kota-kinabalu', '쿠알라룸푸르': 'kuala-lumpur',
        '푸꾸옥': 'phu-quoc', '보라카이': 'boracay', '보홀': 'bohol',
        '클락': 'clark', '비엔티안': 'vientiane', '바탐': 'batam', '마나도': 'manado',
        '끄라비': 'krabi', '자카르타': 'jakarta', '양곤': 'yangon',
        '시엠립': 'siem-reap', '프놈펜': 'phnom-penh', '코사무이': 'ko-samui',
        '랑카위': 'langkawi', '페낭': 'penang', '루앙프라방': 'luang-prabang',
        '달랏': 'da-lat', '후에': 'hue',
        // 중화권
        '홍콩': 'hong-kong', '마카오': 'macau', '타이페이': 'taipei', '타이베이': 'taipei',
        '타이중': 'taichung', '가오슝': 'kaohsiung', '상하이': 'shanghai', '베이징': 'beijing',
        '칭다오': 'qingdao', '옌타이': 'yantai', '웨이하이': 'weihai',
        '화롄': 'hualien', '화련': 'hualien', '지난': 'jinan', '구이린': 'guilin',
        '대련': 'dalian', '장가계': 'zhangjiajie', '싼야': 'sanya',
        '광저우': 'guangzhou', '선전': 'shenzhen', '청두': 'chengdu', '충칭': 'chongqing',
        '쿤밍': 'kunming', '시안': 'xian', '난징': 'nanjing', '항저우': 'hangzhou',
        // 유럽
        '파리': 'paris', '런던': 'london', '로마': 'rome', '바르셀로나': 'barcelona',
        '암스테르담': 'amsterdam', '프라하': 'prague', '밀라노': 'milan',
        '빈': 'vienna', '비엔나': 'vienna', '이스탄불': 'istanbul',
        '부다페스트': 'budapest', '아테네': 'athens', '헬싱키': 'helsinki',
        '코펜하겐': 'copenhagen', '프랑크푸르트': 'frankfurt', '리스본': 'lisbon',
        '뮌헨': 'munich', '베를린': 'berlin', '두브로브니크': 'dubrovnik',
        '산토리니': 'santorini', '스톡홀름': 'stockholm', '취리히': 'zurich',
        '마드리드': 'madrid', '베네치아': 'venice', '브뤼셀': 'brussels',
        '바르샤바': 'warsaw', '더블린': 'dublin', '에든버러': 'edinburgh',
        '니스': 'nice', '피렌체': 'florence',
        // 미주
        '뉴욕': 'new-york', '라스베이거스': 'las-vegas', '샌프란시스코': 'san-francisco',
        '시카고': 'chicago', '호놀룰루': 'honolulu', '캔쿤': 'cancun', '밴쿠버': 'vancouver',
        // 기타
        '사이판': 'saipan', '괌': 'guam', '시드니': 'sydney', '브리즈번': 'brisbane',
        '두바이': 'dubai', '블라디보스토크': 'vladivostok', '울란바토르': 'ulaanbaatar',
        '알마티': 'almaty', '델리': 'new-delhi', '카트만두': 'kathmandu',
        '몰디브': 'maldives', '트라브존': 'trabzon',
    };
    // slug 결정: 1) 한국어 매핑 2) IATA 영문명 3) null
    let slug = CITY_SLUG[cityName];
    if (!slug) {
        const en = arrAirport ? IATA_TO_ENGLISH[arrAirport] : null;
        if (en) {
            slug = en.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9\\-]/g, '').replace(/-+/g, '-');
        }
    }
    if (!slug) return null;
    return 'https://kr.trip.com/hotels/' + slug + '-hotels-list/?' + dateQs + affQs;
};`;

code = code.substring(0, startIdx) + newFn + code.substring(endIdx);
fs.writeFileSync('src/components/Dashboard.tsx', code, 'utf8');
console.log('Done!');
