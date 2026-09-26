// Uses existing binaries; isolated synthetic cluster, loopback only, no Windows service.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
const bin='C:/Program Files/PostgreSQL/18/bin';
if(!fs.existsSync(path.join(bin,'initdb.exe')))throw Error('existing PostgreSQL binaries missing');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tikit-pg-fixture-')),data=path.join(root,'cluster'),password=randomBytes(32).toString('hex');
const passwordFile=path.join(root,'test-password');fs.writeFileSync(passwordFile,password,{mode:0o600});
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:String(port),PGUSER:'fixture_owner',PGPASSWORD:password,PGDATABASE:'postgres',PGSERVICE:'',PGSERVICEFILE:'',PGOPTIONS:'',PGSSLMODE:'disable'};
delete env.PGSERVICE;delete env.PGSERVICEFILE;
const results=[];let initialized=false,stopped=false;
const run=(file,args,input)=>{
 const r=spawnSync(path.join(bin,file+'.exe'),args,{env,encoding:'utf8',input,windowsHide:true,timeout:60000,maxBuffer:1024*1024});
 if(r.status!==0){const line=(r.stderr||r.stdout||'').slice(0,700);throw Error(file+' failed: '+(line||r.error?.code||r.status));}
 return (r.stdout||'').trim();
};
const sql=value=>run('psql',['-X','-v','ON_ERROR_STOP=1','-t','-A'],value);
const parallelSql=value=>new Promise((resolve,reject)=>{
 const child=spawn(path.join(bin,'psql.exe'),['-X','-v','ON_ERROR_STOP=1','-t','-A'],{env,windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:30000});
 let output='';child.stdout.on('data',x=>{output+=x;});child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim()):reject(Error('concurrent SQL failed')));child.stdin.end(value);
});
try{
 run('initdb',['-D',data,'-U','fixture_owner','--auth=scram-sha-256','--pwfile='+passwordFile,'--encoding=UTF8','--no-locale']);initialized=true;
 run('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','30','start']);
 sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE DATABASE tikit_writer_fixture_relay;');
 env.PGDATABASE='tikit_writer_fixture_relay';
 sql(fs.readFileSync('scripts/sql/writer-relay.sql','utf8'));results.push('migration');
 // A receipt is an immutable request plus a monotonic result. Polling it must
 // not wait behind another delivery's global admission transaction.
 sql(`SELECT public.tikit_writer_queue('submit','{"role":"daily","id":"receipt-contention-0001","body":"{}"}');`);
 const holder=spawn(path.join(bin,'psql.exe'),['-X','-v','ON_ERROR_STOP=1','-t','-A'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 holder.stderr.resume();
 const held=new Promise((resolve,reject)=>{holder.stdout.on('data',chunk=>{if(String(chunk).includes('fixture-lock-held'))resolve();});holder.on('error',reject);holder.on('exit',code=>{if(code!==0)reject(Error('fixture lock holder failed'));});});
 const holderDone=new Promise(resolve=>holder.on('exit',resolve));
 holder.stdin.end("BEGIN; SELECT pg_advisory_xact_lock(74152,190915); SELECT 'fixture-lock-held'; SELECT pg_sleep(2); COMMIT;");
 await held;
 try{
  const replay=sql(`SET statement_timeout='500ms'; SELECT public.tikit_writer_queue('submit','{"role":"daily","id":"receipt-contention-0001","body":"{}"}');`);
  if(!replay.includes('pending'))throw Error('receipt replay not returned');
  results.push('receipt-read-does-not-wait-for-global-writer-lock');
 }finally{await holderDone;}
 sql("DELETE FROM tikit_writer_private.deliveries WHERE id='receipt-contention-0001';"); // Synthetic cluster only.
 sql(fs.readFileSync('scripts/sql/test-writer-relay.sql','utf8'));results.push('lifecycle-and-role-denial');
 sql(fs.readFileSync('scripts/sql/test-writer-relay-capacity.sql','utf8'));results.push('history-over-256MiB-active-byte-row-limits-replay-no-reclaim');
 sql(fs.readFileSync('scripts/sql/test-writer-relay-retention.sql','utf8'));results.push('retention-rollout-dates-expiry-heartbeats-purge-supersession-permissions');
 sql(`SELECT public.tikit_writer_queue('submit','{"role":"daily","id":"${'b'.repeat(40)}","body":"{}"}');`);
 const claims=await Promise.all(Array.from({length:4},()=>parallelSql("SELECT public.tikit_writer_queue('claim');")));
 if(claims.filter(Boolean).length!==1)throw Error('multiple concurrent claims');results.push('four-session-single-claim');
 run('pg_ctl',['-D',data,'-w','-t','30','-m','fast','stop']);
 run('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','30','start']);
 if(sql("SELECT public.tikit_writer_queue('claim');")!=='')throw Error('restart reclaimed uncertain job');results.push('restart-no-reclaim');
}catch(e){process.exitCode=1;console.error(String(e.message).replaceAll(password,'[redacted]'));}
finally{
 if(initialized){try{run('pg_ctl',['-D',data,'-w','-t','30','-m','fast','stop']);stopped=true;}catch{
  const status=spawnSync(path.join(bin,'pg_ctl.exe'),['-D',data,'status'],{env,windowsHide:true,stdio:'ignore'});
  stopped=status.status===3;
  if(!stopped){console.error('fixture shutdown requires review; preserved temporary cluster');process.exitCode=1;}
 }}
 else stopped=true;
 if(stopped){
  const closed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('error',()=>resolve(true));socket.once('connect',()=>{socket.destroy();resolve(false);});});
  if(!closed){stopped=false;process.exitCode=1;}
 }
 fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/postgres-relay-result.json',JSON.stringify({version:'18.4',results,stopped,exit:process.exitCode||0},null,2));
 console.log(JSON.stringify({suite:'actual isolated PostgreSQL',passed:results.length,stopped,exit:process.exitCode||0}));
 if(stopped)fs.rmSync(root,{recursive:true}); // Only this mkdtemp-owned synthetic cluster.
}
