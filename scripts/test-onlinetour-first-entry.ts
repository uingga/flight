import assert from 'node:assert/strict';
import { validateAdFrameRecheckEvidence, verifiedEmptyFirstEntry } from './probe-onlinetour-first-entry';

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
const emptySnapshot:any={region:'AS',cities:[],currentScope:null,restricted:false,emptyInventoryVerified:true};
assert.equal(verifiedEmptyFirstEntry({snapshot:emptySnapshot,firstPage:null}),true);
const scope={departure:'ICN',city:'PQC',month:'202609'};
const emptyCity:any={snapshot:{...emptySnapshot,cities:[{code:'PQC',firstDepartureDate:'20260907'}],currentScope:scope},
    firstPage:{scope,pageNo:1,totalCount:0,lastPage:0,rawProducts:[],nextPageAvailable:false}};
assert.equal(verifiedEmptyFirstEntry(emptyCity),true);
for(const invalid of [
    {...emptyCity,firstPage:{...emptyCity.firstPage,totalCount:1}},
    {...emptyCity,firstPage:{...emptyCity.firstPage,nextPageAvailable:true}},
    {...emptyCity,snapshot:{...emptyCity.snapshot,restricted:true}},
    {...emptyCity,snapshot:{...emptyCity.snapshot,currentScope:null}},
])assert.equal(verifiedEmptyFirstEntry(invalid),false);
console.log('offline first-entry evidence cases passed; site requests=0');
