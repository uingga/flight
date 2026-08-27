# Naver flight crawler - Windows Task Scheduler entry point
#
# Pull GitHub data first, then fill up to 280 missing or stale routes across
# every agency. Successful prices refresh by KST calendar date: MyRealTrip daily,
# other agencies every two days. Failed searches retry after 6 hours.
#
# Schedule: daily at 14:30 (Windows task TikitikitNaverCrawl; moved from 04:00 on 2026-08-18)
# Manual:   powershell -File scripts\run-naver-crawl.ps1

$ErrorActionPreference = 'Continue'

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectDir 'data\naver-crawl-local.log'
$SessionCopy = Join-Path $env:TEMP 'tikitikit-naver-session.json'
$HistorySessionCopy = Join-Path $env:TEMP 'tikitikit-naver-history-session.json'

Set-Location $ProjectDir

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $LogFile
}

Log '=== Local Naver crawl started ==='

# These files are owned by this scheduled task. Refuse to run when they already
# contain local edits so the crawler cannot overwrite a user's in-progress work.
$PreexistingManagedChanges = git status --porcelain -- data/naver-prices.json data/naver-crawl-history.json data/all-flights-cache.json
if ($LASTEXITCODE -ne 0) {
    Log 'Unable to inspect managed data files; stopping before the crawl'
    exit 1
}
if ($PreexistingManagedChanges) {
    Log 'Managed data files already contain local changes; stopping without modifying them'
    exit 1
}

# Pull the latest GitHub data while preserving unrelated local changes.
git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile
if ($LASTEXITCODE -ne 0) {
    Log 'Initial git pull failed; stopping before the crawl'
    exit 1
}

# Crawl all agencies using the residential IP, with KST calendar-day refresh rules.
$env:HIDE_WINDOW = '1'
$env:SOURCE_FILTER = 'all'
$env:MAX_FLIGHTS = '280'
$env:REFRESH_DAYS = '2'
$env:MYREALTRIP_REFRESH_DAYS = '1'
$env:MISS_RETRY_HOURS = '6'
npx --no-install tsx scripts/crawl-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
$CrawlerExitCode = $LASTEXITCODE
$HistoryOnly = $CrawlerExitCode -ne 0
if ($HistoryOnly) {
    Log "Crawler exited abnormally (exit $CrawlerExitCode); partial prices will be discarded and history only will be preserved"
}

# Preserve this session, merge it onto the latest remote data, then push.
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

    git checkout -- data/naver-prices.json data/naver-crawl-history.json data/all-flights-cache.json 2>$null
    git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) {
        Log "Remote refresh failed (attempt $attempt); session copies were preserved"
        exit 1
    }

    if (-not $HistoryOnly) {
        npx --no-install tsx scripts/merge-naver-prices.mjs data/naver-prices.json $SessionCopy 2>&1 | Add-Content -Encoding utf8 $LogFile
        $PriceMergeExitCode = $LASTEXITCODE
        Log "merge exit=$PriceMergeExitCode"
        if ($PriceMergeExitCode -ne 0) {
            git checkout -- data/naver-prices.json data/naver-crawl-history.json data/all-flights-cache.json 2>$null
            Log 'Price merge failed; managed data files were restored and session copies were preserved'
            exit 1
        }
    }
    node scripts/merge-naver-crawl-history.mjs data/naver-crawl-history.json $HistorySessionCopy 2>&1 | Add-Content -Encoding utf8 $LogFile
    $HistoryMergeExitCode = $LASTEXITCODE
    Log "history merge exit=$HistoryMergeExitCode"
    if ($HistoryMergeExitCode -ne 0) {
        git checkout -- data/naver-prices.json data/naver-crawl-history.json data/all-flights-cache.json 2>$null
        Log 'History merge failed; managed data files were restored and session copies were preserved'
        exit 1
    }
    if (-not $HistoryOnly) {
        npx --no-install tsx scripts/filter-by-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
        $FilterExitCode = $LASTEXITCODE
        Log "filter exit=$FilterExitCode"
        if ($FilterExitCode -ne 0) {
            git checkout -- data/naver-prices.json data/naver-crawl-history.json data/all-flights-cache.json 2>$null
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

Log '=== Local Naver crawl finished ==='
'' | Add-Content $LogFile
