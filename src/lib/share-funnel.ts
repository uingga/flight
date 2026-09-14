import type { Flight } from '@/types/flight';
import { SHARE_GROUPS } from './share-groups';
import { discoveryIdentity } from './share-discovery';

export const FUNNEL_EVENTS = ['shared_collection_view', 'shared_collection_more', 'shared_outside_detail', 'shared_outside_booking'] as const;
export type FunnelEvent = typeof FUNNEL_EVENTS[number];
export function shareFunnelContext(raw: string) {
    try {
        const url = new URL(raw);
        const code = url.pathname.match(/^\/share-group\/([a-z0-9-]+)\/?$/)?.[1];
        if (!code || !SHARE_GROUPS[code]) return null;
        const source = url.searchParams.get('utm_source');
        const campaign = url.searchParams.get('utm_campaign');
        const content = url.searchParams.get('utm_content');
        if (!['te31', 'threads'].includes(source || '') || !campaign || !content) return null;
        if (source === 'te31' && (campaign !== `tikitikit_te31_${code}` || content !== `share_group_${code}`)) return null;
        if (source === 'threads' && (campaign !== 'tikitikit_threads' || !/^share_[a-zA-Z0-9_-]+$/.test(content))) return null;
        const location = new URL(`/share-group/${code}`, 'https://www.tikitikit.kr');
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
            const value = url.searchParams.get(key); if (value) location.searchParams.set(key, value);
        }
        return { code, source: source!, campaign, content, location: location.href };
    } catch { return null; }
}

/** One observation of each stage per tagged collection per browser-tab session (30 minute expiry). */
export function createShareFunnel(raw: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    emit: (event: FunnelEvent, params: Record<string, string>) => void, now = Date.now()) {
    const context = shareFunnelContext(raw);
    if (!context) return null;
    const key = `tikitikit-share-funnel-v1:${context.source}:${context.campaign}:${context.content}`;
    let startedAt = now;
    let done = new Set<string>();
    let details = new Set<string>();
    try {
        const saved = JSON.parse(storage?.getItem(key) || 'null');
        if (saved && now - saved.at >= 0 && now - saved.at < 30 * 60 * 1000) {
            startedAt = saved.at;
            done = new Set(saved.done); details = new Set(saved.details);
        }
    } catch { /* Storage is optional. In-memory deduplication still applies. */ }
    const persist = () => { try { storage?.setItem(key, JSON.stringify({ at: startedAt, done: Array.from(done), details: Array.from(details) })); } catch {} };
    const send = (event: FunnelEvent) => {
        if (done.has(event)) return;
        done.add(event); persist();
        // Pin only these events to the sanitized original collection, not the current filtered URL.
        emit(event, { page_location: context.location });
    };
    const group = SHARE_GROUPS[context.code];
    const outside = (flight: Flight, inventory: Flight[]) => !group.flightIds.includes(flight.id)
        && !inventory.some(item => group.flightIds.includes(item.id) && discoveryIdentity(item) === discoveryIdentity(flight));
    return {
        view: () => send('shared_collection_view'),
        more: () => { send('shared_collection_view'); send('shared_collection_more'); },
        detail: (flight: Flight, inventory: Flight[]) => {
            if (!done.has('shared_collection_more') || !outside(flight, inventory)) return;
            details.add(discoveryIdentity(flight)); persist(); send('shared_outside_detail');
        },
        booking: (flight: Flight, inventory: Flight[]) => {
            if (done.has('shared_outside_detail') && details.has(discoveryIdentity(flight)) && outside(flight, inventory)) send('shared_outside_booking');
        },
    };
}
