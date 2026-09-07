const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {PGlite} = require(process.env.VISIT_TEST_PGLITE || path.resolve('output/visit-test-runtime/node_modules/@electric-sql/pglite'));
(async()=>{
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const migration = fs.readFileSync('supabase/migrations/20260907_create_visit_analytics.sql','utf8');
    await db.exec(migration);
    await db.exec(migration); // idempotent migrations
    const [{at,day}] = (await db.query("select date_trunc('milliseconds',clock_timestamp())::text as at, (now() at time zone 'Asia/Seoul')::date::text as day")).rows;
    const one=randomUUID(),two=randomUUID(),three=randomUUID();
    const user='a'.repeat(64), other='b'.repeat(64), rate='c'.repeat(64);
    const record = async (id,visitor,channel,action,stamp=at,rateKey=rate) => (await db.query(
      'select public.tikitikit_record_visit($1,$2,$3,$4,$5,$6) as result',[id,visitor,stamp,channel,action,rateKey])).rows[0].result;
    assert.equal(await record(one,user,'search','booking'),'recorded'); // arrives before visit/detail
    await Promise.all(Array.from({length:15},(_,i)=>record(one,user,i%2?'social':'search',i%3?'visit':'detail')));
    assert.equal(await record(one,other,'referral','visit'),'conflict');
    assert.equal(await record(one,user,'referral','visit',new Date(Date.parse(at)-1000).toISOString()),'conflict');
    await record(two,user,'social','visit');
    await record(three,other,'direct','detail');
    const report=(await db.query('select public.tikitikit_visit_report($1) as report',[day])).rows[0].report;
    assert.equal(report.sessions,3);
    assert.equal(report.users,2);
    assert.equal(report.detailUsers,2);
    assert.equal(report.bookingUsers,1);
    assert.equal(report.channels.reduce((n,row)=>n+row.sessions,0),3);
    assert.equal(report.channels.reduce((n,row)=>n+row.users,0),3); // NOT an additive metric
    assert(report.reconciled);
    assert.equal((await db.query('select channel from public.tikitikit_visits where id=$1',[one])).rows[0].channel,'search');
    assert.equal(await record(randomUUID(),user,'unknown','visit','2000-01-01T00:00:00Z'),'invalid');
    assert.equal(await record(randomUUID(),user,'not-a-channel','visit'),'invalid');
    assert.equal(await record(randomUUID(),user,'search','delete'),'invalid');
    const rate2='d'.repeat(64);
    await db.query("insert into public.tikitikit_visit_rate_limits values ($1,date_trunc('minute',clock_timestamp()),120)",[rate2]);
    assert.equal(await record(randomUUID(),user,'search','visit',at,rate2),'limited');
    for (const role of ['anon','authenticated']) {
      const [permissions]=(await db.query(`select has_table_privilege($1,'public.tikitikit_visits','SELECT') as read,
        has_table_privilege($1,'public.tikitikit_visits','INSERT') as write,
        has_function_privilege($1,'public.tikitikit_record_visit(uuid,text,timestamptz,text,text,text)','EXECUTE') as call`,[role])).rows;
      assert.deepEqual(permissions,{read:false,write:false,call:false});
    }
    await db.query("insert into public.tikitikit_visits(id,visitor_key,started_at,channel) values ($1,$2,now()-interval '91 days','direct')",[randomUUID(),user]);
    await db.query("insert into public.tikitikit_visit_rate_limits values ($1,now()-interval '2 days',1)",['e'.repeat(64)]);
    await db.exec('select public.tikitikit_cleanup_visits();');
    assert.equal(Number((await db.query('select count(*) as n from public.tikitikit_visits')).rows[0].n),3);
    assert.equal(Number((await db.query("select count(*) as n from public.tikitikit_visit_rate_limits where minute < now()-interval '1 day'")).rows[0].n),0);
    console.log('PostgreSQL: repeat delivery, out-of-order actions, immutable attribution, unique users, reconciliation, conflicts, rate limits, RLS permissions and cleanup passed');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
