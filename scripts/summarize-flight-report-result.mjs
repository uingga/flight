#!/usr/bin/env node

import fs from 'node:fs';

const [, , beforePath, afterPath, outputPath, flightIdArg, sourceArg] = process.argv;
const flightId = (flightIdArg || process.env.REPORT_FLIGHT_ID)?.trim();
const source = (sourceArg || process.env.REPORT_SOURCE)?.trim();

if (!beforePath || !afterPath || !outputPath || !flightId || !source) {
    console.error('before/after/output 경로와 REPORT_FLIGHT_ID, REPORT_SOURCE가 필요합니다.');
    process.exit(1);
}

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const original = before.flights?.find((flight) => flight?.id === flightId && flight?.source === source);

function sameValue(a, b) {
    return String(a || '').trim() === String(b || '').trim();
}

function findRefreshedFlight() {
    const exact = after.flights?.find((flight) => flight?.id === flightId && flight?.source === source);
    if (exact || !original) return exact;

    const routeCandidates = (after.flights || []).filter((flight) =>
        flight?.source === source
        && sameValue(flight.departure?.airport, original.departure?.airport)
        && sameValue(flight.arrival?.airport, original.arrival?.airport)
        && sameValue(flight.departure?.date, original.departure?.date)
        && sameValue(flight.arrival?.date, original.arrival?.date),
    );
    return routeCandidates.find((flight) =>
        sameValue(flight.airline, original.airline)
        && sameValue(flight.departure?.time, original.departure?.time)
        && sameValue(flight.arrival?.time, original.arrival?.time),
    ) || (routeCandidates.length === 1 ? routeCandidates[0] : undefined);
}

let result;
if (!original) {
    result = {
        status: 'removed',
        message: '자동 확인을 시작하기 전에 이 항공권이 이미 최신 목록에서 사라졌습니다.',
    };
} else {
    const refreshed = findRefreshedFlight();
    const beforeCheckedAt = source === 'myrealtrip'
        ? original.priceCheckedAt
        : before.sourceUpdatedAt?.[source];
    const afterCheckedAt = source === 'myrealtrip'
        ? refreshed?.priceCheckedAt
        : after.sourceUpdatedAt?.[source];
    // MRT 전용 확인 스크립트는 명시적인 '검색 결과 없음'을 읽었을 때만 항공권을 삭제한다.
    // 따라서 항목이 사라진 경우도 정상 확인으로 볼 수 있다. 다른 여행사는 소스 확인 시각으로 판단한다.
    const successfullyChecked = source === 'myrealtrip'
        ? !refreshed || Boolean(afterCheckedAt && afterCheckedAt !== beforeCheckedAt)
        : Boolean(afterCheckedAt && afterCheckedAt !== beforeCheckedAt);

    if (!successfullyChecked) {
        result = {
            status: 'check_failed',
            message: '여행사 응답을 확실하게 확인하지 못해 기존 항공권을 그대로 유지했습니다. 운영자가 확인해야 합니다.',
        };
    } else if (!refreshed) {
        result = {
            status: 'removed',
            message: '여행사에서 더 이상 판매되지 않는 것이 확인되어 티키티킷 목록에서 자동으로 숨겼습니다.',
        };
    } else if (Number(refreshed.price) !== Number(original.price)) {
        result = {
            status: 'updated',
            oldPrice: Number(original.price),
            newPrice: Number(refreshed.price),
            message: `가격을 ${Number(original.price).toLocaleString('ko-KR')}원에서 ${Number(refreshed.price).toLocaleString('ko-KR')}원으로 자동 수정했습니다.`,
        };
    } else {
        result = {
            status: 'confirmed',
            price: Number(refreshed.price),
            message: `현재도 ${Number(refreshed.price).toLocaleString('ko-KR')}원으로 확인됩니다. 여행사 정렬 방식이나 선택 항공편을 함께 확인해 주세요.`,
        };
    }
}

const payload = {
    ...result,
    flightId,
    source,
    checkedAt: new Date().toISOString(),
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));
