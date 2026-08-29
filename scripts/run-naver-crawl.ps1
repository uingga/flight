# Naver flight crawler - Windows Task Scheduler entry point
#
# Pull GitHub data first, then fill up to 280 missing or stale routes across
# every agency. Successful prices refresh by KST calendar date: MyRealTrip daily,
# other agencies every two days. A browser-session circuit breaker controls retries.
#
# Schedule: daily at 14:30, with a no-duplicate 20:30 fallback when upstream data is late
# Manual:   powershell -File scripts\run-naver-crawl.ps1

[CmdletBinding()]
param(
    [switch]$Scheduled
)

$ErrorActionPreference = 'Continue'

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectDir 'data\naver-crawl-local.log'
$StateFile = Join-Path $env:LOCALAPPDATA 'Tikitikit\state\naver-crawl.json'
$SessionCopy = Join-Path $env:TEMP 'tikitikit-naver-session.json'
$HistorySessionCopy = Join-Path $env:TEMP 'tikitikit-naver-history-session.json'
$NaverDataPaths = @('data/naver-prices.json', 'data/naver-crawl-history.json', 'data/all-flights-cache.json')
$TodayPickPath = 'data/today-pick.json'
$ManagedPaths = $NaverDataPaths + $TodayPickPath

Set-Location $ProjectDir

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $LogFile
}

# Task Scheduler's IgnoreNew setting does not cover a manual PowerShell launch.
# A named mutex keeps every entry point on this Windows session single-instance.
$RunMutex = New-Object System.Threading.Mutex($false, 'Local\TikitikitNaverCrawl')
if (-not $RunMutex.WaitOne(0)) {
    Log 'Another local Naver crawl process is already active; duplicate launch skipped'
    exit 0
}

Log '=== Local Naver crawl started ==='

# These files are owned by this scheduled task. Refuse to run when they already
# contain local edits so the crawler cannot overwrite a user's in-progress work.
$PreexistingManagedChanges = git status --porcelain -- $ManagedPaths
if ($LASTEXITCODE -ne 0) {
    Log 'Unable to inspect managed data files; stopping before the crawl'
    exit 1
}
if ($PreexistingManagedChanges) {
    Log 'Managed data files already contain local changes; stopping without modifying them'
    exit 1
}

# Pull the latest GitHub data while preserving unrelated local changes. Naming
# origin/main explicitly avoids repositories with multiple branch merge entries.
$InitialPullOutput = & git pull --rebase --autostash origin main 2>&1
$InitialPullExitCode = $LASTEXITCODE
$InitialPullOutput | Add-Content -Encoding utf8 $LogFile
if ($InitialPullExitCode -ne 0) {
    Log 'Initial git pull failed; stopping before the crawl'
    exit 1
}

# The 14:30 trigger waits for both the post-11:56 general crawl and today's MRT
# refresh. The 20:30 trigger may use whichever upstream is ready. A successful or
# blocked browser session is never launched again on the same KST day.
$PolicyOutput = & node scripts/local-naver-run-policy.mjs check `
    --cache 'data/all-flights-cache.json' `
    --state $StateFile 2>&1
$PolicyExitCode = $LASTEXITCODE
$PolicyText = ($PolicyOutput | Out-String).Trim()
Log "run policy: $PolicyText"
if ($PolicyExitCode -ne 0) {
    Log 'Unable to evaluate local Naver run policy; stopping before browser launch'
    exit 1
}
try {
    $RunPolicy = $PolicyText | ConvertFrom-Json
} catch {
    Log "Invalid run policy output: $($_.Exception.Message)"
    exit 1
}
if (-not $RunPolicy.shouldRun) {
    Log "Browser launch skipped by policy ($($RunPolicy.reason))"
    Log '=== Local Naver crawl finished without requests ==='
    '' | Add-Content $LogFile
    exit 0
}

