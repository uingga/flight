import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Offline integration: run the REAL staging wrapper with a temporary fake crawler.
// No repository data, Chrome or travel website is accessed.
const wrapper = path.resolve('scripts/run-ttang-browser-staging.mjs');
const fakeCrawler = `
import fs from 'node:fs';
import path from 'node:path';
if (process.env.TTANG_DETAIL_CHECKPOINT !== '1' || !process.env.TTANG_STAGING_RUN_ID) process.exit(99);
if (process.argv.includes('--ttang-all-details') !== (process.env.TEST_ALL_DETAILS === '1')) process.exit(98);
const dir = process.env.TIKITIKIT_DATA_DIR;
const checkedAt = new Date().toISOString();
const runId = process.env.TTANG_STAGING_RUN_ID;
const detail = {depTime:'09:00',arrTime:'11:00',retDepTime:'18:00',retArrTime:'20:00',seats:2};
const key = 'product|10|101|20991001';
const flight = { source:'ttang', airline:'제주항공', price:100000,
 departure:{airport:'ICN',date:'2099-10-01',time:'09:00',arrivalTime:'11:00'},
 arrival:{airport:'NRT',date:'2099-10-04',time:'18:00',arrivalTime:'20:00'},
 ttangProduct:{masterId:'10',fareId:'101',fareType:'VV',carrierCode:'7C'},
 detailCheckedAt:checkedAt,availableSeats:2 };
const checkpoint = { version:1, runId, startedAt:process.env.TTANG_STAGING_STARTED_AT,
 adapterVersion:'2026-09-05.2',status:process.env.TEST_CHECKPOINT_STATUS,operationalEligible:false,
 counts:{selected:1,succeeded:1,empty:0,failed:0,unqueried:0,excludedLegacy:0,deferred:0},
 checkpoint:{lastCompletedKey:key,inFlightKey:null},
 outcomes:[{key,status:'success',checkedAt}],
 successes:[{key,identity:{masterId:'10',fareId:'101',departureDate:'20991001'},
 route:{depCode:'ICN',arrCode:'NRT',arrivalDate:'20991004',carrierCode:'7C',fareType:'VV'},
 runId,adapterVersion:'2026-09-05.2',detailCheckedAt:checkedAt,detail,seatAction:'set'}] };
fs.writeFileSync(path.join(dir,'ttang-detail-checkpoint.json'),JSON.stringify(checkpoint));
fs.writeFileSync(path.join(dir,'all-flights-cache.json'),JSON.stringify({flights:[flight],sourceUpdatedAt:{ttang:checkedAt},scrapedCounts:{ttang:1}}));
process.exit(Number(process.env.TEST_CRAWLER_EXIT));
`;

for (const allDetails of [false, true])
for (const [detailStatus, childExit, expectedStatus, expectedExit] of [
    ['aborted', 0, 'failed_validation', 1],
    ['completed', 1, 'failed', 1],
    ['completed', 0, 'ready_for_review', 0],
]) {
    test(`wrapper reports ${expectedStatus} for ${detailStatus} detail / exit ${childExit} / full ${allDetails}`, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-wrapper-test-'));
        try {
            fs.mkdirSync(path.join(root, 'data'));
            const baseline = JSON.stringify({ flights: [], sourceUpdatedAt: { ttang: '2020-01-01T00:00:00.000Z' } });
            const protectedFile = path.join(root, 'data', 'all-flights-cache.json');
            fs.writeFileSync(protectedFile, baseline);
            const fakeCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
            fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
            fs.writeFileSync(fakeCli, fakeCrawler);
            const out = path.join(root, '.local-crawler', 'staging', 'test-run');
            const result = spawnSync(process.execPath, [wrapper, `--output=${out}`, ...(allDetails ? ['--all-details'] : [])], {
                cwd: root, timeout: 15000, encoding: 'utf8',
                env: { ...process.env, TEST_ALL_DETAILS: allDetails ? '1' : '0', TEST_CHECKPOINT_STATUS: detailStatus, TEST_CRAWLER_EXIT: String(childExit) },
            });
            assert.equal(result.status, expectedExit, result.stdout + result.stderr);
            const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
            assert.equal(summary.status, expectedStatus);
            assert.equal(summary.execution.timeoutMinutes, allDetails ? 60 : 30);
            assert.equal(summary.execution.detailScope, allDetails ? 'all_eligible' : 'capped_20');
            assert.equal(summary.partialDetails.status, detailStatus);
            assert.equal(summary.partialDetails.counts.succeeded, 1);
            assert.equal(summary.partialDetails.operationalEligible, false);
            assert.equal(fs.readFileSync(protectedFile, 'utf8'), baseline);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}
