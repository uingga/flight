import assert from 'node:assert/strict';
async function main() {
 process.env.NEXT_PUBLIC_GA_ID='G-LOCALTEST';
 process.env.NEXT_PUBLIC_VISIT_ANALYTICS_ENABLED='false';
 const events: unknown[][]=[];let excluded=false;
 (globalThis as any).window={gtag:(...args:unknown[])=>events.push(args),localStorage:{getItem:()=>excluded?'true':null}};
 globalThis.fetch=async()=>{throw Error('Test must not send requests');};
 const {trackDetailOpen,trackBookingClick,event}=await import('../src/lib/analytics');
 for(const agency of ['hanatour','modetour','myrealtrip','ybtour','ttang','onlinetour']) {
  const start=events.length;
  trackDetailOpen('부산-괌',200000,agency,'card_body',{flightId:'test-'+agency,destination:'괌'});
  trackBookingClick(agency,'부산-괌',200000,{flightId:'test-'+agency,destination:'괌'});
  const received=events.slice(start);
  for(const name of ['detail_open','city_detail_open','booking_click','city_booking_click']){
   const matching=received.filter(event=>event[1]===name);assert.equal(matching.length,1);
   const params=matching[0][2] as Record<string,unknown>;
   assert.equal(params.travel_agency,agency);assert.equal(params.flight_id,'test-'+agency);
   assert.equal(params.destination,'괌');assert.equal(params.price,200000);
  }
  for(const event of received)for(const key of ['source','medium','campaign_source','campaign_medium'])assert.ok(!(key in (event[2] as object)));
 }
 for(const key of ['source','campaign_source']) {
  const params={ [key]:'hanatour',price:200000 };
  event('legacy_detail',params);
  const actual=events.at(-1)![2] as Record<string,unknown>;
  assert.equal(actual.travel_agency,'hanatour');assert.ok(!(key in actual));assert.equal(params[key],'hanatour');
 }
 event('campaign_test',{source:'te31'});assert.equal((events.at(-1)![2] as any).source,'te31');
 const before=events.length;excluded=true;trackDetailOpen('부산-괌',200000,'ttang','card_body');assert.equal(events.length,before);
 console.log('PASS: six agencies use travel_agency, no traffic-source fields, detail/booking metadata and owner exclusion preserved; no network');
}
main().catch(e=>{console.error(e);process.exitCode=1});
