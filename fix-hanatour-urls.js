const fs = require('fs');
const path = require('path');

const CITY_TO_HANATOUR = {
    '서울': 'SEL', '인천': 'SEL', '김포': 'SEL',
    '부산': 'PUS', '김해': 'PUS',
    '대구': 'TAE', '청주': 'CJJ', '제주': 'CJU', '제주시': 'CJU', '무안': 'MWX',
    '도쿄': 'TYO', '오사카': 'OSA', '후쿠오카': 'FUK', '삿포로': 'CTS', '나고야': 'NGO',
    '오키나와': 'OKA', '고베': 'UKB', '나가사키': 'NGS', '가고시마': 'KOJ',
    '구마모토': 'KMJ', '오이타': 'OIT', '마츠야마': 'MYJ', '히로시마': 'HIJ',
    '요나고': 'YGJ', '다카마쓰': 'TAK',
    '방콕': 'BKK', '치앙마이': 'CNX', '푸켓': 'HKT', '푸껫': 'HKT',
    '다낭': 'DAD', '나트랑': 'NHA', '하노이': 'HAN', '호치민': 'SGN', '푸꾸옥': 'PQC',
    '마닐라': 'MNL', '세부': 'CEB', '보라카이': 'KLO', '보홀': 'TAG',
    '싱가포르': 'SIN', '쿠알라룸푸르': 'KUL', '코타키나발루': 'BKI',
    '발리': 'DPS', '자카르타': 'CGK',
    '타이베이': 'TPE', '타이중': 'RMQ', '가오슝': 'KHH', '홍콩': 'HKG', '마카오': 'MFM',
    '상하이': 'SHA', '베이징': 'BJS', '칭다오': 'TAO', '하얼빈': 'HRB', '싼야': 'SYX',
    '괌': 'GUM', '사이판': 'SPN', '하와이': 'HNL', '호놀룰루': 'HNL', '밴쿠버': 'YVR',
    '시드니': 'SYD', '멜버른': 'MEL',
    '파리': 'PAR', '런던': 'LON', '로마': 'ROM', '바르셀로나': 'BCN',
};

function extractCity(cityStr) {
    const match = cityStr.match(/^(.+?)\(([A-Z]{3})\)$/);
    if (match) return { name: match[1], code: match[2] };
    return { name: cityStr, code: '' };
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    // 괄호 안 요일 제거: "2026.02.11(수)" -> "2026.02.11"
    const cleaned = dateStr.replace(/\([^)]*\)/g, '').trim();
    const m = cleaned.match(/(\d{4})[.-](\d{2})[.-](\d{2})/);
    if (m) return m[1] + m[2] + m[3];
    return cleaned.replace(/\D/g, '').slice(0, 8);
}

const cacheFile = path.join(__dirname, 'data', 'all-flights-cache.json');
const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

let fixed = 0, unfixable = 0;
data.flights.forEach(f => {
    if (f.source !== 'hanatour') return;
    const dep = extractCity(f.departure.city);
    const arr = extractCity(f.arrival.city);
    const depCode = CITY_TO_HANATOUR[dep.name] || dep.code || '';
    const arrCode = CITY_TO_HANATOUR[arr.name] || arr.code || '';
    const depDt = formatDate(f.departure.date);
    if (!depCode || !arrCode || !depDt) { unfixable++; return; }
    const sc = { itnrLst: [{ depPlcDvCd: 'C', depPlcCd: depCode, arrPlcDvCd: 'C', arrPlcCd: arrCode, depDt: depDt }], psngrCntLst: [{ ageDvCd: 'A', psngrCnt: 1 }], itnrTypeCd: 'OW' };
    f.link = 'https://hope.hanatour.com/trp/air/CHPC0AIR0200M200?searchCond=' + encodeURIComponent(JSON.stringify(sc));
    fixed++;
});

data.lastUpdated = new Date().toISOString();
fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf-8');
console.log('Fixed:', fixed, '| Unfixable:', unfixable);

// Verify
const sample = data.flights.find(f => f.source === 'hanatour');
const u = new URL(sample.link);
const sc = JSON.parse(decodeURIComponent(u.searchParams.get('searchCond')));
console.log('Sample depDt:', sc.itnrLst[0].depDt, '(should be 8 digits only)');
