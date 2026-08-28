# Install the Naver crawler in a dedicated clean checkout and point Windows Task
# Scheduler at it. Keeping automation out of the developer checkout prevents
# unrelated edits and newly tracked files from blocking git pull.

[CmdletBinding()]
param(
    [string]$AutomationDir = (Join-Path $env:LOCALAPPDATA 'Tikitikit\naver-crawler'),
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$TaskName = 'TikitikitNaverCrawl'
$SourceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RepoUrl = (& git -C $SourceDir remote get-url origin | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or -not $RepoUrl) {
    throw 'Unable to determine the origin repository URL.'
}

$AutomationParent = Split-Path -Parent $AutomationDir
New-Item -ItemType Directory -Path $AutomationParent -Force | Out-Null

if (Test-Path (Join-Path $AutomationDir '.git')) {
    $dirty = & git -C $AutomationDir status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the automation checkout.' }
    if ($dirty) { throw "Automation checkout contains local changes: $AutomationDir" }

    & git -C $AutomationDir switch main
    if ($LASTEXITCODE -ne 0) { throw 'Unable to switch the automation checkout to main.' }
    & git -C $AutomationDir pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Unable to update the automation checkout.' }
} elseif (Test-Path $AutomationDir) {
    throw "Automation directory exists but is not a Git checkout: $AutomationDir"
} else {
    & git clone --branch main --single-branch $RepoUrl $AutomationDir
    if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the automation checkout.' }
}

Push-Location $AutomationDir
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in the automation checkout.' }

    & npx.cmd playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium installation failed.' }

    $marker = Join-Path $AutomationDir 'node_modules\.tikitikit-package-lock.sha256'
    (Get-FileHash -Algorithm SHA256 (Join-Path $AutomationDir 'package-lock.json')).Hash |
        Set-Content -Encoding ascii $marker
} finally {
    Pop-Location
}

$RunnerPath = Join-Path $AutomationDir 'scripts\run-naver-crawl.ps1'
$Action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`"" `
    -WorkingDirectory $AutomationDir
$Trigger = New-ScheduledTaskTrigger -Daily -At '14:30'
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 15)
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description '네이버 항공권 가격 수집(전용 자동화 저장소)' `
    -Force | Out-Null

Write-Output "Installed $TaskName"
Write-Output "Automation checkout: $AutomationDir"
Write-Output 'Schedule: daily at 14:30 KST'

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Output "Started $TaskName"
}
