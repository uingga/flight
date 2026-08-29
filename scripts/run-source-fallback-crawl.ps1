# PC fallback for travel-agency sources paused on GitHub.
# It waits for the matching general crawl, then runs only sources with an active
# GitHub circuit. A successful PC crawl refreshes data without closing GitHub's
# 24-hour circuit.

[CmdletBinding()]
param(
    [switch]$Scheduled
)

$ErrorActionPreference = 'Continue'
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectDir 'data\source-fallback-local.log'
$CachePath = 'data/all-flights-cache.json'
$ManagedPaths = @($CachePath, 'data/crawl-log.json', 'data/interpark-prices.json')
$SessionCopy = Join-Path $env:TEMP "tikitikit-source-fallback-$PID.json"

Set-Location $ProjectDir

function Log($Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" | Add-Content -Encoding utf8 $LogFile
}

$RunMutex = New-Object System.Threading.Mutex($false, 'Local\TikitikitBlockedSourceCrawl')
if (-not $RunMutex.WaitOne(0)) {
    Log 'Another blocked-source fallback is already running; duplicate launch skipped'
    exit 0
}

Log '=== Local blocked-source fallback started ==='

$PreexistingChanges = git status --porcelain -- $ManagedPaths
if ($LASTEXITCODE -ne 0 -or $PreexistingChanges) {
    Log 'Managed data files are not clean; stopping without requests'
    exit 1
}

$PollSeconds = 120
$Sources = @()
while ($true) {
    $PullOutput = & git pull --rebase --autostash origin main 2>&1
    $PullExitCode = $LASTEXITCODE
    $PullOutput | Add-Content -Encoding utf8 $LogFile
    if ($PullExitCode -ne 0) {
        if (-not $Scheduled) {
            Log 'Git pull failed; stopping without requests'
            exit 1
        }
        Log "Git pull failed while waiting; retrying in $PollSeconds seconds"
    } else {
        $PolicyOutput = & node scripts/local-source-fallback-policy.mjs check --cache $CachePath 2>&1
        $PolicyExitCode = $LASTEXITCODE
        $PolicyText = ($PolicyOutput | Out-String).Trim()
        Log "fallback policy: $PolicyText"
        if ($PolicyExitCode -ne 0) {
            Log 'Unable to evaluate fallback policy; stopping without requests'
            exit 1
        }
        try {
            $Policy = $PolicyText | ConvertFrom-Json
        } catch {
            Log "Invalid fallback policy output: $($_.Exception.Message)"
            exit 1
        }
        if ($Policy.shouldRun) {
            $Sources = @($Policy.sources)
            break
        }
        if (-not $Scheduled -or $Policy.reason -ne 'upstream_pending') {
            Log "Fallback skipped by policy ($($Policy.reason))"
            Log '=== Local blocked-source fallback finished without requests ==='
            '' | Add-Content $LogFile
            exit 0
        }
    }

    if ($Policy -and $Policy.nextExpectedAt) {
        $Deadline = [DateTimeOffset]::Parse([string]$Policy.nextExpectedAt).AddMinutes(-1)
        $RemainingSeconds = [Math]::Floor(($Deadline - [DateTimeOffset]::UtcNow).TotalSeconds)
        if ($RemainingSeconds -le 0) {
            Log 'Matching GitHub crawl did not complete before the next slot; stopping without requests'
            exit 0
        }
        $SleepSeconds = [Math]::Min($PollSeconds, $RemainingSeconds)
    } else {
        $SleepSeconds = $PollSeconds
    }
    Log "Upstream pending; checking again in $SleepSeconds seconds without site requests"
    Start-Sleep -Seconds $SleepSeconds
}

if ($Sources.Count -eq 0) {
    Log 'No eligible source was returned; stopping without requests'
    exit 0
}

