const COLLECTOR_BRIDGE = 'C:/Users/ynal/AppData/Local/Tikitikit/collector/run.mjs';

export function ttangWorkerSshArgs(worker, mode, host) {
    if (!['--scheduled', '--manual-once'].includes(mode)) throw Error('invalid_worker_mode');
    if (worker === 'B') {
        if (host !== 'tikitikit-pc-b') throw Error('invalid_worker_host');
        return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
            host, 'node', COLLECTOR_BRIDGE, 'ttang-worker', mode];
    }
    if (worker === 'C') {
        return ['-F', 'NUL', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=NUL',
            '-o', 'UserKnownHostsFile=C:/Users/ynal/.ssh/known_hosts', '-o', 'ConnectTimeout=15',
            '-i', 'C:/Users/ynal/.ssh/tikitikit_a_to_c_ed25519', 'ynal@100.87.173.95',
            'C:/Users/ynal/AppData/Local/hermes/node/node.exe', COLLECTOR_BRIDGE, 'ttang-worker', mode];
    }
    throw Error('invalid_worker');
}
