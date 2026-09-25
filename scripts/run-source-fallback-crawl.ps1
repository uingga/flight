# PC-primary sources may collect beside the matching GitHub round. Publication
# waits for that round; GitHub-failure fallback sources are evaluated afterward.

[CmdletBinding()]
param(
    [switch]$Scheduled
)

$ErrorActionPreference = 'Continue'
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
& node (Join-Path $ProjectDir 'scripts/writer-preflight.mjs') source-fallback
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$LogFile = Join-Path $ProjectDir 'data\source-fallback-local.log'
$CachePath = 'data/all-flights-cache.json'
$ManagedPaths = @($CachePath, 'data/crawl-log.json', 'data/interpark-prices.json')
$SessionCopy = Join-Path $env:TEMP "tikitikit-source-fallback-$PID.json"
$LogSessionCopy = Join-Path $env:TEMP "tikitikit-source-fallback-log-$PID.json"
$LateSessionCopy = Join-Path $env:TEMP "tikitikit-source-fallback-late-$PID.json"
$LateLogSessionCopy = Join-Path $env:TEMP "tikitikit-source-fallback-late-log-$PID.json"

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
        # A merge conflict cannot heal by repeating pull. Leave the evidence intact,
        # release this scheduled task, and never hold a later Naver round open.
        $Unmerged = @(git ls-files -u)
        if ($Unmerged.Count -gt 0) {
            Log 'Git pull left unmerged files; stopping without site requests for review'
            exit 1
        }
        if (-not $Scheduled) {
            Log 'Git pull failed; stopping without requests'
            exit 1
        }
        Log "Git pull failed while waiting; retrying in $PollSeconds seconds"
    } else {
        $PolicyOutput = & node scripts/pc-collection-policy.mjs check --cache $CachePath 2>&1
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
            if ($Policy.githubFallbackDue) {
                & node scripts/dispatch-online-github-fallback.mjs 2>&1 | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
                if ($LASTEXITCODE -ne 0) { Log 'GitHub fallback dispatch failed'; exit 1 }
            }
            Log "Fallback skipped by policy ($($Policy.reason))"
            Log '=== Local blocked-source fallback finished without requests ==='
            '' | Add-Content $LogFile
            exit 0
        }
    }

    if ($Policy -and $Policy.nextExpectedAt) {
        $Deadline = if ($Policy.eveningSlot -and $Policy.expectedAt) {
            [DateTimeOffset]::Parse([string]$Policy.expectedAt).AddHours(1)
        } else {
            [DateTimeOffset]::Parse([string]$Policy.nextExpectedAt).AddMinutes(-1)
        }
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
$env:ONLINETOUR_BROWSER_REMOTE = if (Test-Path -LiteralPath (Join-Path $ProjectDir '.local-crawler\onlinetour-remote.json')) { '1' } else { '0' }
$env:MODETOUR_BROWSER_REMOTE = if (Test-Path -LiteralPath (Join-Path $ProjectDir '.local-crawler\modetour-remote.json')) { '1' } else { '0' }
$env:SOURCE_START_JITTER_MAX_MS = '90000'
$TtangPrimaryEnabled = (& node --input-type=module -e "import {TTANG_BROWSER_PRIMARY as p} from './src/lib/browser-primary-config.mjs';console.log(p.enabled ? '1' : '0')") -eq '1'
if ($LASTEXITCODE -ne 0) { Log 'Unable to read Ttang ownership config'; exit 1 }
$LegacySources = @($Sources | Where-Object { $_ -ne 'ttang' -or -not $TtangPrimaryEnabled })
$SourceArgument = "--sources=$($LegacySources -join ',')"
Log "PC fallback sources: $($Sources -join ', ')"
if ($LegacySources.Count -gt 0) {
& npx.cmd --no-install tsx scripts/crawl-all.ts $SourceArgument 2>&1 | ForEach-Object {
    "$_" | Add-Content -Encoding utf8 $LogFile
}
$CrawlerExitCode = $LASTEXITCODE
if ($CrawlerExitCode -ne 0) {
    git checkout -- $ManagedPaths 2>$null
    Log "Crawler failed (exit $CrawlerExitCode); local result discarded"
    exit 1
}
}
if ($TtangPrimaryEnabled -and $Sources -contains 'ttang') {
    & npx.cmd --no-install tsx scripts/run-ttang-remote-primary.ts --scheduled 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) { Log 'Ttang worker preflight failed; result retained locally'; exit 1 }
}

