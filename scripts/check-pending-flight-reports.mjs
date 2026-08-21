#!/usr/bin/env node

import fs from 'node:fs';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outputPath = process.env.GITHUB_OUTPUT;

if (!url || !key || !outputPath) {
    console.error('Supabase 설정 또는 GITHUB_OUTPUT이 없습니다.');
    process.exit(1);
}

// 새 sb_secret_ 형식은 apikey 자체가 서버 권한을 나타낸다. JWT가 아니므로
// Authorization: Bearer에 넣으면 오히려 403이 난다.
const headers = { apikey: key };
const pendingResponse = await fetch(`${url}/rest/v1/flight_reports?select=id&status=eq.pending&limit=1`, { headers });
if (!pendingResponse.ok) {
    console.error(`미처리 신고 확인 실패: ${pendingResponse.status}`);
    process.exit(1);
}

const pendingRows = await pendingResponse.json();
let hasReports = Array.isArray(pendingRows) && pendingRows.length > 0;
if (!hasReports) {
    // 작업이 중간에 종료돼 processing에 남은 신고도 두 시간 뒤 다시 처리한다.
    const staleCutoff = encodeURIComponent(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    const staleResponse = await fetch(
        `${url}/rest/v1/flight_reports?select=id&status=eq.processing&processing_started_at=lt.${staleCutoff}&limit=1`,
        { headers },
    );
    if (!staleResponse.ok) {
        console.error(`멈춘 신고 확인 실패: ${staleResponse.status}`);
        process.exit(1);
    }
    const staleRows = await staleResponse.json();
    hasReports = Array.isArray(staleRows) && staleRows.length > 0;
}
fs.appendFileSync(outputPath, `has_reports=${hasReports}\n`);
console.log(hasReports ? '📨 미처리 항공권 신고가 있습니다.' : 'ℹ️ 미처리 항공권 신고가 없습니다.');
