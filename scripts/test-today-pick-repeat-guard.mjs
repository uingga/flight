import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectRecentPicks,
    findPreviousDayPick,
    recentRepeatDecision,
    repeatDecision,
} from './today-pick-repeat-guard.mjs';

const previousPick = {
    date: '2026-08-27',
    flightId: 'same-flight',
    source: 'ttang',
    arrivalCity: '다카마츠',
    destinationKey: 'TAK',
    effectivePrice: 177_900,
};

const flight = (id, airport, city = '다카마츠') => ({
    id,
    arrival: { airport, city },
});

test('same flight is excluded when its effective price did not drop', () => {
    const decision = repeatDecision(flight('same-flight', 'TAK'), 177_900, previousPick);
    assert.equal(decision.sameFlight, true);
    assert.equal(decision.blocked, true);
});

test('another flight to yesterday destination is also excluded', () => {
    const decision = repeatDecision(flight('another-flight', 'TAK'), 180_000, previousPick);
    assert.equal(decision.sameDestination, true);
    assert.equal(decision.blocked, true);
});

test('same flight or destination can return when the effective price dropped', () => {
    const sameFlight = repeatDecision(flight('same-flight', 'TAK'), 176_900, previousPick);
    const sameDestination = repeatDecision(flight('another-flight', 'TAK'), 170_000, previousPick);
    assert.equal(sameFlight.blocked, false);
    assert.equal(sameFlight.priceDropped, true);
    assert.equal(sameFlight.dropAmount, 1_000);
    assert.equal(sameDestination.blocked, false);
    assert.equal(sameDestination.priceDropped, true);
});

test('a different destination remains eligible regardless of yesterday price', () => {
    const decision = repeatDecision(flight('new-flight', 'FUK', '후쿠오카'), 190_000, previousPick);
    assert.equal(decision.repeated, false);
    assert.equal(decision.blocked, false);
});

test('the previous-day snapshot survives multiple selections on the same day', () => {
    const currentPick = {
        date: '2026-08-28',
        flightId: 'today-flight',
        previousPick,
    };
    assert.deepEqual(
        findPreviousDayPick(currentPick, [], '2026-08-28'),
        previousPick,
    );
});

test('recent picks keep only the seven calendar days before selection day', () => {
    const storedPick = {
        date: '2026-08-29',
        flightId: 'day-1',
        destinationKey: 'TAK',
        effectivePrice: 177_900,
        recentPicks: [
            { date: '2026-08-23', flightId: 'day-7', destinationKey: 'DYG', effectivePrice: 219_000 },
            { date: '2026-08-22', flightId: 'day-8', destinationKey: 'FUK', effectivePrice: 160_000 },
        ],
    };
    const recent = collectRecentPicks(storedPick, [], '2026-08-30');
    assert.deepEqual(recent.map(pick => pick.flightId), ['day-1', 'day-7']);
});

test('a destination selected in the last seven days is blocked without a lower price', () => {
    const recentPicks = [
        { date: '2026-08-24', flightId: 'older', destinationKey: 'TAK', effectivePrice: 180_000 },
        { date: '2026-08-28', flightId: 'newer', destinationKey: 'TAK', effectivePrice: 170_000 },
    ];
    const decision = recentRepeatDecision(flight('candidate', 'TAK'), 175_000, recentPicks);
    assert.equal(decision.blocked, true);
    assert.equal(decision.previousEffectivePrice, 170_000);
});

test('a recent destination can return only below its lowest selected price in the window', () => {
    const recentPicks = [
        { date: '2026-08-24', flightId: 'older', destinationKey: 'TAK', effectivePrice: 180_000 },
        { date: '2026-08-28', flightId: 'newer', destinationKey: 'TAK', effectivePrice: 170_000 },
    ];
    const decision = recentRepeatDecision(flight('candidate', 'TAK'), 169_000, recentPicks);
    assert.equal(decision.blocked, false);
    assert.equal(decision.priceDropped, true);
    assert.equal(decision.dropAmount, 1_000);
    assert.equal(decision.previousDate, '2026-08-28');
});

test('the same city is treated as a repeat even when its airport code differs', () => {
    const recentPicks = [
        {
            date: '2026-08-28',
            flightId: 'haneda-flight',
            arrivalCity: '도쿄',
            destinationKey: 'HND',
            effectivePrice: 180_000,
        },
    ];
    const decision = recentRepeatDecision(flight('narita-flight', 'NRT', '도쿄'), 181_000, recentPicks);
    assert.equal(decision.sameDestination, true);
    assert.equal(decision.blocked, true);
});
