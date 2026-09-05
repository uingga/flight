import assert from 'node:assert/strict';
import {
    buildSourceSlotBars,
    isSourceScheduledAt,
    pickFinalEvent,
    recentSlotTimes,
    type SourceSlotEvent,
} from '../src/lib/admin-source-slots';

const kst = (text: string) => Date.parse(`${text}+09:00`);
const event = (timestamp: string, patch: Partial<SourceSlotEvent> = {}): SourceSlotEvent => ({
    timestamp: new Date(kst(timestamp)).toISOString(),
    value: 300,
    preserved: false,
    skipped: false,
    manual: false,
    localFallback: false,
    ...patch,
});
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });

// 회차 축: 15:00 KST 기준으로 오늘 14:23이 마지막, 4일 전 14:23이 첫 칸 (16개 = 4일)
{
    const slots = recentSlotTimes(kst('2026-09-05T15:00:00'));
    assert.equal(slots.length, 16);
    assert.equal(new Date(slots[15]).toISOString(), new Date(kst('2026-09-05T14:23:00')).toISOString());
    assert.equal(new Date(slots[0]).toISOString(), new Date(kst('2026-09-01T17:31:00')).toISOString());
    // 자정 직후: 어제 17:31이 마지막
    const late = recentSlotTimes(kst('2026-09-06T00:10:00'));
    assert.equal(new Date(late[15]).toISOString(), new Date(kst('2026-09-05T17:31:00')).toISOString());
}

// 땡처리는 08:17·14:23만, 마이리얼트립은 축 밖
{
    assert.equal(isSourceScheduledAt('ttang', kst('2026-09-05T08:17:00')), true);
    assert.equal(isSourceScheduledAt('ttang', kst('2026-09-05T11:12:00')), false);
    assert.equal(isSourceScheduledAt('ttang', kst('2026-09-05T14:23:00')), true);
    assert.equal(isSourceScheduledAt('ttang', kst('2026-09-05T17:31:00')), false);
    assert.equal(isSourceScheduledAt('ybtour', kst('2026-09-05T17:31:00')), true);
    assert.equal(isSourceScheduledAt('myrealtrip', kst('2026-09-05T08:17:00')), false);
}

// 최종 결과 합치기: 자동 실패 → PC 성공 = PC, 건너뜀만 있으면 건너뜀
{
    const failed = event('2026-09-03T08:36:00', { preserved: true, value: 1261 });
    const pc = event('2026-09-03T08:41:00', { localFallback: true, value: 1295 });
    assert.equal(pickFinalEvent([failed, pc]), pc);
    const skip = event('2026-09-03T14:42:00', { skipped: true, skipReason: 'circuit' });
    assert.equal(pickFinalEvent([skip]), skip);
    assert.equal(pickFinalEvent([skip, pc]), pc);
    assert.equal(pickFinalEvent([]), null);
}

// 실제 09-03 땡처리 흐름을 그대로 넣어본다
{
    const now = kst('2026-09-04T12:00:00'); // 11:12 회차 진행 중
    const events = [
        event('2026-09-03T08:36:00', { preserved: true, value: 1261 }),
        event('2026-09-03T08:41:00', { localFallback: true, value: 1295 }),
        event('2026-09-03T11:33:00', { skipped: true, skipReason: 'schedule', value: 0 }),
        event('2026-09-03T14:42:00', { skipped: true, preserved: true, skipReason: 'circuit', value: 0 }),
        event('2026-09-03T14:48:00', { localFallback: true, value: 1282 }),
        event('2026-09-03T17:49:00', { skipped: true, skipReason: 'schedule', value: 0 }),
        event('2026-09-04T08:35:00', { skipped: true, preserved: true, skipReason: 'circuit', value: 0 }),
    ];
    const bars = buildSourceSlotBars({ source: 'ttang', events, now });
    assert.equal(bars.length, 16);
    const byKst = Object.fromEntries(bars.map(bar => [fmt(bar.slotAt), bar]));
    const at = (text: string) => byKst[fmt(new Date(kst(text)).toISOString())];

    assert.equal(at('2026-09-03T08:17:00').status, 'pc');
    assert.equal(at('2026-09-03T08:17:00').value, 1295);
    assert.equal(at('2026-09-03T08:17:00').events.length, 2, '자동 실패 + PC 성공이 한 칸에 모인다');
    assert.equal(at('2026-09-03T11:12:00').status, 'unscheduled');
    assert.equal(at('2026-09-03T14:23:00').status, 'pc');
    assert.equal(at('2026-09-03T14:23:00').value, 1282);
    assert.equal(at('2026-09-03T17:31:00').status, 'unscheduled');
    assert.equal(at('2026-09-04T08:17:00').status, 'skipped');
    assert.equal(at('2026-09-04T08:17:00').final?.skipReason, 'circuit');
    // 최근 회차 11:12는 땡처리 예정 없음 → 대기 아님
    const latest = bars[bars.length - 1];
    assert.equal(latest.isLatest, true);
    assert.equal(fmt(latest.slotAt), fmt(new Date(kst('2026-09-04T11:12:00')).toISOString()));
    assert.equal(latest.status, 'unscheduled');
    // 09-02 이전 칸은 기록 없음
    assert.equal(at('2026-09-02T14:23:00').status, 'missing');
}

