import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Same persistent, headed Chrome/profile as start-ttang-debug-chrome.mjs.
// Never discover personal Chrome, launch a browser, copy a profile or retry here.
export const ONLINE_CHROME_ORIGIN = 'http://127.0.0.1:9222';
export const ONLINE_CHROME_CONNECT_TIMEOUT_MS = 15_000;
export const ONLINE_CHROME_PREFLIGHT = {
    existingListTabPresent: true,
    evidence: 'existing_list_tab_only_not_authentication_guarantee',
} as const;

interface ListenerOwner {
    address: string; port: number; pid: number; name: string;
    commandLine: string; createdAt: string;
}
export function validateDedicatedChromeOwner(value: unknown, profileDir: string): string {
    if (!Array.isArray(value) || value.length !== 1) throw new Error('dedicated_chrome_owner_unverified');
    const row = value[0] as ListenerOwner | null;
    if (!row || row.address !== '127.0.0.1' || row.port !== 9222 || row.name !== 'chrome.exe'
        || !Number.isSafeInteger(row.pid) || row.pid < 1 || typeof row.createdAt !== 'string' || !row.createdAt
        || typeof row.commandLine !== 'string' || row.commandLine.length > 16_384
        || !path.win32.isAbsolute(profileDir)) throw new Error('dedicated_chrome_owner_unverified');
    // Accept quoted Windows paths and either --flag=value or --flag value. Refuse duplicates.
    const text = row.commandLine;
    if ((text.match(/"/g) || []).length % 2) throw new Error('dedicated_chrome_owner_unverified');
    const args = (text.match(/(?:[^\s"]|"[^"]*")+/g) || []).map(arg => arg.replace(/"/g, ''));
    const flag = (name: string): string | null => {
        const hits = args.map((arg, i) => arg === name ? args[i + 1] : arg.startsWith(name + '=') ? arg.slice(name.length + 1) : null)
            .filter(v => v !== null);
        return hits.length === 1 && typeof hits[0] === 'string' ? hits[0] : null;
    };
    const actual = flag('--user-data-dir');
    if (flag('--remote-debugging-port') !== '9222' || flag('--remote-debugging-address') !== '127.0.0.1'
        || !actual || !path.win32.isAbsolute(actual)
        || path.win32.normalize(actual).toLowerCase() !== path.win32.normalize(profileDir).toLowerCase()
        || args.some(arg => /^--(?:headless|incognito|guest|type)(?:=|$)/.test(arg)))
        throw new Error('dedicated_chrome_owner_unverified');
    return `${row.pid}|${row.createdAt}`;
}

export function parseDedicatedChromeVersion(value: unknown): string {
    const v = value as { Browser?: unknown; webSocketDebuggerUrl?: unknown } | null;
    if (!v || typeof v.Browser !== 'string' || !/^Chrome\/\d+(?:\.\d+){3}$/.test(v.Browser)
        || typeof v.webSocketDebuggerUrl !== 'string'
        || !/^ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.webSocketDebuggerUrl))
        throw new Error('dedicated_chrome_endpoint_invalid');
    return v.webSocketDebuggerUrl;
}

const OWNER_QUERY = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$rows = @(Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)
    [pscustomobject]@{ address=$_.LocalAddress; port=[int]$_.LocalPort; pid=[int]$_.OwningProcess;
        name=$process.Name; commandLine=$process.CommandLine; createdAt=$process.CreationDate.ToUniversalTime().ToString('o') }
})
ConvertTo-Json -InputObject $rows -Compress
`;
async function readOwner(): Promise<unknown> {
    const windowsRoot = process.env.SystemRoot;
    if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) throw new Error('dedicated_chrome_owner_unverified');
    return new Promise((resolve, reject) => {
        execFile(path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-Command', OWNER_QUERY],
            { windowsHide: true, timeout: 10_000, maxBuffer: 32_768, encoding: 'utf8' }, (error, stdout) => {
                if (error) { reject(new Error('dedicated_chrome_owner_unverified')); return; }
                try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); }
                catch { reject(new Error('dedicated_chrome_owner_unverified')); }
            });
    });
}

/** Fixed loopback request only, no redirects/proxy/credentials and a bounded response. */
async function readVersion(): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []; let size = 0, done = false;
        const finish = (error?: Error, value?: unknown) => {
            if (done) return; done = true; clearTimeout(timer);
            if (error) reject(error); else resolve(value);
        };
        const fail = () => finish(new Error('dedicated_chrome_unavailable'));
        const request = http.get(ONLINE_CHROME_ORIGIN + '/json/version', { agent: false }, response => {
            if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(response.headers['content-type'] || '')) {
                fail(); response.destroy(); request.destroy(); return;
            }
            response.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > 8192) { fail(); response.destroy(); request.destroy(); } else chunks.push(chunk);
            });
            response.on('error', fail); response.on('aborted', fail);
            response.on('end', () => {
                try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(); }
            });
        });
        const timer = setTimeout(() => { fail(); request.destroy(); }, 3000);
        request.on('error', fail);
    });
}

// Dependency injection is for offline tests, never a CLI endpoint/profile override.
export async function discoverDedicatedChromeEndpoint(deps = {
    platform: process.platform, profileDir: path.join(os.homedir(), 'tmp', 'chrome-debug'), readOwner, readVersion,
}): Promise<string> {
    if (deps.platform !== 'win32') throw new Error('dedicated_chrome_requires_windows');
    const owner = validateDedicatedChromeOwner(await deps.readOwner(), deps.profileDir);
    const endpoint = parseDedicatedChromeVersion(await deps.readVersion());
    if (validateDedicatedChromeOwner(await deps.readOwner(), deps.profileDir) !== owner)
        throw new Error('dedicated_chrome_owner_changed');
    return endpoint;
}
