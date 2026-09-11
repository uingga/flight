import { TE31_POSTS } from '../te31-posts';
import { observedMetrics, type SourceResult } from '../promotion-daily';
import { boundedBytes, CollectionError, safeReason } from './promotion-http';

// The parent-provided 2026-09-11 response declares EUC-KR in HTML, not the HTTP header.
// WHATWG euc-kr decoding covers Windows-949 extensions. Never apply this fallback to JSON APIs.
export function decodeTe31Listing(bytes: Uint8Array, contentType = 'text/html'): string {
    if (bytes.byteLength > 2_000_000 || !/^text\/html(?:\s*;|\s*$)/i.test(contentType)) throw new CollectionError('invalid_listing_content_type');
    const head = Buffer.from(bytes.subarray(0, 8192)).toString('latin1').replace(/<!--[\s\S]*?-->/g, '');
    const declared = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
    const meta = Array.from(head.matchAll(/<meta\b[^>]*>/gi)).map(match => match[0].match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]).find(Boolean);
    const normalize = (value: string) => /^(euc-kr|cp949|windows-949)$/i.test(value) ? 'euc-kr' : /^utf-?8$/i.test(value) ? 'utf-8' : null;
    const encoding = normalize(declared || meta || 'utf-8');
    if (!encoding || (declared && meta && normalize(meta) !== encoding)) throw new CollectionError('unsupported_listing_charset');
    try { return new TextDecoder(encoding, {fatal:true}).decode(bytes); }
    catch { throw new CollectionError('invalid_listing_encoding'); }
}

export function te31ListingUrl(page: number): URL {
    if (!Number.isInteger(page) || page < 1 || page > 3) throw new CollectionError('page_not_allowed');
    return new URL(`https://te31.com/rgr/zboard.php?id=freead&page=${page}`);
}
export function assertTe31ListingUrl(url: URL): void {
    const pairs = Array.from(url.searchParams);
    if (url.protocol !== 'https:' || url.hostname !== 'te31.com' || url.port || url.username || url.password || url.hash
        || url.pathname !== '/rgr/zboard.php' || pairs.length !== 2
        || url.searchParams.getAll('id').length !== 1 || url.searchParams.get('id') !== 'freead'
        || url.searchParams.getAll('page').length !== 1 || !/^[1-3]$/.test(url.searchParams.get('page') || '')) {
        throw new CollectionError('url_not_allowed');
    }
}
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').trim().replace(/\s+/g, ' ');
const count = (html: string): number | null => {
    const text = plain(html);
    const value = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text) ? Number(text.replace(/,/g, '')) : NaN;
    return Number.isSafeInteger(value) ? value : null;
};
// Header and registered row structure verified against the parent-supplied page-1 evidence.
export function parseTe31Listing(html: string, registeredIds: readonly number[]) {
    if (/captcha|cf-chl-|자동\s*입력\s*방지|접근이?\s*(?:차단|제한)|access denied/i.test(html)) throw new CollectionError('access_challenge', true);
    const found = new Map<number, Record<string, number | null>>();
    let recognized = false;
    // Disabled checkbox/header cells must never participate in column alignment.
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const table of html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || []) {
        let columns: Record<string, number> = {};
        let expectedCells = 0; let knownSchema = false;
        for (const row of table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
            const cells = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(match => match[1]);
            const labels: Record<string, string> = { '조회': 'views', '조회수': 'views', '댓글': 'comments', '추천': 'recommendations', '추천수': 'recommendations' };
            const header = Object.fromEntries(cells.flatMap((cell, index) => labels[plain(cell)] ? [[labels[plain(cell)], index]] : []));
            if ('views' in header) {
                columns = header; expectedCells = cells.length; recognized = true;
                knownSchema = /^<table\b[^>]*\bid=["']revolution_main_table["']/i.test(table)
                    && JSON.stringify(cells.map(plain)) === JSON.stringify(['','분류','댓글','제목','이름','','조회','','날짜']);
                continue;
            }
            if (!('views' in columns)) continue;
            const ids = new Set<number>();
            for (const match of Array.from(row.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi))) {
                try {
                    const url = new URL(match[1].replace(/&amp;/gi, '&'), 'https://te31.com/rgr/');
                    if (url.origin !== 'https://te31.com' || url.pathname !== '/rgr/view.php'
                        || url.searchParams.getAll('id').length !== 1 || url.searchParams.get('id') !== 'freead'
                        || url.searchParams.getAll('no').length !== 1) continue;
                    const id = url.searchParams.get('no') || '';
                    if (/^[1-9]\d*$/.test(id) && registeredIds.includes(Number(id))) ids.add(Number(id));
                } catch { /* Not a registered board link. */ }
            }
            if (ids.size !== 1) continue;
            const id = Array.from(ids)[0];
            const cellTags = Array.from(row.matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)).map(match => match[0]);
            const aligned = cells.length === expectedCells;
            const metrics = Object.fromEntries(Object.entries(columns).map(([key, index]) => {
                if (!aligned) return [key, null];
                const value = count(cells[index] || '');
                // Only the observed board schema's present, labelled empty comment cell means zero.
                // Empty views, missing TDs, placeholders and generic tables remain unknown.
                const blankComments = key === 'comments' && knownSchema && /^\s*$/.test(cells[index] || '')
                    && /\btitle=["']최근 댓글 확인["']/.test(cellTags[index] || '')
                    && (cellTags[index] || '').includes(`no=${id}&re=100000`);
                return [key, blankComments ? 0 : value];
            }));
            // Ambiguous duplicates must not silently win.
            if (found.has(id) && JSON.stringify(found.get(id)) !== JSON.stringify(metrics)) throw new CollectionError('conflicting_rows');
            found.set(id, metrics);
        }
    }
    if (!recognized) throw new CollectionError('listing_schema_unverified');
    return found;
}
export async function collectTe31(day: string, options: { verified: boolean; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => string }): Promise<SourceResult> {
    const now = options.now || (() => new Date().toISOString());
    const result: SourceResult = { source: 'te31', outcome: 'unsupported', reason: 'listing_sample_required', observedAt: now(), posts: [] };
    if (!options.verified) return result;
    const found = new Map<number, Record<string, number | null>>();
    try {
        for (let page = 1; page <= 3; page++) {
            if (page > 1) await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(5_000);
            const url = te31ListingUrl(page); assertTe31ListingUrl(url);
            const {bytes,contentType} = await boundedBytes(url, {}, options.fetcher);
            const rows = parseTe31Listing(decodeTe31Listing(bytes, contentType), TE31_POSTS.map(post => post.id));
            const at = now();
            for (const post of TE31_POSTS) {
                const values = rows.get(post.id); if (!values || found.has(post.id)) continue;
                found.set(post.id, values);
                result.posts.push({ id: String(post.id), platform: 'te31', title: post.title,
                    url: `https://te31.com/rgr/view.php?id=freead&no=${post.id}`,
                    trackingContent: post.campaign, metrics: observedMetrics(values, day, at) });
            }
            if (found.size === TE31_POSTS.length) break;
        }
        const complete = result.posts.length === TE31_POSTS.length && result.posts.every(post => 'views' in post.metrics && 'comments' in post.metrics);
        result.outcome = complete ? 'success' : result.posts.some(post => Object.keys(post.metrics).length) ? 'partial' : 'failed';
        result.reason = complete ? 'listing_counts_only' : 'registered_posts_or_counts_missing';
    } catch (error) { result.outcome = result.posts.length ? 'partial' : 'failed'; result.reason = safeReason(error); }
    result.observedAt = now(); return result;
}
