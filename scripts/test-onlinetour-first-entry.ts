import assert from 'node:assert/strict';
import { validateAdFrameRecheckEvidence } from './probe-onlinetour-first-entry';

const id = '6054e2ad-40dc-4ac4-be77-6bab6ce09f62';
const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const prior = { runId: id, status: 'failed', failure: 'invalid_paused_request', cleanupConfirmed: true,
    productionReady: false, rawCount: 0, mappedCount: 0, finishedAt: new Date().toISOString(),
    diagnostics: { actions: 1, documentRequests: 2, permittedDocumentRequests: 1, productRequests: 0, permittedProductRequests: 0, blockedRequests: 1 },
    rejectedRequest: { mainFrame: false, method: 'GET', bodyPresent: false, redirected: false, responseStage: false,
        origin: 'https://gum.criteo.com', path: '/syncframe' } };
assert.equal(validateAdFrameRecheckEvidence({ runId: id }, prior, date), id);
for (const patch of [
    { failure: 'http_access_status' }, { cleanupConfirmed: false }, { rawCount: 1 },
    { finishedAt: '2000-01-01T00:00:00Z' }, { finishedAt: 'bad' },
    { diagnostics: { ...prior.diagnostics, productRequests: 1 } },
    { rejectedRequest: { ...prior.rejectedRequest, mainFrame: true } },
    { rejectedRequest: { ...prior.rejectedRequest, origin: 'https://unknown.example' } },
    { rejectedRequest: { ...prior.rejectedRequest, redirected: true } },
]) assert.throws(() => validateAdFrameRecheckEvidence({ runId: id }, { ...prior, ...patch }, date));
assert.throws(() => validateAdFrameRecheckEvidence({ runId: '../../escape' }, prior, date));
assert.throws(() => validateAdFrameRecheckEvidence({ runId: id }, null, date));
console.log('12 offline recheck-evidence cases passed; site requests=0');
