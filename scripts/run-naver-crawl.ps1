# Naver flight crawler - Windows Task Scheduler entry point
#
# Pull GitHub data first, then share one 200-navigation KST-day budget across
# the fresh 11:12 sources, the 14:23 recovery pass, and a manual-only 17:31 pass.
#
# Schedule: 11:12 initial pass, 14:23 recovery pass, 17:31 startup/manual-capture fallback
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
$RunStatusFile = Join-Path $env:TEMP 'tikitikit-naver-run-status.json'
$NaverDataPaths = @('data/naver-prices.json', 'data/naver-crawl-history.json', 'data/all-flights-cache.json')
$TodayPickPath = 'data/today-pick.json'
$ManagedPaths = $NaverDataPaths + $TodayPickPath

Set-Location $ProjectDir

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $LogFile
}

function Restore-InterruptedRunState {
    if (-not (Test-Path -LiteralPath $StateFile)) { return $true }

    try {
        $ExistingState = Get-Content -Raw -Encoding utf8 $StateFile | ConvertFrom-Json
    } catch {
        Log "Unable to read the existing Naver state: $($_.Exception.Message)"
        return $false
    }
    if ($ExistingState.phase -ne 'running') { return $true }

    $RequestsStarted = $null
    try {
        if (Test-Path -LiteralPath $RunStatusFile) {
            $InterruptedStatus = Get-Content -Raw -Encoding utf8 $RunStatusFile | ConvertFrom-Json
            if ($null -ne $InterruptedStatus.requestsStarted) {
                $RequestsStarted = [Math]::Max(0, [int]$InterruptedStatus.requestsStarted)
            }
        }
    } catch {
        Log "Unable to read the interrupted crawler status; request count remains unknown: $($_.Exception.Message)"
    }

    $RecoveryPlanArgs = @(
        'scripts/local-naver-run-policy.mjs',
        'interrupted-plan',
        '--state', $StateFile
    )
    if ($null -ne $RequestsStarted) {
        $RecoveryPlanArgs += @('--requests-started', [string]$RequestsStarted)
    }
    $RecoveryPlanOutput = & node @RecoveryPlanArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "Unable to plan interrupted Naver recovery: $((($RecoveryPlanOutput | Out-String).Trim()))"
        return $false
    }
    try {
        $RecoveryPlan = ($RecoveryPlanOutput | Out-String).Trim() | ConvertFrom-Json
    } catch {
        Log "Invalid interrupted Naver recovery plan: $($_.Exception.Message)"
        return $false
    }
    $RecoveredNavigations = [Math]::Max(0, [int]$RecoveryPlan.navigationIncrement)
    $CompletedSourceCsv = @($RecoveryPlan.completedSources | Where-Object { $_ }) -join ','
    $PendingSourceCsv = @($RecoveryPlan.pendingSources | Where-Object { $_ }) -join ','

    # The scheduled checkout owns these generated files. A terminated browser can
    # leave partial prices behind, so discard them before the next scheduled phase.
    git restore --source=HEAD --worktree -- $ManagedPaths
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to restore managed data after an interrupted Naver crawl'
        return $false
    }

    Remove-Item -LiteralPath $StateFile -Force
    Remove-Item -LiteralPath $RunStatusFile -Force -ErrorAction SilentlyContinue

    $NowKstDate = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(9)).ToString('yyyy-MM-dd')
    if ([string]$ExistingState.kstDate -ne $NowKstDate) {
        Log "Removed stale Naver running state from $($ExistingState.kstDate); partial generated data was discarded"
        return $true
    }

    $MarkArgs = @(
        'scripts/local-naver-run-policy.mjs',
        'mark',
        '--state', $StateFile,
        '--outcome', [string]$RecoveryPlan.outcome,
        '--reason', [string]$RecoveryPlan.reason,
        '--navigation-increment', [string]$RecoveredNavigations
    )
    if ($CompletedSourceCsv) { $MarkArgs += @('--completed-sources', $CompletedSourceCsv) }
    if ($PendingSourceCsv) { $MarkArgs += @('--pending-sources', $PendingSourceCsv) }
    $RecoveredStateOutput = & node @MarkArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to persist the recovered Naver state after an interrupted run'
        return $false
    }
    Log "Recovered interrupted Naver crawl state: $(($RecoveredStateOutput | Out-String).Trim())"
    return $true
}

