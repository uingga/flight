import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverDedicatedChromeEndpoint, parseDedicatedChromeVersion, validateDedicatedChromeOwner,
    parseDedicatedChromeListeners, readDedicatedChromeOwner } from '../src/lib/onlinetour-dedicated-chrome';

const profile = 'C:\\Users\\Test User\\tmp\\chrome-debug';
const command = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir="' + profile + '"';
const owner = { address: '127.0.0.1', port: 9222, pid: 42, name: 'chrome.exe', createdAt: '2026-09-07T01:00:00Z', commandLine: command };
const endpoint = 'ws://127.0.0.1:9222/devtools/browser/12345678-1234-4abc-8abc-123456789abc';
const version = { Browser: 'Chrome/152.0.7977.76', webSocketDebuggerUrl: endpoint };

test('temporary port 9223 still requires the exact dedicated profile and matching endpoint', async()=>{
    const replacementOwner={...owner,port:9223,commandLine:command.replace('port=9222','port=9223')};
    const replacementVersion={...version,webSocketDebuggerUrl:endpoint.replace(':9222',':9223')};
    assert.equal(await discoverDedicatedChromeEndpoint({platform:'win32',port:9223,profileDir:profile,
        readOwner:async()=>[replacementOwner],readVersion:async()=>replacementVersion}),replacementVersion.webSocketDebuggerUrl);
    await assert.rejects(discoverDedicatedChromeEndpoint({platform:'win32',port:9223,profileDir:profile,
        readOwner:async()=>[owner],readVersion:async()=>replacementVersion}));
    await assert.rejects(discoverDedicatedChromeEndpoint({platform:'win32',port:9223,profileDir:profile,
        readOwner:async()=>[replacementOwner],readVersion:async()=>version}));
});

test('native discovery requires one fixed loopback listener, not an established connection', () => {
    const row = '  TCP  127.0.0.1:9222  0.0.0.0:0  LISTENING  42';
    assert.deepEqual(parseDedicatedChromeListeners('Active Connections\r\n' + row + '\r\nTCP 127.0.0.1:9222 127.0.0.1:5000 ESTABLISHED 42'),
        [{address:'127.0.0.1',port:9222,pid:42}]);
    for (const value of ['', row+'\n'+row, row.replace('127.0.0.1:', '0.0.0.0:'),
        row.replace('127.0.0.1:', '[::1]:'), row.replace('42', '0'), row.replace('42','no_pid'),
        row.replace('9222','19222'), row.replace('LISTENING','ESTABLISHED')])
        assert.throws(() => parseDedicatedChromeListeners(value));
});

test('owner discovery uses bounded native reads without WMI and preserves exact ownership checks', async () => {
    const calls: any[] = [];
    const run = async (file: string, args: string[], timeout: number) => {
        calls.push({file,args,timeout});
        return file.endsWith('netstat.exe') ? 'TCP 127.0.0.1:9222 0.0.0.0:0 LISTENING 42' : JSON.stringify(owner);
    };
    assert.equal(validateDedicatedChromeOwner(await readDedicatedChromeOwner(run, 'C:\\Windows'), profile), '42|'+owner.createdAt);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].timeout, 3000); assert.equal(calls[1].timeout, 6000);
    assert.deepEqual(calls[1].args.slice(-2), ['-ProcessId', '42']);
    assert.doesNotMatch(JSON.stringify(calls), /Get-CimInstance|Get-NetTCPConnection|ExecutionPolicy/);
    await assert.rejects(readDedicatedChromeOwner(async () => { throw Error('dedicated_chrome_owner_query_timeout'); }, 'C:\\Windows'), /query_timeout/);
    await assert.rejects(readDedicatedChromeOwner(async file => file.endsWith('netstat.exe')
        ? 'TCP 127.0.0.1:9222 0.0.0.0:0 LISTENING 42' : JSON.stringify({...owner,pid:43}), 'C:\\Windows'), /owner_unverified/);
    await assert.rejects(readDedicatedChromeOwner(run, 'relative'), /owner_unverified/);
    const helper = fs.readFileSync(path.join(__dirname, 'read-dedicated-chrome-process.ps1'), 'utf8');
    assert.doesNotMatch(helper, /Get-CimInstance|Get-WmiObject|ReadProcessMemory|AdjustTokenPrivileges|Start-Process/);
    assert.match(helper, /OpenProcess\(0x1000, false, pid\)/);
});

test('native owner query errors never trigger a Chrome endpoint request or fallback', async () => {
    for (const reason of ['dedicated_chrome_owner_query_timeout','dedicated_chrome_owner_query_failed']) {
        let requests=0;
        await assert.rejects(discoverDedicatedChromeEndpoint({platform:'win32',profileDir:profile,
            readOwner:async()=>{throw Error(reason);},readVersion:async()=>{requests++;return version;}}),new RegExp(reason));
        assert.equal(requests,0);
    }
});

