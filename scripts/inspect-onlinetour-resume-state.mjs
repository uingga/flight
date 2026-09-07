// Read-only discovery of public list checkpoint surfaces. No browser actions or site requests.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { connectDedicatedChrome } = require('../src/lib/onlinetour-browser-adapter.ts');
const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const match = v => { try { const u = new URL(v); return !u.username && !u.password && u.origin + u.pathname === LIST; } catch { return false; } };
let c, sessionId;
try {
    if (process.argv.length !== 3 || process.argv[2] !== '--read-only') throw Error('read_only_required');
    c = await connectDedicatedChrome();
    const tabs = (await c.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && match(t.url));
    if (tabs.length !== 1) throw Error('exact_list_tab_required');
    sessionId = (await c.send('Target.attachToTarget', { targetId: tabs[0].targetId, flatten: true })).sessionId;
    const frame = (await c.send('Page.getFrameTree', {}, sessionId)).frameTree.frame;
    if (!match(frame.url)) throw Error('target_changed');
    const r = await c.send('Runtime.evaluate', { returnByValue: true, expression: String.raw`(() => {
        const u = new URL(location.href);
        if (u.username || u.password || u.origin + u.pathname !== 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList') return { outside: true };
        const fn = typeof window.getDcairMainList === 'function' ? Function.prototype.toString.call(window.getDcairMainList) : '';
        return { timeOrigin: performance.timeOrigin, ready: document.readyState,
            listCount: document.querySelector('#data_list')?.children.length,
            firstCard: document.querySelector('#data_list')?.firstElementChild?.outerHTML.slice(0,10000),
            more: document.querySelector('#btn_more')?.outerHTML,
            ids: Array.from(document.querySelectorAll('[id]')).map(e => ({ tag:e.tagName,id:e.id })).filter(e => /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(e.id)).slice(0,180),
            paginationFields: Array.from(document.querySelectorAll('input')).filter(e => /^(pageNo|pageSize|totalCount|totalCnt|totalPage|lastPage|totalLastPage)$/i.test(e.id || e.name)).map(e => ({ id:e.id,name:e.name,value:/^\d{1,8}$/.test(e.value) ? e.value : '[redacted]' })),
            paginationSource: fn.split('\n').filter(line => /totalCount|totalLastPage|paging|\.append\(|\.html\(/.test(line) && !/apiKey|token|authorization/i.test(line)).map(line => line.trim().slice(0,500)).slice(0,40)
        };
    })()` }, sessionId);
    if (r.exceptionDetails || r.result?.value?.outside) throw Error('read_failed');
    console.log(JSON.stringify({ readOnly:true,siteRequests:0,targetId:tabs[0].targetId,frameId:frame.id,loaderId:frame.loaderId,state:r.result.value }));
} finally { try { if(sessionId) await c?.send('Target.detachFromTarget',{sessionId}); } finally { await c?.close(); } }