# Task Scheduler's IgnoreNew setting does not cover a manual PowerShell launch.
# A named mutex keeps every entry point on this Windows session single-instance.
$RunMutex = New-Object System.Threading.Mutex($false, 'Local\TikitikitNaverCrawl')
if (-not $RunMutex.WaitOne(0)) {
    Log 'Another local Naver crawl process is already active; duplicate launch skipped'
    exit 0
}

Log '=== Local Naver crawl started ==='

if (-not (Restore-InterruptedRunState)) {
    exit 1
}

# These files are owned by this scheduled task. Refuse to run only when their
# actual content differs from HEAD. `git status` can briefly report a restored
# large JSON file as modified when only its index metadata is stale, which must
# not block recovery after an interrupted crawl.
git diff --quiet -- $ManagedPaths
$WorktreeDiffExitCode = $LASTEXITCODE
git diff --cached --quiet -- $ManagedPaths
$IndexDiffExitCode = $LASTEXITCODE
if ($WorktreeDiffExitCode -gt 1 -or $IndexDiffExitCode -gt 1) {
    Log 'Unable to inspect managed data file contents; stopping before the crawl'
    exit 1
}
if ($WorktreeDiffExitCode -eq 1 -or $IndexDiffExitCode -eq 1) {
    Log 'Managed data files already contain local changes; stopping without modifying them'
    exit 1
}

# Each trigger waits for its matching general-crawl commit. The first pass crawls
# only sources refreshed after 11:12. Preserved sources wait for the 14:23 crawl
# and share the original daily navigation budget. Polling never opens Naver.
$UpstreamPollSeconds = 120
$KstOffset = [TimeSpan]::FromHours(9)
$FinalizeOnly = $false
while ($true) {
    # Naming origin/main explicitly avoids repositories with multiple branch
    # merge entries. Scheduled pull failures are retried without browser traffic.
    $PullOutput = & git pull --rebase --autostash origin main 2>&1
    $PullExitCode = $LASTEXITCODE
    $PullOutput | Add-Content -Encoding utf8 $LogFile
    if ($PullExitCode -ne 0) {
        if (-not $Scheduled) {
            Log 'Initial git pull failed; stopping before the crawl'
            exit 1
        }
        Log "Git pull failed while waiting for upstream; retrying in $UpstreamPollSeconds seconds"
    } else {
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
        if ($RunPolicy.shouldRun) {
            break
        }
        if ($RunPolicy.shouldFinalize) {
            $FinalizeOnly = $true
            Log "No recovery browser session needed; finalizing with sources: $($RunPolicy.allowedTodayPickSources -join ',')"
            break
        }
        if (-not $Scheduled -or $RunPolicy.reason -notin @('upstream_pending', 'recovery_upstream_pending', 'no_fresh_sources')) {
            Log "Browser launch skipped by policy ($($RunPolicy.reason))"
            Log '=== Local Naver crawl finished without requests ==='
            '' | Add-Content $LogFile
            exit 0
        }
    }

    $NowKst = [DateTimeOffset]::UtcNow.ToOffset($KstOffset)
    $WaitDeadlineKst = [DateTimeOffset]::new(
        $NowKst.Year,
        $NowKst.Month,
        $NowKst.Day,
        18,
        30,
        0,
        $KstOffset
    )
    if ($NowKst -ge $WaitDeadlineKst) {
        Log 'No usable general-crawl result was available after the 17:31 final slot; stopping without Naver requests'
        Log '=== Local Naver crawl finished without requests ==='
        '' | Add-Content $LogFile
        exit 0
    }

    $RemainingSeconds = [Math]::Max(1, [Math]::Floor(($WaitDeadlineKst - $NowKst).TotalSeconds))
    $SleepSeconds = [Math]::Min($UpstreamPollSeconds, $RemainingSeconds)
    Log "Upstream pending; checking again in $SleepSeconds seconds without Naver requests"
    Start-Sleep -Seconds $SleepSeconds
}

