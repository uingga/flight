import fs from 'node:fs';
import path from 'node:path';
import { parseCataloguePlan, type CataloguePlan } from '../src/lib/onlinetour-catalogue';
import { checkValidationCooldown, createLiveCatalogueBackend, executeCatalogue } from './crawl-onlinetour-catalogue';
import { inspectResumeCheckpoint } from '../src/lib/onlinetour-resume';
import { createDepartureWindow } from '../src/lib/onlinetour-departure-window';

function readSmallJson(file: string) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('invalid_validation_input');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function validateFreshSourceState(state: any, now = Date.now()): void {
    const age = now - Date.parse(state?.fetchedAt), crawlAge = now - Date.parse(state?.fullCrawlUpdatedAt);
    if (!/^[0-9a-f]{40}$/.test(state?.revision || '') || !Number.isFinite(age) || age < 0 || age > 15 * 60_000
        || !Number.isFinite(crawlAge) || crawlAge < 0 || crawlAge > 6 * 3600_000
        || !state?.sourceCircuits || typeof state.sourceCircuits !== 'object' || Array.isArray(state.sourceCircuits))
        throw new Error('stale_source_state');
    checkValidationCooldown(state, null, now);
}
export function validateCombinedPlan(value: unknown): CataloguePlan {
    const plan = parseCataloguePlan(value);
    // User-approved follow-up: preserve PQC evidence, inspect the existing AS page,
    // then one observed JA region transition. The earlier 4 requests leave at most 16.
    if (plan.departureWindow) {
        const regionalFollowup = plan.regions.join(',') === 'AS,JA' && plan.reloadStart === undefined;
        const existingJapanGate = plan.regions.join(',') === 'JA' && plan.reloadStart === true;
        if ((!regionalFollowup && !existingJapanGate) || plan.maxRetries !== 0
            || plan.excludeCities?.join(',') !== 'PQC' || plan.maxCitiesPerRegion !== 1
            || plan.maxMonthsPerCity !== 3 || plan.maxProductRequests > 16
            || plan.maxRegionalNavigations !== 1 || plan.maxPagesPerScope > 6)
            throw new Error('combined_sample_bounds_required');
        return plan;
    }
    // This entry point is a bounded user-approved sample, not a full crawler or retry command.
    if (plan.regions.join(',') !== 'AS' || plan.reloadStart !== true || plan.maxRetries !== 0
        || !plan.maxCitiesPerRegion || plan.maxCitiesPerRegion > 3 || plan.maxMonthsPerCity > 2
        || plan.maxProductRequests > 20 || plan.maxRegionalNavigations !== 1 || plan.maxPagesPerScope > 6)
        throw new Error('combined_sample_bounds_required');
    return plan;
}
async function main() {
    const args = process.argv.slice(2);
    const approvalId = args.length === 7 && args[5] === '--approval-id' ? args[6] : undefined;
    const resumeId = args.length === 7 && args[5] === '--resume-run' ? args[6] : undefined;
    if ((args.length !== 5 && !approvalId && !resumeId) || args[0] !== '--consent-confirmed' || args[1] !== '--plan' || args[3] !== '--source-state'
        || (approvalId !== undefined && !/^[a-z0-9][a-z0-9-]{7,63}$/.test(approvalId))
        || (resumeId !== undefined && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(resumeId)))
        throw new Error('explicit_combined_validation_required');
    const plan = validateCombinedPlan(readSmallJson(args[2]));
    if (plan.departureWindow && JSON.stringify(plan.departureWindow) !== JSON.stringify(createDepartureWindow()))
        throw new Error('stale_departure_window');
    const state = readSmallJson(args[4]);
    validateFreshSourceState(state);
    if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) throw new Error('missing_local_state');
    const root = path.resolve(__dirname, '..');
    const stateRoot = path.join(process.env.LOCALAPPDATA, 'Tikitikit', 'onlinetour-validation');
    fs.mkdirSync(stateRoot, { recursive: true });
    if (fs.lstatSync(stateRoot).isSymbolicLink()) throw new Error('unsafe_state_directory');
    const cooldown = path.join(stateRoot, 'cooldown.json');
    const ownCooldown = path.join(root, '.local-crawler', 'onlinetour-validation-cooldown.json');
    const lock = path.join(stateRoot, 'run.lock');
    const fd = fs.openSync(lock, 'wx'); // Never remove another process's lock.
    try {
        validateFreshSourceState(state);
        for (const file of [cooldown, ownCooldown]) checkValidationCooldown(state, fs.existsSync(file) ? readSmallJson(file) : null);
        const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        const backend = await createLiveCatalogueBackend();
        let recovered: Awaited<ReturnType<typeof inspectResumeCheckpoint>> | undefined;
        const guardedInspection = async (...params: Parameters<typeof inspectResumeCheckpoint>) => {
            try {return await inspectResumeCheckpoint(...params);}
            catch(error) {
                if(error instanceof Error && error.message === 'access_restriction')
                    fs.writeFileSync(cooldown,JSON.stringify({nextProbeAt:new Date(Date.now()+86400_000).toISOString(),reason:'access_restriction'}));
                throw error;
            }
        };
        if (resumeId) {
            const directory = path.join(root, '.local-crawler', 'staging', resumeId);
            if (path.resolve(fs.realpathSync.native(directory)) !== path.resolve(directory)) throw new Error('unsafe_resume_directory');
            const readEvidence = (name: string) => {
                const file = path.join(directory,name), stat = fs.lstatSync(file);
                if(!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error('invalid_resume_file');
                return JSON.parse(fs.readFileSync(file,'utf8'));
            };
            const previous = readEvidence('summary.json'), rows = readEvidence('raw-products.json'), flights = readEvidence('flights.json');
            if(previous.runId !== resumeId) throw new Error('resume_id_mismatch');
            recovered = await guardedInspection(previous,rows,flights,plan);
            const identity = recovered.identity, openLists = backend.openLists;
            let firstRead = true;
            backend.openLists = async (cap, seed) => {
                const adapter = await openLists(cap,seed);
                return { ...adapter,
                    get failureKind() {return adapter.failureKind;}, get partialEvidence() {return adapter.partialEvidence;},
                    async readPage(scope,page,attempt) {
                        if(firstRead) {await guardedInspection(previous,rows,flights,plan,identity); firstRead=false;}
                        return adapter.readPage(scope,page,attempt);
                    },
                };
            };
        }
        // A separately user-approved attempt gets its own immutable marker, never resets prior ones.
        // This identifier is not an automatic retry mode and never overrides a cooldown or lock.
        fs.writeFileSync(path.join(stateRoot, resumeId ? `resume-of-${resumeId}.json` : `combined-validation-${date}${approvalId ? '-' + approvalId : ''}.json`), JSON.stringify({
            startedAt: new Date().toISOString(), sourceStateRevision: state.revision, plan, approvalId: approvalId || null,
            parentRunId: resumeId || null, carriedProductRequests: recovered?.resume.productRequests || 0,
            checkpointIdentity: recovered?.identity || null,
        }), { flag: 'wx' });
        console.log(JSON.stringify({ stage: 'combined_validation_started', plan, productionReady: false }));
        const result = await executeCatalogue(root, plan, backend, false,
            event => console.log(JSON.stringify(event)), recovered?.resume);
        const limited = ['access_restriction', 'http_access_status', 'access_body', 'restricted_dom',
            'empty_or_invalid_first_page'].includes(result.failure || '')
            || result.failure === 'empty_catalogue' && result.productRequests + result.regionalNavigations > 0;
        if (limited) fs.writeFileSync(cooldown, JSON.stringify({ nextProbeAt: new Date(Date.now() + 86400_000).toISOString(), reason: result.failure }));
        console.log(JSON.stringify({ stage: 'combined_validation_finished', runId: result.runId, status: result.status,
            failure: result.failure, firstPageVerified: result.firstPageVerified, productRequests: result.productRequests,
            regionalNavigations: result.regionalNavigations, uniqueCount: result.uniqueCount,
            plannedCoverageCompleted: result.plannedCoverageCompleted, cleanupConfirmed: result.cleanupConfirmed,
            scopeResults: result.scopeResults, deferredCityCount: result.deferred.length, productionReady: false }));
        process.exitCode = result.status === 'failed' ? 1 : 0;
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) void main().catch(error => {
    const reason = /^[a-z_]{1,80}$/.test(error?.message || '') ? error.message : 'combined_validation_preflight_failed';
    console.error(JSON.stringify({ status: 'failed', reason, productionReady: false })); process.exitCode = 1;
});
