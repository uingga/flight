#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const SITE_URL = process.env.SITE_URL || 'https://www.tikitikit.kr';
const OUTPUT_PATH = path.resolve(process.cwd(), 'data/today-pick.json');
const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const effectivePrice = (flight) => flight.price + (flight.source === 'ttang' ? 20_000 : 0);
const kstDayNumber = (timestamp) => Math.floor((timestamp + KST_OFFSET) / DAY);

function comparisonUsable(checkedAt, now) {
    const checkedTime = new Date(checkedAt || '').getTime();
    return Number.isFinite(checkedTime) && kstDayNumber(now) - kstDayNumber(checkedTime) <= 3;
}

function freshnessMultiplier(checkedAt, now) {
    const checkedTime = new Date(checkedAt || '').getTime();
    if (!Number.isFinite(checkedTime)) return 1.12;
    const ageHours = Math.max(0, (now - checkedTime) / 3_600_000);
    if (ageHours <= 8) return 1;
    if (ageHours <= 16) return 1.03;
    if (ageHours <= 24) return 1.08;
    return 1.35;
}

function recommendScore(flight, interparkPrices, now) {
    const price = effectivePrice(flight);
    const city = (flight.arrival?.city || '').replace(/\([^)]+\)/, '').trim();
    const depMonth = (flight.departure?.date || '').replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
    const cityData = interparkPrices[city];
    let monthData = cityData?.[depMonth];
    if (!monthData && cityData && depMonth) {
        const closest = Object.keys(cityData).sort().reduce((best, month) => {
            const diff = Math.abs(month.localeCompare(depMonth));
            const bestDiff = best ? Math.abs(best.localeCompare(depMonth)) : Infinity;
            return diff < bestDiff ? month : best;
        }, '');
        if (closest) monthData = cityData[closest];
    }

    const comparisonPrice = flight.naverLowest > 0 && comparisonUsable(flight.naverCheckedAt, now)
        ? flight.naverLowest
        : null;
    const cheaperThanComparison = comparisonPrice && price <= comparisonPrice;

    let score = price;
    if (!monthData) score *= 1.1;
    else if (price <= monthData.lowest) { /* no penalty */ }
    else if (price <= monthData.lowest * 1.2) score *= 1.15;
    else if (price < monthData.avg) score *= 1.3;
    else score *= cheaperThanComparison ? 1.3 : 10;

    if (comparisonPrice) {
        const ratio = (price - comparisonPrice) / comparisonPrice;
        if (ratio <= -0.20) score *= 0.3;
        else if (ratio <= -0.15) score *= 0.375;
        else if (ratio <= -0.10) score *= 0.45;
        else if (ratio <= -0.05) score *= 0.55;
        else if (ratio <= 0) score *= 0.65;
        else if (ratio <= 0.05) score *= 1.05;
        else if (ratio <= 0.10) score *= 1.15;
        else if (ratio <= 0.15) score *= 1.3;
        else if (ratio <= 0.20) score *= 1.5;
        else score *= 2;
    }

    return score * freshnessMultiplier(flight.priceCheckedAt, now);
}

async function main() {
    const response = await fetch(`${SITE_URL}/api/flights`);
    if (!response.ok) throw new Error(`항공권 API 응답 실패: ${response.status}`);
    const data = await response.json();
    const flights = Array.isArray(data.flights) ? data.flights : [];
    if (flights.length === 0) throw new Error('선정할 항공권이 없습니다. 기존 오늘의 표를 유지합니다.');

    const now = Date.now();
    const ranked = flights
        .filter((flight) => Number(flight.price) > 0)
        .map((flight) => ({ flight, score: recommendScore(flight, data.interparkPrices || {}, now) }))
        .sort((a, b) => a.score - b.score || effectivePrice(a.flight) - effectivePrice(b.flight));
    const selected = ranked[0];
    if (!selected) throw new Error('유효한 오늘의 표 후보가 없습니다.');

    const selectedAt = new Date().toISOString();
    const kstDate = new Date(Date.now() + KST_OFFSET).toISOString().slice(0, 10);
    const output = {
        date: kstDate,
        selectedAt,
        flightId: selected.flight.id,
        source: selected.flight.source,
        effectivePrice: effectivePrice(selected.flight),
    };
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`✅ 오늘의 표: ${selected.flight.departure?.city} → ${selected.flight.arrival?.city} · ${output.effectivePrice.toLocaleString()}원`);
    console.log(`   ${selected.flight.id}`);
}

main().catch((error) => {
    console.error('❌ 오늘의 표 선정 실패:', error);
    process.exitCode = 1;
});
