import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface FlightReportRow {
    id: number;
    flight_id: string;
    source: string;
    report_type: string;
    status: string;
    attempt_count: number;
}

interface VerificationResult {
    status: 'confirmed' | 'updated' | 'removed' | 'check_failed';
    message: string;
    flightId: string;
    source: string;
    checkedAt: string;
    [key: string]: unknown;
}

interface BatchReportResult {
    id: number;
    attemptCount: number;
    finalStatus: VerificationResult['status'] | 'pending';
    result: VerificationResult & { retryScheduled?: boolean };
}

const VALID_SOURCES = new Set(['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip']);
const MAX_REPORTS_PER_RUN = 10;
const MAX_AUTOMATIC_ATTEMPTS = 3;

function config() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
    return { url, key };
}

async function supabaseRequest(restPath: string, init: RequestInit = {}) {
    const { url, key } = config();
    return fetch(`${url}/rest/v1/${restPath}`, {
        ...init,
        headers: {
            apikey: key,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
}

async function releaseStaleClaims() {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const response = await supabaseRequest(
        `flight_reports?status=eq.processing&processing_started_at=lt.${encodeURIComponent(cutoff)}`,
        {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'pending', processing_started_at: null }),
        },
    );
    if (!response.ok) throw new Error(`오래된 신고 잠금 해제 실패: ${response.status}`);
}

async function loadPendingReports(): Promise<FlightReportRow[]> {
    const response = await supabaseRequest(
        `flight_reports?select=id,flight_id,source,report_type,status,attempt_count&status=eq.pending&order=created_at.asc&limit=${MAX_REPORTS_PER_RUN}`,
    );
    if (!response.ok) throw new Error(`미처리 신고 조회 실패: ${response.status}`);
    const reports = await response.json() as FlightReportRow[];
    return reports.filter(report => VALID_SOURCES.has(report.source));
}

async function claimReports(reports: FlightReportRow[]): Promise<FlightReportRow[]> {
    const claimed: FlightReportRow[] = [];
    for (const report of reports) {
        const attemptCount = report.attempt_count + 1;
        const response = await supabaseRequest(`flight_reports?id=eq.${report.id}&status=eq.pending`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                status: 'processing',
                processing_started_at: new Date().toISOString(),
                attempt_count: attemptCount,
            }),
        });
        if (!response.ok) throw new Error(`신고 ${report.id} 처리 시작 기록 실패: ${response.status}`);
        const rows = await response.json() as FlightReportRow[];
        if (rows.length > 0) claimed.push({ ...report, attempt_count: attemptCount });
    }
    return claimed;
}

function run(command: string, args: string[], extraEnv: Record<string, string> = {}) {
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, ...extraEnv, CI: 'true' },
        stdio: 'inherit',
    });
    return result.status === 0;
}

function npxCommand() {
    return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function failureResult(report: FlightReportRow, message: string): VerificationResult {
    return {
        status: 'check_failed',
        message,
        flightId: report.flight_id,
        source: report.source,
        checkedAt: new Date().toISOString(),
    };
}

async function releaseClaims(reports: FlightReportRow[]) {
    await Promise.all(reports.map(async report => {
        await supabaseRequest(`flight_reports?id=eq.${report.id}&status=eq.processing`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'pending', processing_started_at: null }),
        });
    }));
}

async function main() {
    const batchPath = process.env.REPORT_BATCH_PATH || path.join(os.tmpdir(), 'flight-report-batch.json');
    await releaseStaleClaims();
    const pending = await loadPendingReports();
    const claimed = await claimReports(pending);

    if (claimed.length === 0) {
        fs.writeFileSync(batchPath, JSON.stringify({ reports: [], sources: [] }, null, 2));
        console.log('ℹ️ 자동 확인할 항공권 신고가 없습니다.');
        return;
    }

    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const beforePath = path.join(os.tmpdir(), 'flight-report-before.json');
    fs.copyFileSync(cachePath, beforePath);
    const failedSources = new Set<string>();

    try {
        const regularSources = [...new Set(
            claimed.filter(report => report.source !== 'myrealtrip').map(report => report.source),
        )];
        if (regularSources.length > 0) {
            const ok = run(npxCommand(), [
                'tsx',
                'scripts/crawl-all.ts',
                `--sources=${regularSources.join(',')}`,
            ]);
            if (!ok) regularSources.forEach(source => failedSources.add(source));
        }

        for (const report of claimed.filter(item => item.source === 'myrealtrip')) {
            const ok = run(
                npxCommand(),
                ['tsx', 'scripts/recheck-reported-myrealtrip.ts'],
                { REPORT_FLIGHT_ID: report.flight_id },
            );
            if (!ok) failedSources.add(`myrealtrip:${report.flight_id}`);
        }

        const reportResults: BatchReportResult[] = [];
        for (const report of claimed) {
            let result: VerificationResult;
            const sourceFailed = failedSources.has(report.source)
                || failedSources.has(`myrealtrip:${report.flight_id}`);

            if (sourceFailed) {
                result = failureResult(
                    report,
                    '여행사 자동 확인 작업이 완료되지 않아 기존 항공권을 유지했습니다.',
                );
            } else {
                const resultPath = path.join(os.tmpdir(), `flight-report-result-${report.id}.json`);
                const summarized = run(process.execPath, [
                    'scripts/summarize-flight-report-result.mjs',
                    beforePath,
                    cachePath,
                    resultPath,
                    report.flight_id,
                    report.source,
                ]);
                result = summarized
                    ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) as VerificationResult
                    : failureResult(report, '자동 확인 결과를 정리하지 못해 기존 항공권을 유지했습니다.');
            }

            const shouldRetry = result.status === 'check_failed'
                && report.attempt_count < MAX_AUTOMATIC_ATTEMPTS;
            reportResults.push({
                id: report.id,
                attemptCount: report.attempt_count,
                finalStatus: shouldRetry ? 'pending' : result.status,
                result: { ...result, retryScheduled: shouldRetry || undefined },
            });
        }

        const sources = [...new Set(claimed.map(report => report.source))];
        fs.writeFileSync(batchPath, JSON.stringify({ reports: reportResults, sources }, null, 2));
        console.log(`✅ 신고 ${reportResults.length}건 자동 확인 완료`);
        console.log(`📦 갱신 대상 여행사: ${sources.join(', ')}`);
    } catch (error) {
        await releaseClaims(claimed);
        throw error;
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
