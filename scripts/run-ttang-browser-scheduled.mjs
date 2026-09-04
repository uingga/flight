#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLocalSourceFallback } from './local-source-fallback-policy.mjs';
import { ensureTtangDebugChrome } from './start-ttang-debug-chrome.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function argValue(name) {
    const exactIndex = process.argv.indexOf(name);
    if (exactIndex >= 0) return process.argv[exactIndex + 1] || null;
    const prefix = `${name}=`;
    const combined = process.argv.slice(2).find(value => value.startsWith(prefix));
    return combined ? combined.slice(prefix.length) : null;
}

const cachePath = path.join(ROOT, 'data', 'all-flights-cache.json');
if (!fs.existsSync(cachePath)) {
    throw new Error('GitHub 수집 상태를 확인할 운영 캐시가 없습니다.');
}
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const policy = evaluateLocalSourceFallback({ cache });
const ttangEligible = policy.shouldRun && policy.sources.includes('ttang');
if (!ttangEligible) {
    console.log(`Ttang browser fallback skipped: ${policy.reason}`);
    process.exit(0);
}

const profileDir = argValue('--profile-dir') || path.join(os.homedir(), 'tmp', 'chrome-debug');
const port = Number(argValue('--port') || 9222);
await ensureTtangDebugChrome({ profileDir, port });

const result = spawnSync(
    process.execPath,
    [
        path.join(ROOT, 'scripts', 'run-ttang-browser-staging.mjs'),
        `--cdp=http://127.0.0.1:${port}`,
        '--fallback',
    ],
    { cwd: ROOT, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
