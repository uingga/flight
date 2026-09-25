import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const script = fs.readFileSync(new URL('./run-source-fallback-crawl.ps1', import.meta.url), 'utf8');
const readLine = script.split(/\r?\n/).find(line => line.includes('$LatestCache ='))?.trim();
const shell = process.platform === 'win32'
    ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    : null;

test('publication boundary explicitly reads UTF-8 and preserves failure evidence', () => {
    assert.match(readLine, /-Encoding UTF8/);
    assert.match(script, /FullyQualifiedErrorId.*result copies preserved at \$SessionCopy and \$LogSessionCopy/);
    const catchBody = script.slice(script.indexOf('Unable to verify general-round publication'),
        script.indexOf('if ($CurrentGeneralAt -ge $ExpectedGeneralAt)'));
    assert.match(catchBody, /exit 1/);
    assert.doesNotMatch(catchBody, /Remove-Item|npx|writer-push/);
});

function readWithScheduledShell(contents) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-publication-encoding-'));
    const file = path.join(directory, '수집결과.json');
    try {
        fs.writeFileSync(file, contents, 'utf8');
        const command = `$ErrorActionPreference='Stop'; $CachePath='${file.replaceAll("'", "''")}'; ${readLine}; `
            + '[Console]::Write(([DateTimeOffset]::Parse([string]$LatestCache.fullCrawlUpdatedAt)).ToString("o"))';
        return spawnSync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
            Buffer.from(command, 'utf16le').toString('base64')], {encoding: 'utf8', windowsHide: true, timeout: 10000});
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
}

for (const bom of ['', '\uFEFF']) {
    test(`actual scheduled Windows PowerShell reads Korean UTF-8 JSON (${bom ? 'BOM' : 'no BOM'})`,
        {skip: !shell}, () => {
            const result = readWithScheduledShell(bom + JSON.stringify({
                ttangPrimary: {status: 'success', detail: 'C PC Chrome 31일 목록 552건 → 필터 후 84건'},
                modetourPrimary: {detail: '모두투어 15구간 수집 완료'},
                fullCrawlUpdatedAt: '2026-09-25T07:50:10.626Z',
            }));
            assert.equal(result.error, undefined);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout, '2026-09-25T07:50:10.6260000+00:00');
        });
}

test('malformed publication evidence still fails closed', {skip: !shell}, () => {
    const result = readWithScheduledShell('{"fullCrawlUpdatedAt":');
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
});
