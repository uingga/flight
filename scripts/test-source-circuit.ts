import assert from 'node:assert/strict';
import {
    assertNoSourceAccessBlockText,
    SourceResponseError,
} from '../src/lib/scrapers/source-response';
import {
    classifySourceAccessRestriction,
    classifySourceResponseDrop,
    isLocalSourceFallbackCoolingDown,
    isSourceCircuitOpen,
    openSourceCircuit,
    pruneResolvedSourceCircuits,
    recordLocalSourceFallback,
} from '../src/lib/source-circuit';

const now = new Date('2026-08-29T00:00:00.000Z');

const blocked = classifySourceAccessRestriction(
    new SourceResponseError('http-status', '땡처리닷컴 HTTP 403', 403),
);
assert.equal(blocked?.reason, 'blocked');
assert.equal(
    classifySourceAccessRestriction(new Error('모두투어 지역 수집 실패 (HTTP 403)'))?.reason,
    'blocked',
);

let captchaError: unknown;
try {
    assertNoSourceAccessBlockText('테스트 여행사', '<html>Unusual traffic. CAPTCHA required.</html>');
} catch (error) {
    captchaError = error;
}
assert.equal(classifySourceAccessRestriction(captchaError)?.reason, 'blocked');

const rateLimited = classifySourceAccessRestriction(
    new SourceResponseError('http-status', '온라인투어 HTTP 429', 429),
);
assert.equal(rateLimited?.reason, 'rate_limited');

assert.equal(classifySourceAccessRestriction(new Error('ECONNRESET')), null);
assert.equal(classifySourceAccessRestriction(new Error('응답 스키마 변경')), null);

assert.equal(classifySourceResponseDrop(0, 120)?.reason, 'blocked');
assert.equal(classifySourceResponseDrop(59, 100)?.reason, 'blocked');
assert.equal(classifySourceResponseDrop(60, 100), null);
assert.equal(classifySourceResponseDrop(5, 20), null);

const circuit = openSourceCircuit(blocked!, 'ttang-1', now);
assert.equal(circuit.resumePolicy, 'cooldown_or_adapter_change');
assert.equal(circuit.adapterVersion, 'ttang-1');
assert.equal(circuit.nextProbeAt, '2026-08-30T00:00:00.000Z');
assert.equal(isSourceCircuitOpen(circuit, 'ttang-1', now), true);
assert.equal(isSourceCircuitOpen(circuit, 'ttang-1', new Date('2026-08-29T23:59:59.999Z')), true);
assert.equal(isSourceCircuitOpen(circuit, 'ttang-1', new Date('2026-08-30T00:00:00.000Z')), false);
assert.equal(isSourceCircuitOpen(circuit, 'ttang-2', now), false);

const localBlocked = recordLocalSourceFallback(circuit, 'blocked', 'CAPTCHA', now);
assert.equal(localBlocked.nextProbeAt, circuit.nextProbeAt);
assert.equal(localBlocked.localFallback?.status, 'blocked');
assert.equal(localBlocked.localFallback?.nextProbeAt, '2026-08-30T00:00:00.000Z');
assert.equal(isLocalSourceFallbackCoolingDown(localBlocked, now), true);
assert.equal(
    isLocalSourceFallbackCoolingDown(localBlocked, new Date('2026-08-30T00:00:00.000Z')),
    false,
);
const localSuccess = recordLocalSourceFallback(localBlocked, 'success', '120건 완료', now);
assert.equal(localSuccess.localFallback?.status, 'success');
assert.equal(localSuccess.localFallback?.nextProbeAt, undefined);

assert.deepEqual(
    pruneResolvedSourceCircuits({ ttang: circuit }, { ttang: 'ttang-1' }, now),
    { ttang: circuit },
);
assert.deepEqual(
    pruneResolvedSourceCircuits({ ttang: circuit }, { ttang: 'ttang-2' }, now),
    {},
);
assert.deepEqual(
    pruneResolvedSourceCircuits(
        { ttang: circuit },
        { ttang: 'ttang-1' },
        new Date('2026-08-30T00:00:00.000Z'),
    ),
    {},
);

console.log('여행사 접근 제한 회로 테스트 통과');
