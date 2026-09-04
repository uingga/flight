import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const externalBrowserConnections = new Set<Browser>();

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
        return {
            page,
            mode: 'external-chrome',
            close: async () => {
                await page.close({ runBeforeUnload: false }).catch(() => undefined);
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
    return {
        page,
        mode: 'managed-headless',
        close: async () => browser.close(),
    };
}

/**
 * connectOverCDP 연결은 탭만 닫아도 Node 이벤트 루프를 붙잡는다. 한 크롤 회차의 모든
 * 단계가 끝난 뒤 전용 디버그 Chrome과 연결을 함께 닫아 예약 프로세스가 반드시 종료되게 한다.
 */
export async function shutdownTtangExternalBrowserSessions(): Promise<void> {
    const browsers = Array.from(externalBrowserConnections);
    externalBrowserConnections.clear();
    for (const browser of browsers) {
        await browser.close({ reason: 'Ttang crawl completed' }).catch(() => undefined);
    }
}
