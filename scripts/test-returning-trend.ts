import assert from 'node:assert/strict';
import {loadReturningTrend} from '../src/lib/server/returning-trend-report';
import type {Ga4Config, runReport, ReportResponse} from '../src/lib/ga4';
async function main() {
const config={} as Ga4Config, dates=['2026-09-10','2026-09-11'];
const query=(report:ReportResponse) => (async (_config, request) => {
 assert.deepEqual(request.metrics,[{name:'activeUsers'}]);
 assert.deepEqual(request.dateRanges,[{startDate:dates[0],endDate:dates[1]}]);
 assert.equal((request.dimensionFilter as any).filter.stringFilter.value,'returning');
 return report;
}) as typeof runReport;
assert.deepEqual(await loadReturningTrend(config,dates,query({rows:[{dimensionValues:[{value:'20260911'}],metricValues:[{value:'3'}]}],rowCount:1})),{available:true,trend:[{date:dates[0],users:0},{date:dates[1],users:3}]});
for(const report of [{rowCount:3,rows:[]},{metadata:{subjectToThresholding:true}},{rows:[{dimensionValues:[{value:'20260911'}],metricValues:[{value:'bad'}]}]}]) assert.equal((await loadReturningTrend(config,dates,query(report))).available,false);
assert.equal((await loadReturningTrend(config,dates,async()=>{throw Error('429');})).available,false);
assert.deepEqual((await loadReturningTrend(config,dates,query({rows:[]}))).trend.map(p=>p.users),[0,0]);
console.log('PASS: returning filter, date alignment, valid zero, malformed/partial/failure isolation');
}
main();
