import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {Coordinator,kstDay} from '../src/lib/naver-coordinator.mjs';

export function initializeLedger({target,activationDay,legacy,now=Date.now()}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(activationDay)||activationDay<=kstDay(now))throw Error('fresh next-day boundary required');
 if(legacy?.phase==='running'||legacy?.phase==='partial_waiting')throw Error('legacy phase not finalized');
 if(fs.existsSync(target))throw Error('existing ledger preserved');
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'',{flag:'wx'});
 const db=new Coordinator(target,()=>now,null,{initialize:true,writerFencing:true});
 try{db.db.exec('CREATE TABLE activation(id INTEGER PRIMARY KEY CHECK(id=1),day TEXT NOT NULL)');db.db.prepare('INSERT INTO activation VALUES(1,?)').run(activationDay);}
 finally{db.close();}
 return {initialized:true,activationDay,legacyUnchanged:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(os.hostname().toLowerCase()!=='office-omen'||process.argv[2]!=='--initialize-next-day')throw Error('explicit A initialization required');
 const base=path.join(os.homedir(),'AppData/Local/Tikitikit'),state=path.join(base,'state/naver-crawl.json');
 console.log(JSON.stringify(initializeLedger({target:path.join(base,'naver-coordinator/ledger.sqlite'),activationDay:kstDay(Date.now()+86400000),legacy:fs.existsSync(state)?JSON.parse(fs.readFileSync(state,'utf8')):null})));
}
