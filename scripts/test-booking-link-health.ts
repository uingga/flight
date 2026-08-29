import assert from 'node:assert/strict';
import type { Flight } from '@/types/flight';
import {
    validateTtangBookingUrl,
    verifyTtangBookingEvidence,
} from '@/lib/booking-link-health';
import { getTtangBookingUrl } from '@/lib/utils/ttang-url';

const flight: Flight = {
    id: 'ttang-RS0741ICNTAK-G22-2026-09-10',
    source: 'ttang',
    airline: '에어서울',
    departure: { city: '인천', airport: 'ICN', date: '2026-09-10', time: '08:00' },
    arrival: { city: '다카마쓰', airport: 'TAK', date: '2026-09-13', time: '11:00' },
    price: 157_900,
    currency: 'KRW',
    link: 'https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do',
};
const evidenceAt = '2026-08-29T02:00:00.000Z';
const now = new Date('2026-08-29T04:10:00.000Z');

const valid = verifyTtangBookingEvidence(flight, evidenceAt, { now });
assert.equal(valid.outcome, 'passed', valid.reason || '최신 크롤 증거가 정상으로 판정되지 않았습니다.');
assert.equal(valid.masterId, 'RS0741ICNTAK-G22', '항공권 ID에서 masterId를 잘못 읽었습니다.');
assert.equal(valid.evidenceAt, evidenceAt, '여행사별 마지막 정상 수집 시각을 증거로 남기지 않았습니다.');

const generatedUrl = getTtangBookingUrl(flight);
assert.equal(validateTtangBookingUrl(flight, generatedUrl), null, '생성한 땡처리 예약 주소의 구조 검증에 실패했습니다.');
const wrongDateUrl = generatedUrl.replace('depdate0=20260910', 'depdate0=20260911');
assert.match(
    validateTtangBookingUrl(flight, wrongDateUrl) || '',
    /depdate0/,
    '출발일이 다른 예약 주소를 정상으로 판정했습니다.',
);

const stale = verifyTtangBookingEvidence(flight, '2026-08-28T12:00:00.000Z', { now, maxAgeHours: 8 });
assert.equal(stale.outcome, 'unavailable', '오래된 크롤 증거를 예약 링크 실패와 구분하지 않았습니다.');

const wrongIdentity = verifyTtangBookingEvidence({ ...flight, id: 'ttang-invalid' }, evidenceAt, { now });
assert.equal(wrongIdentity.outcome, 'failed', 'masterId가 없는 캐시 행을 정상으로 판정했습니다.');

const wrongRoute = verifyTtangBookingEvidence({
    ...flight,
    departure: { ...flight.departure, airport: '' },
}, evidenceAt, { now });
assert.equal(wrongRoute.outcome, 'failed', '노선 정보가 없는 캐시 행을 정상으로 판정했습니다.');

console.log('땡처리 예약 링크 비접속 검증 완료: 최신 크롤 증거·URL 구조·보류 판정');
