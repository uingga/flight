import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOnlineTourBrowserAdapter } from '../src/lib/onlinetour-browser-adapter';
import { executeBrowserLists } from './crawl-onlinetour-browser-lists';
import { FakeCdp, respond, validRow, rowBody } from './test-onlinetour-browser-adapter';

const scope = { departure: 'ICN', city: 'PQC', month: '202609' };
const apiUrl = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';

for (const method of ['Page.stopLoading', 'Target.detachFromTarget'])
for (const status of [401, 403, 429]) {
    test(`last page + HTTP ${status} during ${method}: cleanup succeeds, crawl must fail`, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-late-cleanup-'));
        const client = new FakeCdp();
        const adapter = await createOnlineTourBrowserAdapter(client);
        client.onAction = () => respond(client, 1, {
            document: true, next: false,
            text: rowBody(1, [validRow('validated')])
                .replace('"totalLastPage":2', '"totalLastPage":1').replace('"totalCount":2', '"totalCount":1'),
        });
        const send = client.send.bind(client);
        let injected = false;
        client.send = async (command, params, sessionId) => {
            if (command === method && !injected) {
                injected = true;
                client.emit('Network.responseReceived', {
                    requestId: 'late-response', type: 'Script', frameId: 'main',
                    response: { url: apiUrl, status },
                });
            }
            return send(command, params, sessionId);
        };
        try {
            const result = await executeBrowserLists(adapter, root, [scope],
                { maxRequests: 1, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
            assert.equal(injected, true);
            assert.equal(result.status, 'failed');
            assert.equal(result.failure, 'access_restriction');
            assert.equal(adapter.failureKind, 'access');
            assert.equal(result.cleanupConfirmed, true);
            assert.equal(result.productionReady, false);
            assert.equal(result.uniqueCount, 1);
            assert.equal(result.permittedProductRequests, 1);
            assert.equal(result.browserActions, 1);
            assert.equal(client.closed, true);
            const dir = path.join(root, '.local-crawler', 'staging', result.runId);
            const saved = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
            assert.equal(saved.status, 'failed');
            assert.equal(saved.failure, 'access_restriction');
            assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'flights.json'), 'utf8')).length, 1);
            assert.equal(fs.existsSync(path.join(root, 'data')), false);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}

for (const scenario of ['normal', 'other-session', 'other-url', 'off-action-query', 'access-and-cleanup-error'] as const) {
    test(`cleanup boundary: ${scenario}`, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-cleanup-boundary-'));
        const client = new FakeCdp();
        const adapter = await createOnlineTourBrowserAdapter(client);
        client.onAction = () => respond(client, 1, { document: true, next: false,
            text: rowBody(1, [validRow('kept')])
                .replace('"totalLastPage":2', '"totalLastPage":1').replace('"totalCount":2', '"totalCount":1') });
        const send = client.send.bind(client);
        let injected = false;
        client.send = async (command, params, sessionId) => {
            if (command === 'Page.stopLoading' && !injected) {
                injected = true;
                if (scenario === 'off-action-query') {
                    client.emitDirect('Fetch.requestPaused', { requestId: 'late-paused',
                        request: { method: 'GET', url: apiUrl } });
                } else if (scenario !== 'normal') {
                    client.emitDirect('Network.responseReceived', { requestId: 'late', type: 'Script',
                        response: { url: scenario === 'other-url' ? 'https://example.invalid/' : apiUrl, status: 429 } },
                        scenario === 'other-session' ? 'not-owned-session' : 'session');
                }
                if (scenario === 'access-and-cleanup-error') throw new Error('PRIVATE_CLEANUP_ERROR');
            }
            return send(command, params, sessionId);
        };
        try {
            const summary = await executeBrowserLists(adapter, root, [scope],
                { maxRequests: 1, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
            const failed = scenario === 'off-action-query' || scenario === 'access-and-cleanup-error';
            assert.equal(summary.status, failed ? 'failed' : 'review_ready');
            assert.equal(summary.cleanupConfirmed, scenario !== 'access-and-cleanup-error');
            assert.equal(summary.failure, scenario === 'access-and-cleanup-error' ? 'access_restriction'
                : scenario === 'off-action-query' ? 'browser_adapter_failed' : null);
            assert.equal(summary.uniqueCount, 1);
            assert.equal(summary.permittedProductRequests, 1);
            assert.equal(client.closed, true);
            assert.equal(JSON.stringify(summary).includes('PRIVATE'), false);
            const finalKind = adapter.failureKind;
            client.emitDirect('Network.responseReceived', { type: 'Script', response: {url:apiUrl,status:429} });
            assert.equal(adapter.failureKind, finalKind, 'after disconnect, late events cannot mutate final evidence');
            assert.equal(client.listeners.size, 0);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}
