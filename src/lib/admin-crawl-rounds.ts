import { recentSlotTimes } from './admin-source-slots';

type RoundStat = { total: number; skipped?: boolean; skipReason?: string };
type RoundEntry = { timestamp: string; sites: Record<string, RoundStat>; alerts: string[] };

/** Read-only presentation model: raw GitHub/PC sessions remain separate in storage. */
export function buildAdminCrawlRounds<T extends RoundEntry>(entries: readonly T[], sources: readonly string[]) {
    const rounds = new Map<number, {
        slotAt: string;
        timestamp: string;
        sites: Record<string, T['sites'][string]>;
        sourceEntries: Record<string, T>;
        entries: T[];
        alerts: string[];
    }>();
    const sorted = entries.filter(entry => Number.isFinite(Date.parse(entry.timestamp)))
        .slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    for (const entry of sorted) {
        const relevant = sources.filter(source => entry.sites[source]
            && entry.sites[source].skipReason !== 'not-requested');
        if (!relevant.length) continue;
        const slot = recentSlotTimes(Date.parse(entry.timestamp), 1)[0];
        let round = rounds.get(slot);
        if (!round) {
            round = { slotAt: new Date(slot).toISOString(), timestamp: entry.timestamp,
                sites: {}, sourceEntries: {}, entries: [], alerts: [] };
            rounds.set(slot, round);
        }
        round.timestamp = entry.timestamp;
        round.entries.push(entry);
        for (const source of relevant) {
            const stat = entry.sites[source] as T['sites'][string];
            // A carry/skip placeholder must not erase a real result. A later real failure can.
            if (stat.skipped && round.sites[source] && !round.sites[source].skipped) continue;
            round.sites[source] = stat;
            round.sourceEntries[source] = entry;
        }
        // Historical warnings are explicitly attributed, not presented as the final source error.
        for (const alert of entry.alerts) {
            const at = new Date(Date.parse(entry.timestamp) + 9 * 60 * 60_000).toISOString().slice(11, 16);
            round.alerts.push(`${at} 기록 · ${alert}`);
        }
    }
    return Array.from(rounds.values());
}