$RunSources = @($RunPolicy.sources | Where-Object { $_ })
$PendingSources = @($RunPolicy.pendingSources | Where-Object { $_ })
$PreviouslyCompletedSources = @($RunPolicy.completedSources | Where-Object { $_ })
$AllowedTodayPickSources = @($RunPolicy.allowedTodayPickSources | Where-Object { $_ })
$RunSourceCsv = $RunSources -join ','
$PendingSourceCsv = $PendingSources -join ','
$PreviouslyCompletedSourceCsv = $PreviouslyCompletedSources -join ','

if ($FinalizeOnly) {
    $FinishedStateOutput = & node scripts/local-naver-run-policy.mjs mark `
        --state $StateFile `
        --outcome success `
        --reason $RunPolicy.reason `
        --completed-sources $PreviouslyCompletedSourceCsv `
        --pending-sources $PendingSourceCsv 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to finalize the split Naver state without a browser session'
        exit 1
    }
    Log "circuit state: $(($FinishedStateOutput | Out-String).Trim())"
    $DataPublished = $true
    $PartialPricesAllowed = $false
    $HistoryOnly = $false
} else {

# Keep the scheduled checkout in sync with package-lock changes without paying
# the npm ci cost on every run.
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
    npx.cmd playwright install chromium 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) {
        Log 'Playwright Chromium installation failed; stopping before the crawl'
        exit 1
    }
    $PackageLockHash | Set-Content -Encoding ascii $DependencyMarker
}

# Keep a short random offset after upstream completion so Naver requests do not
# begin at an identical clock second every day. The mutex remains held while waiting.
if ($Scheduled) {
    $StartJitterSeconds = Get-Random -Minimum 30 -Maximum 181
    Log "Scheduled start jitter: $StartJitterSeconds seconds"
    Start-Sleep -Seconds $StartJitterSeconds
}

# A previous process must not leave a stale request count that could be mistaken
# for this browser session if Windows terminates us before crawl-naver.ts starts.
Remove-Item -LiteralPath $RunStatusFile -Force -ErrorAction SilentlyContinue
$RunningStateOutput = & node scripts/local-naver-run-policy.mjs mark `
    --state $StateFile `
    --outcome running `
    --reason "browser_session_started_$($RunPolicy.runPhase)" `
    --completed-sources $PreviouslyCompletedSourceCsv `
    --pending-sources $PendingSourceCsv `
    --running-sources $RunSourceCsv 2>&1
if ($LASTEXITCODE -ne 0) {
    Log 'Unable to open the local Naver circuit state; stopping before browser launch'
    exit 1
}
Log "circuit state: $(($RunningStateOutput | Out-String).Trim())"

# Crawl only the sources selected for this phase. GitHub Actions remains limited
# to a read-only three-route diagnostic.
$env:HIDE_WINDOW = '1'
$env:NAVER_LIVE_RUN = '1'
$env:SOURCE_FILTER = $RunSourceCsv
$env:MAX_FLIGHTS = [string]$RunPolicy.navigationBudget
$env:MAX_NAVIGATIONS = [string]$RunPolicy.navigationBudget
$env:STANDARD_REFRESH_DAYS = '2'
$env:PRIORITY_REFRESH_DAYS = '2'
$env:PRIORITY_DEPARTURE_DAYS = '14'
$env:PRIORITY_DISCOUNT_RATE = '20'
$env:TOP_CANDIDATE_COUNT = '50'
$env:LOW_CANDIDATE_RATIO = '0.3'
$env:MAX_DEFER_DAYS = '7'
$env:PRICE_CHANGE_AMOUNT = '10000'
$env:PRICE_CHANGE_RATIO = '0.03'
$env:ABORT_AFTER_MISSES = '3'
$env:MAX_HEALTH_CHECKS = '1'
$env:REQUEST_DELAY_MIN_MS = '5000'
$env:REQUEST_DELAY_MAX_MS = '10000'
$env:BATCH_SIZE = '10'
$env:BATCH_REST_MIN_MS = '60000'
$env:BATCH_REST_MAX_MS = '120000'
$env:MAX_TRANSIENT_RESUMES = '1'
$env:TRANSIENT_RESUME_MIN_MS = '600000'
$env:TRANSIENT_RESUME_MAX_MS = '1200000'
$env:NAVER_RUN_STATUS_FILE = $RunStatusFile
$CrawlerAttempt = 0
$PreRequestRetryCount = 0
while ($true) {
    $CrawlerAttempt++
    Remove-Item -LiteralPath $RunStatusFile -Force -ErrorAction SilentlyContinue
    npx.cmd --no-install tsx scripts/crawl-naver.ts 2>&1 | ForEach-Object {
        # Add-Content per line keeps the log readable while the long crawl is running.
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    $CrawlerExitCode = $LASTEXITCODE

    $RequestsStarted = $null
    try {
        if (Test-Path -LiteralPath $RunStatusFile) {
            $RunStatus = Get-Content -Raw -Encoding utf8 $RunStatusFile | ConvertFrom-Json
            $RequestsStarted = $RunStatus.requestsStarted -as [int]
            Log "crawler attempt $CrawlerAttempt status: stage=$($RunStatus.stage), requestsStarted=$RequestsStarted, exit=$CrawlerExitCode"
        }
    } catch {
        Log "Unable to read crawler run status: $($_.Exception.Message)"
    }

    $CanRetryBeforeRequest = $CrawlerExitCode -ne 0 `
        -and $RequestsStarted -eq 0 `
        -and $PreRequestRetryCount -lt 1
    if (-not $CanRetryBeforeRequest) { break }

    $PreRequestRetryCount++
    $RetryDelaySeconds = Get-Random -Minimum 900 -Maximum 1801
    Log "Crawler failed before any Naver request; retrying once in $RetryDelaySeconds seconds"
    Start-Sleep -Seconds $RetryDelaySeconds
}
Remove-Item -LiteralPath $RunStatusFile -Force -ErrorAction SilentlyContinue
$PartialPricesAllowed = $CrawlerExitCode -eq 2
$HistoryOnly = $CrawlerExitCode -ne 0 -and -not $PartialPricesAllowed
$CircuitOutcome = 'success'
$CircuitReason = 'crawler_completed'
if ($CrawlerExitCode -ne 0) {
    if ($PartialPricesAllowed) {
        Log "Crawler stopped after the allowed transient resume (exit $CrawlerExitCode); successful partial prices will be published"
    } else {
        Log "Crawler exited unsafely (exit $CrawlerExitCode); partial prices will be discarded and history only will be preserved"
    }
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
$StateCompletedSourceCsv = $PreviouslyCompletedSourceCsv
if ($CircuitOutcome -eq 'success') {
    $StateCompletedSourceCsv = @($PreviouslyCompletedSources + $RunSources | Select-Object -Unique) -join ','
    if ($RunPolicy.deferTodayPick) {
        $CircuitOutcome = 'partial_waiting'
        $CircuitReason = 'waiting_for_14_23_recovery'
    }
}
$NavigationIncrement = if ($null -eq $RequestsStarted) { 0 } else { [Math]::Max(0, [int]$RequestsStarted) }
$FinishedStateOutput = & node scripts/local-naver-run-policy.mjs mark `
    --state $StateFile `
    --outcome $CircuitOutcome `
    --reason $CircuitReason `
    --completed-sources $StateCompletedSourceCsv `
    --pending-sources $PendingSourceCsv `
    --navigation-increment $NavigationIncrement 2>&1
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
        if ($CrawlerExitCode -eq 0 -and $RunSources -contains 'modetour') {
            $ManualCaptureOutput = & node scripts/local-naver-run-policy.mjs complete-manual-capture `
                --cache 'data/all-flights-cache.json' `
                --history 'data/naver-crawl-history.json' `
                --sources $RunSourceCsv 2>&1
            $ManualCaptureExitCode = $LASTEXITCODE
            Log "manual capture naver state: $((($ManualCaptureOutput | Out-String).Trim()))"
            if ($ManualCaptureExitCode -ne 0) {
                git checkout -- $NaverDataPaths 2>$null
                Log 'Unable to update the manual capture Naver queue state; managed files were restored'
                exit 1
            }
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
    } elseif ($PartialPricesAllowed) {
        'chore(data): publish partial naver prices [local]'
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
    Log 'Naver data could not be published; today pick selection was skipped'
    '' | Add-Content $LogFile
    exit 1
}

