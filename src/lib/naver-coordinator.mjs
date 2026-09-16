// Offline-first coordinator core. No listener, credentials, or crawler is started here.
import { DatabaseSync } from 'node:sqlite';
import { timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {latestAgencyRound} from './naver-round-handoff.mjs';

export const CONTRACT = 'naver-ac-v1';
export const kstDay = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const nonempty = x => typeof x === 'string' && x.length > 0 && x.length <= 512;

export class Coordinator {
    constructor(path, clock = Date.now, requiredAttestation = null, { initialize = false, writerFencing = false } = {}) {
        this.clock = clock;
        this.requiredAttestation = requiredAttestation;
        this.writerFencing = writerFencing;
        if (requiredAttestation && !existsSync(path) && !initialize) throw Error('missing coordinator DB; explicit initialization required');
        this.db = new DatabaseSync(path);
        if(!writerFencing&&this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='publication'").get()){this.db.close();throw Error('legacy opener refused for fenced DB');}
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY, value TEXT NOT NULL)');
        this.activationDay=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activation'").get()
            ?this.db.prepare('SELECT day FROM activation WHERE id=1').get()?.day:null;
        this.readOnlyView = this.snapshot();
        if(writerFencing)this.db.exec("CREATE TABLE IF NOT EXISTS publication(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); INSERT OR IGNORE INTO publication VALUES(1,'{\"epoch\":0,\"writer\":null,\"requests\":{}}')");
        if(writerFencing){this.db.exec('BEGIN IMMEDIATE');try{const f=JSON.parse(this.db.prepare('SELECT value FROM publication WHERE id=1').get().value);f.epoch++;this.db.prepare('UPDATE publication SET value=? WHERE id=1').run(JSON.stringify(f));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
    }
    close() { this.db.close(); }
    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const day = kstDay(this.clock());
            const rows = this.db.prepare('SELECT day,value FROM days').all();
            for (const row of rows) {
                const previous = JSON.parse(row.value);
                if (row.day < day && (previous.owner || Object.values(previous.attempts).some(a => a.status === 'pending'))) {
                    throw Error('unresolved previous day; explicit reconciliation required');
                }
            }
            const row = rows.find(r => r.day === day);
            const s = row ? JSON.parse(row.value) : { day, owner: null, phase: 'new', used: { A: 0, C: 0 },
                runs: {}, attempts: {}, keys: {}, candidates: {}, generation: 0, blocked: false, handoffs: 0 };
            const fence=this.writerFencing?JSON.parse(this.db.prepare('SELECT value FROM publication WHERE id=1').get().value):null;
            const result = fn(s,fence);
            if(fence)this.db.prepare('UPDATE publication SET value=? WHERE id=1').run(JSON.stringify(fence));
            this.db.prepare('INSERT INTO days(day,value) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET value=excluded.value').run(day, JSON.stringify(s));
            this.db.exec('COMMIT');
            this.readOnlyView = structuredClone(s);
            return result;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    validate(input) {
        if(this.activationDay)requireValue(kstDay(this.clock())>=this.activationDay,'activation day not reached; legacy budget preserved');
        requireValue(input.contract === CONTRACT, 'contract mismatch; legacy runner refused');
        requireValue(['A', 'C'].includes(input.worker) && nonempty(input.run), 'invalid worker/run');
    }
    owner(s, input, phase = 'running') {
        this.validate(input);
        requireValue(!input.day || input.day === s.day, 'lease day mismatch');
        if (this.requiredAttestation) requireValue(input.attestation === this.requiredAttestation, 'unattested runner');
        requireValue(!s.blocked, 'blocked day');
        requireValue(s.owner === input.worker && s.runs[input.worker] === input.run, 'owner mismatch');
        if(s.round)requireValue(input.round===s.round,'round ownership mismatch');
        requireValue(s.phase === phase, 'phase mismatch');
    }
    checkObservation(s,f,input) {
        if(!f||input.worker!=='C')return;
        requireValue(!f.writer&&input.expectedFence===f.epoch&&input.observedDay===s.day
            &&nonempty(input.expectedVersion)&&input.expectedVersion===s.verifiedVersion,'stale C observation');
    }
    observe(input) {
        this.validate(input);
        if(this.requiredAttestation)requireValue(input.attestation===this.requiredAttestation,'unattested runner');
        return this.transaction((s,f)=>{
            requireValue(input.worker==='C'&&!s.blocked,'C observation refused');
            if(s.phase==='running')this.owner(s,input);
            else requireValue(s.phase==='ready-C'&&s.owner===null,'C phase not ready');
            if(!f)return {};
            requireValue(!f.writer&&nonempty(s.verifiedVersion),'C publication not ready');
            return {expectedFence:f.epoch,expectedVersion:s.verifiedVersion,observedDay:s.day};
        });
    }
    confirmObservation(input) {return this.transaction((s,f)=>{this.owner(s,input);this.checkObservation(s,f,input);});}
    validRound(round,day) {
        const time=Date.parse(round);
        requireValue(Number.isFinite(time)&&kstDay(time)===day&&time<=this.clock()&&latestAgencyRound(time)===round,'invalid agency round');
    }
    begin(input) {
        this.validate(input);
        if (input.attestation) requireValue(Boolean(this.requiredAttestation), 'coordinator attestation not configured');
        if (this.requiredAttestation) requireValue(input.attestation === this.requiredAttestation, 'unattested runner');
        return this.transaction((s,fence) => {
            if(fence)requireValue(!fence.writer,'writer owns publication fence');
            this.checkObservation(s,fence,input);
            requireValue(!s.blocked, 'blocked day');
            requireValue(s.owner === null, 'owner/run already acquired');
            if(input.round)this.validRound(input.round,s.day);
            const nextRound=input.worker==='A'&&s.phase==='done'&&input.round&&s.round&&Date.parse(input.round)>Date.parse(s.round);
            const nextC=input.worker==='C'&&s.phase==='ready-C'&&input.round===s.round&&s.round&&s.handoffRound!==s.round;
            requireValue(!s.runs[input.worker]||((nextRound||nextC)&&s.runs[input.worker]===input.run),'owner/run already acquired');
            requireValue(input.worker === 'A' ? s.phase === 'new'||nextRound : s.phase === 'ready-C', 'phase not ready');
            if(nextRound)requireValue(s.used.A+s.used.C<400&&!Object.values(s.attempts).some(a=>a.status==='pending'),'round budget exhausted or pending');
            if(input.worker==='A'&&input.round)s.round=input.round;
            if (input.worker === 'C') { requireValue(s.round ? input.round===s.round&&s.handoffRound!==s.round : s.handoffs === 0, 'duplicate handoff'); s.handoffs++;s.handoffRound=s.round||null; }
            s.owner = input.worker; s.runs[input.worker] = input.run; s.phase = 'running';
            return { day: s.day, worker: input.worker, run: input.run, contract: CONTRACT };
        });
    }
    reserve(input) {
        return this.transaction((s,fence) => {
            this.owner(s, input);
            if(fence)requireValue(!fence.writer,'writer owns publication fence');
            this.checkObservation(s,fence,input);
            requireValue(nonempty(input.requestId) && nonempty(input.key), 'invalid attempt');
            requireValue(['search', 'probe'].includes(input.kind), 'invalid kind');
            requireValue(!s.attempts[input.requestId] && !s.keys[input.key], 'duplicate attempt/key');
            requireValue(s.used[input.worker] < 200 && s.used.A + s.used.C < 400, 'budget exhausted');
            const permit = { ...input, ...(fence?{fence:fence.epoch}:{}), day: s.day, status: 'pending', reservedAt: this.clock() };
            s.used[input.worker]++;
            s.attempts[input.requestId] = permit;
            s.keys[input.key] = input.requestId;
            return { ...permit };
        });
    }
    finish(input) {
        return this.transaction((s,fence) => {
            this.owner(s, input);
            requireValue(input.day === s.day, 'day mismatch');
            const a = s.attempts[input.requestId];
            if(fence)requireValue(input.fence===fence.epoch&&a?.fence===input.fence&&!fence.writer,'stale navigation fence');
            requireValue(a && a.status === 'pending' && a.key === input.key && a.worker === input.worker && a.run === input.run, 'attempt mismatch');
            requireValue(['success', 'miss', 'blocked', 'unknown'].includes(input.outcome), 'invalid outcome');
            a.status = input.outcome; a.finishedAt = this.clock();
            if (['blocked', 'unknown'].includes(input.outcome)) { s.blocked = true; s.phase = 'blocked'; }
        });
    }
    complete(input) {
        return this.transaction(s => {
            this.owner(s, input);
            requireValue(!Object.values(s.attempts).some(a => a.status === 'pending'), 'pending attempt');
            requireValue(nonempty(input.version), 'missing result version');
            s.version = input.version; s.phase = 'awaiting-readback';
        });
    }
    verifyAndRelease(input) {
        return this.transaction((s,fence) => {
            this.owner(s, input, 'awaiting-readback');
            if(fence){this.checkWriter(fence,input);requireValue(fence.writer.writer==='naver'&&fence.writer.run===input.run&&fence.writer.observed===input.observed,'unverified publication fence');fence.writer=null;}
            requireValue(nonempty(input.observed) && input.expected === s.version && input.observed === s.version, 'readback mismatch');
            s.verifiedVersion = s.version; s.owner = null;
            if (input.worker === 'A' && input.defer === true) {
                s.owner = 'A'; s.phase = 'paused-A';
            } else s.phase = input.worker === 'A' ? 'ready-C' : 'done';
        });
    }
    resume(input) {
        return this.transaction(s => {
            this.owner(s, {...input,round:s.round}, 'paused-A');
            requireValue(input.worker === 'A', 'only A can resume phases');
            if(s.round)requireValue(nonempty(input.round),'resumed round required');
            if(input.round){this.validRound(input.round,s.day);requireValue(!s.round||Date.parse(input.round)>Date.parse(s.round),'duplicate resumed round');s.round=input.round;}
            if (this.requiredAttestation) requireValue(input.attestation === this.requiredAttestation, 'unattested runner');
            s.phase = 'running';
            return { day: s.day, worker: input.worker, run: input.run, contract: CONTRACT };
        });
    }
    updateCandidates({ generation, candidates, snapshotSignature }) {
        return this.transaction(s => {
            requireValue(Number.isSafeInteger(generation) && generation > s.generation, 'generation out of order');
            requireValue(!Object.values(s.attempts).some(a => a.status === 'pending'), 'pending attempt; not a work boundary');
            requireValue(Array.isArray(candidates) && candidates.every(c => nonempty(c.key)), 'invalid candidates');
            const incoming = new Set(candidates.map(c => c.key));
            for (const row of Object.values(s.candidates)) if (!s.keys[row.key]) row.active = incoming.has(row.key);
            for (const row of candidates) {
                if (s.keys[row.key]) continue;
                const firstQueuedAt = s.candidates[row.key]?.firstQueuedAt ?? row.firstQueuedAt ?? this.clock();
                s.candidates[row.key] = { ...row, firstQueuedAt, active: true };
            }
            s.generation = generation;
            s.snapshotSignature = snapshotSignature || null;
        });
    }
    snapshot() {
        const row = this.db.prepare('SELECT value FROM days WHERE day=?').get(kstDay(this.clock()));
        return row ? JSON.parse(row.value) : null;
    }
    readonlySnapshot() { return structuredClone(this.readOnlyView); }
    checkWriter(fence,input){
        requireValue(fence?.writer&&input.fence===fence.epoch&&input.claim===fence.writer.claim,'stale writer fence');
        requireValue(input.writer===fence.writer.writer,'writer identity mismatch');
        requireValue(this.clock()<=fence.writer.deadline,'expired writer remains locked; reconciliation required');
    }
    writerAcquire(input){return this.transaction((s,f)=>{
        requireValue(f&&!f.writer&&!Object.values(s.attempts).some(a=>a.status==='pending'),'publication busy or legacy mode');
        requireValue(nonempty(input.claim)&&nonempty(input.writer)&&!f.requests[input.claim],'duplicate writer claim');
        requireValue(Number.isInteger(input.ttlMs)&&input.ttlMs>0&&input.ttlMs<=600000,'invalid writer deadline');
        if(input.writer==='naver')this.owner(s,input,'awaiting-readback');
        f.epoch++;f.requests[input.claim]=f.epoch;
        f.writer={claim:input.claim,writer:input.writer,run:input.run||null,deadline:this.clock()+input.ttlMs,observed:null};
        return {claim:input.claim,fence:f.epoch};
    });}
    writerCheck(input){return this.transaction((_s,f)=>{this.checkWriter(f,input);return {fence:f.epoch};});}
    writerObserved(input){return this.transaction((_s,f)=>{this.checkWriter(f,input);requireValue(nonempty(input.observed),'missing observed result');f.writer.observed=input.observed;});}
    writerRelease(input){return this.transaction((_s,f)=>{this.checkWriter(f,input);requireValue(f.writer.writer!=='naver'&&f.writer.observed===input.observed&&nonempty(input.observed),'unverified writer release');f.writer=null;});}
    startMovement(input){return this.transaction((s,f)=>{
        this.owner(s,input);const a=s.attempts[input.requestId];
        requireValue(f&&!f.writer&&input.fence===f.epoch&&a?.fence===input.fence&&a.status==='pending'&&!a.started,'stale or duplicate movement');
        this.checkObservation(s,f,input);
        if(input.worker==='C')requireValue(input.expectedFence===a.expectedFence&&input.expectedVersion===a.expectedVersion&&input.observedDay===a.observedDay,'movement observation mismatch');
        a.started=true;return {fence:f.epoch};
    });}
    workState(input) {
        return this.transaction(s => {
            this.owner(s, input);
            requireValue(!Object.values(s.attempts).some(a => a.status === 'pending'), 'pending work boundary');
            return structuredClone({ day: s.day, generation: s.generation, snapshotSignature: s.snapshotSignature, keys: s.keys,
                candidates: s.candidates, used: s.used, sourceScope: s.sourceScope });
        });
    }
    setSourceScope(input) {
        return this.transaction(s => {
            this.owner(s, input);
            requireValue(input.worker === 'A' && Array.isArray(input.sources) && input.sources.every(nonempty), 'invalid source scope');
            s.sourceScope = [...new Set(input.sources)];
        });
    }
    retirePreviousDay({ day, expectedDigest, operatorAttestation }) {
        if(this.writerFencing)throw Error('fenced pending work cannot be retired by operator attestation; remain closed');
        requireValue(typeof day === 'string' && day < kstDay(this.clock()), 'only previous days may be retired');
        requireValue(operatorAttestation?.noLiveOwner === true && operatorAttestation?.reviewedPending === true
            && nonempty(operatorAttestation?.reason), 'explicit operator evidence required');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const row = this.db.prepare('SELECT value FROM days WHERE day=?').get(day);
            requireValue(row && createHash('sha256').update(row.value).digest('hex') === expectedDigest, 'stale recovery evidence');
            const s = JSON.parse(row.value);
            requireValue(s.day === day && s.phase !== 'retired-uncertain', 'invalid retirement');
            for (const attempt of Object.values(s.attempts)) {
                if (attempt.status === 'pending') attempt.status = 'unknown';
            }
            s.owner = null; s.phase = 'retired-uncertain'; s.blocked = true;
            s.recovery = { expectedDigest, at: this.clock(), noLiveOwner: true, reviewedPending: true, reason: operatorAttestation.reason };
            this.db.prepare('UPDATE days SET value=? WHERE day=?').run(JSON.stringify(s), day);
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
}

// Boundaries only: caller supplies existing credentials; no issuance or network listener.
export function createHandler(coordinator, secrets, {beforeControl}={}) {
    requireValue(['A', 'C', 'publisher'].every(k => nonempty(secrets[k])), 'auth configuration missing');
    requireValue(new Set(Object.values(secrets)).size === Object.values(secrets).length, 'auth identities must be distinct');
    return async request => {
        const supplied = request.headers.get('authorization') || '';
        const role = ['A', 'C', 'publisher', ...Object.keys(secrets).filter(k=>k.startsWith('writer:')), ...(nonempty(secrets.operator) ? ['operator'] : [])].find(k => {
            const expected = Buffer.from(`Bearer ${secrets[k]}`); const actual = Buffer.from(supplied);
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
        if (!role) return new Response('unauthorized', { status: 401 });
        const pathname = new URL(request.url).pathname;
        if (request.method === 'GET' && pathname === '/authority') {
            try {
                requireValue(typeof beforeControl === 'function', 'authority unavailable');
                const proof = await beforeControl();
                requireValue(proof && typeof proof.repository === 'string' && typeof proof.branch === 'string'
                    && Number.isSafeInteger(proof.appId) && Number.isSafeInteger(proof.rulesetId), 'authority unavailable');
                const {repository,branch,appId,rulesetId}=proof;
                return Response.json({ok:true,service:CONTRACT,authority:{repository,branch,appId,rulesetId}});
            } catch { return new Response('{}', {status:503}); }
        }
        if (request.method === 'GET' && pathname === '/health') return Response.json({ ok: true, service: CONTRACT });
        if (request.method === 'GET' && pathname === '/status') {
            const state = coordinator.readonlySnapshot(); // No SQLite call: even SELECT can update SHM read marks.
            return Response.json({ ok: true, state: state ? { day: state.day, phase: state.phase, owner: state.owner,
                blocked: state.blocked, used: state.used, pending: Object.values(state.attempts).filter(a => a.status === 'pending').length,
                  verifiedVersion: state.verifiedVersion || null, round:state.round||null } : null, snapshotSource: 'last-local-commit-or-startup' });
        }
        if (pathname !== '/control') return new Response('not found', { status: 404 });
        if (request.method !== 'POST') return new Response('method refused', { status: 405 });
        try {
            const raw = await request.text();
            requireValue(raw.length <= 65536, 'request too large');
            const { action, ...input } = JSON.parse(raw);
            const allowed = role === 'operator' ? ['retirePreviousDay'] : role.startsWith('writer:')?['writerAcquire','writerCheck','writerObserved','writerRelease']:role === 'publisher'
                ? ['verifyAndRelease', 'updateCandidates', 'setSourceScope','writerAcquire','writerCheck','writerObserved'] : ['begin', 'resume', 'reserve', 'finish', 'complete', 'workState','startMovement','observe','confirmObservation'];
            requireValue(allowed.includes(action), 'forbidden action');
            if(action==='writerAcquire')requireValue(input.writer===(role==='publisher'?'naver':role.slice(7)),'writer role mismatch');
            if(action.startsWith('writer')||action==='verifyAndRelease')input.writer=role==='publisher'?'naver':role.slice(7);
            if (role === 'A' || role === 'C') requireValue(input.worker === role, 'forbidden worker');
            if(beforeControl)await beforeControl();
            const result = coordinator[action](input);
            return Response.json({ ok: true, result: result ?? null });
        } catch { return new Response('request refused', { status: 409 }); }
    };
}

// All clients must discard a permit after this call. Retrying reserve is denied.
export async function guardedGoto(client, input, page, url, options) {
    const permit = await client.reserve(input); // Throws before goto on any persistence/transport failure.
    requireValue(permit?.day && (!input.day || permit.day === input.day)
        && permit.worker === input.worker && permit.run === input.run && permit.contract === input.contract
        && permit.requestId === input.requestId && permit.key === input.key, 'invalid permit');
    if(permit.fence!==undefined)await client.startMovement(permit);
    try { return { response: await page.goto(url, options), permit }; }
    catch (error) {
        await client.finish({ ...permit, outcome: 'unknown' });
        throw error;
    }
}
