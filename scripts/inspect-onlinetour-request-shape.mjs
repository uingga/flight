// Read already loaded public list state only. No navigation, reload, fetch or function invocation.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { connectDedicatedChrome } = require('../src/lib/onlinetour-browser-adapter.ts');
const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const matches = raw => { try { const u = new URL(raw); return !u.username && !u.password && u.origin + u.pathname === LIST; } catch { return false; } };
let client, sessionId;
try {
    if (process.argv.length !== 3 || process.argv[2] !== '--read-only') throw Error('read_only_flag_required');
    client = await connectDedicatedChrome();
    const targets = (await client.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && matches(t.url));
    if (targets.length !== 1) throw Error('require_exactly_one_existing_list_tab');
    sessionId = (await client.send('Target.attachToTarget', { targetId: targets[0].targetId, flatten: true })).sessionId;
    if (!sessionId) throw Error('attachment_failed');
    const tree = await client.send('Page.getFrameTree', {}, sessionId);
    if (!matches(tree.frameTree?.frame?.url)) throw Error('target_left_list');
    const result = await client.send('Runtime.evaluate', { returnByValue: true, expression: String.raw`(() => {
        const u = new URL(location.href);
        if (u.username || u.password || u.origin + u.pathname !== 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList') return { outside: true };
        const keys = ['areaCode','transportStartCity','transportEndCity','eventStartDate','eventStartMonth','order','pageNo','pageSize','pageYn','depPyunStr','statusStr'];
        const wanted = { areaCode:'AS', transportStartCity:'ICN', eventStartDate:'', order:'LP', pageNo:'1', pageSize:'20', pageYn:'Y' };
        const requests = performance.getEntriesByType('resource').filter(e => {
            try { const a = new URL(e.name); return !a.username && !a.password && a.origin + a.pathname === 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list'; } catch { return false; }
        }).slice(-3).map(e => {
            const q = new URL(e.name).searchParams;
            return { keys: Array.from(q.keys()).map(k => /^[A-Za-z_]{1,40}$/.test(k) ? k : '[redacted]'),
                scopeShape: Object.fromEntries(['areaCode','transportStartCity','transportEndCity','eventStartMonth'].map(k=>{
                    const v=q.get(k);return [k,v===null?null:/^(?:[A-Z]{0,3}|\d{0,8})$/.test(v)?v:'[redacted]'];
                })),
                callbackValid:/^[A-Za-z_$][\w$]{0,127}$/.test(q.get('callback') || ''),
                apiKeyShape: { occurrences: q.getAll('apiKey').length, length: (q.get('apiKey') || '').length,
                    empty: q.get('apiKey') === '', hasWhitespace: /\s/.test(q.get('apiKey') || ''),
                    printableAsciiOnly: /^[\x21-\x7e]*$/.test(q.get('apiKey') || '') },
                mismatch: Object.entries(wanted).filter(([k,v]) => q.get(k) !== v).map(([k,v]) => ({ key:k, expected:v,
                    actual: q.get(k) === null ? null : /^(?:[A-Z]{1,3}|\d{0,8})$/.test(q.get(k)) ? q.get(k) : '[redacted]' })),
                duplicates: Array.from(new Set(q.keys())).filter(k => q.getAll(k).length > 1).map(k => keys.includes(k) ? k : '[other]') };
        });
        const source = typeof window.getDcairMainList === 'function' ? Function.prototype.toString.call(window.getDcairMainList) : '';
        const assignments = [];
        for (const key of keys) {
            const re = new RegExp('[\x22\x27]?' + key + '[\x22\x27]?\\s*:\\s*([^,\\n;]{1,80})', 'g');
            for (const m of source.matchAll(re)) {
                const expr = m[1].trim();
                assignments.push({ key, expression: /^(?:[\x22\x27](?:[A-Z]{0,3}|\d{0,8})[\x22\x27]|\d{1,3}|TabGubun|airSect|SelectedCityCd|eventStartMonth|eventStartDate|nowYear|nowMonth|order|pageNo|pageSize|depPyunStr|statusStr)$/.test(expr) ? expr : '[expression]' });
            }
        }
        return { ready:document.readyState, requests, assignments,
            monthControls:Array.from(document.querySelectorAll('[onclick]')).filter(e=>/^(?:nextMonth|prevMonth)\(/.test(e.getAttribute('onclick') || '')).map(e=>({tag:e.tagName,handler:e.getAttribute('onclick'),visible:e.getClientRects().length>0,disabled:!!e.disabled})),
            monthFunctions:['nextMonth','prevMonth'].map(name=>({name,source:typeof window[name]==='function'?Function.prototype.toString.call(window[name]).slice(0,6000):null})),
            listText:document.querySelector('#data_list')?.innerText?.slice(0,1000),
            listChildren:document.querySelector('#data_list')?.children.length,
            moreVisible:(()=>{const e=document.querySelector('#btn_more');return !!e && !e.hidden && e.getClientRects().length>0 && getComputedStyle(e).display!=='none' && getComputedStyle(e).visibility!=='hidden';})(),
            visibleLoading:Array.from(document.querySelectorAll('[class*="loading"], [id*="loading"]')).filter(e=>!e.hidden && e.getClientRects().length>0 && getComputedStyle(e).display!=='none' && getComputedStyle(e).visibility!=='hidden').map(e=>({id:e.id,className:e.className})),
            cityControls:Array.from(document.querySelectorAll('input[name=city]')).map(e=>({
                handler:/^goSelectedCity\('[A-Z]{3}','\d{8}'\);?$/.test(e.getAttribute('onclick') || '')?e.getAttribute('onclick'):'[other]',
                label:Array.from(e.labels || []).map(l=>l.innerText?.trim().slice(0,50))})),
            embeddedList:(()=>{const s=Array.from(document.scripts).find(e=>!e.src && /var dCairAllListStr\s*=/.test(e.textContent || ''));
                const hit=/var dCairAllListStr\s*=\s*'([^\n]*?)';/.exec(s?.textContent || '');
                if(!hit || hit[1].length>2000000)return {found:false};
                try{const rows=JSON.parse(hit[1]);return {found:true,isArray:Array.isArray(rows),count:Array.isArray(rows)?rows.length:null};}
                catch{return {found:true,invalid:true};}})(),
            pageNo: document.querySelector('#pageNo')?.value, pageSize:document.querySelector('#pageSize')?.value,
            restricted: /captcha|access denied|request blocked|비정상(?:적인)?\s*접근|접근이?\s*제한/i.test(document.body?.innerText || '') };
    })()` }, sessionId);
    if (result.exceptionDetails || !result.result?.value || result.result.value.outside) throw Error('read_failed');
    console.log(JSON.stringify({ readOnly: true, actions: 0, siteRequests: 0, state: result.result.value }));
} catch (error) {
    console.error(JSON.stringify({ readOnly: true, reason: /^[a-z_]{1,80}$/.test(error?.message || '') ? error.message : 'inspection_failed' }));
    process.exitCode = 1;
} finally {
    try { if (sessionId) await client.send('Target.detachFromTarget', { sessionId }); }
    finally { await client?.close(); }
}
