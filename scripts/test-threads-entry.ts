import assert from 'node:assert/strict';
import { loadThreadsEntries } from '../src/lib/server/threads-entry-report';
import { loadAcquisition } from '../src/lib/server/acquisition-report';
import { acquisitionSourceKey, isThreadsSource } from '../src/lib/acquisition';
import type { ReportRequest } from '../src/lib/ga4';
const config = {propertyId:'test',clientEmail:'test',privateKey:'test'};
const dates = [{startDate:'29daysAgo',endDate:'yesterday'}];
const metric = (s:number,u:number) => ({rows:[{metricValues:[{value:String(s)},{value:String(u)}]}],rowCount:1});
async function main() {
 for(const source of ['threads','threads.net','www.threads.com','l.threads.com']) assert.equal(acquisitionSourceKey(source),'threads');
 assert.equal(isThreadsSource('notthreads.com'),false);
 assert.equal(isThreadsSource('threads.com.example.com'),false);
 const calls:ReportRequest[]=[];
 const query=async (_:unknown,r:ReportRequest)=>{
  calls.push(r);
  if(r.dimensions?.length===3) return {rows:[{dimensionValues:['Organic Social','threads','social'].map(value=>({value})),metricValues:[{value:'20'},{value:'12'}]}],rowCount:1};
  const filter=JSON.stringify(r.dimensionFilter);
  assert.ok(filter.includes('sessionSource')); assert.ok(filter.includes('sessionManualAdContent'));
  assert.deepEqual(r.metrics.map(m=>m.name),['sessions','totalUsers']);
  if(filter.includes('notExpression')) return metric(3,3);
  if(filter.includes('link_in_bio')) return metric(5,4);
  return metric(12,10);
 };
 const data=await loadAcquisition(config,dates,query);
 assert.equal(data.available,true);
 assert.equal(data.sourceRows![0].users,12); // Never replace the total with 4+10+3.
 assert.deepEqual(data.sourceRows![0].threadsEntries?.rows.map(r=>r.users),[4,10,3]);
 assert.equal(calls.length,4); // One source report + three serial buckets, reused in SNS.
 assert.deepEqual(data.groups[0].sources[0].threadsEntries,data.sourceRows![0].threadsEntries);
 const empty=await loadThreadsEntries(config,dates,{},async()=>({rows:[],rowCount:0}));
 assert.equal(empty.available,true);assert.deepEqual(empty.rows.map(r=>r.sessions),[0,0,0]);
 for(const report of [{rows:[],metadata:{subjectToThresholding:true}},{rows:[],metadata:{dataLossFromOtherRow:true}},{rows:[{}]},metric(-1,1)]) {
  const result=await loadThreadsEntries(config,dates,{},async()=>report);
  assert.equal(result.available,false);assert.equal(result.rows.length,0);
 }
 const failure=await loadAcquisition(config,dates,async(c,r)=>{if(r.dimensions)return query(c,r);throw Error('429');});
 assert.equal(failure.available,true);assert.equal(failure.sourceRows![0].sessions,20);
 assert.equal(failure.sourceRows![0].threadsEntries?.available,false);
 console.log('PASS: Threads aliases, exact profile/post/unknown filters, GA unique users, reused serial queries, empty and failed reports');
}
main().catch(e=>{console.error(e);process.exitCode=1});
