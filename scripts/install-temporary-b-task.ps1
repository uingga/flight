[CmdletBinding()]
param([switch]$Prepare)
$ErrorActionPreference='Stop'
if(-not $Prepare -or $env:COMPUTERNAME -ne 'OFFICE-OMEN'){throw 'explicit_A_task_preparation_required'}
$root='C:/Users/ynal/Tikitikit/ac-control/b-on-a-20260926'
$activation=Get-Content -Raw -LiteralPath ($root+'/activation.json') -Encoding UTF8 | ConvertFrom-Json
if($activation.status -ne 'prepared'){throw 'prepared_installation_required'}
$name='TikitikitTripcomBReplacement'
if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'replacement_task_already_exists'}
$times=@('06:17','08:14','10:12','11:48','13:23','14:57','16:31','18:01','19:31','20:30')
$triggers=@($times|ForEach-Object{New-ScheduledTaskTrigger -Daily -At $_})
$program=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -Command "& ''C:/Program Files/nodejs/node.exe'' ''C:/Users/ynal/Tikitikit/ac-control/b-on-a-20260926/release/scripts/run-temporary-tripcom-b.mjs'' --scheduled; exit $LASTEXITCODE"'
$action=New-ScheduledTaskAction -Execute $program -Argument $arguments -WorkingDirectory ($root+'/release')
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
# No StartWhenAvailable or retry: missed slots stay missed; central admission
# and imported processed keys remain authoritative.
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$settings.Enabled=$false
$task=New-ScheduledTask -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Temporary physical A replacement for logical Trip.com worker B; same ten paired slots, central limits and imported B state.'
$null=Register-ScheduledTask -TaskName $name -InputObject $task
$registered=Get-ScheduledTask -TaskName $name
if($registered.State -ne 'Disabled' -or $registered.Triggers.Count -ne 10){throw 'disabled_replacement_task_not_verified'}
@{task=$name;state=[string]$registered.State;triggers=$times;startWhenAvailable=$registered.Settings.StartWhenAvailable}|ConvertTo-Json -Compress
