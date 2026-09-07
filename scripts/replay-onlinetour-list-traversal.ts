import fs from 'node:fs';
import path from 'node:path';
import type { ListScope, ListPage } from '../src/lib/onlinetour-list-traversal';

interface Observation {
    scope: ListScope;
    pageNo: number;
    attempt: number;
    result?: ListPage;
    error?: { kind: 'transient' | 'access' | 'validation' };
}
interface ReplayManifest {
    schemaVersion: 1;
    evidence: 'synthetic_offline_fixture' | 'saved_rows_with_synthetic_paging';
    scopes: ListScope[];
    observations: Observation[];
}
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const validScope = (value: unknown): value is ListScope => record(value)
    && typeof value.departure === 'string' && /^[A-Z]{3}$/.test(value.departure)
    && typeof value.city === 'string' && /^[A-Z]{3}$/.test(value.city)
    && typeof value.month === 'string' && /^[1-9][0-9]{3}(?:0[1-9]|1[0-2])$/.test(value.month)
    && (value.sort === undefined || typeof value.sort === 'string')
    && (value.filter === undefined || typeof value.filter === 'string');

export function parseReplayManifest(input: unknown): ReplayManifest {
    if (!record(input) || input.schemaVersion !== 1
        || typeof input.evidence !== 'string'
        || !['synthetic_offline_fixture', 'saved_rows_with_synthetic_paging'].includes(input.evidence)
        || !Array.isArray(input.scopes) || input.scopes.length < 1 || input.scopes.length > 100
        || !input.scopes.every(validScope) || !Array.isArray(input.observations)
        || input.observations.length > 100) throw new Error('invalid_offline_manifest');
    for (const item of input.observations) {
        if (!record(item) || !validScope(item.scope) || !Number.isSafeInteger(item.pageNo)
            || Number(item.pageNo) < 1 || ![1, 2].includes(Number(item.attempt))
            || typeof item.attempt !== 'number'
            || (Object.hasOwn(item, 'result') === Object.hasOwn(item, 'error'))) throw new Error('invalid_offline_observation');
        if (Object.hasOwn(item, 'result') && !record(item.result)) throw new Error('invalid_offline_result');
        if (Object.hasOwn(item, 'error') && (!record(item.error) || typeof item.error.kind !== 'string'
            || !['transient', 'access', 'validation'].includes(item.error.kind))) throw new Error('invalid_offline_error');
    }
    return input as unknown as ReplayManifest;
}

export async function runTraversalReplay(input: unknown, repositoryRoot: string) {
    const manifest = parseReplayManifest(input);
    const { traverseOnlineTourLists, ListReadError } = await import('../src/lib/onlinetour-list-traversal');
    const { createStagingRun } = await import('../src/lib/onlinetour-browser-collector');
    let cursor = 0;
    const sameScope = (left: ListScope, right: ListScope) => left.departure === right.departure
        && left.city === right.city && left.month === right.month;
    const result = await traverseOnlineTourLists(manifest.scopes, async (scope, pageNo, attempt) => {
        const observation = manifest.observations[cursor];
        if (!observation || !sameScope(scope, observation.scope) || observation.pageNo !== pageNo
            || observation.attempt !== attempt) throw new ListReadError('validation', 'offline_transcript_mismatch');
        cursor++;
        if (observation.error) throw new ListReadError(observation.error.kind, 'offline_fixture_failure');
        return structuredClone(observation.result!);
    }, { wait: async () => {} }); // Offline replay only: no real requests or waiting.
    const run = createStagingRun(repositoryRoot);
    const { rawProducts, flights, ...metadata } = result;
    const unusedObservations = manifest.observations.length - cursor;
    const replayIssue = result.status !== 'failed' && unusedObservations > 0 ? 'offline_transcript_unused' : null;
    const summary = { ...metadata, status: replayIssue ? 'failed' as const : result.status,
        replayIssue, runId: run.runId, offlineOnly: true as const,
        fixtureEvidence: manifest.evidence, siteRequestCount: 0, replayedRequestCount: result.requestCount,
        consumedObservations: cursor, unusedObservations,
        productionReady: false as const };
    run.write('raw-products.json', rawProducts);
    run.write('flights.json', flights);
    run.write('summary.json', summary);
    return summary;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
        console.log('OFFLINE OnlineTour traversal replay; never connects to Chrome or the site.\n'
            + 'Usage: tsx scripts/replay-onlinetour-list-traversal.ts --fixture <local-json-file>\n'
            + 'Only UUID staging output; synthetic paging is not live collection evidence.');
        return;
    }
    if (args.length !== 2 || args[0] !== '--fixture' || !args[1] || args[1].startsWith('--')) {
        console.error('Refused: use --fixture <local-json-file>, or --help. No live mode.');
        process.exitCode = 2;
        return;
    }
    // Local file only. No URL fetch, endpoint, profile or output-directory arguments.
    const inputPath = path.resolve(args[1]);
    const stat = fs.lstatSync(inputPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10_000_000) throw new Error('invalid_offline_file');
    const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const summary = await runTraversalReplay(input, path.resolve(__dirname, '..'));
    console.log(JSON.stringify({ runId: summary.runId, status: summary.status, offlineOnly: true,
        siteRequestCount: 0, replayedRequestCount: summary.replayedRequestCount,
        rawCount: summary.rawCount, uniqueCount: summary.uniqueCount, productionReady: false }));
    process.exitCode = summary.status === 'failed' ? 1 : 0;
}
if (require.main === module) void main().catch(() => {
    console.error('Offline replay failed: invalid fixture or local staging write. No site requests.');
    process.exitCode = 1;
});
