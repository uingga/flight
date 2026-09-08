import puppeteer from 'puppeteer';
const WebSocket = require('ws');
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { discoverDedicatedChromeEndpoint } from './onlinetour-dedicated-chrome';

/** Uses the existing profile but never waits for, closes or navigates an existing site tab. */
export async function openTtangIsolatedChrome() {
    const endpoint = await discoverDedicatedChromeEndpoint();
    const ws = new WebSocket(endpoint, { handshakeTimeout: 8000 });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    let id = 0, targetId: string | undefined, creationAttempted = false;
    let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    ws.on('error', () => {});
    ws.on('message', (data: Buffer) => {
        const m = JSON.parse(String(data)), p = pending.get(m.id);
        if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
    });
    const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => { pending.delete(n); reject(Error('ttang_cdp_timeout:' + method)); }, 8000);
        pending.set(n, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
        ws.send(JSON.stringify({ id: n, method, params }));
    });
    const close = async () => {
        let confirmed = !creationAttempted;
        try {
            await browser?.disconnect();
            if (targetId) confirmed = (await send('Target.closeTarget', { targetId })).success === true;
        } finally { ws.terminate(); }
        if (!confirmed) throw Error('ttang_owned_tab_cleanup_failed');
    };
    try {
        const ownUrl = 'about:blank#ttang-' + randomUUID();
        creationAttempted = true;
        targetId = (await send('Target.createTarget', { url: ownUrl })).targetId;
        browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 15000,
            targetFilter: target => target.type() === 'browser' || target.url() === ownUrl });
        const page = await browser.targets().find(t => t.url() === ownUrl)?.page();
        if (!page) throw Error('ttang_owned_page_missing');
        // Only this small Playwright-compatible surface is used by Ttang list/detail fetches.
        const adapter = {
            evaluate: page.evaluate.bind(page), goto: page.goto.bind(page), url: page.url.bind(page),
            on: page.on.bind(page),
            waitForTimeout: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
            locator: (selector: string) => ({ innerText: async () => page.$eval(selector, e => (e as HTMLElement).innerText) }),
        } as unknown as Page;
        return { page: adapter, close };
    } catch (error) {
        try { await close(); } catch { throw Error('ttang_owned_tab_cleanup_failed'); }
        throw error;
    }
}
