import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { failYbtourInteraction, YbtourInteractionGuard, YbtourOverlayError } from '../src/lib/scrapers/ybtour-interaction';
import { IncompleteScrapeError } from '../src/lib/scrapers/scrape-errors';
import { SourceResponseError } from '../src/lib/scrapers/source-response';
import { classifySourceAccessRestriction, SOURCE_ADAPTER_VERSIONS } from '../src/lib/source-circuit';

function fixture(options: { overlay?: boolean; stuck?: boolean; text?: string; afterWaitText?: string } = {}) {
    const state = { waits: 0, textReads: 0, text: options.text || '항공권 조회', overlay: !!options.overlay };
    const overlay = {
        first: () => overlay,
        isVisible: async () => state.overlay,
        waitFor: async ({ state: target, timeout }: { state: string; timeout: number }) => {
            assert.equal(target, 'hidden');
            assert.equal(timeout, 8000);
            state.waits++;
            if (options.afterWaitText) state.text = options.afterWaitText;
            if (options.stuck) throw new Error('Timeout');
            state.overlay = false;
        },
    };
    const page = {
        url: () => 'about:blank',
        locator: (selector: string) => selector === 'body'
            ? { innerText: async () => { state.textReads++; return state.text; } }
            : (assert.equal(selector, '.dimBox.bg:visible'), overlay),
    } as unknown as Page;
    return { state, guard: new YbtourInteractionGuard(page) };
}

