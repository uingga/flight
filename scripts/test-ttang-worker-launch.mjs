import test from 'node:test';
import assert from 'node:assert/strict';
import {ttangWorkerSshArgs} from './ttang-worker-launch.mjs';

test('B and C use the verified collector bridge for both run modes', () => {
    for (const worker of ['B', 'C']) for (const mode of ['--scheduled', '--manual-once']) {
        const args=ttangWorkerSshArgs(worker,mode,'tikitikit-pc-b');
        assert.deepEqual(args.slice(-3),['C:/Users/ynal/AppData/Local/Tikitikit/collector/run.mjs','ttang-worker',mode]);
        assert.ok(args.includes('StrictHostKeyChecking=yes'));
        assert.ok(!args.some(value=>value.includes('crawler-validation-20260907') || value.includes('ac-staged-20260916')));
    }
    assert.ok(ttangWorkerSshArgs('C','--scheduled','tikitikit-pc-b').includes('UserKnownHostsFile=C:/Users/ynal/.ssh/known_hosts'));
    assert.throws(()=>ttangWorkerSshArgs('B','--scheduled','wrong-host'),/invalid_worker_host/);
    assert.throws(()=>ttangWorkerSshArgs('C','--unknown','tikitikit-pc-b'),/invalid_worker_mode/);
});
