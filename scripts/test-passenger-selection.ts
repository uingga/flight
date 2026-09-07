import assert from 'node:assert/strict';
import { parsePassengerSelection } from '../src/lib/hooks/use-passenger-selection';

const defaults = { adult: 1, child: 0, infant: 0 };
for (const raw of [null, 'broken', 'null', '{}', '{"adult":"2","child":0,"infant":0}']) {
    assert.deepEqual(parsePassengerSelection(raw), defaults);
}
assert.deepEqual(parsePassengerSelection(JSON.stringify({ adult: 2, child: 1, infant: 1 })), { adult: 2, child: 1, infant: 1 });
assert.deepEqual(parsePassengerSelection(JSON.stringify({ adult: 0, child: -1, infant: 8 })), { adult: 1, child: 0, infant: 1 });
assert.deepEqual(parsePassengerSelection(JSON.stringify({ adult: 20, child: 20, infant: 20 })), { adult: 9, child: 9, infant: 4 });
console.log('Passenger selection parsing/defaults/bounds passed');
