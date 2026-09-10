import { normalizeCity } from './flight-helpers';

// Keep the internal Guilin key unchanged for price history, links and route matching.
export function cityDisplayName(city: string): string {
    if (normalizeCity(city) === '구이린') return '계림';
    return city.replace(/\([^)]*\)/g, '').trim();
}

export function cityDetailName(city: string): string {
    return normalizeCity(city) === '구이린' ? '계림(구이린)' : cityDisplayName(city);
}

export function citySearchMatches(city: string, query: string): boolean {
    const term = query.trim().toLocaleLowerCase('ko-KR');
    if (city.toLocaleLowerCase('ko-KR').includes(term)) return true;
    return normalizeCity(city) === '구이린'
        && ['계림', '구이린', '구이린시', '계림시', 'kwl', '계림(구이린)']
            .some(alias => alias.includes(term));
}
