import assert from 'node:assert/strict';
import {
    alertDayInKorea,
    buildAlertApprovalBatches,
    getDailyLimitedAlertTargets,
    revalidateAlertApprovalBatch,
    toPublicApprovalBatch,
    type AlertSubscriptionRecord,
} from '../src/lib/alert-approval';
import { classifyPushFailure, expiredSubscriptionUpdate } from '../src/lib/alert-delivery-policy';
import { buildAdminAttentionItems, type AdminAttentionInput } from '../src/lib/admin-attention';
import { encodeDealAlertRegion } from '../src/lib/deal-alerts';
import type { Flight } from '../src/types/flight';

const now = new Date('2026-08-27T08:00:00.000Z');
const flight: Flight = {
    id: 'test-flight',
    source: 'myrealtrip',
    airline: '테스트항공',
    departure: { city: '인천', airport: 'ICN', date: '2026-09-10', time: '09:00' },
    arrival: { city: '후쿠오카', airport: 'FUK', date: '2026-09-13', time: '18:00' },
    price: 100_000,
    currency: 'KRW',
    link: 'https://example.com',
    region: '일본',
    naverLowest: 120_000,
    naverCheckedAt: now.toISOString(),
    priceCheckedAt: now.toISOString(),
    firstSeen: '2026-08-27',
};

function alert(id: string, endpoint: string): AlertSubscriptionRecord {
    return {
        id,
        alert_key: `alert-${id}`,
        endpoint_hash: endpoint,
        subscription: { endpoint: `https://fcm.googleapis.com/${endpoint}`, keys: { p256dh: 'x', auth: 'y' } },
        departure_city: '인천',
        arrival_city: '후쿠오카',
        max_price: 120_000,
        notified_flight_ids: [],
        created_at: '2026-08-26T00:00:00.000Z',
    };
}

const history = { '인천-후쿠오카': [{ date: '2026-08-01', minPrice: 150_000 }] };
const sourceUpdatedAt = { myrealtrip: now.toISOString(), ttang: now.toISOString() };

const grouped = buildAlertApprovalBatches(
    [alert('1', 'device-a'), alert('2', 'device-b')],
    [flight],
    history,
    sourceUpdatedAt,
    now,
);
assert.equal(grouped.length, 1, '같은 문구와 항공권은 한 승인 묶음이어야 한다');
assert.equal(grouped[0].recipients.length, 2, '받을 사람 수를 묶어서 보여줘야 한다');
const publicBatch = toPublicApprovalBatch(grouped[0]);
assert.equal(publicBatch.recipientConditions.length, 1, '같은 수신 조건은 한 줄로 묶어야 한다');
assert.equal(publicBatch.recipientConditions[0].recipientCount, 2, '조건별 받을 사람 수를 보여줘야 한다');
assert.equal('recipients' in publicBatch, false, '관리자 응답에 푸시 구독 정보가 노출되면 안 된다');
assert.equal(/fcm\.googleapis\.com|device-a|device-b/.test(JSON.stringify(publicBatch)), false,
    '관리자 응답에 endpoint나 내부 기기 식별값이 포함되면 안 된다');

assert.ok(
    revalidateAlertApprovalBatch(grouped[0].batchKey, [alert('1', 'device-a')], [flight], history, sourceUpdatedAt, now),
    '승인 시점에도 조건을 만족하는 후보만 다시 찾을 수 있어야 한다',
);
assert.equal(
    revalidateAlertApprovalBatch(
        grouped[0].batchKey,
        [alert('1', 'device-a')],
        [{ ...flight, price: 130_000 }],
        history,
        sourceUpdatedAt,
        now,
    ),
    null,
    '승인 뒤 가격이 희망가를 넘으면 예전에 본 배치 키로 발송할 수 없어야 한다',
);

const sentToday = { ...alert('2', 'device-b'), last_sent_at: '2026-08-27T01:00:00.000Z' };
const dailyLimited = buildAlertApprovalBatches(
    [alert('1', 'device-a'), sentToday],
    [flight],
    history,
    sourceUpdatedAt,
    now,
);
assert.equal(dailyLimited[0].recipients.length, 1, '오늘 이미 받은 기기는 후보에서 빠져야 한다');

const koreaDayBoundary = new Date('2026-08-27T16:00:00.000Z'); // KST 8월 28일 01:00
assert.equal(alertDayInKorea(koreaDayBoundary), '2026-08-28', '하루 제한은 KST 날짜를 사용해야 한다');
assert.equal(alertDayInKorea(new Date('invalid')), '', '깨진 발송 시각이 전체 후보 계산을 중단하면 안 된다');
const sameDeviceDifferentCondition = {
    ...alert('3', 'device-b'),
    max_price: 130_000,
};
assert.equal(
    buildAlertApprovalBatches([sentToday, sameDeviceDifferentCondition], [flight], history, sourceUpdatedAt, now).length,
    0,
    '한 기기의 다른 알림 조건도 오늘 이미 발송했다면 모두 하루 제한을 받아야 한다',
);
const previousKoreaDay = {
    ...alert('6', 'device-f'),
    last_sent_at: '2026-08-27T14:59:00.000Z', // KST 8월 27일 23:59
};
assert.equal(
    getDailyLimitedAlertTargets([previousKoreaDay], koreaDayBoundary).size,
    0,
    'UTC 날짜가 같아도 KST 전날 발송은 오늘 제한에 포함하면 안 된다',
);
const sameKoreaDay = {
    ...previousKoreaDay,
    last_sent_at: '2026-08-27T15:01:00.000Z', // KST 8월 28일 00:01
};
assert.equal(
    getDailyLimitedAlertTargets([sameKoreaDay], koreaDayBoundary).size,
    1,
    'KST 자정 이후 발송은 같은 날 제한에 포함해야 한다',
);

