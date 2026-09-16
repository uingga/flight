import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
export {createRelayHandler} from './writer-relay-handler.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
// The relay is a trusted authentication boundary, but has NO Git credentials or control API.
// Claims never expire/requeue: an uncertain A response requires reconciliation, not replay.
export class PublicationQueue {
 constructor(file){
  this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS deliveries(role TEXT,id TEXT,hash TEXT,body TEXT,state TEXT,claim TEXT,response TEXT,PRIMARY KEY(role,id));`);
 }
 close(){this.db.close();}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 submit(role,id,body){return this.transaction(()=>{
  let row=this.db.prepare('SELECT * FROM deliveries WHERE role=? AND id=?').get(role,id);
  if(row){if(row.hash!==digest(body))throw Error('identity collision');return row;}
  if(this.db.prepare('SELECT count(*) AS n FROM deliveries').get().n>=1000)throw Error('queue capacity; explicit retention review required');
  this.db.prepare("INSERT INTO deliveries VALUES(?,?,?,?,'pending',NULL,NULL)").run(role,id,digest(body),body);
  return {state:'pending'};
 });}
 claim(){return this.transaction(()=>{
  const row=this.db.prepare("SELECT * FROM deliveries WHERE state='pending' ORDER BY rowid LIMIT 1").get();
  if(!row)return null;
  const claim=randomUUID();
  this.db.prepare("UPDATE deliveries SET state='claimed',claim=? WHERE role=? AND id=? AND state='pending'").run(claim,row.role,row.id);
  return {role:row.role,id:row.id,body:row.body,claim};
 });}
 complete({role,id,claim,response}){return this.transaction(()=>{
  const row=this.db.prepare('SELECT * FROM deliveries WHERE role=? AND id=?').get(role,id);
  const encoded=JSON.stringify(response);
  if(!row||row.claim!==claim)throw Error('unknown claim');
  if(row.state==='done'){if(row.response!==encoded)throw Error('conflicting completion');return;}
  if(row.state!=='claimed')throw Error('invalid state');
  this.db.prepare("UPDATE deliveries SET state='done',response=? WHERE role=? AND id=?").run(encoded,role,id);
 });}
}