try {
    Copy-Item -LiteralPath $CachePath -Destination $SessionCopy -Force -ErrorAction Stop
    Copy-Item -LiteralPath 'data/crawl-log.json' -Destination $LogSessionCopy -Force -ErrorAction Stop
} catch {
    git checkout -- $ManagedPaths 2>$null
    Log "Unable to preserve fallback result: $($_.Exception.Message)"
    exit 1
}
$EarlySources = @($Sources)

# PC-primary browsers may collect alongside GitHub, but GitHub must publish
# its general snapshot before this source-scoped result is merged and written.
# The preserved session copies let us refresh main without repeating site requests.
try {
    $ExpectedGeneralAt = [DateTimeOffset]::Parse([string]$Policy.expectedAt)
    $ObservedGeneralAt = [DateTimeOffset]::Parse([string]$Policy.fullCrawlUpdatedAt)
    $WaitForGeneral = $ObservedGeneralAt -lt $ExpectedGeneralAt
    $GeneralDeadline = if ($Policy.eveningSlot) {
        $ExpectedGeneralAt.AddHours(1)
    } else {
        [DateTimeOffset]::Parse([string]$Policy.nextExpectedAt).AddMinutes(-1)
    }
} catch {
    Log 'Unable to establish the general-round publication boundary; saved result retained'
    exit 1
}

# The legacy GitHub-failure fallbacks still depend on the current general result.
# Re-evaluate them after that result lands; an early PC-primary start must not
# silently drop a new Yellow Balloon or HanaTour fallback from this same slot.
$LateSources = @()
$LateCollectionFailed = $false
if ($WaitForGeneral) {
    git checkout -- $ManagedPaths 2>$null
    while ($true) {
        $PullOutput = & git pull --rebase --autostash origin main 2>&1
        $PullExitCode = $LASTEXITCODE
        $PullOutput | Add-Content -Encoding utf8 $LogFile
        if ($PullExitCode -ne 0) {
            Log 'Remote refresh failed while awaiting general publication; result copy preserved'
            exit 1
        }
        try {
            # Scheduled tasks use Windows PowerShell 5.1, whose default file
            # encoding is the system code page. Cache JSON is always UTF-8.
            $LatestCache = Get-Content -LiteralPath $CachePath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            $CurrentGeneralAt = [DateTimeOffset]::Parse([string]$LatestCache.fullCrawlUpdatedAt)
        } catch {
            # Do not log Exception.Message: ConvertFrom-Json can include the
            # entire input. Retain exact recovery paths and a bounded error ID.
            Log "Unable to verify general-round publication ($($_.FullyQualifiedErrorId)); result copies preserved at $SessionCopy and $LogSessionCopy"
            exit 1
        }
        if ($CurrentGeneralAt -ge $ExpectedGeneralAt) {
            Log 'Matching general round published; checking newly eligible PC fallbacks'
            break
        }
        $RemainingSeconds = [Math]::Floor(($GeneralDeadline - [DateTimeOffset]::UtcNow).TotalSeconds)
        if ($RemainingSeconds -le 0) {
            Log "Matching general round missed the publication deadline; result copies preserved at $SessionCopy and $LogSessionCopy"
            exit 1
        }
        $SleepSeconds = [Math]::Min($PollSeconds, $RemainingSeconds)
        Log "PC-primary result saved; waiting $SleepSeconds seconds for matching general publication without site requests"
        Start-Sleep -Seconds $SleepSeconds
    }

    $AfterPolicyOutput = & node scripts/pc-collection-policy.mjs check --cache $CachePath 2>&1
    if ($LASTEXITCODE -ne 0) { Log 'Unable to re-evaluate PC fallbacks; early result copy preserved'; exit 1 }
    try { $AfterPolicy = ($AfterPolicyOutput | Out-String).Trim() | ConvertFrom-Json -ErrorAction Stop }
    catch { Log 'Invalid post-GitHub fallback policy; early result copy preserved'; exit 1 }
    if ($AfterPolicy.expectedAt -ne $Policy.expectedAt) {
        Log 'PC fallback slot advanced during collection; early result copy preserved without another site request'
        exit 1
    }
    $LateSources = @($AfterPolicy.fallbackSources | Where-Object { $EarlySources -notcontains $_ })
    if ($LateSources.Count -gt 0) {
        Log "New GitHub-failure PC fallbacks for the same slot: $($LateSources -join ', ')"
        $LateArgument = "--sources=$($LateSources -join ',')"
        & npx.cmd --no-install tsx scripts/crawl-all.ts $LateArgument 2>&1 |
            ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($LASTEXITCODE -ne 0) {
            Log 'Post-GitHub fallback collection failed; publishing the saved PC-primary result only'
            $LateCollectionFailed = $true
        } else {
            try {
                Copy-Item -LiteralPath $CachePath -Destination $LateSessionCopy -Force -ErrorAction Stop
                Copy-Item -LiteralPath 'data/crawl-log.json' -Destination $LateLogSessionCopy -Force -ErrorAction Stop
            } catch {
                Log 'Unable to preserve post-GitHub fallback result; publishing the saved PC-primary result only'
                $LateCollectionFailed = $true
            }
        }
        if ($LateCollectionFailed) {
            git checkout -- $ManagedPaths 2>$null
            $LateSources = @()
        }
    }
}

