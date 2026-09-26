import { spawn } from 'node:child_process';

// Transport metadata only: never log SSH arguments, request bodies, raw stderr,
// command lines or credentials. No retry: losing the connection is NOT proof
// that the remote worker did not start requests.
export function safeRemoteStderr(text: string): string | null {
    const collector = text.match(/Collector (?:bridge|release) refused: ([a-z_]+)(?::|\s|$)/);
    const known = new Set(['invalid_version', 'release_mismatch', 'code_modified', 'linked_code',
        'dependency_missing', 'dependency_version_mismatch', 'dependency_runtime_missing',
        'collector_dependencies_not_local', 'dependency_outside_local_root', 'invalid_dependency_lock',
        'completion_unknown', 'collector_completion_unknown', 'target_not_allowed']);
    if (collector && known.has(collector[1])) return collector[1];
    if (/Host key verification failed/i.test(text)) return 'ssh_host_key_rejected';
    if (/Permission denied/i.test(text)) return 'ssh_authentication_failed';
    if (/Connection (?:timed out|refused|reset)/i.test(text)) return 'ssh_connection_failed';
    return text ? 'unclassified_stderr' : null;
}

interface Options {
    file?: string;
    cwd?: string;
    args: string[];
    request: unknown;
    timeoutMs: number;
    maxBytes: number;
    trace: (record: Record<string, unknown>) => void;
}

export function requestRemoteWorker(options: Options, start = spawn): Promise<any> {
    const { args, request, timeoutMs, maxBytes, trace } = options;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxBytes) || maxBytes <= 0)
        return Promise.reject(new Error('invalid_transport_limits'));
    const input = JSON.stringify(request), started = Date.now();
    trace({ state: 'started', startedAt: new Date(started).toISOString() });
    return new Promise((resolve, reject) => {
        let child: ReturnType<typeof spawn>;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let done = false, size = 0, stderrBytes = 0, stderr = '', firstByteAt: string | null = null;
        const chunks: Buffer[] = [];
        const finish = (reason: string | null, value?: unknown, exitCode?: number | null, signal?: string | null) => {
            if (done) return;
            done = true; if (timer) clearTimeout(timer);
            // A failed trace must not leave this promise pending after collection.
            try {
                trace({ state: reason ? 'failed' : 'replied', reason, completedAt: new Date().toISOString(),
                    elapsedMs: Date.now() - started, firstByteAt, stdoutBytes: size, stderrBytes,
                    stderrCode: safeRemoteStderr(stderr), exitCode: exitCode ?? null, signal: signal ?? null,
                    remoteCompletionUnknown: Boolean(reason) });
            } catch { reject(new Error('remote_diagnostics_failed')); return; }
            if (reason) reject(new Error(reason)); else resolve(value);
        };
        const abort = (reason: string) => {
            if (done) return;
            finish(reason);
            try { child?.kill(); } catch { /* Remote outcome stays unknown. */ }
        };
        try { child = start(options.file || 'ssh', args, { windowsHide: true, ...(options.cwd ? {cwd:options.cwd} : {}) }); }
        catch { finish('remote_spawn_failed'); return; }
        timer = setTimeout(() => abort('remote_transport_timeout'), timeoutMs);
        child.on('error', () => abort('remote_spawn_failed'));
        child.stdin!.on('error', () => abort('remote_stdin_failed'));
        child.stderr!.on('data', (chunk: Buffer) => {
            stderrBytes += chunk.length;
            if (stderr.length < 16384) stderr += chunk.toString('utf8').slice(0, 16384 - stderr.length);
        });
        child.stdout!.on('data', (chunk: Buffer) => {
            firstByteAt ||= new Date().toISOString(); size += chunk.length;
            if (size > maxBytes) { abort('remote_reply_too_large'); return; }
            chunks.push(Buffer.from(chunk));
        });
        child.on('close', (code, signal) => {
            if (done) return;
            let reply;
            try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { finish('invalid_remote_reply', undefined, code, signal); return; }
            if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
                finish('invalid_remote_reply', undefined, code, signal); return;
            }
            if (signal || (reply.status === 'verified' && code !== 0)) {
                finish('remote_exit_failed', undefined, code, signal); return;
            }
            finish(null, reply, code, signal);
        });
        try { child.stdin!.end(input); } catch { abort('remote_stdin_failed'); }
    });
}
