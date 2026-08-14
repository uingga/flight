import type { DealAlertCondition, DealCandidate } from './deal-alerts';
import { dealAlertRegionLabel } from './deal-alerts';
import { normalizeCity } from './utils/flight-helpers';

export const DEAL_DESTINATION_COOLDOWN_DAYS = 7;
export const DEAL_RENOTIFY_MIN_DROP = 5_000;
export const DEAL_RENOTIFY_MIN_DROP_RATE = 0.05;
export const DEAL_SENT_EVENT_PREFIX = '@deal-sent:';

export interface DealSentEvent {
    arrivalCity: string;
    sentAt: string;
    effectivePrice: number;
    flightId: string;
}

export interface DealCandidateSelection {
    candidate: DealCandidate | null;
    skippedRecentDestinations: string[];
}

function formatBudget(price: number): string {
    return price % 10_000 === 0 ? `${price / 10_000}만원` : `${Math.round(price).toLocaleString('ko-KR')}원`;
}

function formatExactPrice(price: number): string {
    return `${Math.round(price).toLocaleString('ko-KR')}원`;
}

export function sanitizePublicDealText(text: string): string {
    return text
        .replace(/네이버\s*항공권\s*최저가/gi, '외부 비교 최저가')
        .replace(/네이버\s*최저가/gi, '외부 비교 최저가')
        .replace(/네이버/gi, '외부 비교 서비스')
        .replace(/naver/gi, '외부 비교 서비스');
}

export function encodeDealSentEvent(event: DealSentEvent): string {
    return [
        DEAL_SENT_EVENT_PREFIX + encodeURIComponent(normalizeCity(event.arrivalCity)),
        event.sentAt,
        Math.round(event.effectivePrice),
        encodeURIComponent(event.flightId),
    ].join('|');
}

export function decodeDealSentEvent(value: string): DealSentEvent | null {
    if (!value.startsWith(DEAL_SENT_EVENT_PREFIX)) return null;
    try {
        const [cityToken, sentAt, priceToken, flightToken] = value.split('|');
        const effectivePrice = Number(priceToken);
        if (!cityToken || !sentAt || !flightToken || !Number.isFinite(effectivePrice)) return null;
        const sentAtTime = new Date(sentAt).getTime();
        if (!Number.isFinite(sentAtTime)) return null;
        return {
            arrivalCity: decodeURIComponent(cityToken.slice(DEAL_SENT_EVENT_PREFIX.length)),
            sentAt,
            effectivePrice,
            flightId: decodeURIComponent(flightToken),
        };
    } catch {
        return null;
    }
}

export function appendDealSentEvent(
    history: string[],
    event: DealSentEvent,
    maxEntries = 20,
): string[] {
    return [...history, encodeDealSentEvent(event)].slice(-maxEntries);
}

function latestDestinationEvent(history: string[], arrivalCity: string): DealSentEvent | null {
    const destination = normalizeCity(arrivalCity);
    return history
        .map(decodeDealSentEvent)
        .filter((event): event is DealSentEvent => event !== null && normalizeCity(event.arrivalCity) === destination)
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0] || null;
}

export function selectDealCandidateForNotification(
    candidates: DealCandidate[],
    history: string[],
    now = new Date(),
): DealCandidateSelection {
    const skippedRecentDestinations: string[] = [];
    const cooldownMs = DEAL_DESTINATION_COOLDOWN_DAYS * 86_400_000;

    for (const candidate of candidates) {
        const previous = latestDestinationEvent(history, candidate.arrivalCity);
        if (!previous) return { candidate, skippedRecentDestinations };

        const ageMs = Math.max(0, now.getTime() - new Date(previous.sentAt).getTime());
        if (ageMs >= cooldownMs) return { candidate, skippedRecentDestinations };

        const priceDrop = previous.effectivePrice - candidate.effectivePrice;
        const priceDropRate = previous.effectivePrice > 0 ? priceDrop / previous.effectivePrice : 0;
        if (priceDrop >= DEAL_RENOTIFY_MIN_DROP || priceDropRate >= DEAL_RENOTIFY_MIN_DROP_RATE) {
            return { candidate, skippedRecentDestinations };
        }

        skippedRecentDestinations.push(candidate.arrivalCity);
    }

    return { candidate: null, skippedRecentDestinations };
}

export function buildDealNotificationText(
    condition: DealAlertCondition,
    candidate: DealCandidate,
): { title: string; body: string } {
    const region = dealAlertRegionLabel(condition.region);
    const title = condition.region === 'all'
        ? `✈️ ${formatBudget(condition.maxPrice)} 이하 특가를 찾았어요`
        : `✈️ ${region} ${formatBudget(condition.maxPrice)} 이하 특가`;
    const publicReason = candidate.reasons
        .map(sanitizePublicDealText)
        .find(reason => reason.includes('외부 비교') || reason.includes('시세'))
        || candidate.reasons.map(sanitizePublicDealText).find(reason => reason.includes('일정'))
        || '예산 안에서 발견한 좋은 가격';

    return {
        title,
        body: `${candidate.departureCity} → ${candidate.arrivalCity} · ${formatExactPrice(candidate.effectivePrice)} · ${publicReason}`,
    };
}
