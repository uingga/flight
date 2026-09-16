import { cityDisplayName } from './utils/city-display';

// Editorial shortlist for search/navigation, not a measured popularity ranking.
export const FEATURED_TRAVEL_CITIES = ['오사카', '도쿄', '후쿠오카', '삿포로', '오키나와', '다낭', '나트랑', '푸꾸옥', '방콕', '세부', '괌', '타이베이'] as const;
export function isIndexableCity(city: string, flightCount: number) {
    return flightCount >= 3 && (FEATURED_TRAVEL_CITIES as readonly string[]).includes(cityDisplayName(city));
}
export function featuredCityOrder(city: string) {
    return (FEATURED_TRAVEL_CITIES as readonly string[]).indexOf(cityDisplayName(city));
}
