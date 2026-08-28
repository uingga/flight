import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findPreviousDayPick,
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
