import { createHash } from 'crypto';
import {
    decodeDealAlertRegion,
    dealAlertRegionLabel,
    evaluateDealAlert,
    type DealAlertCondition,
    type DealCandidate,
} from './deal-alerts';
import {
    appendDealSentEvent,
    buildDealNotificationText,
    selectDealCandidateForNotification,
} from './deal-alert-delivery';
import { normalizeCity as canonicalCity } from './utils/flight-helpers';
import type { Flight } from '../types/flight';

export interface AlertSubscriptionRecord {
    id: string;
    alert_key?: string;
    endpoint_hash?: string;
    subscription?: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
    };
    departure_city?: string;
    arrival_city?: string;
    departure_date_from?: string;
    departure_date_to?: string;
    max_price: number;
    last_notified_price?: number;
    last_notified_flight_id?: string;
    notified_flight_ids?: string[];
    last_sent_at?: string;
    created_at?: string;
}

export interface AlertApprovalRecipient {
    alert: AlertSubscriptionRecord;
    updates: Record<string, unknown>;
    selectionRank: number;
}

export interface AlertApprovalBatch {
    batchKey: string;
    kind: 'route' | 'deal';
    title: string;
    body: string;
    url: string;
    flightId: string;
    departureCity: string;
    arrivalCity: string;
    departureDate: string;
    returnDate: string;
    airline: string;
    source: string;
    effectivePrice: number;
    score: number;
    reasons: string[];
    selectionRank: number;
    recipients: AlertApprovalRecipient[];
}

export interface PublicAlertApprovalBatch extends Omit<AlertApprovalBatch, 'recipients'> {
    recipientCount: number;
    recipientConditions: Array<{
        kind: 'route' | 'deal';
        departureCity: string;
        destination: string;
        maxPrice: number;
        departureDateFrom?: string;
        departureDateTo?: string;
        selectionRank: number;
        recipientCount: number;
    }>;
}

type PriceHistory = Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;

interface AlertProposal {
    kind: AlertApprovalBatch['kind'];
    title: string;
    body: string;
    url: string;
    candidate: DealCandidate;
    recipient: AlertApprovalRecipient;
    endpointKey: string;
    selectionRank: number;
}

