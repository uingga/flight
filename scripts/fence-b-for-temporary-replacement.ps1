param([switch]$Apply)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($env:COMPUTERNAME.ToUpperInvariant() -ne 'DESKTOP-OFFICE'){throw 'physical_B_required'}
$base='C:/Users/ynal/AppData/Local/Tikitikit'
$backup=Join-Path $base 'deployment-backups/b-on-a-20260926'
$marker=Join-Path $base 'b-on-a-maintenance.json'
$entries=@('collector/run.mjs','agency-evening-v2/scripts/mrt-c-worker.mjs','agency-evening-v2/scripts/agency-evening-runtime.mjs')
function NativeTask([string]$Arguments) {
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName="$env:SystemRoot/System32/schtasks.exe";$info.Arguments=$Arguments
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($info)
 $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
 if(!$child.WaitForExit(8000)){$child.Kill();throw 'task_command_timeout'}
 if($child.ExitCode -ne 0){throw 'task_command_failed'}
 return [string]$stdout.Result
}
$taskXml=NativeTask '/Query /TN TikitikitTripcomParallel /XML'
[xml]$task=$taskXml
if([string]$task.Task.Actions.Exec.Arguments -notmatch '/tripcom-crawler/run-worker-parallel.ps1$'){throw 'unexpected_tripcom_task'}
$before=@()
foreach($relative in $entries){
 $file=Join-Path $base $relative
 if(!(Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).LinkType){throw 'invalid_worker_entry'}
 $before+=@{file=$relative;sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
}
if(!$Apply){@{mode='inspect';taskEnabled=[string]$task.Task.Settings.Enabled;entries=$before}|ConvertTo-Json -Depth 4 -Compress;exit 0}
if(Test-Path -LiteralPath $marker){throw 'replacement_already_fenced_review_receipt'}
if(Test-Path -LiteralPath $backup){throw 'backup_exists_review_before_retry'}
New-Item -ItemType Directory -Path $backup|Out-Null
[IO.File]::WriteAllText((Join-Path $backup 'tripcom-task.xml'),$taskXml,[Text.Encoding]::Unicode)
foreach($relative in $entries){
 $copy=Join-Path $backup $relative
 New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force|Out-Null
 Copy-Item -LiteralPath (Join-Path $base $relative) -Destination $copy -ErrorAction Stop
}
$proof=@{id='b-on-a-20260926';physicalHost='B';status='fenced';at=[DateTime]::UtcNow.ToString('o');entries=$before;tripcomPreviouslyEnabled=[string]$task.Task.Settings.Enabled}
[IO.File]::WriteAllText($marker,($proof|ConvertTo-Json -Depth 4 -Compress),[Text.UTF8Encoding]::new($false))
$guard="import {existsSync as temporaryMaintenanceExists} from 'node:fs';`nif(temporaryMaintenanceExists('C:/Users/ynal/AppData/Local/Tikitikit/b-on-a-maintenance.json')){process.stderr.write('B worker in temporary maintenance; no collection started\n');process.exit(72);}`n"
foreach($relative in $entries){
 $file=Join-Path $base $relative
 $prior=[IO.File]::ReadAllText((Join-Path $backup $relative))
 [IO.File]::WriteAllText($file,$guard+$prior,[Text.UTF8Encoding]::new($false))
}
$null=NativeTask '/Change /TN TikitikitTripcomParallel /DISABLE'
[xml]$after=NativeTask '/Query /TN TikitikitTripcomParallel /XML'
if([string]$after.Task.Settings.Enabled -ne 'false'){throw 'tripcom_fence_not_confirmed'}
# Do not stop a running task here. A must separately prove zero B admissions
# before ending the already-stuck scheduler process. This script never clears state.
$proof.fenceSha=(Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash.ToLowerInvariant()
$proof.tripcomEnabled=$false
[IO.File]::WriteAllText((Join-Path $backup 'receipt.json'),($proof|ConvertTo-Json -Depth 4 -Compress),[Text.UTF8Encoding]::new($false))
$proof|ConvertTo-Json -Depth 4 -Compress
