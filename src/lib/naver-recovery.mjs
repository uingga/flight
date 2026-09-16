import { DatabaseSync } from 'node:sqlite';

// Inspection only. Never recreates, deletes, repairs or releases an operational DB.
export function inspectRecovery(path) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw Error('database integrity failed');
        const rows = db.prepare('SELECT day,value FROM days').all().map(row => JSON.parse(row.value));
        for (const row of rows) {
            const attempts = Object.values(row.attempts);
            for (const worker of ['A', 'C']) {
                const count = attempts.filter(a => a.worker === worker).length;
                if (row.used[worker] !== count || count > 200) throw Error('ledger budget inconsistent');
            }
            if (Object.keys(row.keys).length !== attempts.length || attempts.some(a => row.keys[a.key] !== a.requestId)) throw Error('ledger keys inconsistent');
        }
        const fenced=!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='publication'").get();
        const publication=fenced?JSON.parse(db.prepare('SELECT value FROM publication WHERE id=1').get().value):null;
        return { integrity: 'ok', rows, publication, requiresReconciliation: !!publication?.writer || rows.some(row => row.owner || row.blocked
            || Object.values(row.attempts).some(a => a.status === 'pending')) };
    } finally { db.close(); }
}

export function assertNoRecoveryRollback(candidate, evidence) {
    if(evidence.publication){
        const a=candidate.publication,b=evidence.publication;
        if(!a||a.epoch<b.epoch||JSON.stringify(a.writer)!==JSON.stringify(b.writer)||Object.entries(b.requests).some(([k,v])=>a.requests[k]!==v))throw Error('backup loses publication fence evidence');
    }
    for (const previous of evidence.rows) {
        const restored = candidate.rows.find(row => row.day === previous.day);
        if (!restored || ['A', 'C'].some(worker => restored.used[worker] < previous.used[worker])) throw Error('backup loses budget evidence');
        for (const [id, attempt] of Object.entries(previous.attempts)) {
            const retained = restored.attempts[id];
            if (!retained || retained.key !== attempt.key || retained.status !== attempt.status) throw Error('backup loses attempt evidence');
        }
    }
    // This check is NOT authorization to restore or run. Unknown later requests
    // still require independent durable evidence and an approved reconciliation.
    return true;
}
