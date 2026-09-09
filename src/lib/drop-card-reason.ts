type RepeatPrice = {
    previousDate?: string;
    previousEffectivePrice: number;
    currentEffectivePrice: number;
    dropAmount: number;
};

export function exactWon(value: number): string {
    return value >= 10_000 && value % 1000 === 0
        ? `${value / 10_000}만원` : `${value.toLocaleString('ko-KR')}원`;
}

function calendarDay(value: string): number | null {
    const normalized = value.replace(/\./g, '-').replace(/\(.*\)/g, '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
    const timestamp = Date.parse(`${normalized}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === normalized
        ? timestamp : null;
}

/** Describe verified facts; never infer weekend availability or yesterday's price. */
export function buildDropCardReason(input: {
    origin: string; destination: string; price: number;
    departureDate: string; today: string; seats?: number;
    averageDiscountRate?: number; repeat?: RepeatPrice | null;
}): string {
    const { repeat, price } = input;
    if (repeat && Number.isFinite(price) && price > 0
        && repeat.currentEffectivePrice === price
        && repeat.previousEffectivePrice > price
        && repeat.previousEffectivePrice - price === repeat.dropAmount) {
        const previousDay = calendarDay(repeat.previousDate || '');
        const today = calendarDay(input.today);
        if (previousDay !== null && today !== null && previousDay < today) {
            const date = new Date(previousDay);
            const label = date.getUTCFullYear() === new Date(today).getUTCFullYear()
                ? `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`
                : `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
            return `${label} 선정가보다 ${exactWon(repeat.dropAmount)} 내렸어요`;
        }
        return `지난 선정가보다 ${exactWon(repeat.dropAmount)} 내렸어요`;
    }
    const rate = input.averageDiscountRate;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 5 && rate < 100) {
        return `같은 목적지 월평균가보다 ${Math.round(rate)}% 저렴해요`;
    }
    const departure = calendarDay(input.departureDate);
    const today = calendarDay(input.today);
    if (departure !== null && today !== null) {
        const days = (departure - today) / 86_400_000;
        if (days === 0) return `오늘 출발하는 ${input.origin}발 표예요`;
        if (days > 0 && days <= 5) return `${days}일 뒤 출발하는 ${input.origin}발 표예요`;
    }
    if (Number.isSafeInteger(input.seats) && input.seats! > 0) {
        return `지금 확인되는 좌석은 ${input.seats}석이에요`;
    }
    return `${input.origin}에서 ${input.destination}, 왕복 ${exactWon(price)}이에요`;
}
