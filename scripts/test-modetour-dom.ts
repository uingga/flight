import assert from 'node:assert/strict';
import {
    MODETOUR_DOM_DATA_REQUEST_LIMIT,
    parseModetourDomSnapshot,
} from '../src/lib/scrapers/modetour-dom';

assert.equal(MODETOUR_DOM_DATA_REQUEST_LIMIT, 6);

const flight = parseModetourDomSnapshot({
    airline: '티웨이항공',
    departureTime: '21:35',
    departureCity: '인천',
    departureMonthDay: '09/06',
    returnTime: '01:25',
    arrivalCity: '다낭',
    returnMonthDay: '09/10',
    flyingTime: '05시간 00분',
    isDirect: true,
    seats: 3,
    price: 244_600,
    normalPrice: 1_702_600,
    sourceDiscountRate: 86,
}, 'ASIA', new Date('2026-08-31T01:00:00.000Z'));

assert.ok(flight);
assert.equal(flight.airline, '티웨이항공');
assert.equal(flight.departure.airport, 'ICN');
assert.equal(flight.arrival.airport, 'DAD');
assert.equal(flight.departure.date, '2026-09-06');
assert.equal(flight.arrival.date, '2026-09-10');
assert.equal(flight.availableSeats, 3);
assert.equal(flight.modetourDetail?.isDirect, true);
assert.equal(flight.modetourDetail?.normalPrice, 1_702_600);
assert.match(flight.link, /modetour\.com\/flights\/discount-flight/);

const rollover = parseModetourDomSnapshot({
    airline: '대한항공',
    departureTime: '10:00',
    departureCity: '인천',
    departureMonthDay: '12/28',
    returnTime: '18:00',
    arrivalCity: '도쿄',
    returnMonthDay: '01/02',
    isDirect: true,
    price: 400_000,
}, 'JPN', new Date('2026-12-15T00:00:00.000Z'));

assert.ok(rollover);
assert.equal(rollover.departure.date, '2026-12-28');
assert.equal(rollover.arrival.date, '2027-01-02');

assert.equal(parseModetourDomSnapshot({
    airline: '테스트항공',
    departureTime: '10:00',
    departureCity: '인천',
    departureMonthDay: '09/06',
    returnTime: '18:00',
    arrivalCity: '다낭',
    returnMonthDay: '09/10',
    isDirect: true,
    price: 700_000,
}, 'ASIA', new Date('2026-08-31T00:00:00.000Z')), null);

console.log('모두투어 PC DOM 파서 테스트 통과');