if ($PartialPricesAllowed) {
    Log '=== Local Naver crawl partially published after transient errors; today pick selection skipped ==='
    '' | Add-Content $LogFile
    exit 1
}

if ($RunPolicy.deferTodayPick) {
    Log "=== Initial Naver phase finished; waiting for 14:23 sources: $PendingSourceCsv ==="
    '' | Add-Content $LogFile
    exit 0
}
}

# Select the daily pick only after the successful Naver filter is on main and
# the deployed API has caught up. The selector keeps an existing same-day pick,
# so retries cannot replace a selection that was already published today.
$TodayPickSelected = $false
$env:TODAY_PICK_SOURCE_FILTER = $AllowedTodayPickSources -join ','
Log "Today pick source filter: $env:TODAY_PICK_SOURCE_FILTER"
for ($selectionAttempt = 1; $selectionAttempt -le 2; $selectionAttempt++) {
    git pull --ff-only origin main 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        Log "Unable to refresh main before today pick selection (attempt $selectionAttempt)"
        exit 1
    }

    node scripts/wait-for-flight-api-cache.mjs 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) {
        Log 'The deployed flight API did not catch up; today pick selection was skipped'
        exit 1
    }

    node scripts/select-today-pick.mjs 2>&1 | ForEach-Object {
        "$_" | Add-Content -Encoding utf8 $LogFile
    }
    if ($LASTEXITCODE -ne 0) {
        git checkout -- $TodayPickPath 2>$null
        Log 'Today pick selection failed; the existing selection was restored'
        exit 1
    }

    $TodayPickDirty = git status --porcelain -- $TodayPickPath
    if (-not $TodayPickDirty) {
        Log 'Today pick selection produced no file change; commit skipped'
        $TodayPickSelected = $true
        break
    }

    git add -- $TodayPickPath
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $TodayPickPath 2>$null
        git checkout -- $TodayPickPath 2>$null
        Log 'Unable to stage today pick selection; the existing selection was restored'
        exit 1
    }

    git commit --only -m 'chore(data): select today pick after naver crawl [local]' -- $TodayPickPath 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        git reset HEAD -- $TodayPickPath 2>$null
        git checkout -- $TodayPickPath 2>$null
        Log 'Unable to commit today pick selection; the existing selection was restored'
        exit 1
    }

    git push origin main 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -eq 0) {
        Log "Today pick selection commit and push completed (attempt $selectionAttempt)"
        $TodayPickSelected = $true
        break
    }

    Log "Today pick push failed (attempt $selectionAttempt); refreshing main and selecting again"
    git reset --soft HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to undo the unpushed today pick commit'
        exit 1
    }
    git reset HEAD -- $TodayPickPath 2>&1 | Add-Content -Encoding utf8 $LogFile
    git checkout -- $TodayPickPath 2>$null
    if ($LASTEXITCODE -ne 0) {
        Log 'Unable to restore today pick before selection retry'
        exit 1
    }
}

if (-not $TodayPickSelected) {
    Log 'Today pick selection could not be published after two attempts'
    '' | Add-Content $LogFile
    exit 1
}

Log '=== Local Naver crawl finished ==='
'' | Add-Content $LogFile
