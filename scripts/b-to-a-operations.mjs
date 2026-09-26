import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output/b-on-a-20260926');
export function remoteB(script){
    const payload="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"+script;
    const stdinEntry="[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); & ([scriptblock]::Create([Console]::In.ReadToEnd()))";
    const result=spawnSync('ssh.exe',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','tikitikit-pc-b',
        'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(stdinEntry,'utf16le').toString('base64')],
        {input:payload,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16000000});
    if(result.error||result.status!==0){
        const safe=result.stderr?.match(/\b(?:physical_B_required|task_command_timeout|task_command_failed|unexpected_tripcom_task|invalid_worker_entry|replacement_already_fenced_review_receipt|backup_exists_review_before_retry|tripcom_fence_not_confirmed)\b/);
        throw Error(result.error?.code || safe?.[0] || 'remote_B_operation_failed');
    }
    return result.stdout.replace(/^\uFEFF/,'');
}
async function main(){
    const action=process.argv[2];fs.mkdirSync(output,{recursive:true});
    if(action==='inspect-fence'||action==='apply-fence'){
        const script=fs.readFileSync(path.join(root,'scripts/fence-b-for-temporary-replacement.ps1'),'utf8');
        const text=remoteB('& {\n'+script+'\n} '+(action==='apply-fence'?'-Apply':''));
        const result=JSON.parse(text);
        fs.writeFileSync(path.join(output,action+'.json'),JSON.stringify(result,null,2),{flag:'wx'});
        console.log(JSON.stringify(result));return;
    }
    if(action==='snapshot-state'){
        const script=String.raw`
$base='C:/Users/ynal/AppData/Local/Tikitikit'
if(!(Test-Path -LiteralPath ($base+'/b-on-a-maintenance.json'))){throw 'B_not_fenced'}
$rows=@()
foreach($sub in @('onlinetour-validation','ttang-browser','modetour-browser','mrt-worker','agency-evening-v1','evening-general')){
 $dir=Join-Path $base $sub
 foreach($file in @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue|Where-Object{$_.Extension -eq '.json' -or $_.Extension -eq '.lock'})){
  if($file.LinkType -or $file.Length -gt 2000000){throw 'unsafe_state_snapshot'}
  $rows+=@{file=$sub+'/'+$file.Name;bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))}
 }
}
$config=Get-Content -LiteralPath ($base+'/tripcom-crawler/connection/config-parallel.json') -Raw|ConvertFrom-Json
$metadata=@{host=[string]$config.host;hostname=[string]$config.hostname;stateRoot=[string]$config.stateRoot;profile=[string]$config.profile;enabled=$config.enabled;protocolVersion=$config.protocolVersion}
@{fence=[IO.File]::ReadAllText($base+'/b-on-a-maintenance.json');files=$rows;tripcom=$metadata}|ConvertTo-Json -Depth 4 -Compress
`;
        const result=JSON.parse(remoteB(script));
        const canonical=JSON.stringify(result.files.sort((a,b)=>a.file.localeCompare(b.file)));
        const stateSha=createHash('sha256').update(canonical).digest('hex');
        fs.writeFileSync(path.join(output,'state-snapshot.json'),JSON.stringify({...result,stateSha},null,2),{flag:'wx'});
        console.log(JSON.stringify({stateSha,files:result.files.length,locks:result.files.filter(x=>x.file.endsWith('.lock')).map(x=>x.file),tripcom:result.tripcom}));return;
    }
    if(action==='tripcom-files'){
        const result=JSON.parse(remoteB(String.raw`
$dir='C:/Users/ynal/AppData/Local/Tikitikit/tripcom-crawler/releases/parallel-v3-20260924'
$rows=@()
foreach($file in @(Get-ChildItem -LiteralPath $dir -File|Where-Object{$_.Name -match '^[a-z0-9_]+\.py$'})){
 if($file.LinkType -or $file.Length -gt 200000){throw 'unsafe_tripcom_release'}
 $rows+=@{file=[string]$file.Name;bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))}
}
ConvertTo-Json -InputObject $rows -Depth 3 -Compress
`));
        const target=path.join(output,'tripcom-source');fs.mkdirSync(target,{recursive:true});
        for(const row of result){
            if(!/^[a-z0-9_]+\.py$/.test(row.file))throw Error('invalid_python_file');
            const file=path.join(target,row.file),bytes=Buffer.from(row.bytes,'base64');
            if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(bytes))throw Error('tripcom_snapshot_changed');}
            else fs.writeFileSync(file,bytes,{flag:'wx'});
        }
        console.log(JSON.stringify({files:result.length,target}));return;
    }
    if(action==='stop-fenced-tripcom'){
        const result=JSON.parse(remoteB(String.raw`
$base='C:/Users/ynal/AppData/Local/Tikitikit'
if(!(Test-Path -LiteralPath ($base+'/b-on-a-maintenance.json'))){throw 'B_not_fenced'}
$name='TikitikitTripcomParallel'
[xml]$task=(& schtasks.exe /Query /TN $name /XML | Out-String)
if($LASTEXITCODE -ne 0 -or $task.Task.Settings.Enabled -ne 'false'){throw 'tripcom_fence_not_confirmed'}
$null=& schtasks.exe /End /TN $name 2>&1
$exit=$LASTEXITCODE
$configPath=$base+'/tripcom-crawler/connection/config-parallel.json'
$backup=$base+'/deployment-backups/b-on-a-20260926/config-parallel.json'
if(Test-Path -LiteralPath $backup){throw 'backup_exists_review_before_retry'}
[IO.File]::Copy($configPath,$backup,$false)
$config=[IO.File]::ReadAllText($configPath)|ConvertFrom-Json
$config.enabled=$false
[IO.File]::WriteAllText($configPath,($config|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$live=$scheduler.GetFolder('\').GetTask($name)
@{task=$name;enabled=[bool]$live.Enabled;state=[int]$live.State;endExit=$exit;configEnabled=$false;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
`));
        fs.writeFileSync(path.join(output,'stopped-tripcom.json'),JSON.stringify(result,null,2),{flag:'wx'});
        if(result.enabled!==false||result.state===4||result.configEnabled!==false)throw Error('B_tripcom_not_stopped');
        console.log(JSON.stringify(result));return;
    }
    if(action==='tripcom-state'){
        const result=JSON.parse(remoteB(String.raw`
$base='C:/Users/ynal/AppData/Local/Tikitikit'
if(!(Test-Path -LiteralPath ($base+'/b-on-a-maintenance.json'))){throw 'B_not_fenced'}
$state=$base+'/tripcom-crawler/state-v2'
$rows=@()
foreach($file in @(Get-ChildItem -LiteralPath $state -File -Recurse)){
 if($file.LinkType -or $file.Length -gt 4000000){throw 'unsafe_tripcom_state'}
 $relative=$file.FullName.Substring($state.Length+1).Replace('\','/')
 if($relative -match '^(circuit\.json|active\.lock|runs/[a-f0-9]{64}\.json|artifacts/[a-f0-9]{64}\.json)$'){
  $rows+=@{file=$relative;bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))}
 }
}
$xml=[IO.File]::ReadAllText($base+'/deployment-backups/b-on-a-20260926/tripcom-task.xml')
@{files=$rows;taskXml=$xml}|ConvertTo-Json -Depth 4 -Compress
`));
        const stateSha=createHash('sha256').update(JSON.stringify(result.files.sort((a,b)=>a.file.localeCompare(b.file)))).digest('hex');
        fs.writeFileSync(path.join(output,'tripcom-state.json'),JSON.stringify({...result,stateSha},null,2),{flag:'wx'});
        console.log(JSON.stringify({files:result.files.length,stateSha,locks:result.files.filter(x=>x.file.endsWith('.lock')).map(x=>x.file)}));return;
    }
    if(action==='tripcom-task'){
        const result=JSON.parse(remoteB(String.raw`
$file='C:/Users/ynal/AppData/Local/Tikitikit/deployment-backups/b-on-a-20260926/tripcom-task.xml'
@{taskXml=[IO.File]::ReadAllText($file)}|ConvertTo-Json -Compress
`));
        fs.writeFileSync(path.join(output,'tripcom-task.json'),JSON.stringify(result,null,2),{flag:'wx'});
        console.log(JSON.stringify({times:[...result.taskXml.matchAll(/<StartBoundary>(.*?)<\/StartBoundary>/g)].map(x=>x[1])}));return;
    }
    throw Error('explicit_transfer_operation_required');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
    main().catch(error=>{console.error(error.message);process.exitCode=1;});
