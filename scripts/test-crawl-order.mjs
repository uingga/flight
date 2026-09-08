import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlOrder, crawlWaitMs, finiteListBudget } from '../src/lib/crawl-order.mjs';

test('seeded order is complete, unique, reproducible, and does not mutate its input', () => {
    const original = Array.from({length: 31}, (_, i) => 'date-' + i), before = [...original];
    const first = crawlOrder(original, 'round-a');
    assert.deepEqual([...first].sort(), [...original].sort());
    assert.deepEqual(original, before);
    assert.deepEqual(crawlOrder(original, 'round-a'), first);
    assert.notDeepEqual(crawlOrder(original, 'round-b'), first);
    const completed = new Set(first.slice(0, 9));
    assert.deepEqual(crawlOrder(original, 'round-a').filter(k => !completed.has(k)), first.slice(9));
    assert.deepEqual(crawlOrder(original), original);
    assert.throws(() => crawlOrder(original, '../unsafe'));
});
test('online jitter is 5–8 seconds, never shortens a longer retry', () => {
    assert.equal(crawlWaitMs(5000, () => 0), 5000);
    assert.equal(crawlWaitMs(5000, () => 0.999999), 8000);
    assert.equal(crawlWaitMs(10000, () => 0.999999), 13000);
    assert.throws(() => crawlWaitMs(5000, () => 1));
});
test('budgets cover all targets; retries counted, safety ceiling cannot silently truncate', () => {
    assert.equal(finiteListBudget(15, 1, 15), 15);
    for (let days = 29; days <= 32; days++) assert.equal(finiteListBudget(days, 2, 64), days * 2);
    assert.throws(() => finiteListBudget(33, 2, 64));
    assert.throws(() => finiteListBudget(0));
});
