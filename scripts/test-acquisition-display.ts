import assert from 'node:assert/strict';
import { acquisitionRows } from '../src/lib/acquisition-display';
import type { AcquisitionData } from '../src/lib/acquisition';
const data: AcquisitionData = { available: true, groups: [
    { label: '검색', sessions: 12, users: 7, sources: [{ source: 'google', label: '구글', sessions: 12, users: 7 }] },
    { label: '기타 외부 링크', sessions: 4, users: 3, sources: [{ source: 'google', label: '구글', sessions: 4, users: 3 }] },
] };
assert.deepEqual(acquisitionRows(data), [{ source: 'google', label: '구글', sessions: 16, users: null }]);
data.sourceRows = [{ source: 'google', label: '구글', sessions: 16, users: 8, categories: ['검색', '기타 외부 링크'] }];
assert.equal(acquisitionRows(data)[0].users, 8);
assert.equal(acquisitionRows(data, '검색')[0].sessions, 12);
assert.equal(acquisitionRows(data, '검색')[0].users, 7);
assert.deepEqual(acquisitionRows(data, '없는 유형'), []);
assert.deepEqual(acquisitionRows(undefined), []);
assert.deepEqual(acquisitionRows({ ...data, available: false }), []);
const many = { ...data, sourceRows: Array.from({ length: 37 }, (_, i) => ({ source: `s${i}`, label: `사이트 ${i}`, sessions: i, users: i === 0 ? 0 : null, categories: ['검색'] })) };
const sorted = acquisitionRows(many);
assert.equal(sorted[0].sessions, 36);
assert.equal(sorted.at(-1)?.users, 0);
assert.equal(sorted.slice(0, 5).length, 5);
assert.equal(sorted.slice(30, 40).length, 7);
console.log('PASS: source totals, category-specific counts, null/zero users, 37-source sorting and pagination.');
