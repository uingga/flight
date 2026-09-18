import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NextRequest} from 'next/server';


import {homeRecommendation} from '../src/lib/home-recommendation';

test('first page and API use identical candidates and comparison data',async()=>{
 // Next supplies this marker at bundle time; the test itself runs only in Node.
 const Module=require('node:module');const originalLoad=Module._load;
 Module._load=function(name:string,...args:any[]){return name==='server-only'?{}:originalLoad.call(this,name,...args);};
 const {GET}=await import('../src/app/api/flights/route');
 const {createPublicFlightsResponse}=await import('../src/lib/server/public-flights-response');
 Module._load=originalLoad;
 const query='sortBy=price&sortOrder=asc';
 const data=await(await createPublicFlightsResponse(new URLSearchParams(query))).json();
 const api=await(await GET(new NextRequest('http://localhost/api/flights?'+query))).json();
 assert.ok(data.success);assert.ok(data.flights.length>0);assert.deepEqual(data,api);
 const compared=data.flights.find((f:any)=>f.nearbyNaverSampleCount>=2);assert.ok(compared?.nearbyNaverBaseline);
 const options={now:Date.now(),pinnedId:data.todayPickId,placements:data.manualFlightOrder.placements};
 const ids=(rows:any[])=>homeRecommendation(rows,data.interparkPrices,data.priceHistory,options).map(f=>f.id);
 const initial=ids(data.flights);assert.deepEqual(initial,ids(api.flights));
 assert.deepEqual(initial,ids([...api.flights].reverse()));
 const pin=data.flights[3];const movable=data.flights.find((f:any)=>f.id!==pin.id);
 const manual=homeRecommendation(data.flights,data.interparkPrices,data.priceHistory,{...options,pinnedId:pin.id,placements:[{key:movable.manualOrderKey,position:1}]});
 assert.equal(manual[0].id,pin.id);assert.equal(manual[1].id,movable.id);
});
