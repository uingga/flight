import fs from 'node:fs';
import path from 'node:path';

export const isManualRunId = id => typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

// A user-approved one-off is separate from regularOnly. It cannot authorize
// another source, a second run, or changes to site circuits/collection budgets.
export function validateTtangManualGrant(grant, config, id, now = Date.now()) {
    const created = Date.parse(grant?.createdAt), expires = Date.parse(grant?.expiresAt);
    if (!isManualRunId(id) || grant?.format !== 1 || grant.source !== 'ttang' || grant.runId !== id
        || grant.replacementId !== config.id || grant.releaseVersion !== config.releaseVersion
        || grant.userApproved !== true || grant.maxRuns !== 1
        || !Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now
        || created < Date.parse(config.notBefore) || expires - created > 2 * 3600_000 || expires <= created)
        throw Error('temporary_manual_grant_required');
    return grant;
}

export function manualGrantPaths(config, id) {
    if (!isManualRunId(id)) throw Error('temporary_manual_grant_required');
    const directory = path.join(config.root, 'manual-grants');
    return { directory, grant: path.join(directory, 'ttang-' + id + '.json'),
        claim: path.join(directory, 'ttang-' + id + '.claimed.json') };
}

export function readTtangManualGrant(config, id, now = Date.now()) {
    const files = manualGrantPaths(config, id);
    if (!fs.existsSync(files.grant) || fs.lstatSync(files.directory).isSymbolicLink()
        || fs.lstatSync(files.grant).isSymbolicLink()) throw Error('temporary_manual_grant_required');
    if (fs.existsSync(files.claim)) throw Error('temporary_manual_grant_spent');
    return validateTtangManualGrant(JSON.parse(fs.readFileSync(files.grant, 'utf8')), config, id, now);
}

export function claimTtangManualGrant(config, id, now = Date.now()) {
    readTtangManualGrant(config, id, now);
    const files = manualGrantPaths(config, id);
    fs.writeFileSync(files.claim, JSON.stringify({ runId: id, source: 'ttang', pid: process.pid,
        claimedAt: new Date(now).toISOString(), releaseVersion: config.releaseVersion }), { flag: 'wx' });
}
