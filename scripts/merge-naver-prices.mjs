#!/usr/bin/env node
/**
 * naver-prices.json 두 개를 노선 항목 단위로 병합한다.
 * 같은 노선 키가 양쪽에 있으면 마지막 시도 시각이 더 최신인 쪽이 이긴다.
 * 시각이 같으면 기존 가격은 유지하면서 누락된 여행사 변경 기준선만 보완한다.
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
let metadataUpdated = 0;
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
    } else if (entryTimestamp(entry) === entryTimestamp(existing)
        && !existing.sourceSignature
        && entry.sourceSignature) {
        // 첫 증분 배포 때는 네이버 재조회 없이 현재 여행사 가격·시간 지문만
        // 기준선으로 추가한다. 수집 시각과 기존 가격은 그대로 유지한다.
        target[key] = { ...existing, sourceSignature: entry.sourceSignature };
        metadataUpdated++;
    } else {
        keptNewer++; // target 쪽이 더 최신 — 유지
    }
}

fs.writeFileSync(targetPath, JSON.stringify(target, null, 2));
console.log(`✅ 네이버 가격 병합: 추가 ${added}, 갱신 ${updated}, 기준선 ${metadataUpdated}, 기존이 더 최신 ${keptNewer} (총 ${Object.keys(target).length}건)`);