$DependencyMarker = Join-Path $ProjectDir 'node_modules\.tikitikit-package-lock.sha256'
$PackageLockHash = (Get-FileHash -Algorithm SHA256 (Join-Path $ProjectDir 'package-lock.json')).Hash
$InstalledHash = if (Test-Path $DependencyMarker) { (Get-Content -Raw $DependencyMarker).Trim() } else { '' }
if ($PackageLockHash -ne $InstalledHash) {
    Log 'Dependencies changed; running npm ci'
    npm.cmd ci --no-audit --no-fund 2>&1 | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) { Log 'npm ci failed'; exit 1 }
    npx.cmd playwright install chromium 2>&1 | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) { Log 'Playwright install failed'; exit 1 }
    $PackageLockHash | Set-Content -Encoding ascii $DependencyMarker
}

if ($Scheduled) {
    $StartJitterSeconds = Get-Random -Minimum 30 -Maximum 181
    Log "Scheduled start jitter: $StartJitterSeconds seconds"
    Start-Sleep -Seconds $StartJitterSeconds
}

$env:LOCAL_SOURCE_FALLBACK = '1'
$env:SOURCE_START_JITTER_MAX_MS = '90000'
$SourceArgument = "--sources=$($Sources -join ',')"
Log "PC fallback sources: $($Sources -join ', ')"
& npx.cmd --no-install tsx scripts/crawl-all.ts $SourceArgument 2>&1 | ForEach-Object {
    "$_" | Add-Content -Encoding utf8 $LogFile
}
$CrawlerExitCode = $LASTEXITCODE
if ($CrawlerExitCode -ne 0) {
    git checkout -- $ManagedPaths 2>$null
    Log "Crawler failed (exit $CrawlerExitCode); local result discarded"
    exit 1
}

try {
    Copy-Item -LiteralPath $CachePath -Destination $SessionCopy -Force -ErrorAction Stop
} catch {
    git checkout -- $ManagedPaths 2>$null
    Log "Unable to preserve fallback result: $($_.Exception.Message)"
    exit 1
}

$Published = $false
for ($Attempt = 1; $Attempt -le 2; $Attempt++) {
    git checkout -- $ManagedPaths 2>$null
    $PullOutput = & git pull --rebase --autostash origin main 2>&1
    $PullExitCode = $LASTEXITCODE
    $PullOutput | Add-Content -Encoding utf8 $LogFile
    if ($PullExitCode -ne 0) {
        Log "Remote refresh failed (attempt $Attempt); result copy preserved"
        exit 1
    }

    foreach ($Source in $Sources) {
        & node scripts/merge-cache-source.mjs $CachePath $SessionCopy $Source 2>&1 |
            ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($LASTEXITCODE -ne 0) {
            git checkout -- $ManagedPaths 2>$null
            Log "Source merge failed for $Source"
            exit 1
        }
    }

    $Dirty = git status --porcelain -- $CachePath
    if (-not $Dirty) {
        Log 'Merged cache is unchanged; commit skipped'
        $Published = $true
        break
    }

    git config user.name 'tikitikit-local-crawler'
    git config user.email 'local-crawler@tikitikit.invalid'
    git add -- $CachePath
    git commit --only -m 'chore(data): refresh blocked sources from PC [local]' -- $CachePath 2>&1 |
        ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $CachePath 2>$null
        git checkout -- $ManagedPaths 2>$null
        Log 'Unable to commit fallback cache'
        exit 1
    }

    git push origin main 2>&1 | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -eq 0) {
        Log "Fallback cache pushed (attempt $Attempt)"
        $Published = $true
        break
    }

    Log "Push failed (attempt $Attempt); refreshing remote data and retrying"
    if ($Attempt -lt 2) {
        git reset --soft HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
        if ($LASTEXITCODE -ne 0) { exit 1 }
        git reset HEAD -- $CachePath 2>&1 | Add-Content -Encoding utf8 $LogFile
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }
}

Remove-Item -LiteralPath $SessionCopy -Force -ErrorAction SilentlyContinue
if (-not $Published) {
    Log 'Fallback result could not be published'
    exit 1
}

Log '=== Local blocked-source fallback completed ==='
'' | Add-Content $LogFile
