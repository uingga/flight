import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { runReport } from '../src/lib/ga4';
import { Ga4RequestQueue } from '../src/lib/ga4-request-queue';
async function main() {
 const config={propertyId:'test',clientEmail:'test@example.com',privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()};
 let active=0,peak=0,reports=0,tokens=0,retries=0;
 const original=globalThis.fetch;
 globalThis.fetch=async (url,init)=>{
  if(String(url).includes('oauth2')){tokens++;return Response.json({access_token:'fake',expires_in:3600});}
  active++;peak=Math.max(peak,active);reports++;
  await new Promise(r=>setTimeout(r,5));active--;
  const request=JSON.parse(String(init?.body));
  if(request.limit===999 && retries++===0)return Response.json({error:{message:'Exhausted concurrent requests quota'}},{status:429});
  if(request.limit===998)return Response.json({error:{message:'Exhausted daily tokens quota'}},{status:429});
  return Response.json({rowCount:request.limit,rows:[]});
 };
 const req=(limit:number)=>({dateRanges:[{startDate:'yesterday',endDate:'yesterday'}],metrics:[{name:'sessions'}],limit});
 try {
  const rows=await Promise.all(Array.from({length:30},(_,i)=>runReport(config,req(i%15+1))));
  assert.equal(peak,2);assert.equal(reports,15);assert.equal(tokens,1);assert.equal(rows.length,30);
  assert.equal((await runReport(config,req(999))).rowCount,999);assert.equal(retries,2);
  const before=reports;await assert.rejects(runReport(config,req(998)),/통계 조회 요청/);assert.equal(reports,before+1);
  await runReport(config,req(1));assert.equal(reports,before+2);
  const queue=new Ga4RequestQueue(1);let jobs=0;
  const job=()=>queue.run('same',async()=>{jobs++;await new Promise(r=>setTimeout(r,5));return 7;});
  assert.deepEqual(await Promise.all([job(),job(),job()]),[7,7,7]);assert.equal(jobs,1);
  await assert.rejects(queue.run('fail',async()=>{throw Error('failed');}));
  assert.equal(await queue.run('fail',async()=>8),8);
  console.log('PASS: concurrency 2, duplicate reports/token single-flight, concurrent-429 retry, daily-429 no retry, failure cleanup, stats single-flight');
 } finally {globalThis.fetch=original;}
}
main().catch(e=>{console.error(e);process.exitCode=1});
