// One-time offline migration from committed observations. No live requests.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {recordRecommendationNews} from './lib/recommendation-news';
import {rememberModetourOffers} from '../src/lib/modetour-offer-history.mjs';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32e6,windowsHide:true});
const commits=git('log','--since=2026-09-10T00:00:00+09:00','--reverse','--format=%H','HEAD','--','data/all-flights-cache.json').trim().split('\n');
let history:any={},latest=0;const used:string[]=[];
for(const sha of commits){const cache=JSON.parse(git('show',`${sha}:data/all-flights-cache.json`));
 const at=cache.sourceUpdatedAt?.modetour;if(!at||Date.parse(at)<=latest)continue;
 const flights=cache.flights.filter((f:any)=>f.source==='modetour');
 history=rememberModetourOffers(history,recordRecommendationNews([],flights,at,history),at);latest=Date.parse(at);used.push(sha);
}
history=rememberModetourOffers(history,[],'2026-09-18T03:00:00Z');
fs.writeFileSync('src/lib/modetour-history-bootstrap.json',JSON.stringify(history,null,2)+'\n');
fs.mkdirSync('output/history-verification',{recursive:true});
fs.writeFileSync('output/history-verification/bootstrap-provenance.json',JSON.stringify({createdAt:new Date().toISOString(),from:'2026-09-10',through:new Date(latest).toISOString(),commits:used,offers:Object.keys(history).length},null,2));
console.log({observations:used.length,offers:Object.keys(history).length});
