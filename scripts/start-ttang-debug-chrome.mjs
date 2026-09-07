#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 9222;
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), 'tmp', 'chrome-debug');

function argValue(name) {
    const exactIndex = process.argv.indexOf(name);
    if (exactIndex >= 0) return process.argv[exactIndex + 1] || null;
    const prefix = `${name}=`;
    const combined = process.argv.slice(2).find(value => value.startsWith(prefix));
    return combined ? combined.slice(prefix.length) : null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function isCdpReady(port) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(1_000),
        });
        if (!response.ok) return false;
        const body = await response.json();
        return typeof body?.webSocketDebuggerUrl === 'string';
    } catch {
        return false;
    }
}

function findChromeExecutable() {
    const candidates = [
        process.env.PROGRAMFILES,
        process.env['PROGRAMFILES(X86)'],
        process.env.LOCALAPPDATA,
    ]
        .filter(Boolean)
        .map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export async function ensureTtangDebugChrome({
    profileDir = DEFAULT_PROFILE_DIR,
    port = DEFAULT_PORT,
} = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`올바르지 않은 디버그 포트입니다: ${port}`);
    }
    if (await isCdpReady(port)) {
        console.log(`Chrome debug port ${port} is already ready.`);
        return;
    }

    const resolvedProfile = path.resolve(profileDir);
    if (!fs.existsSync(resolvedProfile) || !fs.statSync(resolvedProfile).isDirectory()) {
        throw new Error(
            `전용 Chrome 프로필이 없습니다: ${resolvedProfile}\n`
            + 'chacha95/automation 방식으로 한 번만 프로필을 준비한 뒤 다시 실행해주세요.',
        );
    }

    const chromeExecutable = findChromeExecutable();
    if (!chromeExecutable) {
        throw new Error('Google Chrome 실행 파일을 찾지 못했습니다.');
    }

    const chromeArgs = [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${resolvedProfile}`,
    ];
    const chrome = spawn(chromeExecutable, chromeArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
    });
    chrome.unref();

    for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(500);
        if (await isCdpReady(port)) {
            console.log(`Chrome debug port ${port} is ready with profile: ${resolvedProfile}`);
            return;
        }
    }

    throw new Error(`Chrome이 실행됐지만 ${port} 디버그 포트가 15초 안에 열리지 않았습니다.`);
}

const isDirectRun = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    const profileDir = argValue('--profile-dir') || DEFAULT_PROFILE_DIR;
    const port = Number(argValue('--port') || DEFAULT_PORT);
    await ensureTtangDebugChrome({ profileDir, port });
}
