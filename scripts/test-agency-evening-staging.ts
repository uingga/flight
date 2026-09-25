import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createEveningStaging } from './agency-evening-staging.mjs';
import { TtangDetailCheckpoint } from '../src/lib/ttang-detail-checkpoint';

function fixture(t: any) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evening-staging-test-'));
    t.after(() => {
        if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('unsafe_fixture_cleanup');
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}
test('new evening installation creates the real checkpoint-compatible directory without network', t => {
    const root = fixture(t), id = randomUUID();
    const dir = createEveningStaging(root, id, 'ttang', { 'all-flights-cache.json': { flights: [] } });
    const checkpoint = new TtangDetailCheckpoint(root, dir, id, new Date(), 'fixture');
    checkpoint.begin([], 0);
    checkpoint.complete();
    assert.equal(JSON.parse(fs.readFileSync(checkpoint.filePath, 'utf8')).status, 'completed');
    assert.throws(() => createEveningStaging(root, id, 'ttang', {}), /EEXIST/);
    assert.throws(() => createEveningStaging(root, id, 'ttang', { '../data.json': {} }), /invalid_evening_staging/);
});
for (const component of ['.local-crawler', '.local-crawler/staging']) {
    test(`staging refuses a redirected ${component} before writing any input`, t => {
        const root = fixture(t), operational = path.join(root, 'data');
        fs.mkdirSync(operational);
        const link = path.join(root, component);
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(operational, link, 'junction');
        assert.throws(() => createEveningStaging(root, randomUUID(), 'ttang', { 'all-flights-cache.json': {} }), /unsafe_evening_staging/);
        assert.deepEqual(fs.readdirSync(operational), []);
    });
}
