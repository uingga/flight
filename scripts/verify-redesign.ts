import { chromium, type Page } from 'playwright';

const baseUrl = process.argv[2] || 'http://localhost:3002/preview/mobile-redesign';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function waitForFlights(page: Page) {
    await page.getByRole('heading', { name: /전체 항공권|검색 결과|항공권$/ }).first().waitFor();
    await page.locator('article').first().waitFor({ timeout: 15_000 });
    const cardCount = await page.locator('article').count();
    assert(cardCount >= 3, `항공권 카드가 ${cardCount}개만 표시됐습니다.`);
}

async function verifyViewport(width: number, height: number) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await waitForFlights(page);

        const dropTicker = page.locator('[data-drop-alert-flight-id]').filter({ visible: true }).first();
        if (await dropTicker.count()) {
            const tickerFlightId = await dropTicker.getAttribute('data-drop-alert-flight-id');
            const dropCardFlightId = await page.locator('article[data-tikit-drop="true"]').first().getAttribute('data-flight-id');
            assert(tickerFlightId === dropCardFlightId, '상단 특가 경보와 TIKIT DROP 카드가 서로 다른 항공권입니다.');
        }

        const filterButton = page.getByRole('button', { name: '필터', exact: true }).filter({ visible: true });
        if (await filterButton.count()) {
            await filterButton.first().click();
        } else {
            await page.getByRole('button', { name: '상세 조건', exact: true }).click();
        }
        await page.locator('[aria-label="항공권 필터"]').filter({ visible: true }).last().waitFor();
        await page.keyboard.press('Escape');

        await page.locator('article').first().locator('button').first().click();
        const detail = page.locator('[aria-label="항공권 상세"]');
        await detail.waitFor();
        const booking = detail.locator('a').filter({ hasText: /에서 확인하기/ });
        const bookingUrl = await booking.getAttribute('href');
        assert(bookingUrl && !bookingUrl.startsWith('javascript:'), '예약 링크가 올바르게 만들어지지 않았습니다.');

        const sharedUrl = new URL(page.url());
        assert(sharedUrl.searchParams.has('flight'), '상세 열람 URL에 항공권 식별자가 남지 않았습니다.');

        await detail.getByRole('button', { name: '이 노선 가격 알림' }).click();
        const alertDialog = page.getByRole('dialog', { name: /가격 알림|떠날 만한 표/ });
        await alertDialog.waitFor();
        await page.keyboard.press('Escape');
        await alertDialog.waitFor({ state: 'hidden' });
        assert(await detail.isVisible(), '가격 알림만 닫아야 하는데 항공권 상세까지 닫혔습니다.');
        await page.keyboard.press('Escape');
        await detail.waitFor({ state: 'hidden' });
        assert(!new URL(page.url()).searchParams.has('flight'), '상세 닫기 뒤 URL에 항공권 식별자가 남았습니다.');
        await page.goForward();
        await detail.waitFor();
        assert(new URL(page.url()).searchParams.has('flight'), '앞으로가기에서 항공권 상세가 복원되지 않았습니다.');
        await page.goBack();
        await detail.waitFor({ state: 'hidden' });

        await page.goto(sharedUrl.toString(), { waitUntil: 'domcontentloaded' });
        await page.locator('[aria-label="항공권 상세"]').waitFor({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await detail.waitFor({ state: 'hidden' });
        assert(!new URL(page.url()).searchParams.has('flight'), '공유 주소의 상세를 닫은 뒤 flight 값이 남았습니다.');

        await page.goto(sharedUrl.toString(), { waitUntil: 'domcontentloaded' });
        await detail.waitFor({ timeout: 15_000 });
        await detail.getByRole('button', { name: '이 노선 가격 알림' }).click();
        await alertDialog.waitFor();
        await page.goBack();
        await alertDialog.waitFor({ state: 'hidden' });
        await detail.waitFor({ timeout: 2_000 }).catch(() => undefined);
        assert(await detail.isVisible(), '뒤로가기에서 위의 가격 알림 대신 상세까지 닫혔습니다.');
        assert(new URL(page.url()).searchParams.has('flight'), '가격 알림을 뒤로 닫은 뒤 상세 URL이 사라졌습니다.');
        await page.goBack();
        await detail.waitFor({ state: 'hidden' });

        await page.getByRole('button', { name: /로그인|내 여행/ }).first().click();
        await page.getByRole('heading', { name: /어디서든 이어보기|저장해 둔 여행/ }).first().waitFor();
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: '특가 알림', exact: true }).first().click();
        await page.getByRole('heading', { name: /떠날 만한 표가 없나요|내 특가 알림/ }).first().waitFor();
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: '문의하기', exact: true }).scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: '문의하기', exact: true }).click();
        await page.getByRole('heading', { name: '문의하기', exact: true }).waitFor();
        await page.keyboard.press('Escape');

        assert(pageErrors.length === 0, `화면 실행 오류: ${pageErrors.join(' / ')}`);
    } finally {
        await browser.close();
    }
}

async function main() {
    await verifyViewport(320, 700);
    await verifyViewport(390, 844);
    await verifyViewport(1440, 1000);
    console.log('리디자인 핵심 흐름 확인 완료: 모바일 320px·390px / PC 1440px');
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
