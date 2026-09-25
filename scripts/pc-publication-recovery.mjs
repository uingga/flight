// Pure recovery planning. Never starts a collector, clears a lock or rewrites observation times.
import {mergeCacheSource} from '../src/lib/merge-cache-source.mjs';
import {mergeCrawlLogHistories} from './merge-crawl-log.mjs';

export function planPcPublicationRecovery({current, currentLogs, saved, savedLogs, expectedAt, now = Date.now()}) {
    const slot = Date.parse(expectedAt);
    if (!Number.isFinite(slot) || slot > now || now - slot > 24 * 60 * 60_000)
        throw Error('recovery slot is invalid or too old');
    if (!Array.isArray(current?.flights) || !Array.isArray(saved?.flights)
        || !Array.isArray(currentLogs?.entries) || !Array.isArray(savedLogs?.entries))
        throw Error('recovery cache/log evidence is missing');
    if (!(Date.parse(current.fullCrawlUpdatedAt) >= slot) || Date.parse(current.fullCrawlUpdatedAt) > now)
        throw Error('matching general publication is still pending');
    const sources = [];
    for (const source of ['modetour', 'ttang']) {
        const stamp = Date.parse(saved.sourceUpdatedAt?.[source]);
        const prior = Date.parse(current.sourceUpdatedAt?.[source]);
        const primary = saved[source === 'modetour' ? 'modetourPrimary' : 'ttangPrimary'];
        if (!Number.isFinite(stamp) || stamp < slot || stamp > now || stamp - slot > 3 * 60 * 60_000
            || primary?.status !== 'success'
            || !saved.flights.some(flight => flight.source === source)
            || saved.sourceCircuits?.[source]) throw Error(`unverified saved source: ${source}`);
        const log = savedLogs.entries.find(entry => Date.parse(entry.timestamp) >= stamp
            && Date.parse(entry.timestamp) <= now && entry.sites?.[source]?.scraped > 0
            && !entry.sites[source].preserved && !entry.sites[source].skipped);
        if (!log) throw Error(`successful collection log missing: ${source}`);
        if (Number.isFinite(prior) && prior >= stamp) continue;
        // Never use an older successful result to clear a subsequently recorded restriction.
        if (current.sourceCircuits?.[source]) throw Error(`current source protection requires review: ${source}`);
        sources.push(source);
    }
    const cache = structuredClone(current);
    for (const source of sources) mergeCacheSource(cache, structuredClone(saved), source);
    const logs = sources.length ? mergeCrawlLogHistories(currentLogs, savedLogs, sources, now).history : currentLogs;
    return {action: sources.length ? 'publish' : 'already_current', sources, cache, logs};
}
