import fs from 'node:fs';
import assert from 'node:assert/strict';
import {restoreModetourHistory} from '../src/lib/modetour-history';
const cache=JSON.parse(fs.readFileSync('data/all-flights-cache.json','utf8'));
const restored=restoreModetourHistory(cache);
assert.equal(restored.length,cache.flights.length);
const changed:any[]=[];
restored.forEach((f,i)=>{
 const old=cache.flights[i];assert.equal(f.id,old.id);assert.equal(f.price,old.price);
 if(f.source!=='modetour')assert.deepEqual(f,old);
 if(f.firstSeen!==old.firstSeen)changed.push({id:f.id,route:`${f.departure.city}→${f.arrival.city}`,price:f.price,from:old.firstSeen,to:f.firstSeen});
});
fs.mkdirSync('output/history-verification',{recursive:true});
fs.writeFileSync('output/history-verification/restoration-proof.json',JSON.stringify({count:restored.length,changed:changed.length,examples:changed},null,2));
console.log({flightsUnchanged:restored.length,firstSeenRestored:changed.length,examples:changed.slice(0,3)});
