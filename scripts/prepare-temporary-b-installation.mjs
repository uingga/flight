import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {REPLACEMENT_ROOT,validateReplacement} from '../src/lib/temporary-b-replacement.mjs';
import {verifyDependencies} from './lib/collector-dependencies.mjs';
import {verifyTripcomInstallation} from './run-temporary-tripcom-b.mjs';
import {agencyEveningManifest,verifyAgencyEveningRelease} from './agency-evening-release.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.join(project,'output/b-on-a-20260926');
const read=file=>JSON.parse(fs.readFileSync(path.join(evidence,file),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx'});};
function copyState(snapshot,destination){
    const files=snapshot.files.slice().sort((a,b)=>a.file.localeCompare(b.file));
    if(sha(JSON.stringify(files))!==snapshot.stateSha||files.some(row=>row.file.endsWith('.lock')))
        throw Error('state_snapshot_not_idle');
    for(const row of files){
        if(!/^[a-zA-Z0-9_./+-]+\.json$/.test(row.file)||row.file.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('unsafe_state_path');
        const target=path.join(destination,row.file);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,Buffer.from(row.bytes,'base64'),{flag:'wx'});
    }
}
function main(){
    if(process.argv.length===3&&process.argv[2]==='--finalize-prepared'){
        if(os.hostname().toUpperCase()!=='OFFICE-OMEN')throw Error('A_required');
        const root=REPLACEMENT_ROOT+'/release';
        const config=JSON.parse(fs.readFileSync(REPLACEMENT_ROOT+'/activation.json','utf8'));
        validateReplacement(config);
        if(config.status!=='prepared')throw Error('prepared_only');
        const oldManifest=JSON.parse(fs.readFileSync(root+'/release-manifest.json','utf8'));
        verifyAgencyEveningRelease(root,oldManifest,config.releaseVersion);
        const localDepot=REPLACEMENT_ROOT+'/dependencies';
        if(fs.existsSync(localDepot))throw Error('dependency_destination_exists');
        fs.cpSync(path.dirname(fs.realpathSync(root+'/node_modules')),localDepot,{recursive:true,errorOnExist:true,force:false});
        // This removes only the verified junction, never the dependency target.
        if(!fs.lstatSync(root+'/node_modules').isSymbolicLink())throw Error('expected_dependency_junction');
        fs.unlinkSync(root+'/node_modules');
        fs.symlinkSync(localDepot+'/node_modules',root+'/node_modules','junction');
        verifyDependencies(root);
        const names=execFileSync('git',['ls-files','-z','--','src/lib','src/types','scripts','package.json','package-lock.json','tsconfig.json'],{cwd:project}).toString().split('\0').filter(Boolean);
        const files=names.map(file=>({file,content:fs.readFileSync(path.join(project,file))}));
        const manifest=agencyEveningManifest(files);
        const backup=REPLACEMENT_ROOT+'/prepared-revision-backup';
        fs.mkdirSync(backup);
        write(backup+'/release-manifest.json',oldManifest);write(backup+'/activation.json',config);
        for(const {file,content} of files){
            const target=path.join(root,file);
            if(fs.existsSync(target)){
                if(fs.readFileSync(target).equals(content))continue;
                const save=path.join(backup,file);fs.mkdirSync(path.dirname(save),{recursive:true});fs.copyFileSync(target,save,fs.constants.COPYFILE_EXCL);
            }
            fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
        }
        fs.writeFileSync(root+'/release-manifest.json',JSON.stringify(manifest));
        config.releaseVersion=manifest.version;
        fs.writeFileSync(REPLACEMENT_ROOT+'/activation.json',JSON.stringify(config,null,2));
        verifyAgencyEveningRelease(root,manifest,config.releaseVersion);
        write(path.join(evidence,'A-final-prepared.json'),{releaseVersion:manifest.version,dependenciesRoot:localDepot,at:new Date().toISOString()});
        console.log(JSON.stringify({status:'prepared_not_active',releaseVersion:manifest.version,dependenciesRoot:localDepot}));return;
    }
    if(process.argv.length!==3||process.argv[2]!=='--prepare'||os.hostname().toUpperCase()!=='OFFICE-OMEN')throw Error('explicit_A_preparation_required');
    if(fs.existsSync(REPLACEMENT_ROOT))throw Error('existing_installation_review_required');
    const fence=read('apply-fence.json'), stopped=read('stopped-tripcom.json');
    if(fence.status!=='fenced'||stopped.enabled!==false||stopped.configEnabled!==false||stopped.state===4)throw Error('B_not_fenced');
    const state=read('state-snapshot.json'),tripState=read('tripcom-state.json');
    const build=spawnSync(process.execPath,[path.join(project,'scripts/build-agency-evening-release.mjs'),REPLACEMENT_ROOT+'/release'],
        {cwd:project,windowsHide:true,encoding:'utf8'});
    if(build.status!==0)throw Error('release_build_failed');
    const release=JSON.parse(build.stdout);
    const depot=path.join(project,'output/dependency-validation-20260926/2ab553c115d9e3598382058fed379b381569e73d076be83c6f7133586bfcf4ab/node_modules');
    fs.symlinkSync(depot,REPLACEMENT_ROOT+'/release/node_modules','junction');
    const dependencies=verifyDependencies(REPLACEMENT_ROOT+'/release');
    copyState(state,REPLACEMENT_ROOT+'/state');
    copyState(tripState,REPLACEMENT_ROOT+'/tripcom-state');
    const tripSource=path.join(evidence,'tripcom-source');
    const files=fs.readdirSync(tripSource).filter(name=>/^[a-z0-9_]+\.py$/.test(name)).sort().map(file=>{
        const bytes=fs.readFileSync(path.join(tripSource,file));
        const target=REPLACEMENT_ROOT+'/tripcom-release/'+file;
        fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
        return {file,sha256:sha(bytes)};
    });
    const tripManifest={format:1,files,version:sha(JSON.stringify(files))};
    write(REPLACEMENT_ROOT+'/tripcom-release/manifest.json',tripManifest);
    const config={host:'B',physicalHost:'A',hostname:'OFFICE-OMEN',enabled:true,parallelMode:true,
        replacementId:'b-on-a-20260926',profile:'C:/Users/ynal/tmp/chrome-tripcom',
        stateRoot:REPLACEMENT_ROOT+'/tripcom-state',coordinatorUrl:'http://127.0.0.1:47832',
        workerTokenFile:'C:/Users/ynal/Tikitikit/ac-control/tripcom/secrets/B.txt',version:tripManifest.version};
    verifyTripcomInstallation(config,tripManifest);
    write(REPLACEMENT_ROOT+'/tripcom-config.json',config);
    const activation={format:1,id:'b-on-a-20260926',from:'B',to:'A',hostname:'OFFICE-OMEN',status:'prepared',
        notBefore:new Date().toISOString(),bFenced:true,fenceSha:fence.fenceSha,stateSha:state.stateSha,
        tripcomStateSha:tripState.stateSha,tripcomVersion:tripManifest.version,
        releaseVersion:release.version,root:REPLACEMENT_ROOT,regularOnly:true};
    validateReplacement(activation);
    write(REPLACEMENT_ROOT+'/activation.json',activation);
    write(path.join(evidence,'A-prepared.json'),{activation,dependencies,sourceStateFiles:state.files.length,tripcomStateFiles:tripState.files.length});
    console.log(JSON.stringify({status:'prepared_not_active',releaseVersion:release.version,tripcomVersion:tripManifest.version,
        dependencies:dependencies.checked,sourceStateFiles:state.files.length,tripcomStateFiles:tripState.files.length}));
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
