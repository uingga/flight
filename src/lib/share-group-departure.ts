/** Use the collection's declared origin, even when its tickets have expired. */
export function shareGroupDepartureFilter(departure?: string | null): string {
    const filters: Record<string, string> = {
        '부산': '부산/김해', '김해': '부산/김해', '부산/김해': '부산/김해', 'PUS': '부산/김해',
        '인천': '인천/김포', '김포': '인천/김포', '서울': '인천/김포', '인천/김포': '인천/김포', 'ICN': '인천/김포', 'GMP': '인천/김포',
        '대구': '대구', 'TAE': '대구', '청주': '청주', 'CJJ': '청주', '제주': '제주', 'CJU': '제주',
    };
    return filters[departure?.trim() || ''] || '전체';
}
