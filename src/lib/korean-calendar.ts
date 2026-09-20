// Confirmed calendar dates, not inferred substitute holidays.
// Sources and annual maintenance: docs/korean-calendar.md.
const annualHolidays: Record<number, Record<string, string>> = {
    2026: {
        '01-01': '신정', '02-16': '설날 연휴', '02-17': '설날', '02-18': '설날 연휴',
        '03-01': '삼일절', '03-02': '삼일절 대체공휴일', '05-01': '노동절',
        '05-05': '어린이날', '05-24': '부처님오신날', '05-25': '부처님오신날 대체공휴일',
        '06-03': '전국동시지방선거', '06-06': '현충일', '07-17': '제헌절',
        '08-15': '광복절', '08-17': '광복절 대체공휴일',
        '09-24': '추석 연휴', '09-25': '추석', '09-26': '추석 연휴',
        '10-03': '개천절', '10-05': '개천절 대체공휴일', '10-09': '한글날', '12-25': '성탄절',
    },
    2027: {
        '01-01': '신정', '02-06': '설날 연휴', '02-07': '설날', '02-08': '설날 연휴',
        '02-09': '설날 대체공휴일', '03-01': '삼일절',
        '05-01': '노동절', '05-03': '노동절 대체공휴일', '05-05': '어린이날',
        '05-13': '부처님오신날', '06-06': '현충일',
        '07-17': '제헌절', '07-19': '제헌절 대체공휴일',
        '08-15': '광복절', '08-16': '광복절 대체공휴일',
        '09-14': '추석 연휴', '09-15': '추석', '09-16': '추석 연휴',
        '10-03': '개천절', '10-04': '개천절 대체공휴일',
        '10-09': '한글날', '10-11': '한글날 대체공휴일',
        '12-25': '성탄절', '12-27': '성탄절 대체공휴일',
    },
};

// Use the local calendar day provided by DatePicker, never UTC serialization.
export function koreanHolidayName(date: Date): string | undefined {
    const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return annualHolidays[date.getFullYear()]?.[key];
}

export function isKoreanCalendarRedDay(date: Date): boolean {
    return date.getDay() === 0 || Boolean(koreanHolidayName(date));
}
