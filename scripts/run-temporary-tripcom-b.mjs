import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readReplacement,replacementFor,REPLACEMENT_ROOT} from '../src/lib/temporary-b-replacement.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const TRIPCOM_TIMES=Object.freeze(['06:17','08:14','10:12','11:48','13:23','14:57','16:31','18:01','19:31','20:30']);
export function dueTripcomSlot(now=Date.now()){
    const kst=new Date(now+9*3600000).toISOString();
    const due=TRIPCOM_TIMES.filter(time=>time<=kst.slice(11,16)).at(-1);
    if(!due)throw Error('no_current_tripcom_slot');
    return kst.slice(0,10)+'T'+due+':00+09:00';
}
export function verifyTripcomInstallation(config,manifest,read=fs.readFileSync){
    if(config?.host!=='B'||config.hostname!=='OFFICE-OMEN'||config.enabled!==true||config.parallelMode!==true
        ||config.profile!=='C:/Users/ynal/tmp/chrome-tripcom'
        ||config.stateRoot!==REPLACEMENT_ROOT+'/tripcom-state'
        ||config.coordinatorUrl!=='http://127.0.0.1:47832'
        ||config.workerTokenFile!=='C:/Users/ynal/Tikitikit/ac-control/tripcom/secrets/B.txt'
        ||config.physicalHost!=='A'||config.replacementId!=='b-on-a-20260926'
        ||manifest?.format!==1||!Array.isArray(manifest.files)||manifest.files.length<10)
        throw Error('invalid_temporary_tripcom_installation');
    const files=manifest.files.map(item=>{
        if(!/^[a-z0-9_]+\.py$/.test(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('invalid_tripcom_file');
        const bytes=read(path.join(REPLACEMENT_ROOT,'tripcom-release',item.file));
        if(sha(bytes)!==item.sha256)throw Error('tripcom_release_changed');
        return item;
    });
    if(sha(JSON.stringify(files))!==manifest.version||manifest.version!==config.version)
        throw Error('tripcom_release_mismatch');
}
export function main(){
    if(process.argv.length!==3||process.argv[2]!=='--scheduled')throw Error('scheduled_replacement_only');
    const activation=readReplacement();
    if(!activation)throw Error('temporary_replacement_required');
    const slot=dueTripcomSlot();
    replacementFor('tripcom',slot);
    const configFile=path.join(REPLACEMENT_ROOT,'tripcom-config.json');
    const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
    const manifest=JSON.parse(fs.readFileSync(path.join(REPLACEMENT_ROOT,'tripcom-release/manifest.json'),'utf8'));
    verifyTripcomInstallation(config,manifest);
    const python='C:/Users/ynal/AppData/Local/Programs/Python/Python314/python.exe';
    const logs=path.join(REPLACEMENT_ROOT,'logs');fs.mkdirSync(logs,{recursive:true});
    const log=fs.openSync(path.join(logs,'tripcom.log'),'a');
    try{
        fs.writeSync(log,JSON.stringify({event:'scheduled',slot,executionHost:'A',assignedHost:'B',version:config.version,at:new Date().toISOString()})+'\n');
        const result=spawnSync(python,[path.join(REPLACEMENT_ROOT,'tripcom-release/tripcom_entry.py'),'--config',configFile],
            {cwd:path.join(REPLACEMENT_ROOT,'tripcom-release'),windowsHide:true,stdio:['ignore',log,log],
                env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});
        if(result.error||result.signal||!Number.isInteger(result.status))throw Error('temporary_tripcom_completion_unknown');
        fs.writeSync(log,JSON.stringify({event:'worker_exit',slot,code:result.status,at:new Date().toISOString()})+'\n');
        process.exitCode=result.status;
    }finally{fs.closeSync(log);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
    try{main();}catch(error){console.error(error.message);process.exitCode=1;}
