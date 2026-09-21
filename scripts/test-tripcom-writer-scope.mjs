import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTripcomWriterScope} from '../src/lib/tripcom-writer-scope.mjs';
const before={flights:[{source:'ttang',id:'t',price:100}],count:1,naverState:{used:390}};
const after={...structuredClone(before),flights:[...before.flights,{source:'tripcom',id:'tripcom-x',price:154500,arrival:{city:'칭다오'}}],count:2,sources:{tripcom:1},sourceUpdatedAt:{tripcom:'2026-09-21T10:00:00Z'}};
test('source-scoped update accepted',()=>assert.doesNotThrow(()=>assertTripcomWriterScope(before,after)));
test('Naver usage mutation refused',()=>assert.throws(()=>assertTripcomWriterScope(before,{...after,naverState:{used:0}})));
test('other agency deletion refused',()=>assert.throws(()=>assertTripcomWriterScope(before,{...after,flights:after.flights.slice(1),count:1})));
test('two quotes per city refused',()=>assert.throws(()=>assertTripcomWriterScope(before,{...after,flights:[...after.flights,after.flights[1]],count:3})));
