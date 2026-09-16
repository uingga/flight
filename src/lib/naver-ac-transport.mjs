import { guardedGoto } from './naver-coordinator.mjs';

// Injection only. No default fetch, listening socket, credential issuance or retry.
// An ambiguous response must retain the ledger's debit/owner until reconciliation.
export function createClient({ token, transport }) {
    if (typeof token !== 'string' || !token || typeof transport !== 'function') throw Error('transport/auth required');
    const invoke = async (action, input) => {
        const response = await transport(new Request('https://coordinator.invalid/control', {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, action }),
        }));
        if (!response?.ok) throw Error('coordinator request refused');
        const envelope = await response.json();
        if (envelope?.ok !== true || !Object.hasOwn(envelope, 'result')) throw Error('invalid coordinator response');
        return envelope.result;
    };
    return Object.fromEntries(['begin', 'resume', 'reserve', 'finish', 'complete', 'workState', 'updateCandidates', 'setSourceScope', 'verifyAndRelease','writerAcquire','writerCheck','writerObserved','writerRelease','startMovement','observe','confirmObservation']
        .map(action => [action, input => invoke(action, input)]));
}

export async function runCoordinated({ identity, client, publisher, collect, publish, readback }) {
    await client.begin(identity);
    let active = false;
    const navigation = async (attempt, page, url, options, classify) => {
        if (active) throw Error('concurrent navigation refused');
        active = true;
        try {
            const { response, permit } = await guardedGoto(client, { ...attempt, ...identity }, page, url, options);
            let result;
            try { result = await classify(response); }
            catch (error) { await client.finish({ ...permit, outcome: 'unknown' }); throw error; }
            if (!['success', 'miss', 'blocked', 'unknown'].includes(result?.outcome)) {
                await client.finish({ ...permit, outcome: 'unknown' });
                throw Error('unclassified navigation');
            }
            await client.finish({ ...permit, outcome: result.outcome });
            if (['blocked', 'unknown'].includes(result.outcome)) throw Error('unsafe navigation outcome');
            return result.value;
        } finally { active = false; }
    };
    const result = await collect(navigation);
    if (active) throw Error('collection returned with outstanding work');
    if (typeof result?.version !== 'string' || !result.version) throw Error('missing result version');
    await client.complete({ ...identity, version: result.version });
    const published = await publish(result);
    if (published !== result.version) throw Error('publication version mismatch');
    const observed = await readback(result.version);
    if (observed !== result.version) throw Error('readback version mismatch');
    await publisher.verifyAndRelease({ ...identity, expected: result.version, observed });
    return result;
}