function cleanCity(city = ''): string {
    return city.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

function cityKey(city = ''): string {
    return cleanCity(canonicalCity(city || ''));
}

export function normalizeAlertDate(date = ''): string {
    const match = date.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return date.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function formatPrice(price: number): string {
    return `${Math.round(price).toLocaleString('ko-KR')}원`;
}

export function alertDayInKorea(date = new Date()): string {
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}

function endpointKey(alert: AlertSubscriptionRecord): string {
    return alert.endpoint_hash || alert.subscription?.endpoint || '';
}

/** 같은 기기의 다른 조건까지 포함해 KST 하루 1회 제한 대상을 계산한다. */
export function getDailyLimitedAlertTargets(
    alerts: AlertSubscriptionRecord[],
    now = new Date(),
): Set<string> {
    const today = alertDayInKorea(now);
    return new Set(
        alerts
            .filter(alert => alert.last_sent_at && alertDayInKorea(new Date(alert.last_sent_at)) === today)
            .map(endpointKey)
            .filter(Boolean),
    );
}

function effectivePrice(flight: Flight): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

function dateMatches(alert: AlertSubscriptionRecord, flight: Flight): boolean {
    const departureDate = normalizeAlertDate(flight.departure.date);
    const from = alert.departure_date_from ? normalizeAlertDate(alert.departure_date_from) : '';
    const to = alert.departure_date_to ? normalizeAlertDate(alert.departure_date_to) : '';
    if (from && departureDate < from) return false;
    if (to && departureDate > to) return false;
    return true;
}

function shareUrl(candidate: DealCandidate): string {
    return `/share/${encodeURIComponent(candidate.flightId)}?dep=${encodeURIComponent(candidate.departureCity)}&arr=${encodeURIComponent(candidate.arrivalCity)}&date=${encodeURIComponent(normalizeAlertDate(candidate.departureDate))}`;
}

function proposalKey(proposal: AlertProposal): string {
    return createHash('sha256')
        .update([
            proposal.kind,
            proposal.candidate.flightId,
            proposal.title,
            proposal.body,
            proposal.url,
        ].join('|'))
        .digest('hex')
        .slice(0, 24);
}

function routeProposal(
    alert: AlertSubscriptionRecord,
    flights: Flight[],
    priceHistory: PriceHistory,
    sourceUpdatedAt: Record<string, string>,
    now: Date,
): AlertProposal | null {
    if (!alert.departure_city || !alert.arrival_city || !Number.isFinite(Number(alert.max_price))) return null;

    const routeFlights = flights.filter(flight => (
        cityKey(flight.departure.city) === cityKey(alert.departure_city)
        && cityKey(flight.arrival.city) === cityKey(alert.arrival_city)
        && effectivePrice(flight) <= Number(alert.max_price)
        && dateMatches(alert, flight)
    ));
    if (routeFlights.length === 0) return null;

    // 노선을 지정한 알림도 조건형 알림과 같은 가격·일정·신선도 품질 기준을 통과해야 한다.
    const qualityReview = evaluateDealAlert({
        id: alert.alert_key || alert.id,
        departureCity: alert.departure_city,
        region: 'all',
        maxPrice: Number(alert.max_price),
        createdAt: alert.created_at,
    }, routeFlights, priceHistory, sourceUpdatedAt, now);
    const candidate = qualityReview.candidates[0];
    if (!candidate) return null;

    const notifiedIds = Array.isArray(alert.notified_flight_ids) ? alert.notified_flight_ids : [];
    const previousPrice = Number(alert.last_notified_price);
    const priceDrop = Number.isFinite(previousPrice) ? previousPrice - candidate.effectivePrice : Infinity;
    const priceDropRate = Number.isFinite(previousPrice) && previousPrice > 0 ? priceDrop / previousPrice : Infinity;
    const meaningfulDrop = priceDrop >= 5_000 || priceDropRate >= 0.03;
    const newFlight = !notifiedIds.includes(candidate.flightId);
    if (Number.isFinite(previousPrice) && !meaningfulDrop && !newFlight) return null;

    const title = `✈️ ${candidate.departureCity} → ${candidate.arrivalCity} ${formatPrice(candidate.effectivePrice)}`;
    const body = meaningfulDrop && Number.isFinite(priceDrop)
        ? `이전에 본 가격보다 ${formatPrice(priceDrop)} 내려갔어요 · ${candidate.airline}`
        : `기다리던 가격 안으로 들어왔어요 · ${candidate.airline}`;

    return {
        kind: 'route',
        title,
        body,
        url: shareUrl(candidate),
        candidate,
        endpointKey: endpointKey(alert),
        recipient: {
            alert,
            selectionRank: 1,
            updates: {
                last_notified_price: candidate.effectivePrice,
                last_notified_flight_id: candidate.flightId,
                notified_flight_ids: Array.from(new Set([...notifiedIds, candidate.flightId])).slice(-20),
            },
        },
        selectionRank: 1,
    };
}

function dealProposals(
    alert: AlertSubscriptionRecord,
    flights: Flight[],
    priceHistory: PriceHistory,
    sourceUpdatedAt: Record<string, string>,
    now: Date,
): AlertProposal[] {
    const region = decodeDealAlertRegion(alert.arrival_city);
    if (!region || !alert.departure_city || !Number.isFinite(Number(alert.max_price))) return [];
    const condition: DealAlertCondition = {
        id: alert.alert_key || alert.id,
        departureCity: alert.departure_city,
        region,
        maxPrice: Number(alert.max_price),
        createdAt: alert.created_at,
    };
    const review = evaluateDealAlert(condition, flights, priceHistory, sourceUpdatedAt, now);
    const notifiedIds = Array.isArray(alert.notified_flight_ids) ? alert.notified_flight_ids : [];
    const eligibleCandidates = review.candidates
        .filter(candidate => selectDealCandidateForNotification([candidate], notifiedIds, now).candidate !== null)
        .slice(0, 3);

    return eligibleCandidates.map((candidate, index) => {
        const text = buildDealNotificationText(condition, candidate);
        const sentAt = now.toISOString();
        const selectionRank = index + 1;
        return {
            kind: 'deal',
            ...text,
            url: shareUrl(candidate),
            candidate,
            endpointKey: endpointKey(alert),
            selectionRank,
            recipient: {
                alert,
                selectionRank,
                updates: {
                    last_notified_price: candidate.effectivePrice,
                    last_notified_flight_id: candidate.flightId,
                    notified_flight_ids: appendDealSentEvent(notifiedIds, {
                        arrivalCity: candidate.arrivalCity,
                        sentAt,
                        effectivePrice: candidate.effectivePrice,
                        flightId: candidate.flightId,
                    }),
                },
            },
        };
    });
}

/**
 * 현재 데이터로 실제 발송 가능한 후보를 계산한다. 이 함수는 발송하지 않는다.
 * 한 기기에는 하루 한 번만 발송하되, 승인 화면에서는 조건형 알림의 상위 후보를 최대 3개 보여준다.
 */
export function buildAlertApprovalBatches(
    alerts: AlertSubscriptionRecord[],
    flights: Flight[],
    priceHistory: PriceHistory = {},
    sourceUpdatedAt: Record<string, string> = {},
    now = new Date(),
): AlertApprovalBatch[] {
    const sentEndpoints = getDailyLimitedAlertTargets(alerts, now);

    const proposals = alerts.flatMap(alert => {
        const target = endpointKey(alert);
        if (!target || sentEndpoints.has(target)) return [];
        if (decodeDealAlertRegion(alert.arrival_city)) {
            return dealProposals(alert, flights, priceHistory, sourceUpdatedAt, now);
        }
        const proposal = routeProposal(alert, flights, priceHistory, sourceUpdatedAt, now);
        return proposal ? [proposal] : [];
    }).sort((a, b) => (
        a.selectionRank - b.selectionRank
        || (a.kind === 'route' ? 0 : 1) - (b.kind === 'route' ? 0 : 1)
        || b.candidate.score - a.candidate.score
        || a.candidate.effectivePrice - b.candidate.effectivePrice
    ));

    const grouped = new Map<string, AlertApprovalBatch>();
    for (const proposal of proposals) {
        const batchKey = proposalKey(proposal);
        const existing = grouped.get(batchKey);
        if (existing) {
            const duplicateEndpoint = existing.recipients.some(recipient => endpointKey(recipient.alert) === proposal.endpointKey);
            if (!duplicateEndpoint) existing.recipients.push(proposal.recipient);
            existing.selectionRank = Math.min(existing.selectionRank, proposal.selectionRank);
            continue;
        }
        grouped.set(batchKey, {
            batchKey,
            kind: proposal.kind,
            title: proposal.title,
            body: proposal.body,
            url: proposal.url,
            flightId: proposal.candidate.flightId,
            departureCity: proposal.candidate.departureCity,
            arrivalCity: proposal.candidate.arrivalCity,
            departureDate: proposal.candidate.departureDate,
            returnDate: proposal.candidate.returnDate,
            airline: proposal.candidate.airline,
            source: proposal.candidate.source,
            effectivePrice: proposal.candidate.effectivePrice,
            score: proposal.candidate.score,
            reasons: proposal.candidate.reasons,
            selectionRank: proposal.selectionRank,
            recipients: [proposal.recipient],
        });
    }

    return Array.from(grouped.values()).sort((a, b) => (
        a.selectionRank - b.selectionRank
        || (a.kind === 'route' ? 0 : 1) - (b.kind === 'route' ? 0 : 1)
        || b.score - a.score
        || a.effectivePrice - b.effectivePrice
    ));
}

/**
 * 관리자가 본 배치 키를 현재 항공권·구독 상태로 다시 계산해 승인 가능 여부를 확인한다.
 * 가격 변경, 후보 탈락, 오늘 이미 발송된 기기는 이 단계에서 자동으로 빠진다.
 */
export function revalidateAlertApprovalBatch(
    batchKey: string,
    alerts: AlertSubscriptionRecord[],
    flights: Flight[],
    priceHistory: PriceHistory = {},
    sourceUpdatedAt: Record<string, string> = {},
    now = new Date(),
): AlertApprovalBatch | null {
    return buildAlertApprovalBatches(alerts, flights, priceHistory, sourceUpdatedAt, now)
        .find(batch => batch.batchKey === batchKey) || null;
}

export function toPublicApprovalBatch(batch: AlertApprovalBatch): PublicAlertApprovalBatch {
    const { recipients, ...publicBatch } = batch;
    const groupedConditions = new Map<string, PublicAlertApprovalBatch['recipientConditions'][number]>();
    for (const { alert, selectionRank } of recipients) {
        const region = decodeDealAlertRegion(alert.arrival_city);
        const condition = {
            kind: region ? 'deal' as const : 'route' as const,
            departureCity: alert.departure_city || '전체',
            destination: region ? dealAlertRegionLabel(region) : (alert.arrival_city || '전체'),
            maxPrice: Number(alert.max_price),
            departureDateFrom: alert.departure_date_from ? normalizeAlertDate(alert.departure_date_from) : undefined,
            departureDateTo: alert.departure_date_to ? normalizeAlertDate(alert.departure_date_to) : undefined,
            selectionRank,
            recipientCount: 1,
        };
        const key = [
            condition.kind,
            condition.departureCity,
            condition.destination,
            condition.maxPrice,
            condition.departureDateFrom || '',
            condition.departureDateTo || '',
            condition.selectionRank,
        ].join('|');
        const existing = groupedConditions.get(key);
        if (existing) existing.recipientCount++;
        else groupedConditions.set(key, condition);
    }
    return {
        ...publicBatch,
        recipientCount: recipients.length,
        recipientConditions: Array.from(groupedConditions.values())
            .sort((a, b) => b.recipientCount - a.recipientCount || a.maxPrice - b.maxPrice),
    };
}
