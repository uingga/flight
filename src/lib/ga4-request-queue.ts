/** Per-process FIFO queue. Other server instances retain their own quota share. */
export class Ga4RequestQueue {
    private active = 0;
    private waiting: Array<() => void> = [];
    private pending = new Map<string, Promise<unknown>>();
    constructor(private readonly concurrency = 2) {}

    run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const existing = this.pending.get(key);
        if (existing) return existing as Promise<T>;
        const result = this.execute(task).finally(() => { this.pending.delete(key); });
        this.pending.set(key, result);
        return result;
    }

    private async execute<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
        else this.active += 1;
        try { return await task(); }
        finally {
            const next = this.waiting.shift();
            if (next) next();
            else this.active -= 1;
        }
    }
}
