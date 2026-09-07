// Existing public list only. No cookies, storage, account identities, navigation or requests.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { connectDedicatedChrome } = require('../src/lib/onlinetour-browser-adapter.ts');
const { createStagingRun, validatePilotResponse } = require('../src/lib/onlinetour-browser-collector.ts');
const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
let client, sessionId;
try {
    if (process.argv[2] !== '--read-only' || (process.argv.length !== 3
        && !(process.argv.length === 4 && process.argv[3] === '--save-evidence'))) throw Error('read_only_required');
    client = await connectDedicatedChrome();
    const tabs = (await client.send('Target.getTargets')).targetInfos.filter(t => {
        try { const u = new URL(t.url); return t.type === 'page' && !u.username && !u.password && u.origin + u.pathname === LIST; } catch { return false; }
    });
    if (tabs.length !== 1) throw Error('exact_list_tab_required');
    sessionId = (await client.send('Target.attachToTarget', { targetId: tabs[0].targetId, flatten: true })).sessionId;
    const value = await client.send('Runtime.evaluate', { returnByValue:true, expression: String.raw`(() => {
        if (location.origin + location.pathname !== 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList') return {outside:true};
        const visible = e => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
        const links = Array.from(document.querySelectorAll('a,button')).filter(visible).map(e => e.innerText?.trim());
        return { loginLinkVisible:links.includes('로그인'), logoutLinkVisible:links.includes('로그아웃'),
            cards:document.querySelector('#data_list')?.children.length || 0,
            cardText:Array.from(document.querySelector('#data_list')?.children || []).slice(0,20).map(e=>e.innerText?.slice(0,1200)),
            embeddedRows:(() => {
                const script=Array.from(document.scripts).find(s=>!s.src && /var dCairAllListStr\s*=/.test(s.textContent || ''));
                const hit=/var dCairAllListStr\s*=\s*'([^\n]*?)';/.exec(script?.textContent || '');
                if(!hit || hit[1].length>2000000)return null;
                let rows;try {rows=JSON.parse(hit[1]);}catch{return null;}
                if(!Array.isArray(rows) || rows.length>2000)return null;
                const cards=Array.from(document.querySelector('#data_list')?.children || []);
                if(cards.length!==20)return null;
                return cards.map(card=>{
                    const control=Array.from(card.querySelectorAll('[onclick]')).find(e=>/^go_reserve\('/.test(e.getAttribute('onclick') || ''));
                    const id=/^go_reserve\('([0-9]+)'\)/.exec(control?.getAttribute('onclick') || '')?.[1];
                    const found=rows.filter(r=>r.event_code===id);return found.length===1?found[0]:null;
                });
            })(),
            cardData:Array.from(document.querySelector('#data_list')?.children || []).slice(0,3).map(e=>({
                attributes:Array.from(e.attributes).filter(a=>/^(data-|id|class)/.test(a.name)).map(a=>[a.name,a.value.slice(0,300)]),
                controls:Array.from(e.querySelectorAll('[onclick],input')).slice(0,15).map(c=>({tag:c.tagName,name:c.getAttribute('name'),
                    value:c.getAttribute('value')?.slice(0,300),onclick:c.getAttribute('onclick')?.slice(0,500)}))})),
            statusScripts:Array.from(document.scripts).filter(s=>!s.src && /event_status_code/.test(s.textContent || '')).map(s=>({
                prefix:s.textContent.slice(0,450),lines:s.textContent.split('\n').filter(l=>l.length<1500 && /event_status_code|예약가능|예약마감|data_list|JSON.parse/.test(l)).slice(0,35)
            })),
            listScriptMatches:Array.from(document.scripts).filter(s=>!s.src).flatMap(s=>{
                const text=s.textContent || '',matches=[];
                for(const hit of text.matchAll(/event_status_code|adult_fee_price|data\.list/g))
                    matches.push(text.slice(Math.max(0,hit.index-180),hit.index+250));
                return matches.slice(0,20);
            }).slice(0,2),
            restricted:/captcha|access denied|request blocked|접근이?\s*제한/i.test(document.body?.innerText || ''),
            cities:Array.from(document.querySelectorAll('input[name=city]')).map(e => {
                const hit=/goSelectedCity\('([A-Z]{3})','(\d{8})'\)/.exec(e.getAttribute('onclick') || '');
                return {code:hit?.[1],firstDepartureDate:hit?.[2],inputVisible:visible(e),disabled:e.disabled,
                    labels:Array.from(e.labels || []).map(l => ({visible:visible(l),text:l.innerText?.trim().slice(0,50)}))};
            }) };
    })()` }, sessionId);
    if(value.exceptionDetails || value.result?.value?.outside) throw Error('inspection_failed');
    const state=value.result.value;
    if(process.argv[3]==='--save-evidence') {
        if(state.restricted || !Array.isArray(state.embeddedRows) || state.embeddedRows.length!==20 || state.embeddedRows.some(r=>!r))throw Error('embedded_evidence_unavailable');
        const validation=validatePilotResponse('e('+JSON.stringify({status:200,data:{list:state.embeddedRows}})+');','e');
        const run=createStagingRun(process.cwd());
        const summary={readOnly:true,siteRequests:0,provenance:'current_public_inline_document_matched_by_visible_card_id',
            originalApiResponse:false,productionReady:false,capturedAt:new Date().toISOString(),runId:run.runId,
            cardText:state.cardText,status:validation.status,issues:validation.issues};
        run.write('raw-products.json',state.embeddedRows);run.write('flights.json',validation.flights);run.write('summary.json',summary);
        console.log(JSON.stringify({...summary,cardText:undefined,rawCount:state.embeddedRows.length,mappedCount:validation.flights.length,
            statuses:state.embeddedRows.map(r=>r.event_status_code)}));
    } else console.log(JSON.stringify({readOnly:true,siteRequests:0,dedicatedOwnerVerified:true,state:{...state,embeddedRows:undefined}}));
} finally { try {if(sessionId) await client?.send('Target.detachFromTarget',{sessionId});} finally {await client?.close();} }
