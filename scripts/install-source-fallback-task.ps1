# Install the blocked-source PC fallback in a dedicated clean checkout.

[CmdletBinding()]
param(
    [string]$AutomationDir = (Join-Path $env:USERPROFILE 'Tikitikit\source-fallback-crawler'),
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$TaskName = 'TikitikitBlockedSourceCrawl'
$SourceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RepoUrl = [string]((& git -C $SourceDir remote get-url origin 2>&1) | Select-Object -First 1)
$RepoUrl = $RepoUrl.Trim()
if ($LASTEXITCODE -ne 0 -or -not $RepoUrl) { throw 'Unable to determine the origin repository URL.' }

$AutomationParent = Split-Path -Parent $AutomationDir
New-Item -ItemType Directory -Path $AutomationParent -Force | Out-Null

if (Test-Path (Join-Path $AutomationDir '.git')) {
    $Dirty = & git -C $AutomationDir status --porcelain
    if ($LASTEXITCODE -ne 0 -or $Dirty) { throw "Automation checkout is not clean: $AutomationDir" }
    & git -C $AutomationDir switch main
    if ($LASTEXITCODE -ne 0) { throw 'Unable to switch automation checkout to main.' }
    & git -C $AutomationDir pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Unable to update automation checkout.' }
} elseif (Test-Path $AutomationDir) {
    throw "Automation directory exists but is not a Git checkout: $AutomationDir"
} else {
    & git clone --branch main --single-branch $RepoUrl $AutomationDir
    if ($LASTEXITCODE -ne 0) { throw 'Unable to clone automation checkout.' }
}

Push-Location $AutomationDir
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in the automation checkout.' }
    & npx.cmd playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium installation failed.' }
    $Marker = Join-Path $AutomationDir 'node_modules\.tikitikit-package-lock.sha256'
    (Get-FileHash -Algorithm SHA256 (Join-Path $AutomationDir 'package-lock.json')).Hash |
        Set-Content -Encoding ascii $Marker
} finally {
    Pop-Location
}

$RunnerPath = Join-Path $AutomationDir 'scripts\run-source-fallback-crawl.ps1'
if (-not (Test-Path $RunnerPath)) { throw "Fallback runner not found: $RunnerPath" }
$PowerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Action = New-ScheduledTaskAction `
    -Execute $PowerShellPath `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`" -Scheduled"
$Triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '08:17'),
    (New-ScheduledTaskTrigger -Daily -At '11:12'),
    (New-ScheduledTaskTrigger -Daily -At '14:23'),
    (New-ScheduledTaskTrigger -Daily -At '17:31')
)
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -RunOnlyIfNetworkAvailable `
    -WakeToRun `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Triggers `
    -Settings $Settings `
    -Principal $Principal `
    -Description 'GitHub 차단 휴식 중인 여행사만 PC 회선으로 대체 수집' `
    -Force | Out-Null

Write-Output "Installed $TaskName"
Write-Output "Automation checkout: $AutomationDir"
Write-Output 'Schedule: 08:17, 11:12, 14:23, 17:31 KST; active GitHub circuits only'

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Output "Started $TaskName"
}
