// The 20:30 KST PC round is independent of the 19:31 GitHub crawl.
// This module only decides whether a source may be dispatched; it never starts a crawl.
const HOSTS = Object.freeze({
    ybtour: 'DESKTOP-OFFICE',
    hanatour: 'DESKTOP-OFFICE',
    onlinetour: 'DESKTOP-OFFICE',
    modetour: 'DESKTOP-1PPFUR3',
    ttang: 'DESKTOP-1PPFUR3',
    lottetour: 'DESKTOP-1PPFUR3',
});

const SOURCES = Object.freeze(Object.keys(HOSTS));
const MINUTE = 60_000;

export function eveningSlotFor(now = Date.now()) {
    if (!Number.isFinite(now)) throw new Error('invalid_now');
    const day = new Date(now + 9 * 60 * MINUTE).toISOString().slice(0, 10);
    return new Date(`${day}T20:30:00+09:00`).toISOString();
}

export function assertEveningSlot(slot, now = Date.now(), windowMinutes = 15) {
    if (typeof slot !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(slot)
        || !Number.isFinite(Date.parse(slot)) || new Date(slot).toISOString() !== slot
        || !Number.isFinite(now) || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 180)
        throw new Error('invalid_evening_slot');
    if (slot !== eveningSlotFor(Date.parse(slot))) throw new Error('not_2030_kst_slot');
    const age = now - Date.parse(slot);
    if (age < 0 || age >= windowMinutes * MINUTE) throw new Error('outside_evening_window');
    return Date.parse(slot);
}

export function assertEveningHost(source, hostname) {
    if (!SOURCES.includes(source)) throw new Error('unknown_evening_source');
    if (HOSTS[source] !== String(hostname).toUpperCase()) throw new Error('evening_host_mismatch');
    return HOSTS[source];
}

const blockedUntil = (value, now) => value != null && (!Number.isFinite(Date.parse(value)) || Date.parse(value) > now);

export function eveningAdmission({ slot, source, now = Date.now(), cache, localCooldown, windowMinutes = 90 } = {}) {
    try { assertEveningSlot(slot, now, windowMinutes); }
    catch { return { allowed: false, reason: 'outside_evening_window' }; }
    if (!SOURCES.includes(source)) return { allowed: false, reason: 'unknown_evening_source' };
    if (!Array.isArray(cache?.flights)) return { allowed: false, reason: 'invalid_cache' };

    // A completed 19:31 crawl is required. A 20:30 GitHub result is neither expected nor fabricated.
    const priorGeneral = Date.parse(eveningSlotFor(Date.parse(slot)))-59*MINUTE;
    const upstream = Date.parse(cache.fullCrawlUpdatedAt);
    if (!Number.isFinite(upstream) || upstream < priorGeneral || upstream > now)
        return { allowed: false, reason: 'daytime_upstream_pending' };

    const circuit = cache.sourceCircuits?.[source];
    const primary = source === 'modetour' ? cache.modetourPrimary
        : source === 'ttang' ? cache.ttangPrimary
        : source === 'onlinetour' ? cache.onlinePrimary : cache.eveningPrimary?.[source];
    if ([circuit?.nextProbeAt, circuit?.localFallback?.nextProbeAt, primary?.nextProbeAt,
        localCooldown?.nextProbeAt].some(value => blockedUntil(value, now)))
        return { allowed: false, reason: 'source_cooldown' };
    if ([primary?.lastAttemptAt, primary?.lastSuccessAt, cache.sourceUpdatedAt?.[source]]
        .some(value => Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.parse(slot)))
        return { allowed: false, reason: 'slot_already_attempted' };
    return { allowed: true, reason: 'evening_due', host: HOSTS[source] };
}

export function eveningPlan(slot, now = Date.now(), cache) {
    assertEveningSlot(slot, now);
    return [
        { host: HOSTS.ybtour, sources: ['ybtour', 'hanatour', 'onlinetour'] },
        { host: HOSTS.modetour, sources: ['modetour', 'ttang', 'lottetour'] },
    ].map(group => ({ ...group, sources: group.sources.filter(source =>
        eveningAdmission({ slot, source, now, cache }).allowed) }));
}
