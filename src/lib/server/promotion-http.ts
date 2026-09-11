import { createHash, timingSafeEqual } from 'node:crypto';

export function headerAuthorized(headers: Headers, secret: string | undefined): boolean {
    if (!secret) return false;
    const actual = headers.get('authorization') || '';
    const hash = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(hash(actual), hash(`Bearer ${secret}`));
}
export class CollectionError extends Error {
    constructor(public readonly code: string, public readonly blocked = false) { super(code); }
}
export const SOURCE_DEADLINE_MS = 220_000;
export class CollectionDeadline {
    private readonly end: number;
    constructor(durationMs = SOURCE_DEADLINE_MS, private readonly clock = Date.now) { this.end = clock() + durationMs; }
    remaining(): number {
        const remaining = this.end - this.clock();
        if (remaining <= 0) throw new CollectionError('source_deadline');
        return remaining;
    }
    check() { this.remaining(); }
}
export interface BoundedRequestOptions { deadline?: CollectionDeadline; timeoutMs?: number }
// Every caller supplies a fixed endpoint constructed from known identifiers, never a user URL.
export async function boundedBytes(url: URL, init: RequestInit = {}, fetcher: typeof fetch = fetch, maxBytes = 2_000_000, options: BoundedRequestOptions = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
    const remaining = options.deadline?.remaining() ?? Infinity;
    const signal = AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs ?? 15_000, remaining)));
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: 'error', signal, cache: 'no-store' }); }
    catch (error) { options.deadline?.check(); throw error; }
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new CollectionError('redirect_refused');
    if ([401, 403, 429].includes(response.status)) throw new CollectionError(`access_${response.status}`, true);
    if (!response.ok) throw new CollectionError(`http_${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new CollectionError('response_too_large'); }
    const reader = response.body?.getReader();
    if (!reader) throw new CollectionError('empty_response');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            options.deadline?.check();
            const { value, done } = await reader.read(); if (done) break;
            size += value.length;
            if (size > maxBytes) throw new CollectionError('response_too_large');
            chunks.push(value);
        }
    } catch (error) { options.deadline?.check(); throw error; }
    finally { await reader.cancel().catch(() => undefined); }
    return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '' };
}
export async function boundedText(url: URL, init: RequestInit = {}, fetcher: typeof fetch = fetch, maxBytes = 2_000_000, options: BoundedRequestOptions = {}): Promise<string> {
    const { bytes } = await boundedBytes(url, init, fetcher, maxBytes, options);
    // JSON APIs use UTF-8. Legacy HTML decoding is deliberately confined to the TE31 adapter.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export const safeReason = (error: unknown) => error instanceof CollectionError ? error.code : 'request_failed';