// 일반 여행사: 진행 중 회차는 'pending', 전체 수집이 끝났는데 기록 없으면 'missing'
{
    const now = kst('2026-09-04T11:20:00');
    const events = [event('2026-09-04T08:35:00', { value: 313 })];
    const pending = buildSourceSlotBars({ source: 'ybtour', events, now });
    assert.equal(pending[pending.length - 1].status, 'pending');
    assert.equal(pending[pending.length - 2].status, 'auto');
    assert.equal(pending[pending.length - 2].value, 313);

    const done = buildSourceSlotBars({ source: 'ybtour', events, now, completedThrough: kst('2026-09-04T11:18:00') });
    assert.equal(done[done.length - 1].status, 'missing');
}

// 수동 캡처는 회차 밖 시각이어도 가장 가까운 이전 회차 칸에 막대로 들어간다
{
    const now = kst('2026-09-01T18:30:00');
    const events = [
        event('2026-09-01T12:29:00', { value: 700 }),
        event('2026-09-01T13:31:00', { manual: true, value: 42 }),
        event('2026-09-01T15:52:00', { preserved: true, value: 0 }),
        event('2026-09-01T16:47:00', { manual: true, value: 55 }),
        event('2026-09-01T17:49:00', { preserved: true, value: 0 }),
    ];
    const bars = buildSourceSlotBars({ source: 'modetour', events, now });
    const last = bars.slice(-3);
    assert.deepEqual(last.map(bar => bar.status), ['manual', 'manual', 'failed']);
    assert.deepEqual(last.map(bar => bar.value), [42, 55, 0]);
    assert.equal(last[0].events.length, 2, '11:12 칸에 자동 성공 + 수동 캡처가 모인다');
}

// 명시적인 테스트 픽스처: 실행 상태, 경계 시각, 미래 기록 제외
{
    const now = kst('2026-09-05T14:24:00');
    const currentRun = { startedAt: '2026-09-05T14:23:30+09:00', status: 'in_progress', stage: 'crawling' as const, plannedSources: ['ybtour'], skippedSources: [] };
    const latest = (source: string, run = currentRun) => buildSourceSlotBars({ source, events: [], now, currentRun: run }).at(-1)!;
    assert.equal(latest('ybtour').status, 'running');
    for (const stage of ['queued', 'preparing', 'crawling', 'publishing'] as const) {
        const bar = buildSourceSlotBars({ source: 'ybtour', events: [], now, currentRun: { ...currentRun, stage, status: stage === 'queued' ? 'queued' : 'in_progress' } }).at(-1)!;
        assert.equal(bar.status, stage === 'queued' ? 'pending' : 'running');
        assert.equal(bar.runStage, stage === 'queued' ? undefined : stage);
    }
    assert.equal(buildSourceSlotBars({ source: 'ybtour', events: [], now, currentRun: { ...currentRun, status: 'completed' } }).at(-1)?.status, 'pending');
    assert.equal(latest('hanatour').status, 'pending');
    assert.equal(latest('ybtour', { ...currentRun, skippedSources: ['ybtour'] }).status, 'pending');
    assert.equal(latest('myrealtrip').status, 'unscheduled');
    const before = recentSlotTimes(kst('2026-09-05T14:22:59'));
    const after = recentSlotTimes(kst('2026-09-05T14:23:00'));
    assert.equal(before.at(-1), kst('2026-09-05T11:12:00'));
    assert.equal(after.at(-1), kst('2026-09-05T14:23:00'));
    const future = buildSourceSlotBars({ source: 'ybtour', now, events: [event('2026-09-05T17:32:00')] });
    assert.equal(future.at(-1)?.value, null);
    assert.equal(future.at(-1)?.status, 'pending');
    const invalid = buildSourceSlotBars({ source: 'ybtour', now, events: [{ ...event('2026-09-05T14:23:00'), timestamp: 'invalid' }] });
    assert.equal(invalid.at(-1)?.value, null);
}

console.log('admin-source-slots: all assertions passed');
