// Backfill discountRate into existing all-flights-cache.json using interpark-prices.json
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const cachePath = path.join(dataDir, 'all-flights-cache.json');
const benchmarkPath = path.join(dataDir, 'interpark-prices.json');

const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf-8'));

// Load city name -> code mapping from interpark.ts (simplified version)
const CITY_NAME_TO_CODE = {
    '오사카': 'OSA', '간사이': 'OSA', '오사카(간사이)': 'OSA', '오사카(KIX)': 'OSA',
    '도쿄': 'TYO', '나리타': 'TYO', '하네다': 'TYO',
    '후쿠오카': 'FUK', '삿포로': 'SPK', '치토세': 'SPK', '삿포로(치토세)': 'SPK',
    '나가사키': 'NGS', '가고시마': 'KOJ', '아오모리': 'AOJ', '하코다테': 'HKD',
    '오키나와': 'OKA', '기타큐슈': 'KKJ', '고베': 'UKB', '하코다테(북해도)': 'HKD',
    '방콕': 'BKK', '방콕(수완나폼)': 'BKK', '방콕(돈무앙)': 'DMK',
    '세부': 'CEB', '마닐라': 'MNL', '보홀': 'TAG', '보홀팡라오': 'TAG', '보홀(필리핀)': 'TAG',
    '다낭': 'DAD', '나트랑': 'CXR', '나트랑(깜란)': 'CXR',
    '하노이': 'HAN', '호치민': 'SGN', '푸꾸옥': 'PQC',
    '타이페이': 'TPE', '타이베이': 'TPE', '대만': 'TPE', '타이페이(송산)': 'TSA',
    '홍콩': 'HKG', '마카오': 'MFM',
    '사이판': 'SPN', '괌': 'GUM',
    '싱가포르': 'SIN',
    '발리': 'DPS', '발리(덴파사)': 'DPS', '바탐': 'BTH', '바탐(인도네시아)': 'BTH',
    '코타키나발루': 'BKI',
    '클락': 'CRK', '클락(앙헬레스)': 'CRK', '칼리보(보라카이)': 'KLO',
    '치앙마이': 'CNX', '비엔티엔': 'VTE', '푸켓': 'HKT', '쿠알라룸푸르': 'KUL',
    '두바이': 'DXB', '아부다비': 'AUH',
    '시드니': 'SYD', '브리즈번': 'BNE',
    '바르셀로나': 'BCN', '로마': 'ROM', '이스탄불': 'IST', '트라브존': 'TZX',
    '상해': 'PVG', '칭다오': 'TAO', '연태': 'YNT', '위해': 'WEH',
    '카오슝': 'KHH', '삼아': 'SYX', '마나도': 'MDC',
    '상해(푸동)': 'PVG', '청도(칭다오)': 'TAO', '연태(옌타이)': 'YNT', '웨이하이': 'WEH',
    '산야(삼아)': 'SYX', '카오슝(대만)': 'KHH',
    '아부다비(아랍에미리트)': 'AUH',
};

const AIRPORT_TO_CITY = {
    'KIX': 'OSA', 'NRT': 'TYO', 'HND': 'TYO', 'FUK': 'FUK', 'CTS': 'SPK',
    'NGS': 'NGS', 'KOJ': 'KOJ', 'AOJ': 'AOJ', 'HKD': 'HKD', 'OKA': 'OKA',
    'KKJ': 'KKJ', 'UKB': 'UKB',
    'BKK': 'BKK', 'DMK': 'DMK', 'CEB': 'CEB', 'MNL': 'MNL', 'TAG': 'TAG',
    'DAD': 'DAD', 'CXR': 'CXR', 'HAN': 'HAN', 'SGN': 'SGN', 'PQC': 'PQC',
    'TPE': 'TPE', 'TSA': 'TSA', 'HKG': 'HKG', 'MFM': 'MFM',
    'SPN': 'SPN', 'GUM': 'GUM', 'SIN': 'SIN',
    'DPS': 'DPS', 'BTH': 'BTH', 'BKI': 'BKI', 'CRK': 'CRK', 'KLO': 'KLO',
    'CNX': 'CNX', 'VTE': 'VTE', 'HKT': 'HKT', 'KUL': 'KUL',
    'DXB': 'DXB', 'AUH': 'AUH', 'SYD': 'SYD', 'BNE': 'BNE',
    'BCN': 'BCN', 'ROM': 'ROM', 'IST': 'IST', 'TZX': 'TZX',
    'PVG': 'PVG', 'TAO': 'TAO', 'YNT': 'YNT', 'WEH': 'WEH',
    'KHH': 'KHH', 'SYX': 'SYX', 'MDC': 'MDC',
};

function resolveCityCode(city, airport) {
    // Try airport code first
    if (airport && AIRPORT_TO_CITY[airport]) return AIRPORT_TO_CITY[airport];
    // Try direct city name lookup
    const cleanCity = city.replace(/\([^)]+\)/, '').trim();
    if (CITY_NAME_TO_CODE[city]) return CITY_NAME_TO_CODE[city];
    if (CITY_NAME_TO_CODE[cleanCity]) return CITY_NAME_TO_CODE[cleanCity];
    return null;
}

function isInterparkBenchmarkApplicable(flight) {
    const airport = String(flight.departure?.airport || '').trim().toUpperCase();
    if (airport === 'ICN' || airport === 'GMP') return true;
    if (/^[A-Z]{3}$/.test(airport)) return false;
    return /서울|인천|김포/.test(String(flight.departure?.city || '').replace(/\s+/g, ''));
}

let updated = 0;
let noData = 0;

for (const f of cache.flights) {
    if (!isInterparkBenchmarkApplicable(f)) {
        f.discountRate = 0;
        noData++;
        continue;
    }
    const cityCode = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
    if (!cityCode) { f.discountRate = 0; noData++; continue; }

    const depDate = f.departure?.date || '';
    const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
    const m = dateStr.match(/^(\d{4})-(\d{2})/);
    if (!m) { f.discountRate = 0; noData++; continue; }

    const yearMonth = `${m[1]}-${m[2]}`;
    const cityPrices = benchmark.prices[cityCode];
    if (!cityPrices || !cityPrices[yearMonth]) { f.discountRate = 0; noData++; continue; }

    const lowest = cityPrices[yearMonth].lowest;
    f.discountRate = lowest > 0 ? Math.round((1 - f.price / lowest) * 100) : 0;
    updated++;
}

fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
console.log(`✅ Backfill complete: ${updated} flights updated, ${noData} without benchmark data`);

// Show top 10 by discount
const top = cache.flights.filter(f => f.discountRate > 0).sort((a, b) => b.discountRate - a.discountRate);
console.log('\n🏆 Top 10 by discount rate:');
top.slice(0, 10).forEach((f, i) => {
    console.log(`${i + 1}. ${f.departure.city} → ${f.arrival.city} ₩${f.price.toLocaleString()} (${f.discountRate}% cheaper) — ${f.airline} ${f.source}`);
});
