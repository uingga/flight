#!/usr/bin/env node
/**
 * 항공권 캐시를 "소스 단위"로 병합한다.
 *
 *   node scripts/merge-cache-source.mjs <target.json> <overlay.json> <source>
 *
 * target의 flights 중 해당 source 항목을 overlay의 같은 source 항목으로 교체하고,
 * count/sources를 다시 계산해 target에 저장한다. 나머지 소스의 항공권은 건드리지 않는다.
 *
 * 용도: GitHub Actions에서 여러 크롤링 워크플로우가 동시에 돌 때,
 * 파일 통째 덮어쓰기로 서로의 최신 데이터를 지우는 경쟁 조건을 막는다.
 * (예: 마이리얼트립 워크플로우는 원격 최신 캐시를 base로 자기 소스 항목만 반영)
 */

import fs from 'node:fs';

const [, , targetPath, overlayPath, sourceKey] = process.argv;

if (!targetPath || !overlayPath || !sourceKey) {
    console.error('사용법: node merge-cache-source.mjs <target.json> <overlay.json> <source>');
    process.exit(1);
}

if (!fs.existsSync(targetPath)) {
    console.error(`❌ target 없음: ${targetPath}`);
    process.exit(1);
}
if (!fs.existsSync(overlayPath)) {
    console.error(`❌ overlay 없음: ${overlayPath}`);
    process.exit(1);
}

const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));

if (!Array.isArray(target.flights) || !Array.isArray(overlay.flights)) {
    console.error('❌ flights 배열이 없는 캐시 파일');
    process.exit(1);
}

const overlayFlights = overlay.flights.filter((f) => f?.source === sourceKey);
const keptFlights = target.flights.filter((f) => f?.source !== sourceKey);
const beforeCount = target.flights.length;
const replacedCount = beforeCount - keptFlights.length;

// 크롤러 장애로 생성된 빈 결과가 정상 데이터를 통째로 지우는 것을 막는다.
// 실제로 소스를 0건으로 비워야 할 때만 명시적으로 우회할 수 있다.
if (replacedCount > 0 && overlayFlights.length === 0 && process.env.ALLOW_EMPTY_SOURCE !== '1') {
    console.error(
        `❌ ${sourceKey} 병합 중단: 기존 ${replacedCount}건을 빈 결과로 교체하려고 했습니다. ` +
        '의도적인 초기화라면 ALLOW_EMPTY_SOURCE=1을 지정하세요.'
    );
    process.exit(1);
}

target.flights = [...keptFlights, ...overlayFlights];
target.count = target.flights.length;

// sources 카운트 재계산 (기존 키 유지)
if (target.sources && typeof target.sources === 'object') {
    for (const key of Object.keys(target.sources)) {
        target.sources[key] = target.flights.filter((f) => f?.source === key).length;
    }
}

// timestamp는 둘 중 최신값 유지
if (overlay.timestamp && (!target.timestamp || overlay.timestamp > target.timestamp)) {
    target.timestamp = overlay.timestamp;
}

// 교체한 소스의 실제 확인 시각도 overlay에서 함께 가져온다.
if (overlay.sourceUpdatedAt?.[sourceKey]) {
    target.sourceUpdatedAt = {
        ...(target.sourceUpdatedAt || {}),
        [sourceKey]: overlay.sourceUpdatedAt[sourceKey],
    };
}

// 접근 제한 휴식 상태도 소스 단위로 함께 옮긴다. 정상 복구 결과에 상태가 없으면
// 원격 캐시에 남아 있던 낡은 휴식 상태를 지운다.
target.sourceCircuits = { ...(target.sourceCircuits || {}) };
if (overlay.sourceCircuits?.[sourceKey]) {
    target.sourceCircuits[sourceKey] = overlay.sourceCircuits[sourceKey];
} else {
    delete target.sourceCircuits[sourceKey];
}

if (overlay.staleStreak?.[sourceKey] !== undefined) {
    target.staleStreak = {
        ...(target.staleStreak || {}),
        [sourceKey]: overlay.staleStreak[sourceKey],
    };
}
if (overlay.scrapedCounts?.[sourceKey] !== undefined) {
    target.scrapedCounts = {
        ...(target.scrapedCounts || {}),
        [sourceKey]: overlay.scrapedCounts[sourceKey],
    };
}

// 땡처리 PC 대체 수집은 항공권과 함께 시간 조회 성공값·실패 쿨다운도 만든다.
// 이 상태를 빼면 GitHub 캐시로 합친 직후 같은 실패 노선을 다시 신규처럼 조회한다.
if (sourceKey === 'ttang' && overlay.ttangTimeEnrichment) {
    target.ttangTimeEnrichment = overlay.ttangTimeEnrichment;
}

if (sourceKey === 'ybtour' && overlay.ybtourTimeEnrichment) {
    target.ybtourTimeEnrichment = overlay.ybtourTimeEnrichment;
}

// 병합 대상 소스의 경고만 overlay 상태로 교체한다. 전체 배열을 덮으면 이 작업이
// 실행되는 동안 다른 크롤러가 새로 남긴 경고를 지울 수 있고, 반대로 이 처리를
// 생략하면 차단 회로는 저장돼도 관리자 화면의 경고가 누락되거나 복구 후 남는다.
const sourceAlertAliases = {
    ybtour: ['ybtour', '노랑풍선'],
    hanatour: ['hanatour', '하나투어'],
    modetour: ['modetour', '모두투어'],
    onlinetour: ['onlinetour', '온라인투어'],
    ttang: ['ttang', '땡처리'],
    myrealtrip: ['myrealtrip', '마이리얼트립'],
};
const alertAliases = sourceAlertAliases[sourceKey] || [sourceKey];
const belongsToSource = (alert) => alertAliases.some(alias =>
    String(alert || '').toLocaleLowerCase('ko-KR').includes(alias.toLocaleLowerCase('ko-KR'))
);
const targetAlerts = Array.isArray(target.integrityAlerts) ? target.integrityAlerts : [];
const overlayAlerts = Array.isArray(overlay.integrityAlerts) ? overlay.integrityAlerts : [];
target.integrityAlerts = Array.from(new Set([
    ...targetAlerts.filter(alert => !belongsToSource(alert)),
    ...overlayAlerts.filter(belongsToSource),
]));

fs.writeFileSync(targetPath, JSON.stringify(target, null, 2));
console.log(
    `✅ ${sourceKey} 병합: target ${beforeCount}건(${sourceKey} ${replacedCount}) → ${target.count}건(${sourceKey} ${overlayFlights.length})`
);
