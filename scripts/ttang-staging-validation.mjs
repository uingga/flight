import fs from 'node:fs';
import path from 'node:path';

/** Evidence summary only: this never merges patches or approves operational data. */
export function readTtangPartialSummary(stagingDir, runId, { timedOut = false } = {}) {
    const file = path.join(stagingDir, 'ttang-detail-checkpoint.json');
    const base = { file, operationalEligible: false };
    if (!fs.existsSync(file)) return { ...base, status: 'not_started' };
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        const c = saved.counts;
        if (saved.version !== 1 || saved.runId !== runId || saved.operationalEligible !== false
            || !['running', 'completed', 'aborted'].includes(saved.status)
            || !c || !['selected', 'succeeded', 'empty', 'failed', 'unqueried', 'excludedLegacy', 'deferred']
                .every(key => Number.isSafeInteger(c[key]) && c[key] >= 0)
            || c.selected !== c.succeeded + c.empty + c.failed + c.unqueried
            || saved.successes?.length !== c.succeeded
            || saved.outcomes?.length !== c.selected - c.unqueried
            || new Set(saved.outcomes.map(o => o.key)).size !== saved.outcomes.length
            || saved.outcomes.filter(o => o.status === 'success').length !== c.succeeded
            || saved.outcomes.filter(o => o.status === 'empty').length !== c.empty) {
            throw new Error('Invalid checkpoint summary');
        }
        return {
            ...base, status: saved.status === 'running' ? 'interrupted' : saved.status,
            counts: c, checkpoint: saved.checkpoint,
            runId: saved.runId, startedAt: saved.startedAt, adapterVersion: saved.adapterVersion,
            successes: saved.successes, outcomes: saved.outcomes,
            abortReason: saved.status === 'running'
                ? { kind: timedOut ? 'timeout' : 'process-exit' }
                : saved.abortReason,
        };
    } catch { return { ...base, status: 'invalid' }; }
}

export function countFreshTtangDetails(flights, runStartedAt, { runId, partialDetails, now = Date.now() } = {}) {
    const startedAt = new Date(runStartedAt).getTime();
    const empty = { timeVerified: 0, seatVerified: 0 };
    if (!Number.isFinite(startedAt) || !Number.isFinite(now) || startedAt > now
        || !runId || partialDetails?.runId !== runId
        || Date.parse(partialDetails.startedAt) !== startedAt
        || typeof partialDetails.adapterVersion !== 'string' || !partialDetails.adapterVersion
        || !Array.isArray(partialDetails.successes) || !Array.isArray(partialDetails.outcomes)) return empty;

    // Cache timestamps alone are not evidence: match the actual response patch and outcome.
    const completeFreshFlights = flights.filter(flight => {
        const checkedAt = Date.parse(flight?.detailCheckedAt || '');
        if (flight?.source !== 'ttang' || !Number.isFinite(checkedAt) || checkedAt < startedAt || checkedAt > now) return false;
        const product = flight.ttangProduct;
        const identity = {
            masterId: String(product?.masterId || '').trim(),
            fareId: String(product?.fareId || '').trim(),
            departureDate: String(flight.departure?.date || '').replace(/-/g, ''),
        };
        const route = {
            depCode: flight.departure?.airport, arrCode: flight.arrival?.airport,
            arrivalDate: String(flight.arrival?.date || '').replace(/-/g, ''),
            carrierCode: String(product?.carrierCode || '').trim(), fareType: String(product?.fareType || '').trim(),
        };
        const times = {
            depTime: flight.departure?.time, arrTime: flight.departure?.arrivalTime,
            retDepTime: flight.arrival?.time, retArrTime: flight.arrival?.arrivalTime,
        };
        if (![...Object.values(identity), ...Object.values(route)].every(v => typeof v === 'string' && v)
            || !Object.values(times).every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return false;
        const key = `product|${identity.masterId}|${identity.fareId}|${identity.departureDate}`;
        return partialDetails.successes.some(patch => {
            if (patch?.key !== key || patch.runId !== runId || patch.adapterVersion !== partialDetails.adapterVersion
                || patch.detailCheckedAt !== flight.detailCheckedAt
                || !Object.entries(identity).every(([field, value]) => patch.identity?.[field] === value)
                || !Object.entries(route).every(([field, value]) => patch.route?.[field] === value)
                || !Object.entries(times).every(([field, value]) => patch.detail?.[field] === value)
                || !partialDetails.outcomes.some(o => o?.key === key && o.status === 'success' && o.checkedAt === patch.detailCheckedAt)) return false;
            const seats = patch.detail.seats;
            return Number.isFinite(seats) && (seats > 0
                ? patch.seatAction === 'set' && flight.availableSeats === seats
                    && (flight.seats === undefined || flight.seats === `${seats}석`)
                : seats === 0 && patch.seatAction === 'clear' && flight.availableSeats === undefined && flight.seats === undefined);
        });
    });
    return {
        timeVerified: completeFreshFlights.length,
        seatVerified: completeFreshFlights.filter(flight => flight.availableSeats > 0).length,
    };
}

export function isTtangStagingReady({ sourceAccepted, timeVerified, seatVerified, partialDetails }) {
    // Legacy requests have no complete product patches and their failures are not in failed.
    if (partialDetails && (partialDetails.status !== 'completed' || partialDetails.counts?.failed !== 0
        || partialDetails.counts?.excludedLegacy !== 0)) return false;
    return Boolean(sourceAccepted)
        && Number(timeVerified) > 0
        && Number(seatVerified) > 0;
}
