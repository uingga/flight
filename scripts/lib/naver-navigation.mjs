import { randomUUID } from 'node:crypto';
import { guardedGoto } from '../../src/lib/naver-coordinator.mjs';

// This is the only goto used by both actual general and probe paths.
export async function gotoNaver(page, url, options, session, attempt) {
    if (session) return session.navigate(page, url, options, attempt);
    return page.goto(url, options);
}

export class NavigationSession {
    constructor(client, identity) { this.client = client; this.identity = identity; this.pending = new Map(); this.failed = false; this.busy = false; }
    async navigate(page, url, options, attempt) {
        if (this.failed || this.busy || this.pending.size) throw Error('coordination halted or pending navigation');
        this.busy = true;
        try {
            const { response, permit } = await guardedGoto(this.client,
                { ...attempt, requestId: randomUUID(), ...this.identity }, page, url, options);
            this.pending.set(page, permit);
            return response;
        } catch (error) { this.failed = true; throw error; }
        finally { this.busy = false; }
    }
    async settle(page, state) {
        const permit = this.pending.get(page);
        if (!permit) return;
        const outcome = ['success', 'available'].includes(state) ? 'success'
            : ['miss', 'no_result', 'route_error'].includes(state) ? 'miss'
            : state === 'blocked' ? 'blocked' : 'unknown';
        try {
            await this.client.finish({ ...permit, outcome });
            this.pending.delete(page);
            if (outcome === 'blocked' || outcome === 'unknown') throw Error(`coordination halted: ${outcome}`);
        } catch (error) { this.failed = true; throw error; }
    }
    assertComplete() {
        if (this.failed || this.busy || this.pending.size) throw Error('collection is not safely complete');
    }
}
