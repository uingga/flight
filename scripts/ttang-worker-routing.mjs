import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function ttangWorkerForSlot(expectedAt,{manual=false}={}) {
    if(manual)return 'B';
    const t=Date.parse(expectedAt);if(!Number.isFinite(t))throw Error('invalid_slot');
    const d=new Date(t+9*3600000),key=d.getUTCHours()+':'+d.getUTCMinutes();
    if(['6:17','13:23'].includes(key))return 'B';
    if(['10:12','16:31'].includes(key))return 'C';
    throw Error('invalid_slot');
}
export function assertTtangWorker(host,expectedAt,manual=false,requestedWorker) {
    const role=host.toUpperCase()==='DESKTOP-OFFICE'?'B':host.toUpperCase()==='DESKTOP-1PPFUR3'?'C':null;
    if(!role||role!==ttangWorkerForSlot(expectedAt,{manual})||(requestedWorker&&requestedWorker!==role))throw Error('wrong_worker');
    return role;
}
// A owns this journal across B/C. A failed publication cannot erase a spent slot or block.
export function beginTtangDispatch(root,slot,id,now=Date.now()) {
    fs.mkdirSync(root,{recursive:true});
    const cooldown=path.join(root,'cooldown.json');
    const checkCooldown=()=>{if(fs.existsSync(cooldown)){
        const next=Date.parse(JSON.parse(fs.readFileSync(cooldown,'utf8')).nextProbeAt);
        if(!Number.isFinite(next)||next>now)throw Error('shared_source_cooldown');
    }};
    const lock=path.join(root,'dispatch.lock'),fd=fs.openSync(lock,'wx');
    try {checkCooldown();fs.writeFileSync(path.join(root,createHash('sha256').update(slot).digest('hex')+'.json'),JSON.stringify({slot,id,startedAt:new Date(now).toISOString()}),{flag:'wx'});}
    catch(e){fs.closeSync(fd);fs.unlinkSync(lock);throw e;}
    let closed=false;
    return {finish(failed,nextProbeAt){
        if(closed)throw Error('duplicate_finish');
        if(failed){const until=Math.max(now+86400000,Date.parse(nextProbeAt)||0);fs.writeFileSync(cooldown,JSON.stringify({nextProbeAt:new Date(until).toISOString(),id}));}
        closed=true;fs.closeSync(fd);fs.unlinkSync(lock);
    }};
}
