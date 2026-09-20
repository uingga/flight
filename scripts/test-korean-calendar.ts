import assert from 'node:assert/strict';
import { isKoreanCalendarRedDay, koreanHolidayName } from '../src/lib/korean-calendar';

const date = (value: string) => new Date(`${value}T00:00:00`);
for (const value of ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-10-05', '2027-02-09', '2027-05-03', '2027-07-19', '2027-12-27']) {
    assert.equal(isKoreanCalendarRedDay(date(value)), true, value);
}
for (const value of ['2026-09-23', '2026-09-28', '2026-10-10', '2027-06-07']) {
    assert.equal(isKoreanCalendarRedDay(date(value)), false, value);
}
assert.equal(koreanHolidayName(date('2026-09-25')), '추석');
assert.equal(koreanHolidayName(date('2026-10-05')), '개천절 대체공휴일');
assert.equal(koreanHolidayName(new Date('invalid')), undefined);
console.log('Korean calendar tests passed');