# Keep a dedicated automation checkout in sync with package-lock changes without
# paying the npm ci cost on every run.
$DependencyMarker = Join-Path $ProjectDir 'node_modules\.tikitikit-package-lock.sha256'
$PackageLockHash = (Get-FileHash -Algorithm SHA256 (Join-Path $ProjectDir 'package-lock.json')).Hash
$InstalledPackageLockHash = if (Test-Path $DependencyMarker) {
    (Get-Content -Raw $DependencyMarker).Trim()
} else {
    ''
}
if ($PackageLockHash -ne $InstalledPackageLockHash) {
    Log 'package-lock.json changed or dependencies are missing; running npm ci'
    npm.cmd ci --no-audit --no-fund 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) {
        Log 'npm ci failed; stopping before the crawl'
        exit 1
    }
    $PackageLockHash | Set-Content -Encoding ascii $DependencyMarker
}

# Fixed-time automation still gets a small random start offset, so requests do not
# begin at the exact same second every day. The mutex remains held during the wait.
if ($Scheduled) {
    $StartJitterSeconds = Get-Random -Minimum 30 -Maximum 601
    Log "Scheduled start jitter: $StartJitterSeconds seconds"
    Start-Sleep -Seconds $StartJitterSeconds
}

$RunningStateOutput = & node scripts/local-naver-run-policy.mjs mark `
    --state $StateFile `
    --outcome running `
    --reason 'browser_session_started' 2>&1
if ($LASTEXITCODE -ne 0) {
    Log 'Unable to open the local Naver circuit state; stopping before browser launch'
    exit 1
}
Log "circuit state: $(($RunningStateOutput | Out-String).Trim())"

# Crawl all agencies using the residential IP. This is the only production Naver
# browser session: GitHub Actions is limited to a read-only three-route diagnostic.
$env:HIDE_WINDOW = '1'
$env:SOURCE_FILTER = 'all'
$env:MAX_FLIGHTS = '280'
$env:REFRESH_DAYS = '2'
$env:MYREALTRIP_REFRESH_DAYS = '1'
$env:MISS_RETRY_HOURS = '24'
$env:ABORT_AFTER_MISSES = '3'
$env:MAX_HEALTH_CHECKS = '1'
$env:REQUEST_DELAY_MIN_MS = '5000'
$env:REQUEST_DELAY_MAX_MS = '10000'
$env:BATCH_SIZE = '10'
$env:BATCH_REST_MIN_MS = '60000'
$env:BATCH_REST_MAX_MS = '120000'
npx.cmd --no-install tsx scripts/crawl-naver.ts 2>&1 | ForEach-Object {
    # Add-Content per line keeps the log readable while the long crawl is running.
    "$_" | Add-Content -Encoding utf8 $LogFile
}
$CrawlerExitCode = $LASTEXITCODE
$HistoryOnly = $CrawlerExitCode -ne 0
$CircuitOutcome = 'success'
$CircuitReason = 'crawler_completed'
if ($HistoryOnly) {
    Log "Crawler exited abnormally (exit $CrawlerExitCode); partial prices will be discarded and history only will be preserved"
    $CircuitOutcome = 'degraded'
    $CircuitReason = "crawler_exit_$CrawlerExitCode"
    try {
        $LatestLocalEntry = (Get-Content -Raw -Encoding utf8 'data/naver-crawl-history.json' | ConvertFrom-Json).entries |
            Where-Object { $_.runner -eq 'local' } |
            Sort-Object { [DateTimeOffset]::Parse($_.timestamp) } |
            Select-Object -Last 1
        if (($LatestLocalEntry.blocked -as [int]) -gt 0 -or $LatestLocalEntry.abortReason -match '403|429|CAPTCHA|접근 제한') {
            $CircuitOutcome = 'blocked'
            $CircuitReason = [string]$LatestLocalEntry.abortReason
        } elseif ($LatestLocalEntry.abortReason) {
            $CircuitReason = [string]$LatestLocalEntry.abortReason
        }
    } catch {
        Log "Unable to classify crawler failure for cooldown: $($_.Exception.Message)"
    }
}
$FinishedStateOutput = & node scripts/local-naver-run-policy.mjs mark `
    --state $StateFile `
    --outcome $CircuitOutcome `
    --reason $CircuitReason 2>&1
