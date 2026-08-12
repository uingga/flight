# 네이버 항공권 크롤러 — Windows 로컬 실행 스크립트 (작업 스케줄러용)
#
# 주거용 IP에서 크롤링하므로 GitHub Actions(데이터센터 IP)보다 차단 확률이 낮다.
# 48시간 신선도 캐시 덕분에 GitHub 크롤링과 중복 실행돼도 서로 스킵되어 안전하다.
#
# 등록:   schtasks /create /tn TikitikitNaverCrawl /tr "powershell -NoProfile -ExecutionPolicy Bypass -File \"<이 파일 경로>\"" /sc daily /st 09:00
# 해제:   schtasks /delete /tn TikitikitNaverCrawl /f
# 수동:   powershell -File scripts\run-naver-crawl.ps1

$ErrorActionPreference = 'Continue'

# 저장소 루트 = 이 스크립트의 상위 폴더
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectDir 'data\naver-crawl-local.log'
$SessionCopy = Join-Path $env:TEMP 'tikitikit-naver-session.json'

Set-Location $ProjectDir

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $LogFile
}

Log '=== 네이버 로컬 크롤링 시작 ==='

# 1. 최신 상태로 동기화 (작업 중인 코드 변경은 autostash로 보존)
git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile

# 2. 크롤링 (브라우저 창은 화면 밖에 배치)
$env:HIDE_WINDOW = '1'
npx --no-install tsx scripts/crawl-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
if ($LASTEXITCODE -ne 0) {
    Log "크롤러 비정상 종료 (exit $LASTEXITCODE) — 이번 실행 중단"
    exit 1
}

# 3. 커밋·푸시 (원격과 경합 시 1회 재시도)
#    수집분을 세션 사본으로 보관 → 원격 최신을 받아 → 항목 단위 병합 → 필터 → 커밋
for ($attempt = 1; $attempt -le 2; $attempt++) {
    Copy-Item data/naver-prices.json $SessionCopy -Force

    # 데이터 파일만 원상 복구 후 원격 최신 수신 (사용자 코드 변경은 건드리지 않음)
    git checkout -- data/naver-prices.json data/all-flights-cache.json 2>$null
    git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile

    # 원격 최신본에 이번 수집분을 노선 단위로 병합 + 필터 재계산
    # (예약 실행 환경에서 node 직접 호출이 실패한 사례가 있어 npx tsx로 통일 — 2026-08-12)
    npx --no-install tsx scripts/merge-naver-prices.mjs data/naver-prices.json $SessionCopy 2>&1 | Add-Content -Encoding utf8 $LogFile
    Log "병합 exit=$LASTEXITCODE"
    npx --no-install tsx scripts/filter-by-naver.ts 2>&1 | Add-Content -Encoding utf8 $LogFile
    Log "필터 exit=$LASTEXITCODE"

    $dirty = git status --porcelain data/naver-prices.json data/all-flights-cache.json
    if (-not $dirty) {
        Log '변경 없음 (모든 노선이 최신) — 커밋 생략'
        break
    }

    git add data/naver-prices.json data/all-flights-cache.json
    git commit -m 'chore(data): update naver prices + filter flights [local]' 2>&1 | Add-Content -Encoding utf8 $LogFile
    git push origin main 2>&1 | Add-Content -Encoding utf8 $LogFile

    if ($LASTEXITCODE -eq 0) {
        Log "커밋·푸시 완료 (시도 $attempt)"
        break
    }

    # 푸시 실패 (그 사이 원격 전진) → 커밋 취소하고 재시도
    Log "푸시 실패 (시도 $attempt) — 원격 변경 반영 후 재시도"
    git reset --mixed HEAD~1 2>&1 | Add-Content -Encoding utf8 $LogFile
    if ($attempt -eq 2) { Log '재시도 실패 — 다음 실행에서 병합됨 (수집분은 세션 사본에 보존)' }
}

Log '=== 완료 ==='
'' | Add-Content $LogFile
