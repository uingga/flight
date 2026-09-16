#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resultVersion } from '../src/lib/naver-coordination-contract.mjs';

export async function waitForCache({ cache, fetcher = globalThis.fetch, clock = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), exact = false,
    siteUrl = 'https://www.tikitikit.kr', timeoutMs = 600000, intervalMs = 12000 }) {
    const expectedVersion = resultVersion(cache);
    const expectedValue = cache.lastUpdated || cache.timestamp;
    const expectedTimestamp = new Date(expectedValue || '').getTime();
    if (exact && !expectedVersion) throw Error('invalid local result_version');
    if (!exact && !Number.isFinite(expectedTimestamp)) throw Error('invalid local timestamp');
    const deadline = clock() + timeoutMs;
    let attempt = 0;
    while (clock() < deadline) {
        const response = await fetcher(`${siteUrl.replace(/\/$/, '')}/api/flights?summaryOnly=1&deployCheck=${++attempt}`, {
            cache: 'no-store', headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
        });
        if (!response.ok) throw Error('readback response failed');
        const data = await response.json();
        if (exact ? data.result_version === expectedVersion
            : new Date(data.lastUpdated || '').getTime() >= expectedTimestamp) return data;
        await sleep(intervalMs);
    }
    throw Error('readback timeout');
}

async function main() {

const siteUrl = (process.env.SITE_URL || 'https://www.tikitikit.kr').replace(/\/$/, '');
const timeoutMs = Number(process.env.FLIGHT_API_WAIT_TIMEOUT_MS || 10 * 60 * 1000);
const intervalMs = Number(process.env.FLIGHT_API_WAIT_INTERVAL_MS || 12_000);
const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
if (cache.naverCoordination || process.env.NAVER_COORDINATION === '1') {
    await waitForCache({ cache, exact: true, siteUrl, timeoutMs, intervalMs });
    return;
}
const expectedValue = cache.lastUpdated || cache.timestamp;
const expectedTimestamp = new Date(expectedValue || '').getTime();

if (!Number.isFinite(expectedTimestamp)) {
    throw new Error('로컬 항공권 캐시의 갱신 시각을 확인할 수 없습니다.');
}

const deadline = Date.now() + timeoutMs;
let attempt = 0;
let lastObserved = null;
let ready = false;

while (Date.now() < deadline) {
    attempt += 1;

    try {
        const cacheBuster = `${expectedTimestamp}-${attempt}-${Date.now()}`;
        const response = await fetch(`${siteUrl}/api/flights?summaryOnly=1&deployCheck=${cacheBuster}`, {
            cache: 'no-store',
            headers: {
                'cache-control': 'no-cache',
                pragma: 'no-cache',
            },
        });

        if (!response.ok) {
            console.log(`[flight-api] attempt=${attempt} status=${response.status}`);
        } else {
            const data = await response.json();
            lastObserved = data.lastUpdated || null;
            const observedTimestamp = new Date(lastObserved || '').getTime();
            console.log(`[flight-api] attempt=${attempt} expected=${expectedValue} observed=${lastObserved || 'none'}`);

            // 다른 데이터 워크플로가 그사이에 더 최신 캐시를 배포한 경우도 준비 완료로 본다.
            if (Number.isFinite(observedTimestamp) && observedTimestamp >= expectedTimestamp) {
                console.log('✅ 최신 항공권 캐시가 운영 API에 반영됐습니다.');
                ready = true;
                break;
            }
        }
    } catch (error) {
        console.log(`[flight-api] attempt=${attempt} error=${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
}

if (!ready) {
    throw new Error(`운영 API의 캐시 반영을 기다리다 시간 초과했습니다. expected=${expectedValue}, observed=${lastObserved || 'none'}`);
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
