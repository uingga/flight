import { randomUUID } from 'node:crypto';
import { dayBefore, kstDay, type DailyHistory, type SourceLatest, type SourceResult } from '../promotion-daily';
import { boundedText, CollectionError } from './promotion-http';
import type { RemoteRequest } from './promotion-remote';

export interface PromotionStore {
    claim(day: string, id: string): Promise<boolean>;
    latest(): Promise<DailyHistory['latest']>;
    save(day: string, id: string, result: SourceResult, latest: SourceLatest): Promise<void>;
    finish(day: string, id: string): Promise<string>;
}
// Standalone Node runner and Next server share this private client. Never import into a client component.
export class SupabasePromotionStore implements PromotionStore {
    async request<T>(resource: string, init: RequestInit = {}): Promise<T> {
        const base = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!base || !key) throw new CollectionError('promotion_storage_missing');
        const url = new URL(base);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new CollectionError('invalid_storage_config');
        const headers = { apikey: key, ...key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }, 'Content-Type': 'application/json', ...init.headers };
        const text = await boundedText(new URL(`/rest/v1/${resource}`, url), { ...init, headers }, fetch, 15_000_000);
        return (text ? JSON.parse(text) : undefined) as T;
    }
    rpc<T>(name: string, body: object) { return this.request<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }); }
    claim(day: string, id: string = randomUUID()) { return this.rpc<boolean>('promotion_claim_run', { p_day: day, p_id: id }); }
    latest() { return this.request<DailyHistory['latest']>('promotion_daily_latest?select=source,payload&order=source&limit=100'); }
    async save(day: string, id: string, result: SourceResult, latest: SourceLatest) {
        const saved = await this.rpc<boolean>('promotion_save_source', { p_day: day, p_id: id, p_source: result.source, p_payload: result, p_latest: latest });
        if (!saved) throw new CollectionError('promotion_save_rejected');
    }
    finish(day: string, id: string) { return this.rpc<string>('promotion_finish_run', { p_day: day, p_id: id }); }
    claimRemote(request: RemoteRequest) { return this.rpc<boolean>('promotion_claim_remote_source', {p_day:request.day,p_id:request.runId,p_source:request.source}); }
    async activeRun(request: RemoteRequest): Promise<boolean> {
        const rows = await this.request<Array<{lease_until:string}>>(`promotion_daily_runs?day=eq.${request.day}&id=eq.${request.runId}&status=eq.running&select=lease_until&limit=1`);
        return rows.length === 1 && Date.parse(rows[0].lease_until) > Date.now();
    }
    async currentThreads(day: string) {
        const rows = await this.request<Array<{payload:SourceResult}>>(`promotion_daily_sources?day=eq.${day}&source=eq.threads&select=payload&limit=1`);
        if (rows.length !== 1 || !Array.isArray(rows[0].payload.posts) || rows[0].payload.posts.length > 30) throw new CollectionError('threads_registry_unavailable');
        return rows[0].payload.posts;
    }
    async history(days = 30): Promise<DailyHistory> {
        const since = dayBefore(kstDay(), days - 1);
        const [runs, sources, latest, dispatches] = await Promise.all([
            this.request<DailyHistory['runs']>(`promotion_daily_runs?select=day,id,status,started_at,finished_at&day=gte.${since}&order=day.desc&limit=90`),
            this.request<DailyHistory['sources']>(`promotion_daily_sources?select=day,source,payload&day=gte.${since}&order=day.desc&limit=270`), this.latest(),
            this.request<NonNullable<DailyHistory['dispatches']>>(`promotion_daily_dispatches?select=day,claimed_at,status&day=gte.${since}&order=day.desc&limit=90`),
        ]);
        // An expired/interrupted run is never presented as complete, even before tomorrow's claim updates the row.
        return { runs: runs.map(run => run.status === 'running' && Date.now() - Date.parse(run.started_at) >= 25 * 60_000 ? { ...run, status: 'incomplete' } : run), sources, latest, dispatches };
    }
}
