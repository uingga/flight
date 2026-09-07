import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyFlightOrder, parsePlacements, type FlightPlacement, type ManualFlightOrder } from '../manual-flight-order';
import { supabaseRest } from './supabase-rest';

export class FlightOrderConflict extends Error {}
export function flightOrderStorageMode(): 'preview' | 'supabase' | 'disabled' {
    if (process.env.FLIGHT_ORDER_PREVIEW_DIR) {
        if (process.env.VERCEL) throw new Error('Local flight order preview is forbidden on Vercel');
        return 'preview';
    }
    return process.env.FLIGHT_ORDER_ENABLED === '1' ? 'supabase' : 'disabled';
}
function previewPath() {
    const directory = path.resolve(process.env.FLIGHT_ORDER_PREVIEW_DIR!);
    return path.join(directory, 'flight-order.json');
}
function decode(row: { revision: number; placements: unknown; updated_at?: string | null }): ManualFlightOrder {
    if (!Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('Invalid flight order revision');
    return { revision: row.revision, placements: parsePlacements(row.placements), updatedAt: row.updated_at || null };
}
export async function readFlightOrder(): Promise<ManualFlightOrder> {
    const mode = flightOrderStorageMode();
    if (mode === 'disabled') return emptyFlightOrder();
    if (mode === 'preview') {
        const file = previewPath();
        if (!fs.existsSync(file)) return emptyFlightOrder();
        return decode(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    const rows = await supabaseRest<Array<{ revision: number; placements: unknown; updated_at: string }>>('flight_display_order?id=eq.main&select=revision,placements,updated_at');
    if (rows.length !== 1) throw new Error('Flight order storage is not initialized');
    return decode(rows[0]);
}
export async function saveFlightOrder(placements: FlightPlacement[], expectedRevision: number): Promise<ManualFlightOrder> {
    const normalized = parsePlacements(placements);
    const mode = flightOrderStorageMode();
    if (mode === 'disabled') throw new Error('Flight order storage is not enabled');
    if (mode === 'preview') {
        const file = previewPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const lock = file + '.lock';
        try { fs.mkdirSync(lock); } catch { throw new FlightOrderConflict(); }
        try {
            const previous = await readFlightOrder();
            if (previous.revision !== expectedRevision) throw new FlightOrderConflict();
            const row = { revision: expectedRevision + 1, placements: normalized, updated_at: new Date().toISOString() };
            const temporary = file + '.' + randomUUID();
            fs.writeFileSync(temporary, JSON.stringify(row), { flag: 'wx' });
            fs.renameSync(temporary, file);
            return decode(row);
        } finally { fs.rmdirSync(lock); }
    }
    const rows = await supabaseRest<Array<{ revision: number; placements: unknown; updated_at: string }>>('rpc/save_flight_display_order', {
        method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision, new_placements: normalized }),
    });
    if (!rows.length) throw new FlightOrderConflict();
    return decode(rows[0]);
}
