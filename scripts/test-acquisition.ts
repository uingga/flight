import assert from 'node:assert/strict';
import { classifyAcquisition, acquisitionSourceLabel } from '../src/lib/acquisition';
import { loadAcquisition } from '../src/lib/server/acquisition-report';
import type { ReportRow, ReportRequest } from '../src/lib/ga4';
for(const [channel,source,medium,expected] of [
 ['Unassigned','m.keep.naver.com','referral','기타 외부 링크'],
 ['Organic Search','m.keep.naver.com','organic','기타 외부 링크'],
 ['Unassigned','m.search.naver.com','referral','검색'],
 ['Referral','te31.com','referral','커뮤니티'],
 ['Unassigned','te31','community','커뮤니티'],
 ['Unassigned','user_share','referral','사용자 공유'],
 ['Unassigned','blog.naver.com','referral','블로그'],
 ['Unassigned','notnaver.example','(none)','유형 미분류'],
 ['Unassigned','(not set)','(not set)','출처 확인 불가'],
 ['Unassigned','(direct)','(none)','직접 방문'],
 ['Unassigned','google','cpc','검색 광고'],
 ['Unassigned','chatgpt.com','referral','AI 서비스'],
 ['Unassigned','threads.com','referral','SNS'],
]) assert.equal(classifyAcquisition(channel,source,medium),expected,source);
assert.equal(acquisitionSourceLabel('hanatour'), 'hanatour (출처 확인 필요)');
assert.equal(acquisitionSourceLabel('hanatour.com'), 'hanatour.com');
assert.equal(classifyAcquisition('Unassigned','hanatour','(not set)'), '유형 미분류');
const row=(channel:string,source:string,medium:string,sessions:number,users:number):ReportRow=>({dimensionValues:[channel,source,medium].map(value=>({value})),metricValues:[sessions,users].map(v=>({value:String(v)}))});
const raw=[row('Organic Search','naver','organic',4,3),row('Organic Search','google','organic',1,1),row('Unassigned','user_share','referral',2,2),row('Referral','m.keep.naver.com','referral',1,1)];
const config={propertyId:'test',clientEmail:'test',privateKey:'test'};
(async()=>{
const calls:ReportRequest[]=[];
const data=await loadAcquisition(config,[{startDate:'today',endDate:'today'}],async(_,req)=>{
 calls.push(req);
 if(req.dimensions?.length===3) return req.offset===0 ? {rows:raw.slice(0,2),rowCount:4}:{rows:raw.slice(2),rowCount:4};
 return {rows:[{dimensionValues:[{value:'naver'}],metricValues:[{value:'4'},{value:'3'}]},{dimensionValues:[{value:'google'}],metricValues:[{value:'1'},{value:'1'}]}],totals:[{metricValues:[{value:'5'},{value:'3'}]}]};
});
assert.equal(data.available,true);const search=data.groups.find(g=>g.label==='검색')!;
assert.equal(search.users,3);assert.equal(search.sources.reduce((s,r)=>s+(r.users||0),0),4);assert.equal(search.sessions,5);
assert.equal(data.groups.reduce((s,g)=>s+g.sessions,0),8);
assert.equal(calls.length,3);assert.match(JSON.stringify(calls[2].dimensionFilter),/sessionMedium/);
const failed=await loadAcquisition(config,[],async(_,req)=>{if(req.dimensions?.length===1)throw Error('failed');return {rows:raw}});
assert.equal(failed.groups.find(g=>g.label==='검색')!.users,null);
const mismatch=await loadAcquisition(config,[],async(_,req)=>req.dimensions?.length===3?{rows:raw}:{rows:[],totals:[{metricValues:[{value:'6'},{value:'3'}]}]});
assert.equal(mismatch.groups.find(g=>g.label==='검색')!.users,null);
for(const metadata of [{subjectToThresholding:true},{dataLossFromOtherRow:true},{samplingMetadatas:[{}]}])assert.equal((await loadAcquisition(config,[],async()=>({rows:raw,metadata}))).available,false);
assert.equal((await loadAcquisition(config,[],async()=>({rowCount:5,rows:[]}))).available,false);
assert.deepEqual((await loadAcquisition(config,[],async()=>({rows:[]}))).groups,[]);
const cross=await loadAcquisition(config,[],async(_,req)=>req.dimensions?.length===3?{rows:[row('Organic Search','google','organic',4,2),row('Paid Search','google','cpc',2,2)]}:{rows:[{dimensionValues:[{value:'google'}],metricValues:[{value:'6'},{value:'3'}]}]});
assert.equal(cross.sourceRows?.length,1);assert.equal(cross.sourceRows?.[0].sessions,6);assert.equal(cross.sourceRows?.[0].users,3);
assert.deepEqual(cross.sourceRows?.[0].categories,['검색','검색 광고']);
console.log('PASS: source classification, exact filters, pagination, deduplicated users, missing/limited reports, snapshot mismatch and empty state');
})().catch(e=>{console.error(e);process.exitCode=1});