test('normal page clicks once without extra waits', async () => {
    const { guard, state } = fixture(); let clicks = 0;
    await guard.click('보홀', async () => { clicks++; });
    assert.equal(clicks, 1); assert.equal(state.waits, 0);
});
test('temporary mask clears normally before one click', async () => {
    const { guard, state } = fixture({ overlay: true }); let clicks = 0;
    await guard.click('보홀', async () => { assert.equal(state.overlay, false); clicks++; });
    assert.equal(clicks, 1); assert.equal(state.waits, 1);
});
test('stuck mask stops before the next 27 cities and is not an access circuit', async () => {
    const { guard, state } = fixture({ overlay: true, stuck: true }); let clicks = 0;
    await assert.rejects(async () => {
        for (let i = 0; i < 28; i++) await guard.click(`도시 ${i}`, async () => { clicks++; });
    }, error => {
        assert.ok(error instanceof IncompleteScrapeError);
        assert.match(error.message, /dimBox/);
        assert.equal(classifySourceAccessRestriction(error), null);
        return true;
    });
    assert.equal(clicks, 0); assert.equal(state.waits, 1);
});
test('known intercepted click retries only once across all cities', async () => {
    const { guard, state } = fixture(); let clicks = 0;
    const intercepted = new Error('<div class="dimBox bg"></div> intercepts pointer events');
    await guard.click('첫 도시', async () => { if (++clicks === 1) { state.overlay = true; throw intercepted; } });
    assert.equal(clicks, 2);
    await assert.rejects(guard.click('다음 도시', async () => { clicks++; throw intercepted; }), IncompleteScrapeError);
    assert.equal(clicks, 3); assert.equal(state.waits, 1);
});
test('ordinary timeout is never blindly retried', async () => {
    const { guard } = fixture(); let clicks = 0;
    await assert.rejects(guard.click('조회', async () => { clicks++; throw new Error('Timeout 5000ms'); }), IncompleteScrapeError);
    assert.equal(clicks, 1);
});
test('click that already landed is not replayed even if earlier logs mention a mask', async () => {
    const { guard } = fixture(); let clicks = 0;
    await assert.rejects(guard.click('조회', async () => {
        clicks++;
        throw new Error('dimBox intercepts pointer events\nclick action done\nwaiting for scheduled navigations');
    }), IncompleteScrapeError);
    assert.equal(clicks, 1);
});
test('restriction appearing on the final retry is not downgraded to UI failure', async () => {
    const { guard, state } = fixture(); let clicks = 0;
    await assert.rejects(guard.click('조회', async () => {
        if (++clicks === 1) throw new Error('dimBox intercepts pointer events');
        state.text = 'CAPTCHA'; throw new Error('Timeout');
    }), error => { assert.equal(classifySourceAccessRestriction(error)?.reason, 'blocked'); return true; });
    assert.equal(clicks, 2);
});
test('CAPTCHA mask prevents waits and clicks', async () => {
    const { guard, state } = fixture({ overlay: true, text: 'CAPTCHA' }); let clicks = 0;
    await assert.rejects(guard.click('조회', async () => { clicks++; }), error => {
        assert.equal(classifySourceAccessRestriction(error)?.reason, 'blocked'); return true;
    });
    assert.equal(clicks, 0); assert.equal(state.waits, 0);
});
test('access restriction revealed after waiting is preserved', async () => {
    const { guard } = fixture({ overlay: true, stuck: true, afterWaitText: '접근이 제한되었습니다' });
    await assert.rejects(guard.click('조회', async () => assert.fail('must not click')), error => {
        assert.ok(error instanceof SourceResponseError); return true;
    });
});
test('explicit HTTP restrictions propagate unchanged without retry', async () => {
    for (const status of [401, 403, 429]) {
        const { guard, state } = fixture(); let clicks = 0;
        const error = new SourceResponseError('http-status', `HTTP ${status}`, status);
        await assert.rejects(guard.click('조회', async () => { clicks++; throw error; }), e => e === error);
        assert.equal(clicks, 1); assert.equal(state.textReads, 0);
    }
});
test('nested row/city/region catches retain the original incomplete failure', () => {
    let captured: unknown;
    try { failYbtourInteraction('아시아/보홀 행 1', new Error('조회 버튼 누락')); } catch (e) { captured = e; }
    for (const label of ['보홀', '아시아']) assert.throws(() => failYbtourInteraction(label, captured), e => e === captured);
    assert.equal(classifySourceAccessRestriction(captured), null);
    assert.equal(SOURCE_ADAPTER_VERSIONS.ybtour, '2026-08-31.1', 'existing circuit must not be bypassed by a version bump');
});
test('collector wires all three clicks and propagates all three nested failures', () => {
    const source = readFileSync('src/lib/scrapers/ybtour.ts', 'utf8');
    assert.equal((source.match(/await interaction\.click\(/g) || []).length, 3);
    assert.ok(source.includes('failYbtourInteraction(`${region.name}/${city.name} 행 ${rowIdx}`, e)'));
    assert.ok(source.includes('failYbtourInteraction(`${region.name}/${city.name}(${city.code})`, error)'));
    assert.ok(source.includes('failYbtourInteraction(`${region.name} 지역`, error)'));
    assert.ok(source.includes('await browser.close()'), 'browser cleanup remains active');
});

test('region recovery has one navigation budget and does not recover unknown failures or access restrictions', async () => {
    for (const scenario of ['success', 'http403', 'captchaBefore', 'captchaAfter', 'ordinary'] as const) {
        let navigations = 0; let regionClicks = 0;
        const page = {
            url: () => 'about:blank',
            goto: async () => {
                navigations++;
                return { ok: () => scenario !== 'http403', status: () => 403, headers: () => ({}), url: () => 'about:blank' };
            },
            locator: (selector: string) => {
                const locator = {
                    first: () => locator,
                    isVisible: async () => false,
                    waitFor: async () => {},
                    click: async () => { assert.equal(selector, '[id="bannerCode_A0/A3"]'); regionClicks++; },
                    innerText: async () => scenario === 'captchaBefore' || (scenario === 'captchaAfter' && navigations > 0) ? 'CAPTCHA' : '항공권 목록',
                };
                return locator;
            },
        } as unknown as Page;
        const guard = new YbtourInteractionGuard(page);
        const error = scenario === 'ordinary' ? new IncompleteScrapeError('unknown', []) : new YbtourOverlayError('dimBox', ['DAD']);
        if (scenario === 'success') {
            assert.equal(await guard.recoverCity(error, 'bannerCode_A0/A3', 'DAD'), true);
            assert.equal(await guard.recoverCity(error, 'bannerCode_A0/A3', 'DAD'), false);
            assert.equal(navigations, 1); assert.equal(regionClicks, 1);
        } else if (scenario === 'ordinary') {
            assert.equal(await guard.recoverCity(error, 'bannerCode_A0/A3', 'DAD'), false);
            assert.equal(navigations, 0);
        } else {
            await assert.rejects(guard.recoverCity(error, 'bannerCode_A0/A3', 'DAD'), e => {
                assert.equal(classifySourceAccessRestriction(e)?.reason, 'blocked'); return true;
            });
            assert.equal(regionClicks, 0);
            assert.equal(navigations, scenario === 'captchaBefore' ? 0 : 1);
        }
    }
});
