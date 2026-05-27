@echo off
REM ============================================
REM 🛫 항공권 자동 크롤링 + Vercel 배포 스크립트
REM 하루 3회 실행 (오전 8시, 오후 2시, 저녁 8시)
REM Windows 작업 스케줄러에서 실행
REM ============================================

set PROJECT_DIR=c:\Users\ynal\Dropbox\Projects\Personal Projects\Anti_gravity\260207_Test
set LOG_FILE=%PROJECT_DIR%\data\auto-crawl.log

echo [%date% %time%] 크롤링 시작 >> "%LOG_FILE%"

cd /d "%PROJECT_DIR%"

REM 크롤링 실행
echo [%date% %time%] npm run crawl:all 실행 중... >> "%LOG_FILE%"
call npm run crawl:all >> "%LOG_FILE%" 2>&1

IF %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] ❌ 크롤링 실패 (exit code: %ERRORLEVEL%) >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] ✅ 크롤링 완료, Git push 시작 >> "%LOG_FILE%"

REM Git 커밋 & 푸시 (Vercel 자동 배포 트리거)
git add data/all-flights-cache.json
git commit -m "🔄 자동 크롤링 데이터 업데이트 (%date%)"
git push origin main >> "%LOG_FILE%" 2>&1

IF %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] ❌ Git push 실패 >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] ✅ 완료! Vercel 자동 배포 트리거됨 >> "%LOG_FILE%"
