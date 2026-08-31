# Install the Naver crawler in a dedicated clean checkout and point Windows Task
# Scheduler at it. AppData is avoided because this PC's scheduler rejects scripts
# there with 0xFFFD0000; the user-profile path remains isolated from active dev tools.

[CmdletBinding()]
param(
    [string]$AutomationDir = (Join-Path $env:USERPROFILE 'Tikitikit\naver-crawler'),
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$TaskName = 'TikitikitNaverCrawl'
$SourceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RepoUrlOutput = & git -C $SourceDir remote get-url origin 2>&1
$RepoUrlExitCode = $LASTEXITCODE
$RepoUrl = [string]($RepoUrlOutput | Select-Object -First 1)
$RepoUrl = $RepoUrl.Trim()
if ($RepoUrlExitCode -ne 0 -or -not $RepoUrl) {
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
if (-not (Test-Path $RunnerPath)) {
    throw "Naver runner not found: $RunnerPath"
}
$PowerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Action = New-ScheduledTaskAction `
    -Execute $PowerShellPath `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`" -Scheduled"
$Triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '11:12'),
    (New-ScheduledTaskTrigger -Daily -At '14:23'),
    (New-ScheduledTaskTrigger -Daily -At '17:31')
)
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
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
    -Description '네이버 항공권 가격 수집(주거용 IP, 소스별 2단계, KST 하루 합산 200회)' `
    -Force | Out-Null

Write-Output "Installed $TaskName"
Write-Output "Automation checkout: $AutomationDir"
Write-Output 'Schedule: 11:12 initial pass, 14:23 recovery pass, 17:31 startup fallback'

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Output "Started $TaskName"
}
