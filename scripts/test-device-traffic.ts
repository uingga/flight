import assert from 'node:assert/strict';
import { parseDeviceTraffic } from '../src/lib/device-traffic';
import { loadDeviceTraffic } from '../src/lib/server/device-traffic-report';
import type { ReportRequest, ReportRow } from '../src/lib/ga4';
const row=(device:string,sessions:number,users:number):ReportRow=>({dimensionValues:[{value:device}],metricValues:[sessions,users].map(value=>({value:String(value)}))});
async function main(){
 const report=parseDeviceTraffic({rows:[row('mobile',70,30),row('desktop',20,10),row('(not set)',10,5)]});
 assert.equal(report.available,true);assert.equal(report.sessions,100);
 assert.equal(report.rows.find(r=>r.device==='mobile')?.percent,70);
 assert.equal(report.rows.find(r=>r.device==='tablet')?.sessions,0);
 assert.equal(report.rows.find(r=>r.device==='(not set)')?.percent,10);
 assert.equal(report.rows.find(r=>r.device==='mobile')?.users,30);
 assert.equal(parseDeviceTraffic({rows:[]}).available,true);
 assert.equal(parseDeviceTraffic({rows:[]}).sessions,0);
 for(const metadata of [{subjectToThresholding:true},{dataLossFromOtherRow:true},{samplingMetadatas:[{}]}]) assert.equal(parseDeviceTraffic({rows:[row('mobile',1,1)],metadata}).available,false);
 for(const rows of [[row('mobile',-1,1)],[row('mobile',1,NaN)],[row('mobile',1,1),row('mobile',1,1)],[{dimensionValues:[{value:'mobile'}],metricValues:[{value:'1'}]}]]) assert.equal(parseDeviceTraffic({rows}).available,false);
 assert.equal(parseDeviceTraffic({rows:[row('mobile',1,1)],rowCount:2}).available,false);
 assert.equal(parseDeviceTraffic({rows:[row('smart tv',2,1)]}).rows[0].label,'기타 기기 · smart tv');
 const calls:ReportRequest[]=[];
 const data=await loadDeviceTraffic({propertyId:'test',clientEmail:'test',privateKey:'test'},async(_,req)=>{
  calls.push(req);if(req.dateRanges[0].startDate==='7daysAgo')throw Error('429');
  return {rows:[row('desktop',1,1)]};
 });
 assert.equal(calls.length,3);
 assert.deepEqual(calls.map(c=>c.dateRanges[0]),[{startDate:'today',endDate:'today'},{startDate:'7daysAgo',endDate:'yesterday'},{startDate:'30daysAgo',endDate:'yesterday'}]);
 for(const req of calls){assert.deepEqual(req.dimensions,[{name:'deviceCategory'}]);assert.deepEqual(req.metrics,[{name:'sessions'},{name:'totalUsers'}]);}
 assert.equal(data.today.available,true);assert.equal(data.recent7.available,false);assert.equal(data.recent30.available,true);
 console.log('PASS: device session ratios, total users, unknown devices, zero/missing/partial reports, period boundaries and isolated failures');
}
main().catch(e=>{console.error(e);process.exitCode=1});
