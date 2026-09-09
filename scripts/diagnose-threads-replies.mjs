import { pathToFileURL } from 'node:url';

const BASE = 'https://graph.threads.net/v1.0';
const FIELDS = 'id,text,link_attachment_url,is_reply_owned_by_me,root_post,replied_to';
export function safeFailure(status, body) {
    const code = Number.isInteger(body?.error?.code) ? body.error.code : undefined;
    const subcode = Number.isInteger(body?.error?.error_subcode) ? body.error.error_subcode : undefined;
    const message = typeof body?.error?.message === 'string' ? body.error.message : '';
    const kind = [190,102].includes(code) ? 'token-invalid'
        : [10,200].includes(code) ? 'permission-denied'
        : status === 429 || [4,17,32,613].includes(code) ? 'rate-limited'
        : code === 100 && /nonexisting field|non.?existing field|unknown field/i.test(message) ? 'unsupported-field'
        : code === 100 && /unsupported get request/i.test(message) ? 'unsupported-request'
        : code === 100 ? 'invalid-request'
        : body === null ? 'non-json-response' : 'request-failed';
    return { status, ...(code !== undefined ? {code} : {}), ...(subcode !== undefined ? {subcode} : {}), kind };
}

/** Read-only, bounded diagnosis. Never print Graph messages, URLs, post text, cursors or tokens. */
export async function diagnoseReplies({ token, fetcher = fetch, report = value => console.log(JSON.stringify(value)) }) {
    if (!token?.trim()) throw new Error('THREADS_ACCESS_TOKEN must be supplied in the process environment.');
    let requests = 0;
    const request = async (path, params) => {
        if (++requests > 6) throw new Error('Diagnostic request limit exceeded');
        const url = new URL(`${BASE}/${path}`);
        for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
        url.searchParams.set('access_token',token.trim());
        let response;
        try { response = await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(15000)}); }
        catch { const error={status:0,kind:'network-or-timeout'};report({endpoint:path,...error});return {error}; }
        let body;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok || body?.error || body === null) {
            const error=safeFailure(response.status,body);report({endpoint:path,...error});return {error};
        }
        if (!Array.isArray(body.data)) {
            const error={status:response.status,kind:'malformed-response'};report({endpoint:path,...error});return {error};
        }
        return {body};
    };
    const listing = await request('me/threads',{fields:'id,timestamp',limit:'30'});
    if (listing.error) return {complete:false,requests};
    const times=listing.body.data.map(post=>Date.parse(post.timestamp)).filter(Number.isFinite);
    const since=times.length?String(Math.floor(Math.min(...times)/1000)):undefined;
    report({endpoint:'me/threads',postCount:listing.body.data.length,since:since||null});
    const posts = new Set(listing.body.data.map(post=>post.id));
    let after;const seen=new Set();const replies=[];
    for (let page=1;page<=3;page++) {
        const result=await request('me/replies',{fields:FIELDS,limit:'50',...(since?{since}:{}),...(after?{after}:{})});
        if(result.error) {
            // Compare only an API schema/request failure. Never retry rate, auth or network failures.
            if(page===1 && ['unsupported-field','unsupported-request','invalid-request'].includes(result.error.kind)) {
                const minimal=await request('me/replies',{fields:'id',limit:'1'});
                report({probe:'minimal-reply-fields',succeeded:!minimal.error});
            }
            return {complete:false,requests};
        }
        replies.push(...result.body.data);
        report({endpoint:'me/replies',page,count:result.body.data.length,hasNext:Boolean(result.body.paging?.next),hasCursor:Boolean(result.body.paging?.cursors?.after)});
        if(!result.body.paging?.next) {
            const own=replies.filter(reply=>reply.is_reply_owned_by_me===true);
            report({complete:true,total:replies.length,owned:own.length,matchedRoots:own.filter(reply=>posts.has(reply.root_post?.id||reply.replied_to?.id)).length});
            return {complete:true,requests};
        }
        after=result.body.paging?.cursors?.after;
        if(!after || seen.has(after))break;
        seen.add(after);
    }
    report({complete:false,kind:'pagination-incomplete'});
    return {complete:false,requests};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
    diagnoseReplies({token:process.env.THREADS_ACCESS_TOKEN}).then(result=>{if(!result.complete)process.exitCode=1;}).catch(()=>{
        console.error('Threads reply diagnostic could not run. Supply THREADS_ACCESS_TOKEN through an approved environment. No credentials were printed.');process.exitCode=1;
    });
}
