/**
 * draft-naver-blog.mjs
 *
 * 네이버 블로그 "초안 작성" 자동화 — 발행 버튼은 절대 누르지 않는다.
 *
 * 흐름:
 *   1. 오늘자 블로그 글이 없으면 generate-blog.js 실행 (글 HTML + 카드 이미지 생성)
 *   2. public/을 로컬 서버로 띄워 글을 렌더링 → 전체 선택 + 복사 (이미지 포함)
 *   3. 네이버 블로그 에디터를 열어 제목 입력 + 본문 붙여넣기 + 임시저장
 *   4. 브라우저를 열어둔 채 대기 — 사용자가 직접 다듬고 발행 버튼을 누른다
 *
 * 최초 1회는 열린 창에서 네이버 로그인이 필요하다 (세션은 .naver-profile에 보존).
 * 자동화 단계가 중간에 실패해도 클립보드에 글이 복사돼 있으므로
 * 에디터에서 Ctrl+V만 하면 이어갈 수 있다.
 *
 * Usage:  npm run blog:draft          (오늘자 글 생성 or 재사용 → 에디터 준비)
 *         FORCE_GEN=1 npm run blog:draft   (글 강제 재생성)
 *         DRY_RUN=1 npm run blog:draft     (복사까지만 하고 네이버는 열지 않음)
 */

import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROFILE_DIR = path.join(ROOT, '.naver-profile');
const EDITOR_URL = 'https://blog.naver.com/GoBlogWrite.naver';
const LOGIN_WAIT_MS = 5 * 60 * 1000; // 최초 로그인 대기

const now = new Date();
const yymmdd = now.toISOString().substring(2, 10).replace(/-/g, '');
const postFile = path.join(PUBLIC_DIR, `blog-post-${yymmdd}.html`);

// ── 1. 글 생성 ──
if (!fs.existsSync(postFile) || process.env.FORCE_GEN) {
    console.log('📝 오늘자 블로그 글 생성 중... (특가 추출 + 카드 스크린샷, 1~2분)');
    const r = spawnSync('node', ['scripts/generate-blog.js'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status !== 0 || !fs.existsSync(postFile)) {
        console.error('❌ 블로그 글 생성 실패');
        process.exit(1);
    }
} else {
    console.log(`♻️ 기존 글 재사용: public/blog-post-${yymmdd}.html (재생성: FORCE_GEN=1)`);
}

const title = (fs.readFileSync(postFile, 'utf8').match(/<title>([^<]+)<\/title>/) || [])[1]
    || `오늘의 땡처리 항공권 특가 (${yymmdd})`;

// ── 2. public/ 로컬 서버 (이미지 상대경로 해석용) ──
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    const file = path.join(PUBLIC_DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const localUrl = `http://127.0.0.1:${server.address().port}/blog-post-${yymmdd}.html`;

// ── 3. 브라우저 (로그인 세션이 보존되는 영구 프로필) ──
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: 'ko-KR',
    args: ['--no-sandbox'],
});
await context.grantPermissions(['clipboard-read', 'clipboard-write']);

let done = false;
const finish = async (code) => {
    if (done) return; done = true;
    server.close();
    try { await context.close(); } catch { /* 이미 닫힘 */ }
    process.exit(code);
};

