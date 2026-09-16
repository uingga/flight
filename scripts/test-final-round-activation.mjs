import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roundBridgeEnabled} from './run-naver-round-bridge.mjs';
test('Naver keeps earlier phases unchanged and activates at Sep16 final slot',()=>{
 assert.equal(roundBridgeEnabled(Date.parse('2026-09-16T07:30:59Z')),false);
 assert.equal(roundBridgeEnabled(Date.parse('2026-09-16T07:31:00Z')),true);
 assert.equal(roundBridgeEnabled(Date.parse('2026-09-16T21:17:00Z')),true);
});