if ($LASTEXITCODE -ne 0) {
    Log 'Unable to persist the post-crawl circuit state; automatic retry remains disabled by the scheduled-task configuration'
} else {
    Log "circuit state: $(($FinishedStateOutput | Out-String).Trim())"
}

# Preserve this session, merge it onto the latest remote data, then push.
$DataPublished = $false
for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
        if (-not $HistoryOnly) {
            Copy-Item data/naver-prices.json $SessionCopy -Force -ErrorAction Stop
        }
        Copy-Item data/naver-crawl-history.json $HistorySessionCopy -Force -ErrorAction Stop
    } catch {
        Log "Unable to preserve crawler session files: $($_.Exception.Message)"
        exit 1
    }

    git checkout -- $NaverDataPaths 2>$null
    $MergePullOutput = & git pull --rebase --autostash origin main 2>&1
    $MergePullExitCode = $LASTEXITCODE
    $MergePullOutput | Add-Content -Encoding utf8 $LogFile
    if ($MergePullExitCode -ne 0) {
        Log "Remote refresh failed (attempt $attempt); session copies were preserved"
        exit 1
    }

    if (-not $HistoryOnly) {
        npx --no-install tsx scripts/merge-naver-prices.mjs data/naver-prices.json $SessionCopy 2>&1 | Add-Content -Encoding utf8 $LogFile
        $PriceMergeExitCode = $LASTEXITCODE
        Log "merge exit=$PriceMergeExitCode"
        if ($PriceMergeExitCode -ne 0) {
            git checkout -- $NaverDataPaths 2>$null
            Log 'Price merge failed; managed data files were restored and session copies were preserved'
            exit 1
        }
    }
    node scripts/merge-naver-crawl-history.mjs data/naver-crawl-history.json $HistorySessionCopy 2>&1 | Add-Content -Encoding utf8 $LogFile
    $HistoryMergeExitCode = $LASTEXITCODE
    Log "history merge exit=$HistoryMergeExitCode"
    if ($HistoryMergeExitCode -ne 0) {
        git checkout -- $NaverDataPaths 2>$null
        Log 'History merge failed; managed data files were restored and session copies were preserved'
        exit 1
    }
    if (-not $HistoryOnly) {
        npx --no-install tsx scripts/filter-by-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
        $FilterExitCode = $LASTEXITCODE
        Log "filter exit=$FilterExitCode"
        if ($FilterExitCode -ne 0) {
            git checkout -- $NaverDataPaths 2>$null
            Log 'Filtering failed; managed data files were restored and session copies were preserved'
            exit 1
        }
    }

    $dirty = if ($HistoryOnly) {
        git status --porcelain data/naver-crawl-history.json
    } else {
        git status --porcelain data/naver-prices.json data/naver-crawl-history.json data/all-flights-cache.json
    }
    if (-not $dirty) {
        Log 'No data changes; commit skipped'
        if (-not $HistoryOnly) {
            $DataPublished = $true
        }
        break
    }

    $CommitPaths = if ($HistoryOnly) {
        @('data/naver-crawl-history.json')
    } else {
        @('data/naver-prices.json', 'data/naver-crawl-history.json', 'data/all-flights-cache.json')
    }
    $CommitMessage = if ($HistoryOnly) {
        'chore(data): record failed naver crawl [local]'
    } else {
        'chore(data): update naver prices + filter flights [local]'
    }

    git add -- $CommitPaths
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $CommitPaths 2>$null
        git checkout -- $CommitPaths 2>$null
        Log 'Staging managed data failed; managed files were restored and session copies were preserved'
        exit 1
    }

    # --only prevents unrelated files that the user may already have staged from
    # being swept into the crawler's automated commit.
    git commit --only -m $CommitMessage -- $CommitPaths 2>&1 | Add-Content -Encoding utf8 $LogFile
    $CommitExitCode = $LASTEXITCODE
    if ($CommitExitCode -ne 0) {
        git reset HEAD -- $CommitPaths 2>$null
        git checkout -- $CommitPaths 2>$null
        Log "Data commit failed (exit $CommitExitCode); managed files were restored and session copies were preserved"
        exit 1
    }
    git push origin main 2>&1 | Add-Content -Encoding utf8 $LogFile

    if ($LASTEXITCODE -eq 0) {
        if ($HistoryOnly) {
            Log "Failed-run history commit and push completed (attempt $attempt)"
        } else {
            Log "Commit and push completed (attempt $attempt)"
            $DataPublished = $true
        }
        break
    }

    Log "Push failed (attempt $attempt); refreshing remote data and retrying"
    if ($attempt -lt 2) {
        # Undo only the data commit. A soft reset plus path-scoped index reset
        # preserves any unrelated staged work while exposing this session for
        # the next merge attempt.
        git reset --soft HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
        if ($LASTEXITCODE -ne 0) {
            Log 'Unable to prepare the data commit for retry; the local commit was preserved'
            exit 1
        }
        git reset HEAD -- $CommitPaths 2>&1 | Add-Content -Encoding utf8 $LogFile
        if ($LASTEXITCODE -ne 0) {
            Log 'Unable to reset managed paths for retry; stopping with session files preserved'
            exit 1
        }
    }
    if ($attempt -eq 2) {
        Log 'Retry failed; clean local data commit is preserved for the next run'
    }
}

