const assert = require('node:assert/strict');
const path = require('node:path');
const {build} = require('esbuild');
const {NextRequest} = require('next/server');
const {randomUUID} = require('node:crypto');
async function load(file) {
  const result = await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['next/server','server-only']});
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(name=>name==='server-only'?{}:require(name),module,module.exports);
  return module.exports;
}
(async()=>{
  process.env.NODE_ENV='development';
  process.env.VISIT_ANALYTICS_ENABLED='true';
  process.env.SUPABASE_URL='https://storage.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_local-test-only';
  process.env.ADMIN_KEY='local-test-admin';
  const events=await load('src/app/api/visit-events/route.ts');
  const stats=await load('src/app/api/visit-stats/route.ts');
  const input={visitId:randomUUID(),visitorId:randomUUID(),startedAt:Date.now(),channel:'search',action:'booking'};
  let calls=[]; let result='recorded'; let fail=false;
  global.fetch=async(url,init)=>{
    assert(String(url).startsWith('https://storage.test.invalid/rest/v1/rpc/'));
    calls.push(JSON.parse(init.body));
    if(fail) throw new Error('test storage outage');
    return new Response(JSON.stringify(result),{status:200});
  };
  const request=(body=input,headers={})=>new NextRequest('http://localhost:3999/api/visit-events',{
    method:'POST',headers:{origin:'http://localhost:3999','content-type':'application/json','user-agent':'Local test','x-forwarded-for':'192.0.2.4',...headers},body:JSON.stringify(body),
  });
  assert.equal((await events.POST(request())).status,204);
  assert.equal(calls.length,1);
  assert.equal(calls[0].p_action,'booking');
  assert.match(calls[0].p_visitor_key,/^[a-f0-9]{64}$/);
  assert.match(calls[0].p_rate_key,/^[a-f0-9]{64}$/);
  assert(!JSON.stringify(calls[0]).includes(input.visitorId));
  assert(!JSON.stringify(calls[0]).includes('192.0.2.4'));
  for(const [headers,status] of [
    [{origin:'https://evil.test'},403],[{'sec-fetch-site':'cross-site'},403],
    [{'content-type':'text/plain'},415],[{'dnt':'1'},204],[{'sec-gpc':'1'},204],[{'user-agent':'Googlebot'},204],
  ]) assert.equal((await events.POST(request(input,headers))).status,status);
  assert.equal((await events.POST(request({...input,email:'not allowed'}))).status,400);
  assert.equal((await events.POST(request({large:'x'.repeat(2000)}))).status,400);
  assert.equal(calls.length,1);
  result='limited'; assert.equal((await events.POST(request())).status,429);
  result='conflict'; assert.equal((await events.POST(request())).status,409);
  fail=true; assert.equal((await events.POST(request())).status,503); fail=false;
  const statsRequest=(token='local-test-admin',query='')=>new NextRequest('http://localhost:3999/api/visit-stats'+query,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal((await stats.GET(statsRequest('wrong'))).status,401);
  assert.equal((await stats.GET(statsRequest('local-test-admin','?day=2026-02-30'))).status,400);
  result={sessions:2,channels:[{channel:'search',sessions:2,users:1}],reconciled:true,users:1};
  assert.equal((await stats.GET(statsRequest())).status,200);
  result={sessions:2,channels:[{channel:'search',sessions:3,users:1}],reconciled:true};
  assert.equal((await stats.GET(statsRequest())).status,503);
  process.env.VISIT_ANALYTICS_ENABLED='false';
  assert.equal((await events.POST(request())).status,503);
  assert.equal((await (await stats.GET(statsRequest())).json()).available,false);
  console.log('HTTP: origin, privacy signals, payload limits, hashing, rate failures, auth, dates, reconciliation and disabled mode passed');
})().catch(error=>{console.error(error);process.exitCode=1});
