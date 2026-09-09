import type { AcquisitionData, AcquisitionSource } from './acquisition';

/** Presentation only: use GA's source totals and never add unique users together. */
export function acquisitionRows(data: AcquisitionData | undefined, category = '전체'): AcquisitionSource[] {
    if (!data?.available) return [];
    const entries = category === '전체' && data.sourceRows
        ? data.sourceRows
        : data.groups.filter(group => category === '전체' || group.label === category).flatMap(group => group.sources);
    const rows = new Map<string, AcquisitionSource>();
    for (const entry of entries) {
        const previous = rows.get(entry.source);
        rows.set(entry.source, previous
            ? { ...previous, sessions: previous.sessions + entry.sessions, users: null }
            : { ...entry });
    }
    return Array.from(rows.values()).sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source));
}