test('fixed dedicated profile/owner accepts quoted paths and separate flag values', () => {
    assert.equal(validateDedicatedChromeOwner([owner], profile), '42|' + owner.createdAt);
    assert.equal(validateDedicatedChromeOwner([{ ...owner, commandLine: command.replace('--user-data-dir=', '--user-data-dir ') }], profile), '42|' + owner.createdAt);
    assert.equal(validateDedicatedChromeOwner([{ ...owner, commandLine: command.replace('--user-data-dir="' + profile + '"', '"--user-data-dir=' + profile + '"') }], profile), '42|' + owner.createdAt);
});
for (const [name, value] of Object.entries({
    missing: [], duplicate: [owner, owner], remote: [{ ...owner, address: '0.0.0.0' }],
    otherPort: [{ ...owner, port: 64131 }], notChrome: [{ ...owner, name: 'other.exe' }],
    unknownCommand: [{ ...owner, commandLine: null }],
    personal: [{ ...owner, commandLine: command.replace(profile, 'C:\\Users\\Test User\\AppData\\Local\\Google\\Chrome\\User Data') }],
    noProfile: [{ ...owner, commandLine: command.split(' --user-data-dir')[0] }],
    headless: [{ ...owner, commandLine: command + ' --headless=new' }],
    guest: [{ ...owner, commandLine: command + ' --guest' }],
    childProcess: [{ ...owner, commandLine: command + ' --type=renderer' }],
    duplicateProfile: [{ ...owner, commandLine: command + ' --user-data-dir=C:\\other' }],
    malformedQuotes: [{ ...owner, commandLine: command + '"' }],
    wrongAddressFlag: [{ ...owner, commandLine: command.replace('address=127.0.0.1', 'address=0.0.0.0') }],
})) test(`refuse ${name} before any Chrome request`, async () => {
    let requests = 0;
    await assert.rejects(discoverDedicatedChromeEndpoint({ platform: 'win32', profileDir: profile,
        readOwner: async () => value, readVersion: async () => { requests++; return version; } }), /dedicated_chrome_owner_unverified/);
    assert.equal(requests, 0);
});
test('only exact loopback Chrome browser websocket accepted', () => {
    assert.equal(parseDedicatedChromeVersion(version), endpoint);
    for (const url of [endpoint.replace('127.0.0.1', 'evil.test'), endpoint.replace('9222', '64131'),
        endpoint.replace('ws:', 'wss:'), endpoint.replace('/browser/', '/page/'), endpoint + '?token=secret',
        endpoint + '#fragment', endpoint.replace('127.0.0.1', 'user:pass@127.0.0.1')])
        assert.throws(() => parseDedicatedChromeVersion({ ...version, webSocketDebuggerUrl: url }), /endpoint_invalid/);
    assert.throws(() => parseDedicatedChromeVersion({ ...version, Browser: 'HeadlessChrome/152.0.7977.76' }));
});
test('discovery verifies listener before and after one version request, no retry or fallback', async () => {
    const calls: string[] = [];
    const deps = { platform: 'win32' as const, profileDir: profile,
        readOwner: async () => { calls.push('owner'); return [owner]; },
        readVersion: async () => { calls.push('version'); return version; } };
    assert.equal(await discoverDedicatedChromeEndpoint(deps), endpoint);
    assert.deepEqual(calls, ['owner', 'version', 'owner']);
    calls.length = 0;
    await assert.rejects(discoverDedicatedChromeEndpoint({ ...deps, readVersion: async () => { calls.push('failed'); throw Error('offline refusal'); } }));
    assert.deepEqual(calls, ['owner', 'failed']);
    let ownerReads = 0;
    await assert.rejects(discoverDedicatedChromeEndpoint({ ...deps, readOwner: async () => [{ ...owner, pid: ++ownerReads }] }), /owner_changed/);
});
test('unsupported OS refuses without discovery', async () => {
    let calls = 0;
    await assert.rejects(discoverDedicatedChromeEndpoint({ platform: 'linux', profileDir: profile,
        readOwner: async () => { calls++; return []; }, readVersion: async () => { calls++; return version; } }), /requires_windows/);
    assert.equal(calls, 0);
});
test('all active OnlineTour browser commands use dedicated connection with no personal-profile fallback', () => {
    for (const file of ['crawl-onlinetour-browser.ts', 'crawl-onlinetour-browser-lists.ts', 'crawl-onlinetour-catalogue.ts',
        'discover-onlinetour-regions.ts', 'inspect-onlinetour-connection.mjs', 'inspect-onlinetour-stages.mjs']) {
        const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.match(source, /(?:connect|discover)DedicatedChrome/);
        assert.doesNotMatch(source, /connectNormalChrome|discoverNormalChrome|DevToolsActivePort|myaccount\.google/);
    }
});
test('transport and stage diagnostics refuse missing consent before connecting', () => {
    for (const file of ['inspect-onlinetour-connection.mjs', 'inspect-onlinetour-stages.mjs']) {
        const result = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10_000 });
        assert.equal(result.status, 2, result.stderr);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /Explicit consent required/);
    }
});
