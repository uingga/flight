import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mrtRoundForGeneralSlot, evaluateMrtRoundReadiness} from '../src/lib/mrt-round-readiness.mjs';

const generalSlot = '2026-09-16T07:31:00.000Z';
test('five KST rounds assign the expected host and earlier start', () => {
    for (const [general, start, host] of [
        ['2026-09-15T21:17:00.000Z','2026-09-15T20:00:00.000Z','github'],
        ['2026-09-16T01:12:00.000Z','2026-09-15T23:55:00.000Z','C'],
        ['2026-09-16T04:23:00.000Z','2026-09-16T03:05:00.000Z','github'],
        [generalSlot,'2026-09-16T06:15:00.000Z','C'],
        ['2026-09-16T10:31:00.000Z','2026-09-16T10:15:00.000Z','B'],
    ]) assert.deepEqual(mrtRoundForGeneralSlot(general), {generalSlot:general, expectedAt:start, host});
});
test('invalid and non-slot timestamps are refused', () => {
    for (const value of ['invalid','2026-09-16T07:32:00.000Z','2026-09-16T07:31:01.000Z',null]) {
        assert.throws(()=>mrtRoundForGeneralSlot(value));
    }
});
const record = {generalSlot, expectedAt:'2026-09-16T06:15:00.000Z',host:'C',status:'published',
    completedAt:'2026-09-16T07:28:00.000Z',publishedAt:'2026-09-16T07:30:00.000Z',resultVersion:'fixture-version'};
const now = Date.parse('2026-09-16T07:35:00Z');
const check = (changes={}, extra={}) => evaluateMrtRoundReadiness({generalSlot,record:{...record,...changes},
    observedVersion:'fixture-version',now,...extra});
test('only exact round, host and observed published version are ready', () => {
    assert.equal(check().ready,true);
    for (const changes of [{host:'github'},{generalSlot:'2026-09-16T01:12:00.000Z'},
        {expectedAt:'2026-09-16T01:12:00.000Z'},{resultVersion:''},{publishedAt:null},
        {completedAt:'2026-09-16T07:31:00.000Z'},{publishedAt:'2026-09-16T08:00:00.000Z'}]) {
        assert.equal(check(changes).ready,false);
    }
    assert.equal(check({}, {observedVersion:'other'}).ready,false);
});
test('running, absent, failed, blocked and unknown never count as fresh', () => {
    for (const status of ['running','failed','blocked','unknown','skipped']) assert.equal(check({status}).ready,false);
    assert.equal(check({}, {record:null}).ready,false);
    assert.equal(check({}, {sharedBlocked:true}).ready,false);
    assert.equal(check({}, {transportHealthy:false}).ready,false);
});
test('gate never mutates existing Naver budget or state', () => {
    const value = structuredClone(record);
    const before = JSON.stringify(value);
    evaluateMrtRoundReadiness({generalSlot,record:value,now,observedVersion:'fixture-version'});
    assert.equal(JSON.stringify(value),before);
    assert.deepEqual(Object.keys(check()).sort(),['ready','reason']);
});
