import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-node-runner-'));
    const scripts = path.join(root, 'scripts');
    fs.mkdirSync(scripts);
    return { root, scripts };
}
function run(script, args, root) {
    return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
        cwd: root, encoding: 'utf8', timeout: 15000,
    });
}

test('Node pilot forwards only an explicitly selected all-details mode without Chrome/network', () => {
    const { root, scripts } = fixture();
    try {
        fs.copyFileSync('scripts/run-ttang-browser-pilot.mjs', path.join(scripts, 'run-ttang-browser-pilot.mjs'));
        fs.writeFileSync(path.join(scripts, 'start-ttang-debug-chrome.mjs'),
            'export async function ensureTtangDebugChrome() {}');
        fs.writeFileSync(path.join(scripts, 'run-ttang-browser-staging.mjs'),
            'console.log(JSON.stringify(process.argv.slice(2)))');
        for (const all of [false, true]) {
            const result = run('run-ttang-browser-pilot.mjs', all ? ['--all-details'] : [], root);
            assert.equal(result.status, 0, result.stderr);
            const args = JSON.parse(result.stdout);
            assert.equal(args.includes('--all-details'), all);
            assert.equal(args.includes('--fallback'), false);
        }
        assert.notEqual(run('run-ttang-browser-pilot.mjs', ['--fallback'], root).status, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('operator cannot reuse an old successful summary after child failure or no new result', () => {
    const { root, scripts } = fixture();
    try {
        fs.copyFileSync('scripts/hermes-ttang-operator.mjs', path.join(scripts, 'hermes-ttang-operator.mjs'));
        fs.writeFileSync(path.join(scripts, 'local-source-fallback-policy.mjs'),
            'export function evaluateLocalSourceFallback() { return { shouldRun:false, sources:[] }; }');
        const local = path.join(root, '.local-crawler');
        fs.mkdirSync(path.join(local, 'hermes'), { recursive: true });
        fs.writeFileSync(path.join(local, 'hermes', 'worker.json'), JSON.stringify({hostname:os.hostname()}));
        const oldRun = path.join(local, 'staging', 'ttang-old');
        fs.mkdirSync(oldRun, { recursive: true });
        fs.writeFileSync(path.join(oldRun, 'summary.json'), JSON.stringify({status:'ready_for_review'}));
        for (const exitCode of [1, 0]) {
            fs.writeFileSync(path.join(scripts, 'run-ttang-browser-pilot.mjs'), 'process.exit(' + exitCode + ')');
            const result = run('hermes-ttang-operator.mjs', ['pilot'], root);
            assert.equal(result.status, 1, result.stdout + result.stderr);
            const saved = JSON.parse(fs.readFileSync(path.join(local, 'hermes', 'latest-result.json'), 'utf8'));
            assert.equal(saved.status, 'failed');
            assert.equal(saved.producedNewSummary, false);
            assert.equal(saved.summary, null);
        }
        assert.equal(run('hermes-ttang-operator.mjs', ['scheduled', '--all-details'], root).status, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('registered ttang entry points stay Node-only and scheduled runs reject all-details', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    for (const [key, command] of Object.entries(pkg.scripts)) {
        if (key.startsWith('crawl:ttang:browser:') || key.startsWith('hermes:ttang:')) {
            assert.match(command, /^node /);
            assert.doesNotMatch(command, /powershell|ExecutionPolicy/i);
        }
    }
    const result = spawnSync(process.execPath, ['scripts/run-ttang-browser-scheduled.mjs', '--all-details'], {
        encoding:'utf8', timeout:15000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pilot-only/);
});
