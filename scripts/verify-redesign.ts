import { chromium, type Locator, type Page } from 'playwright';

const baseUrl = process.argv[2] || 'http://localhost:3002/preview/mobile-redesign';
const isLocalPreview = ['localhost', '127.0.0.1', '::1'].includes(new URL(baseUrl).hostname);

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function swipeSheetDown(page: Page, dialog: Locator) {
    const handle = dialog.locator('[data-swipe-handle]');
    await handle.waitFor({ state: 'visible' });
    const box = await handle.boundingBox();
    assert(box, '바텀시트 드래그 손잡이의 위치를 찾지 못했습니다.');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 190, { steps: 8 });
    await page.mouse.up();
}

async function waitForFlights(page: Page) {
    await page.getByRole('heading', { name: /전체 항공권|검색 결과|항공권$/ }).first().waitFor();
    await page.locator('article').first().waitFor({ timeout: 15_000 });
    const cardCount = await page.locator('article').count();
    assert(cardCount >= 3, `항공권 카드가 ${cardCount}개만 표시됐습니다.`);
}

async function selectSource(page: Page, sourceName: string) {
    const filterButton = page.getByRole('button', { name: '필터', exact: true }).filter({ visible: true });
    if (await filterButton.count()) await filterButton.first().click();
    else await page.getByRole('button', { name: '상세 조건', exact: true }).click();
    const filterDialog = page.locator('[aria-label="항공권 필터"]').filter({ visible: true }).last();
    await filterDialog.waitFor();
    await filterDialog.getByRole('button', { name: sourceName, exact: true }).click();
    await filterDialog.getByRole('button', { name: /개 항공권 보기/ }).click();
    await page.locator('article').first().waitFor();
}

async function verifyViewport(width: number, height: number) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await waitForFlights(page);

        const initialCardCount = await page.locator('article').count();
        const expectedInitialCards = width >= 960 ? 30 : 15;
        assert(
            initialCardCount >= expectedInitialCards,
            `더 보기를 누르기 전 카드가 ${initialCardCount}개뿐입니다. 최소 ${expectedInitialCards}개가 보여야 합니다.`,
        );

        if (width < 960) {
            await page.evaluate(() => window.scrollTo(0, Math.max(1200, document.body.scrollHeight * 0.45)));
            const stickyFilters = page.getByRole('navigation', { name: '현재 항공권 조건' });
            await stickyFilters.waitFor({ state: 'visible' });
            const stickyText = (await stickyFilters.locator('button').allTextContents()).join(' ');
            const departureIndex = stickyText.indexOf('출발');
            const arrivalIndex = stickyText.indexOf('도착');
            const dateIndex = stickyText.indexOf('일정');
            assert(
                departureIndex >= 0 && departureIndex < arrivalIndex && arrivalIndex < dateIndex,
                `스크롤 필터 순서가 출발→도착→일정이 아닙니다: ${stickyText}`,
            );
            await page.evaluate(() => window.scrollTo(0, 0));
        }

        if (width === 390) {
            const previewData = await page.evaluate(async () => {
                const response = await fetch('/api/preview-flights?sortBy=price&sortOrder=asc', { cache: 'no-store' });
                const payload = await response.json() as { flights?: Array<{ source?: string }> };
                return {
                    source: response.headers.get('x-tikitikit-preview-data'),
                    myrealtrip: (payload.flights || []).filter(flight => flight.source === 'myrealtrip').length,
                };
            });
            assert(
                previewData.source === 'live' || (isLocalPreview && previewData.source === 'branch-fallback'),
                `미리보기가 운영 데이터 대신 ${previewData.source || '알 수 없는 데이터'}를 사용합니다.`,
            );
            assert(previewData.myrealtrip > 0, '미리보기 최신 데이터에서 마이리얼트립 항공권이 모두 빠졌습니다.');

            await page.getByRole('button', { name: '로그인하고 찜하기' }).first().click();
            await page.getByRole('heading', { name: '어디서든 이어보기' }).waitFor();
            await page.keyboard.press('Escape');

            await selectSource(page, '하나투어');
            await page.locator('article[data-source="hanatour"]').first().locator('button').first().click();
            let detailForPassenger = page.locator('[aria-label="항공권 상세"]');
            await detailForPassenger.getByText('탑승 인원', { exact: true }).waitFor();
            assert(await detailForPassenger.locator('details[open]').count() > 0, '지원 여행사의 탑승 인원 선택이 펼쳐져 있지 않습니다.');
            await page.keyboard.press('Escape');

            await selectSource(page, '모두투어');
            await page.locator('article[data-source="modetour"]').first().locator('button').first().click();
            detailForPassenger = page.locator('[aria-label="항공권 상세"]');
            await detailForPassenger.getByText('여행사 예약 화면에서 선택해요', { exact: true }).waitFor();
            await page.keyboard.press('Escape');

            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await waitForFlights(page);
            await page.getByRole('button', { name: '검색', exact: true }).click();
            await page.getByLabel('도시나 항공사 검색').fill('후쿠오카');
            await page.getByRole('button', { name: '필터', exact: true }).filter({ visible: true }).first().click();
            const emptyFilterDialog = page.locator('[aria-label="항공권 필터"]').filter({ visible: true }).last();
            await emptyFilterDialog.getByRole('button', { name: '동남아', exact: true }).click();
            await emptyFilterDialog.getByRole('button', { name: /개 항공권 보기/ }).click();
            await page.getByText(/후쿠오카 표는 [\d,]+개 있어요\./).waitFor();
            await page.locator('[class*="emptyBlockers"] button').first().waitFor();

            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await waitForFlights(page);
        }

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
        const mainFilterDialog = page.locator('[aria-label="항공권 필터"]').filter({ visible: true }).last();
        await mainFilterDialog.waitFor();
        if (width < 960) {
            await swipeSheetDown(page, mainFilterDialog);
            await mainFilterDialog.waitFor({ state: 'hidden' });
            await filterButton.first().click();
            await mainFilterDialog.waitFor();
        }
        if (width >= 960) {
            await mainFilterDialog.getByRole('button', { name: '전체 항공사', exact: true }).click();
            const airlineListbox = mainFilterDialog.getByRole('listbox', { name: '항공사 선택' });
            await airlineListbox.waitFor();
            assert(await airlineListbox.getByRole('option').count() > 1, 'PC 항공사 선택 목록이 비어 있습니다.');
            await airlineListbox.getByRole('option', { name: '전체 항공사', exact: true }).click();
            await airlineListbox.waitFor({ state: 'hidden' });
        }
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

        if (width < 960) {
            await page.locator('article').first().locator('button').first().click();
            await detail.waitFor();
            await swipeSheetDown(page, detail);
            await detail.waitFor({ state: 'hidden' });
            assert(!new URL(page.url()).searchParams.has('flight'), '상세를 아래로 내려 닫은 뒤 URL에 항공권 식별자가 남았습니다.');
        }

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
