import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TtangTimeCandidate } from './ttang-time-enrichment';
import type { EnrichAttempt, EnrichData } from './utils/realtime-enrich';
import { SourceResponseError } from './scrapers/source-response';

type Identity = { masterId: string; fareId: string; departureDate: string };
type SuccessPatch = {
    key: string;
    identity: Identity;
    route: { depCode: string; arrCode: string; arrivalDate: string; carrierCode: string; fareType: string };
    runId: string;
    adapterVersion: string;
    detailCheckedAt: string;
    detail: EnrichData;
    seatAction: 'set' | 'clear';
};

/** Staging-only evidence. Never merged into the cache or source health automatically. */
export class TtangDetailCheckpoint {
    readonly filePath: string;
    private begun = false;
    private selected = new Map<string, TtangTimeCandidate>();
    private outcomes = new Map<string, { key: string; status: string; checkedAt: string }>();
    private successes: SuccessPatch[] = [];
    private status: 'running' | 'completed' | 'aborted' = 'running';
    private inFlightKey: string | null = null;
    private lastCompletedKey: string | null = null;
    private excludedLegacy = 0;
    private deferred = 0;
    private abortReason: { kind: string; status?: number; causeCode?: string } | null = null;

    constructor(
        root: string,
        stagingDir: string,
        private readonly runId: string,
        private readonly startedAt: Date,
        private readonly adapterVersion: string,
    ) {
        if (!runId || !adapterVersion || !Number.isFinite(startedAt.getTime())) throw new Error('Invalid checkpoint run metadata');
        const expectedRoot = path.join(fs.realpathSync(root), '.local-crawler', 'staging');
        const allowed = fs.realpathSync(expectedRoot);
        if (path.relative(expectedRoot, allowed)) throw new Error('Staging root must not redirect outside its canonical location');
        const actual = fs.realpathSync(stagingDir);
        const relative = path.relative(allowed, actual);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error('Detail checkpoints require a dedicated .local-crawler/staging run directory');
        }
        this.filePath = path.join(actual, 'ttang-detail-checkpoint.json');
        if (fs.existsSync(this.filePath)) throw new Error('Existing detail checkpoint must not be overwritten');
    }

    begin(candidates: TtangTimeCandidate[], deferred: number): void {
        if (this.begun) throw new Error('Checkpoint already begun');
        this.begun = true;
        this.selected = new Map(candidates.filter(c => c.product).map(c => [c.key, structuredClone(c)]));
        this.excludedLegacy = candidates.filter(c => !c.product).length;
        this.deferred = deferred;
        this.save();
    }

    start(key: string): void {
        if (!this.begun || this.status !== 'running' || !this.selected.has(key) || this.outcomes.has(key) || this.inFlightKey) {
            throw new Error('Checkpoint request is not an unqueried selected product');
        }
        this.inFlightKey = key;
        this.save();
    }

    record(candidate: TtangTimeCandidate, attempt: EnrichAttempt, checkedAt: Date): void {
        const expected = this.selected.get(candidate.key)?.product;
        const product = candidate.product;
        const checkedMs = checkedAt.getTime();
        if (this.status !== 'running' || this.outcomes.has(candidate.key)
            || this.inFlightKey !== candidate.key || !expected || !product
            || JSON.stringify(expected) !== JSON.stringify(product)
            || candidate.key !== `product|${product.masterId}|${product.fareId}|${product.departureDate}`
            || !Number.isFinite(checkedMs) || checkedMs < this.startedAt.getTime() || checkedMs > Date.now()) {
            throw new Error('Checkpoint rejected duplicate, stale or mismatched product evidence');
        }
        if (attempt.status === 'success') {
            const d = attempt.data;
            if (!d || ![d.depTime, d.arrTime, d.retDepTime, d.retArrTime].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
                throw new Error('Checkpoint success requires four valid detail times');
            }
        }
        if (attempt.status === 'success' && attempt.data && candidate.product) {
            const p = candidate.product;
            const d = attempt.data;
            this.successes.push({
                key: candidate.key,
                identity: { masterId: p.masterId, fareId: p.fareId, departureDate: p.departureDate },
                route: { depCode: p.depCode, arrCode: p.arrCode, arrivalDate: p.arrivalDate, carrierCode: p.carrierCode, fareType: p.fareType },
                runId: this.runId,
                adapterVersion: this.adapterVersion,
                detailCheckedAt: checkedAt.toISOString(),
                detail: { depTime: d.depTime, arrTime: d.arrTime, retDepTime: d.retDepTime, retArrTime: d.retArrTime, seats: d.seats > 0 ? d.seats : 0 },
                seatAction: d.seats > 0 ? 'set' : 'clear',
            });
        }
        this.outcomes.set(candidate.key, { key: candidate.key, status: attempt.status, checkedAt: checkedAt.toISOString() });
        this.lastCompletedKey = candidate.key;
        this.inFlightKey = null;
        this.save();
    }

    complete(): void {
        if (!this.begun || this.status !== 'running' || this.inFlightKey || this.outcomes.size !== this.selected.size) {
            throw new Error('Cannot complete an unfinished detail checkpoint');
        }
        this.status = 'completed';
        this.save();
    }

    abort(error: unknown): void {
        this.status = 'aborted';
        // Do not persist page bodies, URLs, cookies or arbitrary upstream exception text.
        this.abortReason = error instanceof SourceResponseError
            ? { kind: error.kind, status: error.status, causeCode: error.causeCode }
            : { kind: 'internal-error' };
        this.save();
    }

    private save(): void {
        const outcomes = Array.from(this.outcomes.values());
        const succeeded = this.successes.length;
        const empty = outcomes.filter(o => o.status === 'empty').length;
        const document = {
            version: 1, runId: this.runId, startedAt: this.startedAt.toISOString(),
            adapterVersion: this.adapterVersion, status: this.status,
            operationalEligible: false, abortReason: this.abortReason,
            counts: { selected: this.selected.size, succeeded, empty, failed: outcomes.length - succeeded - empty,
                unqueried: this.selected.size - outcomes.length, excludedLegacy: this.excludedLegacy, deferred: this.deferred },
            checkpoint: { lastCompletedKey: this.lastCompletedKey, inFlightKey: this.inFlightKey },
            outcomes, successes: this.successes,
        };
        // Keep failed snapshots for diagnosis without blocking the next abort save.
        const temporary = `${this.filePath}.${randomUUID()}.tmp`;
        const fd = fs.openSync(temporary, 'wx');
        try {
            fs.writeFileSync(fd, JSON.stringify(document, null, 2), 'utf8');
            fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        // Windows readers/sync clients can temporarily deny delete-sharing. Retry
        // ONLY the local atomic replacement, never the upstream detail request.
        const delays = [50, 100, 200, 400, 800, 1000];
        const wait = new Int32Array(new SharedArrayBuffer(4));
        for (let attempt = 0; ; attempt++) {
            try {
                fs.renameSync(temporary, this.filePath);
                break;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code || '')
                    || attempt >= delays.length) throw error;
                Atomics.wait(wait, 0, 0, delays[attempt]);
            }
        }
    }
}
