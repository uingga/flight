# 네이버 블로그 초안 자동 작성 — Windows 작업 스케줄러용 (매일 16:00)
#
# 글 생성 → 에디터 입력 → 임시저장까지 자동으로 하고 브라우저를 닫는다.
# 발행은 하지 않는다 — 사용자가 블로그 글쓰기 화면의 저장 목록에서 검토 후 발행.
#
# 등록:   scripts\register-blog-draft-task.ps1 참고 (또는 Claude에게 요청)
# 수동:   powershell -File scripts\run-blog-draft.ps1

$ErrorActionPreference = 'Continue'

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectDir 'data\blog-draft-local.log'

Set-Location $ProjectDir

function Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Encoding utf8 $LogFile
}

Log '=== 블로그 초안 자동 작성 시작 ==='

# 최신 코드 동기화
git pull --rebase --autostash 2>&1 | Add-Content -Encoding utf8 $LogFile

$env:FORCE_GEN = '1'
$env:AUTO_CLOSE = '1'
# 예약 실행 환경에서 node 직접 호출이 실패한 사례가 있어 npx tsx 사용 (2026-08-12)
npx --no-install tsx scripts/draft-naver-blog.mjs 2>&1 | Add-Content -Encoding utf8 $LogFile

if ($LASTEXITCODE -eq 0) {
    Log '초안 작성 완료 (네이버 임시저장)'
} else {
    Log "초안 작성 실패 (exit $LASTEXITCODE)"
}

Log '=== 완료 ==='
'' | Add-Content $LogFile
