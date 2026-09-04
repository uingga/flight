#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTtangDebugChrome } from './start-ttang-debug-chrome.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function argValue(name) {
    const exactIndex = process.argv.indexOf(name);
    if (exactIndex >= 0) return process.argv[exactIndex + 1] || null;
    const prefix = `${name}=`;
    const combined = process.argv.slice(2).find(value => value.startsWith(prefix));
    return combined ? combined.slice(prefix.length) : null;
}

const profileDir = argValue('--profile-dir') || path.join(os.homedir(), 'tmp', 'chrome-debug');
const port = Number(argValue('--port') || 9222);
await ensureTtangDebugChrome({ profileDir, port });

const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'run-ttang-browser-staging.mjs'), `--cdp=http://127.0.0.1:${port}`],
    { cwd: ROOT, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
