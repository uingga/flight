import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionChromeSettings } from './temporary-b-replacement.mjs';

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
export function validateDedicatedChromeOwner(value: unknown, profileDir: string, port = 9222): string {
    if (![9222,9223].includes(port)) throw new Error('dedicated_chrome_owner_unverified');
    if (!Array.isArray(value) || value.length !== 1) throw new Error('dedicated_chrome_owner_unverified');
    const row = value[0] as ListenerOwner | null;
    if (!row || row.address !== '127.0.0.1' || row.port !== port || row.name !== 'chrome.exe'
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
    if (flag('--remote-debugging-port') !== String(port) || flag('--remote-debugging-address') !== '127.0.0.1'
        || !actual || !path.win32.isAbsolute(actual)
        || path.win32.normalize(actual).toLowerCase() !== path.win32.normalize(profileDir).toLowerCase()
        || args.some(arg => /^--(?:headless|incognito|guest|type)(?:=|$)/.test(arg)))
        throw new Error('dedicated_chrome_owner_unverified');
    return `${row.pid}|${row.createdAt}`;
}

export function parseDedicatedChromeVersion(value: unknown, port = 9222): string {
    const v = value as { Browser?: unknown; webSocketDebuggerUrl?: unknown } | null;
    if (![9222,9223].includes(port) || !v || typeof v.Browser !== 'string' || !/^Chrome\/\d+(?:\.\d+){3}$/.test(v.Browser)
        || typeof v.webSocketDebuggerUrl !== 'string'
        || !new RegExp(`^ws://127\\.0\\.0\\.1:${port}/devtools/browser/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,'i').test(v.webSocketDebuggerUrl))
        throw new Error('dedicated_chrome_endpoint_invalid');
    return v.webSocketDebuggerUrl;
}

export function parseDedicatedChromeListeners(stdout: string, port = 9222): Array<{address: string; port: number; pid: number}> {
    if (![9222,9223].includes(port)) throw new Error('dedicated_chrome_owner_unverified');
    const rows: Array<{address: string; port: number; pid: number}> = [];
    for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] !== 'TCP' || !parts[1]?.endsWith(':'+port)) continue;
        // Other connections can have the same local port; only listeners own it.
        if (parts[3] !== 'LISTENING') continue;
        if (parts.length !== 5 || !/^[1-9]\d*$/.test(parts[4])) throw new Error('dedicated_chrome_owner_unverified');
        rows.push({ address: parts[1].slice(0, -5), port, pid: Number(parts[4]) });
    }
    if (rows.length !== 1 || rows[0].address !== '127.0.0.1' || !Number.isSafeInteger(rows[0].pid))
        throw new Error('dedicated_chrome_owner_unverified');
    return rows;
}

type OwnerCommand = (file: string, args: string[], timeout: number) => Promise<string>;
const ownerCommand: OwnerCommand = (file, args, timeout) => new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 262144, encoding: 'utf8' }, (error, stdout) => {
        if (error) { reject(new Error(error.killed ? 'dedicated_chrome_owner_query_timeout' : 'dedicated_chrome_owner_query_failed')); return; }
        resolve(stdout.replace(/^\uFEFF/, ''));
    });
});
// Built-in netstat and limited-information native process reads do not depend on
// the WMI service. Preserve the exact same profile/flags/owner checks above.
export async function readDedicatedChromeOwner(run: OwnerCommand = ownerCommand, windowsRoot = process.env.SystemRoot, port = 9222): Promise<unknown> {
    if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) throw new Error('dedicated_chrome_owner_unverified');
    const system = path.win32.join(windowsRoot, 'System32');
    const [listener] = parseDedicatedChromeListeners(await run(path.win32.join(system, 'netstat.exe'), ['-ano', '-p', 'TCP'], 3000),port);
    const script = fileURLToPath(new URL('../../scripts/read-dedicated-chrome-process.ps1', import.meta.url));
    const stdout = await run(path.win32.join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-File', script, '-ProcessId', String(listener.pid)], 6000);
    let processInfo;
    try { processInfo = JSON.parse(stdout); } catch { throw new Error('dedicated_chrome_owner_query_failed'); }
    if (!processInfo || processInfo.pid !== listener.pid) throw new Error('dedicated_chrome_owner_unverified');
    return [{ ...processInfo, ...listener }];
}

/** Fixed loopback request only, no redirects/proxy/credentials and a bounded response. */
async function readVersion(port = 9222): Promise<unknown> {
    if (![9222,9223].includes(port)) throw new Error('dedicated_chrome_endpoint_invalid');
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []; let size = 0, done = false;
        const finish = (error?: Error, value?: unknown) => {
            if (done) return; done = true; clearTimeout(timer);
            if (error) reject(error); else resolve(value);
        };
        const fail = () => finish(new Error('dedicated_chrome_unavailable'));
        const request = http.get(`http://127.0.0.1:${port}/json/version`, { agent: false }, response => {
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
interface DiscoveryDependencies {platform:string;profileDir:string;port?:number;readOwner:()=>Promise<unknown>;readVersion:()=>Promise<unknown>}
function installedDependencies(): DiscoveryDependencies {
    const {port,profileDir}=collectionChromeSettings();
    return {platform:process.platform,profileDir,port,readOwner:()=>readDedicatedChromeOwner(undefined,undefined,port),readVersion:()=>readVersion(port)};
}
export async function discoverDedicatedChromeEndpoint(deps: DiscoveryDependencies = installedDependencies()): Promise<string> {
    if (deps.platform !== 'win32') throw new Error('dedicated_chrome_requires_windows');
    const port=deps.port ?? 9222;
    const owner = validateDedicatedChromeOwner(await deps.readOwner(), deps.profileDir,port);
    const endpoint = parseDedicatedChromeVersion(await deps.readVersion(),port);
    if (validateDedicatedChromeOwner(await deps.readOwner(), deps.profileDir,port) !== owner)
        throw new Error('dedicated_chrome_owner_changed');
    return endpoint;
}
