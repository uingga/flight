import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agencyEveningManifest, verifyAgencyEveningRelease } from './agency-evening-release.mjs';

test('the PC release is pinned to exact file bytes and rejects modifications', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-evening-release-test-'));
    t.after(() => {
        if (!root.startsWith(os.tmpdir() + path.sep)) throw new Error('unsafe_test_cleanup');
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts/agency-evening-worker.mjs'), 'export const ok=true;\n');
    const manifest = agencyEveningManifest([{ file: 'scripts/agency-evening-worker.mjs',
        content: fs.readFileSync(path.join(root, 'scripts/agency-evening-worker.mjs')) }]);
    assert.equal(verifyAgencyEveningRelease(root, manifest, manifest.version).files, 1);
    assert.throws(() => verifyAgencyEveningRelease(root, manifest, '0'.repeat(64)), /mismatch/);
    fs.writeFileSync(path.join(root, 'scripts/agency-evening-worker.mjs'), 'export const ok=false;\n');
    assert.throws(() => verifyAgencyEveningRelease(root, manifest, manifest.version), /modified/);
    assert.throws(() => agencyEveningManifest([{ file: '../outside', content: 'no' }]), /unsafe/);
});