const feeFlight: Flight = { ...flight, id: 'fee-flight', source: 'ttang', price: 100_000 };
const feeAlert = { ...alert('3', 'device-c'), max_price: 110_000 };
assert.equal(
    buildAlertApprovalBatches([feeAlert], [feeFlight], history, sourceUpdatedAt, now).length,
    0,
    '땡처리닷컴은 수수료를 더한 실결제가가 희망가를 넘으면 제외해야 한다',
);

const outOfRange = {
    ...alert('4', 'device-d'),
    departure_date_from: '2026-09-11',
    departure_date_to: '2026-09-20',
};
assert.equal(
    buildAlertApprovalBatches([outOfRange], [flight], history, sourceUpdatedAt, now).length,
    0,
    '사용자가 지정한 출발 기간 밖의 표는 제외해야 한다',
);

const chinaAlert: AlertSubscriptionRecord = {
    ...alert('5', 'device-e'),
    arrival_city: encodeDealAlertRegion('중국'),
    max_price: 200_000,
};
const kaohsiung: Flight = {
    ...flight,
    id: 'kaohsiung-flight',
    arrival: { ...flight.arrival, city: '가오슝', airport: 'KHH', date: '2026-09-13' },
    price: 191_000,
    region: '중국',
    naverLowest: 200_000,
};
const weihai: Flight = {
    ...flight,
    id: 'weihai-flight',
    arrival: { ...flight.arrival, city: '웨이하이', airport: 'WEH', date: '2026-09-12' },
    price: 176_000,
    region: '중국',
    naverLowest: 180_000,
};
const dealAlternatives = buildAlertApprovalBatches(
    [chinaAlert],
    [kaohsiung, weihai],
    {
        '인천-가오슝': [{ date: '2026-08-01', minPrice: 240_000 }],
        '인천-웨이하이': [{ date: '2026-08-01', minPrice: 220_000 }],
    },
    sourceUpdatedAt,
    now,
);
assert.equal(dealAlternatives.length, 2, '조건형 알림은 목적지가 다른 상위 후보를 함께 보여줘야 한다');
assert.deepEqual(
    dealAlternatives.map(candidate => candidate.selectionRank),
    [1, 2],
    '조건형 후보는 선택 순위를 보존해야 한다',
);

assert.equal(classifyPushFailure(404), 'deactivate-expired-subscription');
assert.equal(classifyPushFailure(410), 'deactivate-expired-subscription');
assert.equal(classifyPushFailure(429), 'keep-active', '일시 오류는 구독을 비활성화하면 안 된다');
assert.deepEqual(
    expiredSubscriptionUpdate(410, '2026-08-27T08:00:00.000Z'),
    {
        active: false,
        delivery_claimed_at: null,
        updated_at: '2026-08-27T08:00:00.000Z',
    },
    '만료 응답은 구독 비활성화와 발송 잠금 해제만 요청해야 한다',
);
assert.equal(expiredSubscriptionUpdate(500, now.toISOString()), null,
    '일시적인 서버 오류는 만료 구독으로 처리하면 안 된다');

const normalAdminInput: AdminAttentionInput = {
    collection: { sourceIssueCount: 0, criticalAlertCount: 0 },
    comparison: { needsAttention: false },
    bookingLinks: { failed: 0, systemicSources: 0 },
    reports: { available: true, loadError: false, needsReview: 0, activeHides: 0 },
    alerts: {
        available: true,
        unavailable: false,
        loadError: false,
        qualifiedCandidates: 0,
        pendingRecipients: 0,
        deliveryAvailable: true,
    },
};
assert.equal(buildAdminAttentionItems(normalAdminInput).length, 0,
    '수집·링크·신고·알림 후보가 모두 정상이면 오늘 조치 목록이 비어야 한다');
const adminAttention = buildAdminAttentionItems({
    ...normalAdminInput,
    bookingLinks: { failed: 1, systemicSources: 0 },
    alerts: {
        ...normalAdminInput.alerts,
        qualifiedCandidates: 2,
        pendingRecipients: 3,
    },
});
assert.deepEqual(adminAttention.map(item => item.id), ['booking-links', 'alert-candidates']);
assert.ok(adminAttention.every(item => item.state && item.cause && item.nextAction),
    '어드민 조치 항목에는 상태·원인 후보·다음 행동이 모두 있어야 한다');

console.log('✅ 알림 후보·승인 재검증·기기당 하루 1회·만료 구독 정책 테스트 통과');
