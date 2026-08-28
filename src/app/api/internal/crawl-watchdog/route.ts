import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getCrawlDispatchBlocker, type GitHubWorkflowRunSummary } from '@/lib/crawl-watchdog-dispatch.mjs';
import { getCrawlScheduleHealth } from '@/lib/crawl-schedule-health.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GITHUB_REPOSITORY = 'uingga/flight';
const CRAWL_WORKFLOW = 'daily-crawl.yml';

function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store' },
    });
}

function authorized(request: NextRequest, secret: string): boolean {
    const actual = Buffer.from(request.headers.get('authorization') || '');
    const expected = Buffer.from(`Bearer ${secret}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function githubHeaders(token: string) {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function readLastCompletedAt(): string | null {
    const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { timestamp?: unknown };
    if (typeof cache.timestamp !== 'string') return null;
    const timestamp = new Date(cache.timestamp).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function GET(request: NextRequest) {
    const checkedAt = new Date();
    const secret = process.env.WATCHDOG_SECRET;
    if (!secret) return json({ ok: false, error: 'watchdog_not_configured' }, 503);
    if (!authorized(request, secret)) return json({ ok: false, error: 'unauthorized' }, 401);

    try {
        const health = getCrawlScheduleHealth(readLastCompletedAt(), { now: checkedAt });
        const result = {
            checkedAt: checkedAt.toISOString(),
            health,
        };

        if (health.status !== 'overdue' || !health.expectedAt) {
            return json({ ok: true, action: 'none', ...result });
        }

        const token = process.env.GH_PAT;
        if (!token) return json({ ok: false, error: 'github_dispatch_not_configured', ...result }, 503);

        const runsResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${CRAWL_WORKFLOW}/runs?branch=main&per_page=30`,
            {
                headers: githubHeaders(token),
                cache: 'no-store',
            },
        );
        if (!runsResponse.ok) {
            console.error('[crawl-watchdog] Failed to list workflow runs:', runsResponse.status);
            return json({ ok: false, error: 'github_runs_unavailable', ...result }, 502);
        }

        const runsPayload = await runsResponse.json() as { workflow_runs?: GitHubWorkflowRunSummary[] };
        const blocker = getCrawlDispatchBlocker(runsPayload.workflow_runs || [], health.expectedAt, {
            now: checkedAt,
        });
        if (blocker) {
            return json({ ok: true, action: 'skipped', blocker, ...result });
        }

        const dispatchResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${CRAWL_WORKFLOW}/dispatches`,
            {
                method: 'POST',
                headers: githubHeaders(token),
                body: JSON.stringify({
                    ref: 'main',
                    inputs: {
                        trigger_source: 'watchdog',
                        expected_at: health.expectedAt,
                    },
                }),
                cache: 'no-store',
            },
        );
        if (dispatchResponse.status !== 204) {
            console.error('[crawl-watchdog] Failed to dispatch fallback:', dispatchResponse.status);
            return json({ ok: false, error: 'github_dispatch_failed', ...result }, 502);
        }

        console.warn(`[crawl-watchdog] Dispatched fallback for ${health.expectedAt} (${health.delayMinutes} minutes late).`);
        return json({ ok: true, action: 'dispatched', ...result }, 202);
    } catch (error) {
        console.error('[crawl-watchdog] Check failed:', error);
        return json({ ok: false, error: 'watchdog_check_failed' }, 500);
    }
}
