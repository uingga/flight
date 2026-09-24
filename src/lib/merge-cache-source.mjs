import {mergeFlightOfferHistory,rememberFlightOffers,restoreFlightOffers,recordFlightOfferNews,historyForSource} from './flight-offer-history.mjs';
// Source-scoped merge rules; no I/O at import.
export function mergeCacheSource(target, overlay, sourceKey, allowEmpty=false) {
if(!Array.isArray(target.flights)||!Array.isArray(overlay.flights))throw Error('invalid cache');
const overlayFlights = overlay.flights.filter((f) => f?.source === sourceKey);
const keptFlights = target.flights.filter((f) => f?.source !== sourceKey);
const beforeCount = target.flights.length;
const replacedCount = beforeCount - keptFlights.length;

// 크롤러 장애로 생성된 빈 결과가 정상 데이터를 통째로 지우는 것을 막는다.
// 실제로 소스를 0건으로 비워야 할 때만 명시적으로 우회할 수 있다.
if (replacedCount > 0 && overlayFlights.length === 0 && !allowEmpty) {
    console.error(
        `❌ ${sourceKey} 병합 중단: 기존 ${replacedCount}건을 빈 결과로 교체하려고 했습니다. ` +
        '의도적인 초기화라면 ALLOW_EMPTY_SOURCE=1을 지정하세요.'
    );
    throw Error('empty source replacement refused');
}

const observed=overlay.sourceUpdatedAt?.[sourceKey]||overlay.timestamp||target.timestamp;
if(observed) {
    const previous=rememberFlightOffers(mergeFlightOfferHistory(target.modetourOfferHistory,target.flightOfferHistory),target.flights,observed);
    const retained=mergeFlightOfferHistory(previous,historyForSource(mergeFlightOfferHistory(overlay.modetourOfferHistory,overlay.flightOfferHistory),sourceKey));
    const recorded=recordFlightOfferNews(target.flights.filter(f=>f.source===sourceKey),overlayFlights,observed,retained);
    target.flightOfferHistory=rememberFlightOffers(retained,recorded,observed);
    if(sourceKey==='modetour')target.modetourOfferHistory=historyForSource(target.flightOfferHistory,'modetour');
    const restored=restoreFlightOffers(recorded,target.flightOfferHistory);
    overlayFlights.splice(0,overlayFlights.length,...restored);
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
if (sourceKey === 'onlinetour' && overlay.onlinePrimary) target.onlinePrimary = overlay.onlinePrimary;
if (overlay.eveningPrimary?.[sourceKey]) {
    target.eveningPrimary = {
        ...(target.eveningPrimary || {}),
        [sourceKey]: overlay.eveningPrimary[sourceKey],
    };
}
if (sourceKey === 'ttang' && overlay.ttangPrimary) target.ttangPrimary = overlay.ttangPrimary;
if (sourceKey === 'modetour' && overlay.modetourPrimary) {
    target.modetourPrimary = overlay.modetourPrimary;
    target.manualCaptureStatus = { ...(target.manualCaptureStatus || {}) };
    if (overlay.manualCaptureStatus?.modetour) target.manualCaptureStatus.modetour = overlay.manualCaptureStatus.modetour;
    else delete target.manualCaptureStatus.modetour;
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
    lottetour: ['lottetour', '롯데관광'],
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


return target;
}
