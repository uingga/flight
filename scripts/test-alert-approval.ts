import assert from 'node:assert/strict';
import {
    buildAlertApprovalBatches,
    toPublicApprovalBatch,
    type AlertSubscriptionRecord,
} from '../src/lib/alert-approval';
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

const sentToday = { ...alert('2', 'device-b'), last_sent_at: '2026-08-27T01:00:00.000Z' };
const dailyLimited = buildAlertApprovalBatches(
    [alert('1', 'device-a'), sentToday],
    [flight],
    history,
    sourceUpdatedAt,
    now,
);
assert.equal(dailyLimited[0].recipients.length, 1, '오늘 이미 받은 기기는 후보에서 빠져야 한다');

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

console.log('✅ 알림 승인 후보 테스트 통과');
