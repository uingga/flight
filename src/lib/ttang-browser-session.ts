import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { getCrawlDataDir } from './crawl-data-dir';
import { createTtangRequestAudit } from './ttang-request-audit.mjs';
import { openTtangIsolatedChrome } from './ttang-isolated-chrome';

const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const externalBrowserConnections = new Set<Browser>();
let externalCleanupFailed = false;
const requestAudits: ReturnType<typeof createTtangRequestAudit>[] = [];

function trackOwnPage(page: Page) {
    if (process.env.TTANG_BROWSER_WORKER !== '1') return () => {};
    const audit = createTtangRequestAudit();
    requestAudits.push(audit);
    const save = () => fs.writeFileSync(path.join(getCrawlDataDir(), 'ttang-request-audit.json'),
        JSON.stringify({ version: 1, scope: 'owned-page-http-events', sessions: requestAudits.map(a => a.snapshot()) }));
    page.on('request', req => { audit.request(req); save(); });
    page.on('response', res => { audit.response(res); save(); });
    page.on('requestfinished', req => { audit.finished(req); save(); });
    page.on('requestfailed', req => { audit.failed(req); save(); });
    save();
    return save;
}

export interface TtangBrowserSession {
    page: Page;
    mode: 'managed-headless' | 'external-chrome';
    close: () => Promise<void>;
}

function configuredCdpEndpoint(): string | null {
    const value = process.env.TTANG_BROWSER_CDP_URL?.trim();
    if (!value) return null;
    return value === '1' ? DEFAULT_CDP_ENDPOINT : value;
}

/**
 * GitHub에서는 기존 headless Chromium을 사용하고, Windows 대체 수집에서는 사용자가
 * 따로 띄운 일반 Chrome의 CDP 포트에 연결한다. 외부 Chrome에는 실행 플래그를 추가하거나
 * 브라우저 자체를 종료하지 않고, 이 작업이 만든 탭만 닫는다.
 */
export async function openTtangBrowserSession(): Promise<TtangBrowserSession> {
    const cdpEndpoint = configuredCdpEndpoint();
    if (cdpEndpoint) {
        if (process.env.TTANG_BROWSER_WORKER === '1') {
            let isolated;
            try { isolated = await openTtangIsolatedChrome(); }
            catch (e) { if (String(e).includes('cleanup')) externalCleanupFailed = true; throw e; }
            const saveAudit = trackOwnPage(isolated.page);
            return { page: isolated.page, mode: 'external-chrome', close: async () => {
                try { await isolated.close(); }
                catch { externalCleanupFailed = true; throw new Error('ttang_owned_tab_cleanup_failed'); }
                finally { saveAudit(); }
            } };
        }
        let browser: Browser;
        try {
            browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 10_000 });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
                `땡처리 로컬 Chrome에 연결하지 못했습니다 (${cdpEndpoint}). `
                + `먼저 전용 디버그 Chrome을 실행해주세요: ${reason}`,
            );
        }

        const context: BrowserContext | undefined = browser.contexts()[0];
        if (!context) {
            await browser.close().catch(() => undefined);
            throw new Error('땡처리 로컬 Chrome에 사용할 브라우저 컨텍스트가 없습니다.');
        }
        externalBrowserConnections.add(browser);
        browser.once('disconnected', () => externalBrowserConnections.delete(browser));
        const page = await context.newPage();
        const saveAudit = trackOwnPage(page);
        return {
            page,
            mode: 'external-chrome',
            close: async () => {
                try { await page.close({ runBeforeUnload: false }); }
                catch { externalCleanupFailed = true; throw new Error('ttang_owned_tab_cleanup_failed'); }
                finally { saveAudit(); }
                // connectOverCDP로 붙은 Chrome은 사용자가 확인할 수 있게 그대로 둔다.
            },
        };
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        locale: 'ko-KR',
        extraHTTPHeaders: {
            Referer: 'https://mm.ttang.com/',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });
    const page = await context.newPage();
    const saveAudit = trackOwnPage(page);
    return {
        page,
        mode: 'managed-headless',
        close: async () => { try { await browser.close(); } finally { saveAudit(); } },
    };
}

/** 한 회차가 만든 외부 Chrome CDP 연결을 끊어 Node 프로세스가 정상 종료되게 한다. */
export async function shutdownTtangExternalBrowserSessions(): Promise<void> {
    const browsers = Array.from(externalBrowserConnections);
    externalBrowserConnections.clear();
    for (const browser of browsers) {
        try { await browser.close({ reason: 'Ttang crawl completed' }); }
        catch { externalCleanupFailed = true; }
    }
    if (externalCleanupFailed) throw new Error('ttang_browser_cleanup_unconfirmed');
}
