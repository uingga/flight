import { normalizeCity } from './flight-helpers';

// Keep the internal Guilin key unchanged for price history, links and route matching.
export function cityDisplayName(city: string): string {
    // Normalize again after removing airport qualifiers: 상해(푸동) -> 상해 -> 상하이.
    // Presentation aliases must not rewrite stored routes, airport codes or price-history keys.
    const base = normalizeCity(normalizeCity(city).replace(/\([^)]*\)/g, '').trim())
        .replace(/\([^)]*\)/g, '').trim();
    const labels: Record<string, string> = {
        '구이린': '계림',
        '청두': '성도',
        '장자제': '장가계',
        '연길': '옌지',
        '시모지시마': '미야코지마',
        '미야코': '미야코지마',
    };
    return labels[base] || base;
}

export function cityDetailName(city: string): string {
    return normalizeCity(city) === '구이린' ? '계림(구이린)' : cityDisplayName(city);
}

export function citySearchMatches(city: string, query: string): boolean {
    const term = query.trim().toLocaleLowerCase('ko-KR');
    if (city.toLocaleLowerCase('ko-KR').includes(term)) return true;
    const displayTerm = cityDisplayName(query).toLocaleLowerCase('ko-KR');
    if (displayTerm && cityDisplayName(city).toLocaleLowerCase('ko-KR').includes(displayTerm)) return true;
    return normalizeCity(city) === '구이린'
        && ['계림', '구이린', '구이린시', '계림시', 'kwl', '계림(구이린)']
            .some(alias => alias.includes(term));
}
