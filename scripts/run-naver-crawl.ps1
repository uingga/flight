# Naver flight crawler - Windows Task Scheduler entry point
#
# Pull GitHub data first, then fill up to 280 missing or stale routes across
# every agency. MyRealTrip prices refresh daily; other successful prices refresh
# every 48 hours. Failed searches retry after 6 hours.
#
# Schedule: daily at 04:00
# Manual:   powershell -File scripts\run-naver-crawl.ps1

$ErrorActionPreference = 'Continue'

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectDir 'data\naver-crawl-local.log'
$SessionCopy = Join-Path $env:TEMP 'tikitikit-naver-session.json'

Set-Location $ProjectDir

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $LogFile
}

Log '=== Local Naver crawl started ==='

# Pull the latest GitHub data while preserving unrelated local changes.
git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile

# Crawl all agencies using the residential IP, with a two-day freshness window.
$env:HIDE_WINDOW = '1'
$env:SOURCE_FILTER = 'all'
$env:MAX_FLIGHTS = '280'
$env:FRESH_HOURS = '48'
$env:MYREALTRIP_FRESH_HOURS = '24'
$env:MISS_RETRY_HOURS = '6'
npx --no-install tsx scripts/crawl-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
if ($LASTEXITCODE -ne 0) {
    Log "Crawler exited abnormally (exit $LASTEXITCODE); stopping this run"
    exit 1
}

# Preserve this session, merge it onto the latest remote data, then push.
for ($attempt = 1; $attempt -le 2; $attempt++) {
    Copy-Item data/naver-prices.json $SessionCopy -Force

    git checkout -- data/naver-prices.json data/all-flights-cache.json 2>$null
    git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile

    npx --no-install tsx scripts/merge-naver-prices.mjs data/naver-prices.json $SessionCopy 2>&1 | Add-Content -Encoding utf8 $LogFile
    Log "merge exit=$LASTEXITCODE"
    npx --no-install tsx scripts/filter-by-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
    Log "filter exit=$LASTEXITCODE"

    $dirty = git status --porcelain data/naver-prices.json data/all-flights-cache.json
    if (-not $dirty) {
        Log 'No data changes; commit skipped'
        break
    }

    git add data/naver-prices.json data/all-flights-cache.json
    git commit -m 'chore(data): update naver prices + filter flights [local]' 2>&1 | Add-Content -Encoding utf8 $LogFile
    git push origin main 2>&1 | Add-Content -Encoding utf8 $LogFile

    if ($LASTEXITCODE -eq 0) {
        Log "Commit and push completed (attempt $attempt)"
        break
    }

    Log "Push failed (attempt $attempt); refreshing remote data and retrying"
    git reset --mixed HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($attempt -eq 2) {
        Log 'Retry failed; session copy is preserved for the next run'
    }
}

Log '=== Local Naver crawl finished ==='
'' | Add-Content $LogFile
