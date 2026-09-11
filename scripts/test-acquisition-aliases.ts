import assert from 'node:assert/strict';
import { loadAcquisition } from '../src/lib/server/acquisition-report';
import { acquisitionSourceKey, acquisitionSourceLabel } from '../src/lib/acquisition';
import type { ReportRow, ReportRequest } from '../src/lib/ga4';
const row=(channel:string,source:string,medium:string,sessions:number,users:number):ReportRow=>({dimensionValues:[channel,source,medium].map(value=>({value})),metricValues:[sessions,users].map(v=>({value:String(v)}))});
const raw=[row('Organic Search','naver','organic',3,2),row('Referral','m.search.naver.com','referral',2,2),row('Referral','blog.naver.com','referral',4,3),row('Organic Social','naver_blog','social',2,2),row('Referral','m.keep.naver.com','referral',1,1),row('Unassigned','hanatour','(not set)',1,1),row('Referral','hanatour.com','referral',1,1)];
const config={propertyId:'test',clientEmail:'test',privateKey:'test'};
async function main(){
 const calls:ReportRequest[]=[];
 const query=async(_:unknown,req:ReportRequest)=>{
  calls.push(req);
  if(req.dimensions?.length===3)return {rows:raw,rowCount:raw.length};
  if(req.dimensions?.length===1)return {rows:[],totals:[]}; // Unverified per-category users stay unknown.
  const filter=JSON.stringify(req.dimensionFilter);
  const blog=filter.includes('blog.naver.com');
  return {rows:[{metricValues:[{value:blog?'6':'4'},{value:blog?'4':'3'}]}],rowCount:1};
 };
 const data=await loadAcquisition(config,[],query);assert.equal(data.available,true);
 const search=data.sourceRows!.filter(s=>s.label==='네이버 검색');assert.equal(search.length,1);
 assert.equal(search[0].sessions,4);assert.equal(search[0].users,3); // GA union, not 3+2 visits or 2+2 people.
 assert.deepEqual(search[0].rawSources,['naver','m.search.naver.com']);
 const blog=data.sourceRows!.filter(s=>s.label==='네이버 블로그');assert.equal(blog.length,1);assert.equal(blog[0].users,4);
 assert.equal(data.groups.find(g=>g.label==='검색')!.sources.length,1);
 assert.equal(data.sourceRows!.find(s=>s.source==='keep.naver.com')!.sessions,1);
 assert.equal(data.sourceRows!.find(s=>s.source==='hanatour')!.sessions,1); // Do not delete historical visits without evidence.
 assert.equal(data.sourceRows!.find(s=>s.source==='hanatour.com')!.label,'hanatour.com');
 for(const req of calls) assert.deepEqual(req.metrics.map(m=>m.name),['sessions','totalUsers']);
 const unions=calls.filter(c=>!c.dimensions);assert.equal(unions.length,2); // Reuse totals across summary/category, no duplicate API calls.
 for(const req of unions){const filters=(req.dimensionFilter as any).orGroup.expressions;assert.equal(filters.length,2);for(const t of filters)assert.deepEqual(t.andGroup.expressions.map((f:any)=>f.filter.fieldName),['sessionDefaultChannelGroup','sessionSource','sessionMedium']);}
 for(const failure of ['throw','partial','invalid'] as const){
  const result=await loadAcquisition(config,[],async(c,r)=>{
   if(r.dimensions)return query(c,r);
   if(failure==='throw')throw Error('No totals');
   if(failure==='partial')return {rows:[],metadata:{subjectToThresholding:true}};
   return {rows:[{metricValues:[{value:'99'},{value:'99'}]}]};
  });assert.equal(result.available,false); // Never fabricate merged counts.
 }
 assert.equal(acquisitionSourceKey('notnaver.example'),'notnaver.example');
 assert.notEqual(acquisitionSourceKey('m.keep.naver.com'),acquisitionSourceKey('m.search.naver.com'));
 assert.equal(acquisitionSourceLabel('(direct)'),'직접 방문');
 console.log('PASS: source aliases, exact GA union counts, retained raw sources, separate Keep/agency domains, shared query, unavailable totals');
}
main().catch(e=>{console.error(e);process.exitCode=1});