if ($HistoryOnly) {
    Log "=== Local Naver crawl failed; partial prices discarded (exit $CrawlerExitCode) ==="
    '' | Add-Content $LogFile
    exit 1
}

if (-not $DataPublished) {
    Log 'Naver data could not be published; today pick repair was skipped'
    '' | Add-Content $LogFile
    exit 1
}

# Validate the existing pick only after the successful Naver filter is on main
# and the deployed API has caught up. A concurrent data commit causes the next
# attempt to pull the new main and run --repair again instead of overwriting it.
$TodayPickChecked = $false
for ($repairAttempt = 1; $repairAttempt -le 2; $repairAttempt++) {
    git pull --ff-only origin main 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        Log "Unable to refresh main before today pick repair (attempt $repairAttempt)"
        exit 1
    }

    node scripts/wait-for-flight-api-cache.mjs 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) {
        Log 'The deployed flight API did not catch up; today pick repair was skipped'
        exit 1
    }

    node scripts/select-today-pick.mjs --repair 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) {
        git checkout -- $TodayPickPath 2>$null
        Log 'Today pick repair check failed; the existing selection was restored'
        exit 1
    }

    $TodayPickDirty = git status --porcelain -- $TodayPickPath
    if (-not $TodayPickDirty) {
        Log 'Today pick remains valid; repair commit skipped'
        $TodayPickChecked = $true
        break
    }

    git add -- $TodayPickPath
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $TodayPickPath 2>$null
        git checkout -- $TodayPickPath 2>$null
        Log 'Unable to stage today pick repair; the existing selection was restored'
        exit 1
    }

    git commit --only -m 'chore(data): repair today pick after naver crawl [local]' -- $TodayPickPath 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $TodayPickPath 2>$null
        git checkout -- $TodayPickPath 2>$null
        Log 'Unable to commit today pick repair; the existing selection was restored'
        exit 1
    }

    git push origin main 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -eq 0) {
        Log "Today pick repair commit and push completed (attempt $repairAttempt)"
        $TodayPickChecked = $true
        break
    }

    Log "Today pick push failed (attempt $repairAttempt); refreshing main and checking again"
    git reset --soft HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to undo the unpushed today pick commit'
        exit 1
    }
    git reset HEAD -- $TodayPickPath 2>&1 | Add-Content -Encoding utf8 $LogFile
    git checkout -- $TodayPickPath 2>$null
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to restore today pick before retry'
        exit 1
    }
}

if (-not $TodayPickChecked) {
    Log 'Today pick repair could not be published after two attempts'
    '' | Add-Content $LogFile
    exit 1
}

Log '=== Local Naver crawl finished ==='
'' | Add-Content $LogFile
