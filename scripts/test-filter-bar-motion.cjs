const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/app/preview/mobile-redesign/MobileRedesignPreview.tsx', 'utf8');
const start = source.indexOf('        let pinned = false;');
const end = source.indexOf('\n    }, []);', start);
assert.ok(start > 0 && end > start);
const effect = source.slice(start, end).replace(/: number \| undefined/g, '');
function scenario({ desktop = true, reduced = false } = {}) {
    let top = 50, tick = 0, id = 0;
    const timers = new Map(), listeners = new Map();
    const state = { Pinned: false, Exiting: false, Returning: false, Leaving: false };
    const context = {
        filterBarSlotRef: { current: { getBoundingClientRect: () => ({ top }) } },
        setShowScrollTop() {},
        window: {
            scrollY: 0, innerHeight: 900,
            matchMedia: q => ({ matches: q.includes('min-width') ? desktop : reduced }),
            setTimeout: (fn, ms) => { timers.set(++id, { fn, at: tick + ms }); return id; },
            clearTimeout: key => timers.delete(key),
            addEventListener: (name, fn) => listeners.set(name, fn),
            removeEventListener: name => listeners.delete(name),
        },
    };
    for (const key of Object.keys(state)) context[`setFilterBar${key}`] = value => { state[key] = value; };
    const cleanup = vm.runInNewContext(`(() => {${effect}})()`, context);
    return {
        state, timers, cleanup,
        scroll(value) { top = value; listeners.get('scroll')(); },
        advance(ms) {
            tick += ms;
            for (const [key, timer] of [...timers]) if (timer.at <= tick) {
                timers.delete(key); timer.fn();
            }
        },
    };
}

const normal = scenario();
normal.scroll(-9);
assert.equal(normal.state.Leaving, true);
assert.equal(normal.state.Pinned, false);
normal.advance(100);
assert.equal(normal.state.Pinned, true);
normal.scroll(8);
assert.equal(normal.state.Exiting, false, 'hysteresis holds pinned bar');
normal.scroll(17);
assert.equal(normal.state.Exiting, true);
normal.advance(100);
assert.equal(normal.state.Pinned, false);
assert.equal(normal.state.Returning, true);

const interrupted = scenario();
interrupted.scroll(-9);
interrupted.scroll(20);
interrupted.advance(200);
assert.equal(interrupted.state.Pinned, false, 'cancelled entrance must not pin later');
assert.equal(interrupted.state.Leaving, false);
interrupted.scroll(-9); interrupted.advance(100);
interrupted.scroll(20); interrupted.advance(40); interrupted.scroll(-20); interrupted.advance(100);
assert.equal(interrupted.state.Pinned, true, 'cancelled exit must remain usable');
assert.equal(interrupted.state.Exiting, false);

for (const options of [{ reduced: true }, { desktop: false }]) {
    const instant = scenario(options);
    instant.scroll(-9);
    assert.equal(instant.state.Pinned, true);
    assert.equal(instant.timers.size, 0);
    instant.scroll(20);
    assert.equal(instant.state.Pinned, false);
}
const unmounted = scenario();
unmounted.scroll(-9); unmounted.cleanup();
assert.equal(unmounted.timers.size, 0);
console.log('PASS: filter motion timing, reversal, hysteresis, reduced motion, mobile, cleanup');