try {
    // ── 4. 글 페이지 열고 전체 복사 (이미지 로딩 완료 후) ──
    const src = context.pages()[0] || await context.newPage();
    await src.goto(localUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await src.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.body);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
    });
    console.log(`📋 글 복사 완료: "${title}"`);

    if (process.env.DRY_RUN) {
        const clip = await src.evaluate(async () => {
            const items = await navigator.clipboard.read();
            for (const it of items) {
                if (it.types.includes('text/html')) return (await (await it.getType('text/html')).text()).length;
            }
            return 0;
        });
        console.log(`✅ DRY_RUN: 클립보드 HTML ${clip.toLocaleString()}자 확인 — 네이버 단계는 생략`);
        await finish(0);
    }

    // ── 5. 네이버 에디터 열기 (미로그인 시 로그인 대기) ──
    const naver = await context.newPage();
    await naver.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (naver.url().includes('nid.naver.com')) {
        console.log('🔑 네이버 로그인이 필요합니다 — 열린 창에서 로그인해주세요 (최대 5분 대기)');
        console.log('   로그인하면 자동으로 이어서 진행됩니다. 세션은 저장되어 다음부터는 묻지 않습니다.');
        await naver.waitForURL(/blog\.naver\.com/, { timeout: LOGIN_WAIT_MS });
        // 로그인 후 어디로 돌아왔든 글쓰기 화면으로 확실히 이동
        await naver.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // 에디터 준비 대기 — mainFrame iframe 안일 수도, 페이지 직속일 수도 있다
    let frame = null;
    for (let w = 0; w < 30 && !frame; w++) {
        for (const cand of [naver.frameLocator('#mainFrame'), naver]) {
            try {
                if (await cand.locator('.se-section-documentTitle').count() > 0) { frame = cand; break; }
            } catch { /* iframe 미존재 */ }
        }
        if (!frame) await naver.waitForTimeout(1000);
    }
    if (!frame) {
        const shot = path.join(ROOT, 'debug-naver-editor.png');
        await naver.screenshot({ path: shot }).catch(() => {});
        console.warn(`⚠️ 에디터 화면을 찾지 못했습니다 (현재 URL: ${naver.url()})`);
        console.warn(`   화면 캡처: ${shot} — 글은 클립보드에 있으니 수동으로 Ctrl+V 가능합니다.`);
        throw new Error('editor not found');
    }

    // "작성 중인 글 이어쓰기" 팝업 등은 취소하고 새 글로 시작
    for (const sel of ['.se-popup-button-cancel', 'button:has-text("취소")', '.se-help-panel-close-button']) {
        try { await frame.locator(sel).first().click({ timeout: 2500 }); } catch { /* 팝업 없음 */ }
    }

    // ── 6. 글을 이미지 경계로 조각내기 ──
    // 네이버 에디터는 붙여넣기 시 <img>를 버리므로, 이미지 위치마다 끊어서
    // [텍스트 조각 붙여넣기 → 사진 업로드] 를 반복해 원래 자리에 이미지를 넣는다.
    // 글 전체가 래퍼 div 하나에 싸여 있으므로, 이미지들을 문서 순서로 찾고
    // "이미지를 단독으로 감싼 블록"(예: <p><img></p>)을 경계로 삼는다.
    const imgSrcs = await src.evaluate(() => {
        let root = document.body;
        while (root.children.length === 1) root = root.children[0];
        window.__root = root;
        window.__blocks = [...root.querySelectorAll('img')].map(img => {
            let b = img;
            while (b.parentElement && b.parentElement !== root
                && b.parentElement.querySelectorAll('img').length === 1
                && (b.parentElement.textContent || '').replace(/ /g, ' ').trim().length < 5) {
                b = b.parentElement;
            }
            return b;
        });
        return window.__blocks.map(b => (b.matches('img') ? b : b.querySelector('img')).getAttribute('src'));
    });

    // i번째 이미지 블록 뒤 ~ j번째 이미지 블록 앞 구간을 클립보드에 복사 (내용 없으면 false)
    // 브라우저 선택-복사를 쓰면 컨테이너의 박스 스타일(테두리/그림자)까지 딸려 들어가
    // 에디터에 가로줄이 생기므로, 핵심 텍스트 스타일만 인라인한 정제 HTML을 직접 쓴다.
    const copyBetween = (i, j) => src.evaluate(async ([i, j]) => {
        const root = window.__root, blocks = window.__blocks;
        const kids = [...root.children];
        // 블록이 root 직속이 아니면 직속 조상 기준으로 경계를 잡는다
        const topIndex = (el) => {
            let n = el;
            while (n.parentElement && n.parentElement !== root) n = n.parentElement;
            return kids.indexOf(n);
        };
        const startIdx = i < 0 ? 0 : topIndex(blocks[i]) + 1;
        const endIdx = j >= blocks.length ? kids.length : topIndex(blocks[j]);
        const seg = kids.slice(startIdx, Math.max(startIdx, endIdx));
        if (!seg.length) return false;

        const inlineStyles = (srcEl, dstEl) => {
            const cs = getComputedStyle(srcEl);
            let style = '';
            for (const p of ['font-size', 'font-weight', 'color', 'text-align']) {
                style += `${p}:${cs.getPropertyValue(p)};`;
            }
            dstEl.setAttribute('style', style);
            dstEl.removeAttribute('class');
            [...srcEl.children].forEach((c, idx) => {
                if (dstEl.children[idx]) inlineStyles(c, dstEl.children[idx]);
            });
        };

        const container = document.createElement('div');
        for (const el of seg) {
            const clone = el.cloneNode(true);
            inlineStyles(el, clone);
            container.appendChild(clone);
        }
        const hasText = container.innerText.replace(/ /g, ' ').trim().length > 0;
        if (!hasText) return false;
        await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([container.innerHTML], { type: 'text/html' }),
            'text/plain': new Blob([container.innerText], { type: 'text/plain' }),
        })]);
        return true;
    }, [i, j]);

    // 커서를 본문 맨 끝으로
    const focusEnd = async () => {
        await frame.locator('.se-component.se-text .se-text-paragraph').last().click({ timeout: 8000 });
        await naver.keyboard.press('Control+End');
    };

    const uploadImage = async (relSrc) => {
        const file = path.join(PUBLIC_DIR, relSrc.replace(/\//g, path.sep));
        if (/^https?:/.test(relSrc) || !fs.existsSync(file)) {
            console.warn(`   ⏭️ 이미지 건너뜀 (파일 없음): ${relSrc}`);
            return false;
        }
        const before = await frame.locator('.se-component.se-image').count();
        const photoBtn = frame.locator('button[data-name="image"], .se-image-toolbar-button, button:has-text("사진")').first();
        const [chooser] = await Promise.all([
            naver.waitForEvent('filechooser', { timeout: 10000 }),
            photoBtn.click(),
        ]);
        await chooser.setFiles(file);
        // 업로드 완료(이미지 컴포넌트 증가) 대기
        for (let w = 0; w < 30; w++) {
            if (await frame.locator('.se-component.se-image').count() > before) break;
            await naver.waitForTimeout(500);
        }
        await naver.waitForTimeout(800);

        // 방금 넣은 이미지를 중앙 정렬
        try {
            const newImg = frame.locator('.se-component.se-image').last();
            await newImg.click({ timeout: 3000 });
            await naver.waitForTimeout(400);
            let aligned = false;
            for (const sel of [
                'button[data-name="align-center"]', 'button[data-value="center"]',
                '.se-toolbar-icon-align-center', 'button[title*="가운데"]', 'button[aria-label*="가운데"]',
            ]) {
                try { await frame.locator(sel).first().click({ timeout: 1200 }); aligned = true; break; } catch { /* 다음 후보 */ }
            }
            if (!aligned) await naver.keyboard.press('Control+Shift+E'); // SE 가운데 정렬 단축키
            await naver.keyboard.press('Escape');
            await naver.waitForTimeout(300);
        } catch { /* 정렬 실패는 치명적이지 않음 */ }
        return true;
    };

    let pasted = false;
    try {
        await frame.locator('.se-section-documentTitle').first().click({ timeout: 8000 });
        await naver.keyboard.type(title, { delay: 25 });

        await frame.locator('.se-component.se-text .se-text-paragraph').first().click({ timeout: 8000 });
        let imgOk = 0;
        // 조각 k = 이미지(k-1)와 이미지(k) 사이 텍스트 → 붙여넣고, 이어서 이미지(k) 업로드
        for (let k = 0; k <= imgSrcs.length; k++) {
            await src.bringToFront(); // 복사는 포커스된 탭에서만 동작
            const hasText = await copyBetween(k - 1, k);
            if (hasText) {
                await naver.bringToFront();
                await focusEnd();
                await naver.keyboard.press('Control+V');
                await naver.waitForTimeout(1500);
            }
            if (k < imgSrcs.length) {
                await naver.bringToFront();
                await focusEnd();
                if (await uploadImage(imgSrcs[k])) imgOk++;
            }
        }
        pasted = true;
        console.log(`✍️ 제목 + 본문 입력 완료 (이미지 ${imgOk}/${imgSrcs.length}장 첨부)`);
        if (imgOk < imgSrcs.length) console.log('   (건너뛴 이미지는 파일이 없는 항목입니다 — 보통 별도 제작하는 썸네일)');
    } catch (e) {
        console.warn(`⚠️ 자동 입력 실패 (${e.message.split('\n')[0]})`);
        console.warn('   에디터 본문을 클릭해 Ctrl+V로 마저 붙여넣거나, 다시 실행해주세요.');
        console.warn(`   카드 이미지 폴더: ${path.join(PUBLIC_DIR, 'blog-cards')}`);
    }

    // ── 7. 임시저장 (발행 아님) ──
    if (pasted) {
        try {
            await frame.locator('[class*="save_btn"], button:has-text("저장")').first().click({ timeout: 5000 });
            console.log('💾 임시저장 완료');
        } catch {
            console.warn('⚠️ 임시저장 버튼을 찾지 못했습니다 — 에디터 우측 상단 "저장"을 눌러주세요.');
        }
    }

    console.log('');
    console.log('👀 브라우저를 열어뒀습니다. 내용을 다듬은 뒤 직접 발행해주세요.');
    console.log('   (발행은 자동화하지 않습니다 — 창을 닫으면 스크립트가 종료됩니다)');
    context.on('close', () => finish(0));
    await new Promise(() => { /* 창이 닫힐 때까지 대기 */ });
} catch (e) {
    console.error('❌ 오류:', e.message.split('\n')[0]);
    console.error('   블로그 글 파일은 남아 있습니다:', path.relative(ROOT, postFile));
    await finish(1);
}
