import { headerAuthorized, CollectionDeadline, CollectionError, safeReason } from './promotion-http';
import { parseRemoteRequest, remoteResultDto, type RemoteRequest } from './promotion-remote';
import { SupabasePromotionStore } from './promotion-store';
import { collectThreads } from './promotion-threads';
import { collectGa4 } from './promotion-ga4';
import type { PromotionPost, SourceResult } from '../promotion-daily';

interface RemoteSourceStore {
    claimRemote(request: RemoteRequest): Promise<boolean>;
    currentThreads(day: string): Promise<PromotionPost[]>;
    activeRun(request: RemoteRequest): Promise<boolean>;
}
export interface SourceHandlerDeps {
    secret?: string; store: RemoteSourceStore;
    collect(request: RemoteRequest, threads: PromotionPost[], deadline: CollectionDeadline): Promise<SourceResult>;
}
export async function handlePromotionSource(request: Request, dependencies?: SourceHandlerDeps): Promise<Response> {
    const deps = dependencies || { secret:process.env.PROMOTION_JOB_SECRET, store:new SupabasePromotionStore(),
        collect: (input: RemoteRequest, threads: PromotionPost[], deadline: CollectionDeadline) => input.source === 'threads'
            ? collectThreads(input.day, process.env.THREADS_ACCESS_TOKEN, fetch, deadline) : collectGa4(input.day, threads, undefined, deadline) };
    const json = (body: object, status = 200) => Response.json(body, { status, headers:{'Cache-Control':'private, no-store'} });
    if (!headerAuthorized(request.headers, deps.secret)) return json({error:'unauthorized'},401);
    if (new URL(request.url).search || request.headers.get('content-type')?.split(';')[0] !== 'application/json'
        || Number(request.headers.get('content-length')) > 512) return json({error:'invalid_remote_request'},400);
    const deadline = new CollectionDeadline();
    let input: RemoteRequest;
    try {
        const reader = request.body?.getReader(); if (!reader) throw new Error();
        let bytes = 0; const chunks: Uint8Array[] = [];
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5_000);
        try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 512) throw new Error(); chunks.push(part.value); } }
        finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); }
        if (timedOut) throw new Error();
        input = parseRemoteRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { return json({error:'invalid_remote_request'},400); }
    try {
        deadline.check();
        if (!await deps.store.claimRemote(input)) return json({error:'remote_claim_rejected'},409);
        const threads = input.source === 'ga4' ? await deps.store.currentThreads(input.day) : [];
        deadline.check();
        const result = remoteResultDto(await deps.collect(input,threads,deadline), input);
        if (!await deps.store.activeRun(input)) return json({error:'remote_run_expired'},409);
        return json({ day:input.day, runId:input.runId, result });
    } catch (error) {
        return json({error:error instanceof CollectionError ? safeReason(error) : 'remote_source_failed'},503);
    }
}
