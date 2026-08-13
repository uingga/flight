#!/usr/bin/env node
/**
 * naver-prices.json 두 개를 노선 항목 단위로 병합한다.
 * 같은 노선 키가 양쪽에 있으면 crawledAt이 더 최신인 쪽이 이긴다.
 *
 *   node scripts/merge-naver-prices.mjs <target.json> <overlay.json>
 *
 * 용도: GitHub Actions와 로컬 PC가 각자 크롤링해 커밋할 때,
 * 파일 통째 덮어쓰기로 상대방이 그 사이 수집한 노선을 지우지 않도록 한다.
 */

import fs from 'node:fs';

const [, , targetPath, overlayPath] = process.argv;

if (!targetPath || !overlayPath) {
    console.error('사용법: node merge-naver-prices.mjs <target.json> <overlay.json>');
    process.exit(1);
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});

const target = readJson(targetPath);
const overlay = readJson(overlayPath);

let added = 0;
let updated = 0;
let keptNewer = 0;

const entryTimestamp = (entry) => entry?.lastAttemptAt || entry?.crawledAt || '';

for (const [key, entry] of Object.entries(overlay)) {
    const existing = target[key];
    if (!existing) {
        target[key] = entry;
        added++;
    } else if (entryTimestamp(entry) > entryTimestamp(existing)) {
        target[key] = entry;
        updated++;
    } else {
        keptNewer++; // target 쪽이 더 최신 — 유지
    }
}

fs.writeFileSync(targetPath, JSON.stringify(target, null, 2));
console.log(`✅ 네이버 가격 병합: 추가 ${added}, 갱신 ${updated}, 기존이 더 최신 ${keptNewer} (총 ${Object.keys(target).length}건)`);
