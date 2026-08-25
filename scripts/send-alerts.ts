import * as fs from 'fs';
import * as path from 'path';
import webpush from 'web-push';
import { normalizeCity as canonicalCity } from '../src/lib/utils/flight-helpers';
import {
    decodeDealAlertRegion,
    evaluateDealAlert,
    type DealAlertCondition,
    type DealCandidate,
} from '../src/lib/deal-alerts';
import {
    appendDealSentEvent,
    buildDealNotificationText,
    selectDealCandidateForNotification,
} from '../src/lib/deal-alert-delivery';
import type { Flight } from '../src/types/flight';

interface AlertSubscription {
    id: string;
    alert_key?: string;
    endpoint_hash?: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
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

type DeliveryResult = 'sent' | 'expired' | 'failed';

/**
 * 웹 푸시 발송자 연락처(VAPID subject).
 *
 * 푸시 서비스가 문제를 발견했을 때 발송자에게 연락하는 통로라 실재해야 한다.
 * 예전에는 만든 적 없는 주소가 적혀 있어서, 연락이 와도 아무도 받지 못했다.
 * RFC 8292는 mailto: 외에 https: URL도 허용하므로, 공개 저장소에 개인 메일
 * 주소를 남기지 않도록 사이트 주소를 기본값으로 쓴다. 실제로 받을 수 있는
 * 주소를 쓰고 싶으면 VAPID_CONTACT 환경변수로 덮어쓴다.
 */
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'https://tikitikit.kr';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FLIGHTS_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const PRICE_HISTORY_PATH = path.join(process.cwd(), 'data', 'price-history.json');
// 실제 조건형 푸시는 명시적으로 1을 설정했을 때만 켠다. 기존 노선형 알림은 이 값과 무관하다.
const DEAL_ALERT_SEND_ENABLED = process.env.DEAL_ALERT_SEND_ENABLED === '1';

function normalizeCity(city = ''): string {
    return city.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

/**
 * 알림 매칭용 도시 키.
 * 등록은 대시보드의 normalizeCity(표기 통일: 서울(ICN)→인천, 쿠마모토→구마모토)를 거친 값을 저장하는데,
 * 캐시에는 두 표기가 섞여 있어 여기서도 같은 정규화를 적용해야 같은 노선으로 매칭된다.
 */
function cityKey(city = ''): string {
    return normalizeCity(canonicalCity(city || ''));
}

function normalizeDate(date = ''): string {
    const match = date.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return date.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function formatPrice(price: number): string {
    return `${Math.floor(price / 10000)}만${price % 10000 ? `${Math.floor((price % 10000) / 1000)}천` : ''}원`;
}

function todayInKorea(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}

async function supabaseRequest(pathname: string, init: RequestInit = {}) {
    return fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
}

function endpointKey(alert: AlertSubscription): string {
    return alert.endpoint_hash || alert.subscription.endpoint;
}

async function claimDelivery(alert: AlertSubscription): Promise<boolean> {
    const response = await supabaseRequest('rpc/claim_price_alert_delivery', {
        method: 'POST',
        body: JSON.stringify({ p_alert_id: String(alert.id) }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`발송 중복 방지 잠금 실패: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }
    return await response.json() === true;
}

async function releaseDeliveryClaim(alert: AlertSubscription): Promise<boolean> {
    const response = await supabaseRequest(`price_alerts?id=eq.${encodeURIComponent(String(alert.id))}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ delivery_claimed_at: null, updated_at: new Date().toISOString() }),
    });
    return response.ok;
}

async function sendAndRecord(
    alert: AlertSubscription,
    payload: Record<string, unknown>,
    updates: Record<string, unknown>,
): Promise<DeliveryResult> {
    try {
        await webpush.sendNotification(alert.subscription, JSON.stringify(payload));
        const now = new Date().toISOString();
        const updateResponse = await supabaseRequest(`price_alerts?id=eq.${encodeURIComponent(String(alert.id))}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
                ...updates,
                last_sent_at: now,
                delivery_claimed_at: null,
                updated_at: now,
            }),
        });
        if (!updateResponse.ok) throw new Error(`발송 이력 저장 실패: ${updateResponse.status}`);
        return 'sent';
    } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
            try {
                const deactivateResponse = await supabaseRequest(`price_alerts?id=eq.${encodeURIComponent(String(alert.id))}`, {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: JSON.stringify({
                        active: false,
                        delivery_claimed_at: null,
                        updated_at: new Date().toISOString(),
                    }),
                });
                if (!deactivateResponse.ok) {
                    console.error(`[알림] 만료 구독 비활성화 실패: ${alert.id} (${deactivateResponse.status})`);
                    return 'failed';
                }
            } catch (deactivateError) {
                console.error(`[알림] 만료 구독 비활성화 실패: ${alert.id}`, deactivateError);
                return 'failed';
            }
            console.log(`[알림] 만료된 구독 비활성화: ${alert.id}`);
            return 'expired';
        } else {
            console.error(`[알림] 발송 실패: ${alert.id}`, error);
        }
        try {
            if (!await releaseDeliveryClaim(alert)) {
                console.error(`[알림] 발송 잠금 해제 실패: ${alert.id}`);
            }
        } catch (releaseError) {
            console.error(`[알림] 발송 잠금 해제 실패: ${alert.id}`, releaseError);
        }
        return 'failed';
    }
}

async function main() {
    console.log('\n=== 가격 알림 발송 시작 ===');
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('VAPID 또는 Supabase 설정이 없어 알림을 발송할 수 없습니다.');
    }

    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
    const alertResponse = await supabaseRequest('price_alerts?select=*&active=eq.true');
    if (!alertResponse.ok) throw new Error(`알림 구독 조회 실패: ${alertResponse.status}`);
    const alerts = await alertResponse.json() as AlertSubscription[];
    if (alerts.length === 0) {
        console.log('활성 가격 알림이 없습니다.');
        return;
    }

    const flightsData = JSON.parse(fs.readFileSync(FLIGHTS_PATH, 'utf-8')) as {
        flights?: Flight[];
        sourceUpdatedAt?: Record<string, string>;
        priceHistory?: Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;
    } | Flight[];
    const flights: Flight[] = Array.isArray(flightsData) ? flightsData : flightsData.flights || [];
    let priceHistory = Array.isArray(flightsData) ? {} : flightsData.priceHistory || {};
    if (fs.existsSync(PRICE_HISTORY_PATH)) {
        priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf-8')) as typeof priceHistory;
    }
    const sourceUpdatedAt = Array.isArray(flightsData) ? {} : flightsData.sourceUpdatedAt || {};
    const today = todayInKorea();
    const now = new Date();
    const endpointsAlreadySentToday = new Set(
        alerts
            .filter(alert => alert.last_sent_at && todayInKorea(new Date(alert.last_sent_at)) === today)
            .map(endpointKey),
    );
    // 사용자가 목적지를 명시한 노선형 알림을 조건형 추천보다 먼저 처리한다.
    const orderedAlerts = [...alerts].sort((a, b) => {
        const aIsDeal = decodeDealAlertRegion(a.arrival_city) ? 1 : 0;
        const bIsDeal = decodeDealAlertRegion(b.arrival_city) ? 1 : 0;
        return aIsDeal - bIsDeal;
    });
    let sentCount = 0;
    let routeSentCount = 0;
    let dealSentCount = 0;
    let dealDryRunCount = 0;
    let deliveryFailureCount = 0;

    for (const alert of orderedAlerts) {
        const subscriberKey = endpointKey(alert);
        // 같은 브라우저에는 노선형·조건형을 합쳐 하루 최대 한 번만 보낸다.
        if (endpointsAlreadySentToday.has(subscriberKey)) continue;

        const dealRegion = decodeDealAlertRegion(alert.arrival_city);
        if (dealRegion) {
            if (!alert.departure_city || !Number.isFinite(Number(alert.max_price))) continue;
            const condition: DealAlertCondition = {
                id: alert.alert_key || alert.id,
                departureCity: alert.departure_city,
                region: dealRegion,
                maxPrice: Number(alert.max_price),
                createdAt: alert.created_at,
            };
            const review = evaluateDealAlert(condition, flights, priceHistory, sourceUpdatedAt, now);
            const notifiedIds = Array.isArray(alert.notified_flight_ids) ? alert.notified_flight_ids : [];
            const selection = selectDealCandidateForNotification(review.candidates, notifiedIds, now);
            const candidate = selection.candidate;
            if (!candidate) {
                if (selection.skippedRecentDestinations.length > 0) {
                    console.log(`[조건형] 최근 발송 목적지 제외: ${selection.skippedRecentDestinations.join(', ')}`);
                }
                continue;
            }

            if (!DEAL_ALERT_SEND_ENABLED) {
                dealDryRunCount++;
                console.log(`[조건형][DRY RUN] ${candidate.departureCity} → ${candidate.arrivalCity} ${formatPrice(candidate.effectivePrice)} (${candidate.score}점)`);
                continue;
            }

            let claimed = false;
            try {
                claimed = await claimDelivery(alert);
            } catch (error) {
                deliveryFailureCount++;
                console.error(`[조건형] 발송 준비 실패: ${alert.id}`, error);
                continue;
            }
            if (!claimed) {
                console.log(`[조건형] 오늘 이미 발송했거나 다른 실행에서 처리 중: ${alert.id}`);
                endpointsAlreadySentToday.add(subscriberKey);
                continue;
            }

            const text = buildDealNotificationText(condition, candidate);
            const payload = {
                ...text,
                url: `/share/${encodeURIComponent(candidate.flightId)}?dep=${encodeURIComponent(candidate.departureCity)}&arr=${encodeURIComponent(candidate.arrivalCity)}&date=${encodeURIComponent(normalizeDate(candidate.departureDate))}`,
                tag: `deal-alert-${alert.id}`,
            };
            const sentAt = new Date().toISOString();
            const delivery = await sendAndRecord(alert, payload, {
                last_notified_price: candidate.effectivePrice,
                last_notified_flight_id: candidate.flightId,
                notified_flight_ids: appendDealSentEvent(notifiedIds, {
                    arrivalCity: candidate.arrivalCity,
                    sentAt,
                    effectivePrice: candidate.effectivePrice,
                    flightId: candidate.flightId,
                }),
            });
            // 성공 여부와 관계없이 같은 실행에서 동일 기기에 두 번째 푸시를 시도하지 않는다.
            endpointsAlreadySentToday.add(subscriberKey);
            if (delivery === 'sent') {
                sentCount++;
                dealSentCount++;
                console.log(`[조건형] ✅ ${candidate.departureCity} → ${candidate.arrivalCity} ${formatPrice(candidate.effectivePrice)}`);
            } else if (delivery === 'failed') {
                deliveryFailureCount++;
            }
            continue;
        }

        const matches = flights.filter(flight => {
            if (cityKey(flight.departure.city) !== cityKey(alert.departure_city)) return false;
            if (cityKey(flight.arrival.city) !== cityKey(alert.arrival_city)) return false;
            if (flight.price > alert.max_price) return false;

            // 오래된 값으로는 알리지 않는다.
            //
            // 무결성 가드는 수집이 실패하면 일부러 이전 데이터를 그대로 둔다. 그때
            // sourceUpdatedAt이 멈추므로 얼마나 묵었는지 알 수 있는데, 노선형 알림만
            // 그걸 보지 않았다. 며칠 전에 사라진 표로 '가격이 내려갔어요' 알림이 가고,
            // 눌러 들어가면 없는 표다. 조건형 알림은 이미 같은 기준(72시간)을 쓴다.
            const checkedAt = flight.priceCheckedAt || sourceUpdatedAt[flight.source];
            if (checkedAt) {
                const ageHours = (Date.now() - new Date(checkedAt).getTime()) / 3600000;
                if (Number.isFinite(ageHours) && ageHours >= 72) return false;
            }

            return true;
        }).sort((a, b) => a.price - b.price);

        if (matches.length === 0) continue;
        const cheapest = matches[0];
        const notifiedIds = Array.isArray(alert.notified_flight_ids) ? alert.notified_flight_ids : [];
        const priceDrop = alert.last_notified_price ? alert.last_notified_price - cheapest.price : Infinity;
        const priceDropRate = alert.last_notified_price ? priceDrop / alert.last_notified_price : Infinity;
        const meaningfulDrop = priceDrop >= 5000 || priceDropRate >= 0.03;
        const newFlight = !notifiedIds.includes(cheapest.id);
        if (alert.last_notified_price && !meaningfulDrop && !newFlight) continue;

        const dep = normalizeCity(cheapest.departure.city);
        const arr = normalizeCity(cheapest.arrival.city);
        const date = normalizeDate(cheapest.departure.date);
        const payload = {
            title: `✈️ ${dep} → ${arr} ${formatPrice(cheapest.price)}`,
            body: meaningfulDrop && Number.isFinite(priceDrop)
                ? `이전보다 ${formatPrice(priceDrop)} 내려갔어요 · ${cheapest.airline}`
                : `새로운 목표가 이하 항공권이 나왔어요 · ${cheapest.airline}`,
            url: `/share/${encodeURIComponent(cheapest.id)}?dep=${encodeURIComponent(dep)}&arr=${encodeURIComponent(arr)}&date=${encodeURIComponent(date)}`,
            tag: `price-alert-${alert.id}`,
        };

        let claimed = false;
        try {
            claimed = await claimDelivery(alert);
        } catch (error) {
            deliveryFailureCount++;
            console.error(`[알림] 발송 준비 실패: ${alert.id}`, error);
            continue;
        }
        if (!claimed) {
            console.log(`[알림] 오늘 이미 발송했거나 다른 실행에서 처리 중: ${alert.id}`);
            endpointsAlreadySentToday.add(subscriberKey);
            continue;
        }

        const updatedIds = [...new Set([...notifiedIds, cheapest.id])].slice(-20);
        const delivery = await sendAndRecord(alert, payload, {
            last_notified_price: cheapest.price,
            last_notified_flight_id: cheapest.id,
            notified_flight_ids: updatedIds,
        });
        // 일부 이력 저장만 실패했더라도 같은 실행에서 중복 푸시를 보내지 않는다.
        endpointsAlreadySentToday.add(subscriberKey);
        if (delivery === 'sent') {
            sentCount++;
            routeSentCount++;
            console.log(`[알림] ✅ ${dep} → ${arr} ${formatPrice(cheapest.price)}`);
        } else if (delivery === 'failed') {
            deliveryFailureCount++;
        }
    }

    console.log(`\n[알림] 총 ${sentCount}건 발송 (노선형 ${routeSentCount}, 조건형 ${dealSentCount}), 활성 구독 ${alerts.length}건`);
    if (!DEAL_ALERT_SEND_ENABLED && dealDryRunCount > 0) {
        console.log(`[조건형] DRY RUN 후보 ${dealDryRunCount}건 — DEAL_ALERT_SEND_ENABLED=1 설정 전까지 실제 발송하지 않음`);
    }
    if (deliveryFailureCount > 0) {
        throw new Error(`가격 알림 ${deliveryFailureCount}건의 발송 또는 이력 저장에 실패했습니다.`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
