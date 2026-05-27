const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 1200, deviceScaleFactor: 2 });

    const url = 'http://localhost:3000/blog-post-08.html';
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Hide the copy guide overlay
    await page.evaluate(() => {
        const guide = document.querySelector('.copy-guide');
        if (guide) guide.style.display = 'none';
    });

    const outDir = path.resolve('c:/Users/ynal/Dropbox/Projects/Personal Projects/Anti_gravity/260207_Test/public/blog-tables');

    // Ensure output directory exists
    const fs = require('fs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // 1. Main comparison table (📊 3월 추천 여행지 한눈에 비교)
    // Capture the first <table> and notes below it
    const table1 = await page.evaluateHandle(() => {
        const tables = document.querySelectorAll('table');
        return tables[0]?.parentElement;
    });

    // Actually let's capture each table element individually with some padding
    // We'll use a wrapper approach

    // Strategy: inject a wrapper around each table, screenshot each wrapper
    const tableCount = await page.evaluate(() => document.querySelectorAll('table').length);
    console.log(`Found ${tableCount} tables`);

    // Capture each table
    for (let i = 0; i < tableCount; i++) {
        const tableBox = await page.evaluate((idx) => {
            const table = document.querySelectorAll('table')[idx];
            if (!table) return null;
            const rect = table.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            };
        }, i);

        if (!tableBox) continue;

        // Add padding around the table
        const padding = 16;
        await page.screenshot({
            path: path.join(outDir, `table_${String(i + 1).padStart(2, '0')}.png`),
            clip: {
                x: Math.max(0, tableBox.x - padding),
                y: Math.max(0, tableBox.y - padding),
                width: tableBox.width + padding * 2,
                height: tableBox.height + padding * 2
            }
        });

        console.log(`✅ Captured table_${String(i + 1).padStart(2, '0')}.png`);
    }

    // Now let's also capture table with its heading for context
    // Table 1: 📊 comparison + notes
    // Table 12 (last): 💰 total cost + notes

    // Capture table 1 with heading
    const section1Box = await page.evaluate(() => {
        const h2 = document.querySelector('h2.center'); // 📊 3월 추천 여행지 한눈에 비교
        const table = document.querySelectorAll('table')[0];
        // Find the note text below table
        let nextEl = table.nextElementSibling;
        let bottom = table.getBoundingClientRect().bottom;
        while (nextEl && (nextEl.tagName === 'P' || nextEl.tagName === 'BR')) {
            bottom = nextEl.getBoundingClientRect().bottom;
            nextEl = nextEl.nextElementSibling;
        }
        const top = h2.getBoundingClientRect().top;
        return { x: 32, y: top, width: 720 - 64, height: bottom - top };
    });

    await page.screenshot({
        path: path.join(outDir, 'overview_table.png'),
        clip: {
            x: Math.max(0, section1Box.x - 16),
            y: Math.max(0, section1Box.y - 16),
            width: section1Box.width + 32,
            height: section1Box.height + 32
        }
    });
    console.log('✅ Captured overview_table.png');

    // Capture total cost table with heading
    const costBox = await page.evaluate(() => {
        const headings = document.querySelectorAll('h2');
        let costH2 = null;
        headings.forEach(h => {
            if (h.textContent.includes('총비용')) costH2 = h;
        });
        if (!costH2) return null;

        const tables = document.querySelectorAll('table');
        const lastTable = tables[tables.length - 1];

        // Find notes below
        let nextEl = lastTable.nextElementSibling;
        let bottom = lastTable.getBoundingClientRect().bottom;
        while (nextEl && (nextEl.tagName === 'P' || nextEl.tagName === 'BR')) {
            bottom = nextEl.getBoundingClientRect().bottom;
            nextEl = nextEl.nextElementSibling;
        }

        const top = costH2.getBoundingClientRect().top;
        return { x: 32, y: top, width: 720 - 64, height: bottom - top };
    });

    if (costBox) {
        await page.screenshot({
            path: path.join(outDir, 'cost_table.png'),
            clip: {
                x: Math.max(0, costBox.x - 16),
                y: Math.max(0, costBox.y - 16),
                width: costBox.width + 32,
                height: costBox.height + 32
            }
        });
        console.log('✅ Captured cost_table.png');
    }

    await browser.close();
    console.log(`\n🎉 All tables captured to: ${outDir}`);
})();
