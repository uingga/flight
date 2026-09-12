import type { Page } from 'playwright';
import { IncompleteScrapeError } from './scrape-errors';
import { assertNoSourceAccessBlockText, SourceResponseError } from './source-response';
import { classifySourceAccessRestriction } from '../source-circuit';

export const YBTOUR_LIST_URL = 'https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV';

export class YbtourOverlayError extends IncompleteScrapeError {}

/** UI failures must not become a successful short list and trigger the count-drop circuit. */
export function failYbtourInteraction(label: string, error: unknown): never {
    if (error instanceof IncompleteScrapeError || classifySourceAccessRestriction(error)) throw error;
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    const ErrorType = /dimBox/i.test(error instanceof Error ? error.message : String(error))
        ? YbtourOverlayError : IncompleteScrapeError;
    throw new ErrorType(`노랑풍선 ${label} 화면 조작 실패 — 불완전 결과 폐기: ${reason}`, [label]);
}

export class YbtourInteractionGuard {
    private retriedInterceptedClick = false;
    private reloadedForRecovery = false;

    constructor(private readonly page: Page, private readonly overlayTimeout = 8_000) {}

    /** Restore only the failed city's region; never replay completed cities or reset the budget. */
    async recoverCity(error: unknown, regionTabId: string, cityCode: string): Promise<boolean> {
        if (!(error instanceof YbtourOverlayError) || this.reloadedForRecovery) return false;
        await this.assertAccess(cityCode);
        this.reloadedForRecovery = true;
        console.log(`[RECOVER] 노랑풍선 ${cityCode}: 목록 재진입 후 해당 도시부터 재개 (회차당 1회)`);
        const response = await this.page.goto(YBTOUR_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (response && !response.ok()) {
            throw new SourceResponseError('http-status', `노랑풍선 화면 복구 HTTP ${response.status()}`,
                response.status(), response.headers()['content-type'] || '', undefined, response.url());
        }
        await this.assertAccess(cityCode);
        await this.page.locator('table tbody').first().waitFor({ state: 'attached', timeout: 10_000 });
        const tab = this.page.locator(`[id="${regionTabId}"]`);
        await this.click(`${cityCode} 지역 복원`, () => tab.click({ timeout: 5_000 }));
        await this.page.locator(`#cityCode_${cityCode} a`).waitFor({ state: 'visible', timeout: 5_000 });
        return true;
    }

    private async assertAccess(label: string): Promise<void> {
        const text = await this.page.locator('body').innerText({ timeout: 5_000 });
        assertNoSourceAccessBlockText(`노랑풍선 ${label}`, text, this.page.url());
    }

    private async waitUntilReady(label: string): Promise<void> {
        const overlay = this.page.locator('.dimBox.bg:visible').first();
        if (await overlay.isVisible()) {
            await this.assertAccess(label);
            console.log(`[WAIT] 노랑풍선 ${label}: 화면 덮개가 사라질 때까지 대기`);
            try {
                await overlay.waitFor({ state: 'hidden', timeout: this.overlayTimeout });
            } catch (error) {
                // Inspect again: a loading mask may have turned into an access restriction.
                await this.assertAccess(label);
                failYbtourInteraction(label, new Error('화면 덮개(dimBox)가 제한 시간 내 사라지지 않음'));
            }
        }
    }

    async click(label: string, action: () => Promise<void>): Promise<void> {
        try {
            await this.waitUntilReady(label);
            try {
                await action();
            } catch (error) {
                if (classifySourceAccessRestriction(error)) throw error;
                await this.assertAccess(label);
                const message = error instanceof Error ? error.message : String(error);
                // Only a click known not to have landed can be retried, once for the entire run.
                if (this.retriedInterceptedClick || /click action done|scheduled navigations|navigated/i.test(message)
                    || !/dimBox[^\n]*intercepts pointer events/i.test(message)) throw error;
                this.retriedInterceptedClick = true;
                await this.waitUntilReady(label);
                await action();
            }
        } catch (error) {
            if (!(error instanceof IncompleteScrapeError) && !classifySourceAccessRestriction(error)) {
                await this.assertAccess(label);
            }
            failYbtourInteraction(label, error);
        }
    }
}
