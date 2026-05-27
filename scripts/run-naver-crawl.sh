#!/bin/bash
# 네이버 항공권 크롤러 로컬 자동 실행 스크립트
# launchd로 매일 실행됨

PROJECT_DIR="$HOME/Dropbox/Projects/Personal Projects/Anti_gravity/260207_Test"
LOG_FILE="$PROJECT_DIR/data/naver-crawl.log"

cd "$PROJECT_DIR" || exit 1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 네이버 크롤링 시작 ===" >> "$LOG_FILE"

# Node.js 경로 설정 (launchd에서는 PATH가 제한됨)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

npx tsx scripts/crawl-naver.ts >> "$LOG_FILE" 2>&1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 완료 ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 크롤링 후 git에 자동 커밋+푸시 (선택사항)
if [[ -n $(git status --porcelain data/naver-prices.json) ]]; then
    git add data/naver-prices.json
    git commit -m "chore(data): update naver prices [local]"
    git push origin main
fi
