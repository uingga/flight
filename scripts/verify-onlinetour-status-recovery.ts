// Offline replay of an explicitly identified public-document snapshot. No browser or site calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validatePilotResponse} from '../src/lib/onlinetour-browser-collector';

assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--snapshot');
const root=path.resolve(process.argv[3]);
const read=(name:string)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const summary=read('summary.json'),raw=read('raw-products.json'),previous=read('flights.json');
assert.equal(summary.readOnly,true);assert.equal(summary.siteRequests,0);
assert.equal(summary.provenance,'current_public_inline_document_matched_by_visible_card_id');
assert.equal(summary.originalApiResponse,false);assert.equal(raw.length,20);assert.equal(summary.cardText.length,20);
assert.equal(summary.status,'failed_validation');
assert.deepEqual(summary.issues.map((i:any)=>i.row),[0,1,2,14,15,16,17,18,19]);
assert.ok(summary.issues.every((i:any)=>i.reason==='unsupported_event_status' && raw[i.row].event_status_code==='01'));
const validation=validatePilotResponse('replay('+JSON.stringify({status:200,data:{list:raw}})+');','replay');
assert.equal(validation.status,'pilot_ready_for_review');assert.deepEqual(validation.issues,[]);
assert.equal(validation.flights.length,20);assert.equal(new Set(validation.flights.map(f=>f.id)).size,20);
assert.equal(previous.length,11);
for(const old of previous)assert.deepEqual(validation.flights.find(f=>f.id===old.id),old);
for(const [index,flight] of validation.flights.entries()) {
    const text=summary.cardText[index] as string,compact=text.replace(/\s/g,'');
    const times=Array.from(text.matchAll(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g),m=>m[0]);
    assert.deepEqual(times,[flight.departure.time,flight.departure.arrivalTime,flight.arrival.time,flight.arrival.arrivalTime]);
    assert.ok(compact.includes(flight.price.toLocaleString('en-US')+'원총요금정보'));
    assert.equal(Number(/(\d+)석예약가능$/.exec(compact)?.[1]),flight.availableSeats);
    assert.ok(compact.includes(flight.departure.date.slice(5)) && compact.includes(flight.arrival.date.slice(5)));
    const link=new URL(flight.link);
    assert.equal(link.origin+link.pathname,'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairReservation');
    assert.deepEqual([...link.searchParams.keys()],['eventCode']);assert.equal(link.searchParams.get('eventCode'),raw[index].event_code);
    assert.equal(link.username+link.password+link.hash,'');
}
console.log(JSON.stringify({offlineOnly:true,siteRequests:0,snapshotRunId:summary.runId,previousValid:11,
    recovered:9,verified:20,priceTimesSeatsDatesAndLinkIdVerified:true,originalFailureUnchanged:true,productionReady:false}));
