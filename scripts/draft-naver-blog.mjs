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
    }
    await naver.waitForTimeout(4000);

    // 에디터는 mainFrame iframe 안에 있을 수도, 페이지 직속일 수도 있다
    const frame = (await naver.$('iframe#mainFrame')) ? naver.frameLocator('#mainFrame') : naver;

    // "작성 중인 글 이어쓰기" 팝업 등은 취소하고 새 글로 시작
    for (const sel of ['.se-popup-button-cancel', 'button:has-text("취소")', '.se-help-panel-close-button']) {
        try { await frame.locator(sel).first().click({ timeout: 2500 }); } catch { /* 팝업 없음 */ }
    }

    // ── 6. 제목 입력 + 본문 붙여넣기 ──
    let pasted = false;
    try {
        await frame.locator('.se-section-documentTitle').first().click({ timeout: 8000 });
        await naver.keyboard.type(title, { delay: 25 });

        await frame.locator('.se-component.se-text .se-text-paragraph').first().click({ timeout: 8000 });
        await naver.keyboard.press('Control+V');
        await naver.waitForTimeout(6000); // 이미지 처리 대기
        pasted = true;
        console.log('✍️ 제목 + 본문 입력 완료');
    } catch (e) {
        console.warn(`⚠️ 자동 입력 실패 (${e.message.split('\n')[0]})`);
        console.warn('   글이 클립보드에 있으니 에디터 본문을 클릭하고 Ctrl+V 해주세요.');
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
