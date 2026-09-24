# A-only 20:30 PC agency round. This is not the GitHub blocked-source fallback.
[CmdletBinding()]
param([switch]$Scheduled)

$ErrorActionPreference = 'Continue'
if (-not $Scheduled -or [Environment]::MachineName.ToUpperInvariant() -ne 'OFFICE-OMEN') {
    throw 'scheduled_A_evening_only'
}
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ManagedPaths = @('data/all-flights-cache.json', 'data/crawl-log.json', 'data/interpark-prices.json')
$CachePath = 'data/all-flights-cache.json'
$LogPath = 'data/crawl-log.json'
$LogFile = Join-Path $ProjectDir 'data/agency-evening-local.log'
Set-Location $ProjectDir

function Log($Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" | Add-Content -Encoding utf8 $LogFile
}

& node (Join-Path $ProjectDir 'scripts/writer-preflight.mjs') source-fallback
if ($LASTEXITCODE -ne 0) { throw 'writer_preflight_refused' }
$Preexisting = git status --porcelain -- $ManagedPaths
if ($LASTEXITCODE -ne 0 -or $Preexisting) { throw 'managed_data_not_clean' }

$RunMutex = New-Object System.Threading.Mutex($false, 'Local\TikitikitBlockedSourceCrawl')
if (-not $RunMutex.WaitOne(0)) { Log 'Other agency collection owns the shared mutex; evening skipped'; exit 0 }
try {
    $CConfigPath = Join-Path $ProjectDir '.local-crawler/agency-evening-config.json'
    if (-not (Test-Path -LiteralPath $CConfigPath)) { throw 'C_connection_config_missing' }
    $CConfig = Get-Content -LiteralPath $CConfigPath -Raw | ConvertFrom-Json
    if (-not $CConfig.args -or -not $CConfig.version) { throw 'C_connection_config_invalid' }
    $env:AGENCY_EVENING_C_SSH_ARGS_JSON = ConvertTo-Json -InputObject @($CConfig.args) -Compress
    $env:AGENCY_EVENING_RELEASE_VERSION = [string]$CConfig.version

    $KstNow = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(9))
    $Deadline = [DateTimeOffset]::Parse($KstNow.ToString('yyyy-MM-dd') + 'T20:45:00+09:00')
    do {
        $Pull = & git pull --rebase --autostash origin main 2>&1
        $Pull | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($LASTEXITCODE -ne 0) { throw 'main_refresh_failed_before_evening' }
        $Output = & npx.cmd --no-install tsx scripts/run-agency-evening.ts --scheduled 2>&1
        $RunExit = $LASTEXITCODE
        $Output | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($RunExit -ne 0) { throw 'evening_dispatch_failed_preserve_claims' }
        $Lines = @($Output | ForEach-Object { "$_" })
        $Result = $Lines[-1] | ConvertFrom-Json
        if ($Result.status -ne 'upstream_pending') { break }
        $Remaining = [Math]::Floor(($Deadline - [DateTimeOffset]::UtcNow).TotalSeconds)
        if ($Remaining -le 0) { Log '19:31 upstream did not finish before evening window; no site requests'; exit 0 }
        $SleepSeconds = [Math]::Min(120, $Remaining)
        Log "19:31 upstream pending; rechecking in $SleepSeconds seconds"
        Start-Sleep -Seconds $SleepSeconds
    } while ($true)
    if ($Result.status -eq 'no_sources') { Log 'No eligible 20:30 sources; no site request or publication'; exit 0 }
    if ($Result.status -notin @('verified', 'partial') -or -not $Result.sources) { throw 'evening_result_invalid' }
    $Sources = @($Result.sources)
    $OverlayCache = [IO.Path]::GetFullPath([string]$Result.cachePath)
    $OverlayLog = [IO.Path]::GetFullPath([string]$Result.logPath)
    $StateRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Tikitikit/agency-evening-dispatch'))
    if (-not $OverlayCache.StartsWith($StateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not $OverlayLog.StartsWith($StateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $OverlayCache) -or -not (Test-Path -LiteralPath $OverlayLog)) {
        throw 'evening_overlay_path_invalid'
    }

    $Pull = & git pull --rebase --autostash origin main 2>&1
    $Pull | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) { throw 'main_refresh_failed_after_evening_result_preserved' }
    foreach ($Source in $Sources) {
        $PreviousAllowEmptySource = $env:ALLOW_EMPTY_SOURCE
        try {
            $env:ALLOW_EMPTY_SOURCE = if ($Source -eq 'onlinetour' -and @($Result.verifiedEmptySources) -contains $Source) { '1' } else { '0' }
            & node scripts/merge-cache-source.mjs $CachePath $OverlayCache $Source 2>&1 |
                ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        } finally { $env:ALLOW_EMPTY_SOURCE = $PreviousAllowEmptySource }
        if ($LASTEXITCODE -ne 0) { throw "evening_source_merge_failed_$Source" }
    }
    & node scripts/merge-crawl-log.mjs $LogPath $OverlayLog ($Sources -join ',') 2>&1 |
        ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) { throw 'evening_log_merge_failed' }

    $Dirty = git status --porcelain -- $CachePath $LogPath
    if (-not $Dirty) { Log 'Evening verified result made no data change'; exit 0 }
    git config user.name 'tikitikit-local-crawler'
    git config user.email 'local-crawler@tikitikit.invalid'
    git add -- $CachePath $LogPath
    & git commit --only -m 'chore(data): publish 20:30 PC agency round [local]' -- $CachePath $LogPath 2>&1 |
        ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) { throw 'evening_commit_failed_result_preserved' }
    & node (Join-Path $ProjectDir 'scripts/writer-push.mjs') source-fallback origin main 2>&1 |
        ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) { throw 'evening_writer_refused_result_preserved' }
    Log "Evening published sources: $($Sources -join ', ')"
} finally {
    $RunMutex.ReleaseMutex()
    $RunMutex.Dispose()
}