$Sources = @($EarlySources) + @($LateSources)
$Published = $false
for ($Attempt = 1; $Attempt -le 2; $Attempt++) {
    git checkout -- $ManagedPaths 2>$null
    $PullOutput = & git pull --rebase --autostash origin main 2>&1
    $PullExitCode = $LASTEXITCODE
    $PullOutput | Add-Content -Encoding utf8 $LogFile
    if ($PullExitCode -ne 0) {
        Log "Remote refresh failed (attempt $Attempt); result copies preserved"
        exit 1
    }

    foreach ($Source in $EarlySources) {
        & node scripts/merge-cache-source.mjs $CachePath $SessionCopy $Source 2>&1 |
            ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($LASTEXITCODE -ne 0) {
            git checkout -- $ManagedPaths 2>$null
            Log "Source merge failed for $Source"
            exit 1
        }
    }
    foreach ($Source in $LateSources) {
        & node scripts/merge-cache-source.mjs $CachePath $LateSessionCopy $Source 2>&1 |
            ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($LASTEXITCODE -ne 0) {
            git checkout -- $ManagedPaths 2>$null
            Log "Post-GitHub source merge failed for $Source"
            exit 1
        }
    }

    & node scripts/merge-crawl-log.mjs 'data/crawl-log.json' $LogSessionCopy ($EarlySources -join ',') 2>&1 |
        ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) {
        git checkout -- $ManagedPaths 2>$null
        Log 'PC fallback crawl-log merge failed'
        exit 1
    }
    if ($LateSources.Count -gt 0) {
        & node scripts/merge-crawl-log.mjs 'data/crawl-log.json' $LateLogSessionCopy ($LateSources -join ',') 2>&1 |
            ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
        if ($LASTEXITCODE -ne 0) {
            git checkout -- $ManagedPaths 2>$null
            Log 'Post-GitHub fallback crawl-log merge failed'
            exit 1
        }
    }

    $Dirty = git status --porcelain -- $CachePath 'data/crawl-log.json'
    if (-not $Dirty) {
        Log 'Merged cache and crawl log are unchanged; commit skipped'
        $Published = $true
        break
    }

    git config user.name 'tikitikit-local-crawler'
    git config user.email 'local-crawler@tikitikit.invalid'
    git add -- $CachePath 'data/crawl-log.json'
    git commit --only -m 'chore(data): refresh blocked sources from PC [local]' -- $CachePath 'data/crawl-log.json' 2>&1 |
        ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $CachePath 'data/crawl-log.json' 2>$null
        git checkout -- $ManagedPaths 2>$null
        Log 'Unable to commit fallback cache and crawl log'
        exit 1
    }

    $PushOutput = @(& node (Join-Path $ProjectDir 'scripts/writer-push.mjs') source-fallback origin main 2>&1)
    $PushExitCode = $LASTEXITCODE
    $PushOutput | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
    if ($PushExitCode -eq 0) {
        Log "Fallback cache pushed (attempt $Attempt)"
        $Published = $true
        break
    }

    if ($env:NAVER_COORDINATION -eq '1') {
        $Diagnostic = $null
        foreach ($Line in $PushOutput) {
            try {
                $Candidate = "$Line" | ConvertFrom-Json -ErrorAction Stop
                if ($Candidate.event -eq 'writer-publication-error') { $Diagnostic = $Candidate }
            } catch { }
        }
        if ($Attempt -lt 2 -and $Diagnostic.code -eq 'WRITER_PRECOMMIT_BASE_CHANGED' -and
            $Diagnostic.outcome -eq 'refused' -and $Diagnostic.newRequestAllowed -eq $true) {
            # The writer has not submitted a commit request. Keep the exact result
            # reachable, then re-merge the saved source copies onto the new main.
            $LocalCommit = (& git rev-parse HEAD).Trim()
            if ($LASTEXITCODE -ne 0 -or $LocalCommit -notmatch '^[a-f0-9]{40}$') { exit 1 }
            & git update-ref "refs/tikitikit-publication/$LocalCommit" $LocalCommit 2>&1 | Add-Content -Encoding utf8 $LogFile
            if ($LASTEXITCODE -ne 0) { exit 1 }
            & git reset --soft HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
            if ($LASTEXITCODE -ne 0) { exit 1 }
            & git reset HEAD -- $CachePath 'data/crawl-log.json' 2>&1 | Add-Content -Encoding utf8 $LogFile
            if ($LASTEXITCODE -ne 0) { exit 1 }
            Log 'Writer base advanced before commit; re-merging saved result once without site requests'
            continue
        }
        Log 'Coordinated publication refused; preserve local result and do not retry or bypass the writer claim'
        exit 1
    }
    Log "Push failed (attempt $Attempt); refreshing remote data and retrying"
    if ($Attempt -lt 2) {
        git reset --soft HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
        if ($LASTEXITCODE -ne 0) { exit 1 }
        git reset HEAD -- $CachePath 'data/crawl-log.json' 2>&1 | Add-Content -Encoding utf8 $LogFile
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }
}

if (-not $Published) {
    Log 'Fallback result could not be published'
    exit 1
}
Remove-Item -LiteralPath $SessionCopy -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LogSessionCopy -Force -ErrorAction SilentlyContinue
if ($LateSources.Count -gt 0) {
    Remove-Item -LiteralPath $LateSessionCopy -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $LateLogSessionCopy -Force -ErrorAction SilentlyContinue
}
& node scripts/dispatch-online-github-fallback.mjs 2>&1 | ForEach-Object { "$_" | Add-Content -Encoding utf8 $LogFile }
if ($LASTEXITCODE -ne 0) { Log 'GitHub fallback dispatch failed after PC outcome publication'; exit 1 }
if ($LateCollectionFailed) {
    Log 'PC-primary result published; post-GitHub fallback requires separate review without automatic retry'
    exit 1
}
Log '=== Local PC collection completed ==='
'' | Add-Content $LogFile
