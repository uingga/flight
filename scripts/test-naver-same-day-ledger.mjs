import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Coordinator, CONTRACT } from '../src/lib/naver-coordinator.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naver-recheck-ledger-'));
const now = Date.parse('2026-09-23T03:00:00.000Z');
const coordinator = new Coordinator(path.join(directory, 'ledger.sqlite'), () => now, null, { initialize: true });
const owner = { contract: CONTRACT, worker: 'A', run: '2026-09-23-A' };

try {
    coordinator.begin(owner);
    const first = coordinator.reserve({ ...owner, requestId: 'first', key: 'route-a', kind: 'search' });
    coordinator.finish({ ...first, outcome: 'success' });
    assert.deepEqual(coordinator.workState(owner).recheckableKeys, ['route-a']);
    assert.throws(() => coordinator.reserve({ ...owner, requestId: 'duplicate', key: 'route-a', kind: 'search' }), /duplicate key/);
    assert.throws(() => coordinator.reserve({ ...owner, requestId: 'probe', key: 'route-a', kind: 'probe', recheck: true }), /same-day recheck refused/);

    assert.throws(() => coordinator.reserve({ ...owner, requestId: 'wrong-source', key: 'route-a', kind: 'search', source: 'ybtour', recheck: true }), /same-day recheck refused/);
    const second = coordinator.reserve({ ...owner, requestId: 'second', key: 'route-a', kind: 'search', source: 'myrealtrip', recheck: true });
    coordinator.finish({ ...second, outcome: 'success' });
    assert.deepEqual(coordinator.workState(owner).recheckableKeys, []);
    assert.throws(() => coordinator.reserve({ ...owner, requestId: 'third', key: 'route-a', kind: 'search', source: 'myrealtrip', recheck: true }), /same-day recheck refused/);

    const missed = coordinator.reserve({ ...owner, requestId: 'missed', key: 'route-b', kind: 'search' });
    coordinator.finish({ ...missed, outcome: 'miss' });
    assert.throws(() => coordinator.reserve({ ...owner, requestId: 'retry', key: 'route-b', kind: 'search', source: 'tripcom', recheck: true }), /same-day recheck refused/);
    assert.deepEqual(coordinator.readonlySnapshot().used, { A: 3, C: 0 });
    console.log('Naver same-day ledger tests passed');
} finally {
    coordinator.close();
    fs.rmSync(directory, { recursive: true, force: true });
}
