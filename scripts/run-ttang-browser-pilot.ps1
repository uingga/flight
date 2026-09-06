[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE 'tmp\chrome-debug'),
    [int]$Port = 9222,
    [switch]$AllDetails
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

& (Join-Path $ProjectDir 'scripts\start-ttang-debug-chrome.ps1') -ProfileDir $ProfileDir -Port $Port
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $ProjectDir
$StageArgs = @("--cdp=http://127.0.0.1:$Port")
if ($AllDetails) { $StageArgs += '--all-details' }
& npm.cmd run crawl:ttang:browser:stage -- @StageArgs
exit $LASTEXITCODE
