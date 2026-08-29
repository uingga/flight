#!/usr/bin/env node

import fs from 'node:fs';

const [, , targetPath, overlayPath, batchPath] = process.argv;
const allowedSources = new Set(['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip']);

if (![targetPath, overlayPath, batchPath].every(file => file && fs.existsSync(file))) {
    console.error('target, overlay, 신고 처리 결과 파일이 모두 필요합니다.');
    process.exit(1);
}

const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const sources = [...new Set((batch.sources || []).filter(source => allowedSources.has(source)))];

if (!Array.isArray(target.flights) || !Array.isArray(overlay.flights)) {
    console.error('캐시 파일에 flights 배열이 없습니다.');
    process.exit(1);
}

if (sources.length === 0) {
    console.log('ℹ️ 병합할 신고 여행사가 없습니다.');
    process.exit(0);
}

for (const source of sources) {
    const previousCount = target.flights.filter(flight => flight?.source === source).length;
    const overlayFlights = overlay.flights.filter(flight => flight?.source === source);
    if (previousCount > 0 && overlayFlights.length === 0) {
        console.error(`❌ ${source} 전체가 0건이 되는 병합은 중단합니다.`);
        process.exit(1);
    }

    target.flights = [
        ...target.flights.filter(flight => flight?.source !== source),
        ...overlayFlights,
    ];

    if (overlay.sourceUpdatedAt?.[source]) {
        target.sourceUpdatedAt = {
            ...(target.sourceUpdatedAt || {}),
            [source]: overlay.sourceUpdatedAt[source],
        };
    }
    if (overlay.scrapedCounts?.[source] !== undefined) {
        target.scrapedCounts = {
            ...(target.scrapedCounts || {}),
            [source]: overlay.scrapedCounts[source],
        };
    }
    if (overlay.staleStreak?.[source] !== undefined) {
        target.staleStreak = {
            ...(target.staleStreak || {}),
            [source]: overlay.staleStreak[source],
        };
    }
    target.sourceCircuits = { ...(target.sourceCircuits || {}) };
    if (overlay.sourceCircuits?.[source]) {
        target.sourceCircuits[source] = overlay.sourceCircuits[source];
    } else {
        delete target.sourceCircuits[source];
    }
}

target.count = target.flights.length;
if (target.sources && typeof target.sources === 'object') {
    for (const source of Object.keys(target.sources)) {
        target.sources[source] = target.flights.filter(flight => flight?.source === source).length;
    }
}

if (overlay.timestamp && (!target.timestamp || overlay.timestamp > target.timestamp)) {
    target.timestamp = overlay.timestamp;
}

fs.writeFileSync(targetPath, JSON.stringify(target, null, 2));
console.log(`✅ 신고 재확인 데이터 병합: ${sources.join(', ')} · 전체 ${target.count}건`);
