[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE 'tmp\chrome-debug'),
    [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 | Out-Null
    Write-Output "Chrome debug port $Port is already ready."
    exit 0
} catch { }

$ResolvedProfile = [System.IO.Path]::GetFullPath($ProfileDir)
if (-not (Test-Path -LiteralPath $ResolvedProfile -PathType Container)) {
    throw "전용 Chrome 프로필이 없습니다: $ResolvedProfile`nchacha95/automation 방식으로 한 번만 프로필을 준비한 뒤 다시 실행해주세요."
}

$CandidateRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) |
    Where-Object { $_ }
$ChromeCandidates = @($CandidateRoots | ForEach-Object {
    Join-Path $_ 'Google\Chrome\Application\chrome.exe'
} | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })

if ($ChromeCandidates.Count -eq 0) {
    throw 'Google Chrome 실행 파일을 찾지 못했습니다.'
}

$ChromeArgs = @(
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    "--user-data-dir=$ResolvedProfile"
)

# 사람이 현재 상태를 확인할 수 있는 전용 Chrome이므로 창을 표시한다.
Start-Process -FilePath $ChromeCandidates[0] -ArgumentList $ChromeArgs | Out-Null

for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 | Out-Null
        Write-Output "Chrome debug port $Port is ready with profile: $ResolvedProfile"
        exit 0
    } catch { }
}

throw "Chrome이 실행됐지만 $Port 디버그 포트가 15초 안에 열리지 않았습니다."
