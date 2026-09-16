import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NavigationSession } from './lib/naver-navigation.mjs';
import { NaverWorkBoundary } from './lib/naver-work-boundary';
import { attestRunner, runnerDigest } from './lib/naver-admission.mjs';
import { assertMode, stampResult, resultVersion, shouldSelectTodayPick } from '../src/lib/naver-coordination-contract.mjs';
import { applyNaverFilter } from './filter-by-naver';
import { main as selectTodayPick } from './select-today-pick.mjs';
import { evaluateLocalNaverRun } from './local-naver-run-policy.mjs';
import { configuredRunnerOptions } from './lib/naver-runtime-config';
import { runScheduledNaver, scheduledArguments } from './lib/naver-scheduled-run.mjs';
import {evaluateRoundContinuation} from '../src/lib/naver-round-handoff.mjs';

export function loadCandidateSnapshot(root = process.cwd(), read = readFileSync) {
    const cache = JSON.parse(read(path.join(root, 'data/all-flights-cache.json'), 'utf8'));
    const times = [cache.fullCrawlUpdatedAt, cache.lastUpdated, cache.timestamp, ...Object.values(cache.sourceUpdatedAt || {})]
        .map(value => new Date(value as string).getTime()).filter(Number.isFinite);
    const generation = Math.max(...times);
    if (!Number.isSafeInteger(generation) || !Array.isArray(cache.flights)) throw Error('invalid source snapshot');
    return { generation, flights: cache.flights, cache };
}

// Actual PS1 target. Every I/O dependency is injectable; this module starts no server.
export async function runNaverAc(options: any) {
    const attestation = attestRunner({ ...options.attestation, digest: runnerDigest(options.root || process.cwd()) });
    if (options.identity.worker === 'A' && !options.policyInput) throw Error('legacy A policy input required');
    let policy: any = options.identity.worker === 'A' ? evaluateLocalNaverRun(options.policyInput) : {};
    if(options.identity.worker==='A'&&options.policyInput?.completedRound&&policy.reason==='daily_budget_exhausted'){
        const refresh=evaluateRoundContinuation({now:new Date(options.policyInput.now||Date.now()).getTime(),cache:options.policyInput.cache,state:options.policyInput.state,round:options.policyInput.completedRound,totalBudget:400});
        if(refresh.shouldRun)policy={...refresh,shouldRun:false,shouldFinalize:true,navigationBudget:0};
    }
    if (options.identity.worker === 'A' && !policy.shouldRun && !policy.shouldFinalize) return { status: 'waiting', reason: policy.reason };
    const { client, publisher, publish, readback } = options;
    const loadSnapshot = options.loadSnapshot || (() => loadCandidateSnapshot(options.root));
    const identity = { ...options.identity, attestation };
    const lease = await client[options.resume ? 'resume' : 'begin'](identity);
    Object.assign(identity, lease);
    try {
    await options.initialize?.(identity, policy);
    const { runNaver, getNaverSelectionOptions, prepareFlightCandidates } = await import('./crawl-naver');
    const phaseState = await client.workState(identity);
    if (identity.worker === 'C' && !Array.isArray(phaseState.sourceScope)) throw Error('missing A source scope');
    const session: any = new NavigationSession(client, identity);
    const boundary = new NaverWorkBoundary({ client, publisher, identity,
        selectionOptions: options.selectionOptions || getNaverSelectionOptions() });
    let latest: any = null;
    session.nextFlight = async (prices: any, limit: number) => {
        session.assertComplete();
        latest = await loadSnapshot();
        const contentSignature = createHash('sha256').update(JSON.stringify(latest.flights)).digest('hex');
        const flights = (options.prepareFlights || prepareFlightCandidates)(structuredClone(latest.flights),
            latest.cache?.sourceUpdatedAt || latest.sourceUpdatedAt || {}, latest.cache?.lastUpdated || latest.cache?.timestamp,
            identity.worker === 'A' ? new Set(policy.sources || []) : new Set(phaseState.sourceScope));
        const currentState = await client.workState(identity);
        const phaseRemaining = Math.max(0, (policy.navigationBudget ?? 200) - (currentState.used[identity.worker] - phaseState.used[identity.worker]));
        const rows = await boundary.refresh({ ...latest, flights, contentSignature }, prices, Math.min(limit, phaseRemaining));
        return rows[0] || null;
    };
    let result;
    if (identity.worker === 'A' && policy.shouldFinalize && !policy.shouldRun) {
        const prices = await options.loadPrices();
        await session.nextFlight(prices, 0);
        result = { normalExit: true, prices };
    } else result = await (options.collect || runNaver)(session);
    session.assertComplete();
    if (result?.normalExit !== true) throw Error('collection did not terminate normally');
    const state = await client.workState(identity);
    if (!latest || state.generation !== latest.generation) throw Error('missing or changed collection snapshot');
    const filtered = applyNaverFilter(structuredClone(latest.cache || { flights: latest.flights }), result.prices).cache;
    const cache = stampResult(filtered, result.prices, { run: identity.run, generation: state.generation });
    const version = resultVersion(cache);
    if (identity.worker === 'A') await publisher.setSourceScope({ ...identity, sources: policy.allowedTodayPickSources || [] });
    await client.complete({ ...identity, version });
    Object.assign(identity, await options.acquirePublication?.(identity) || {});
    if (await publish({ cache, prices: result.prices, version, expectedBase: latest.ref }) !== version) throw Error('publication version mismatch');
    const observed = await readback(cache);
    if (observed !== version) throw Error('readback version mismatch');
    if (identity.worker === 'A' && shouldSelectTodayPick({ ...policy, dataPublished: true })) {
        await (options.selectTodayPick || selectTodayPick)({ sources: new Set(policy.allowedTodayPickSources || []) });
    }
    await options.onComplete?.({ version, worker: identity.worker }, policy);
    await options.beforeRelease?.(cache);
    await options.recordPublication?.(identity,observed);
    await publisher.verifyAndRelease({ ...identity, expected: version, observed,
        defer: identity.worker === 'A' && policy.deferTodayPick === true });
    await options.afterRelease?.();
    return { version, worker: identity.worker };
    } finally { await options.dispose?.(); }
}

export async function main(options?: any, args=process.argv.slice(2)) {
    if (!assertMode()) throw Error('coordinated runner requires coordinated mode');
    if (options) return runNaverAc(options);
    const {scheduled,approvedRecoverySources}=scheduledArguments(args);
    const env={...process.env,NAVER_COORDINATION_APPROVED_RECOVERY_SOURCES:approvedRecoverySources};
    return runScheduledNaver({scheduled,
        configure:()=>configuredRunnerOptions(env),
        run:runNaverAc});
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
