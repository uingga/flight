/**
 * PostgREST bulk inserts require every object in one JSON array to expose the
 * same keys. Database rows loaded with select=* can include default columns
 * (for example created_at) that newly-created rows do not have, so split them
 * into shape-compatible requests before batching.
 */
export function groupRowsByShape(rows: unknown[]): Array<Array<Record<string, unknown>>> {
    const groups = new Map<string, Array<Record<string, unknown>>>();

    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new TypeError('PostgREST rows must be plain objects.');
        }
        const record = row as Record<string, unknown>;
        const signature = Object.keys(record).sort().join('\u001f');
        const group = groups.get(signature) || [];
        group.push(record);
        groups.set(signature, group);
    }

    return [...groups.values()];
}
