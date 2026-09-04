[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE 'tmp\chrome-debug'),
    [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir

$PolicyText = & node scripts/local-source-fallback-policy.mjs check --cache data/all-flights-cache.json
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub 수집 상태를 확인하지 못했습니다.'
}
$Policy = $PolicyText | ConvertFrom-Json
$TtangEligible = $Policy.shouldRun -and (@($Policy.sources) -contains 'ttang')
if (-not $TtangEligible) {
    Write-Output "Ttang browser fallback skipped: $($Policy.reason)"
    exit 0
}

& (Join-Path $ProjectDir 'scripts\start-ttang-debug-chrome.ps1') -ProfileDir $ProfileDir -Port $Port
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm.cmd run crawl:ttang:browser:stage -- "--cdp=http://127.0.0.1:$Port" --fallback
exit $LASTEXITCODE
