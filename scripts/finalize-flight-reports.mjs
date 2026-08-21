#!/usr/bin/env node

import fs from 'node:fs';

const [, , batchPath, mode] = process.argv;
if (!batchPath || !fs.existsSync(batchPath)) {
    console.error('신고 처리 결과 파일이 필요합니다.');
    process.exit(1);
}

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
    process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const reports = Array.isArray(batch.reports) ? batch.reports : [];
const releaseOnly = mode === '--release';
const workflowRunUrl = process.env.GITHUB_SERVER_URL
    && process.env.GITHUB_REPOSITORY
    && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
const publishedCommit = process.env.PUBLISHED_COMMIT || undefined;

for (const report of reports) {
    const finalStatus = releaseOnly ? 'pending' : report.finalStatus;
    const retrying = finalStatus === 'pending';
    const result = {
        ...report.result,
        ...(workflowRunUrl ? { workflowRunUrl } : {}),
        ...(publishedCommit ? { publishedCommit } : {}),
        ...(releaseOnly ? { publishFailed: true, retryScheduled: true } : {}),
    };
    const response = await fetch(`${url}/rest/v1/flight_reports?id=eq.${Number(report.id)}&status=eq.processing`, {
        method: 'PATCH',
        headers: {
            apikey: key,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify({
            status: finalStatus,
            result,
            processing_started_at: null,
            processed_at: retrying ? null : new Date().toISOString(),
        }),
    });
    if (!response.ok) {
        console.error(`신고 ${report.id} 결과 저장 실패: ${response.status}`);
        process.exitCode = 1;
    }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(releaseOnly
    ? `↩️ 신고 ${reports.length}건을 재처리 대기로 되돌렸습니다.`
    : `✅ 신고 ${reports.length}건 결과 저장 완료`);
