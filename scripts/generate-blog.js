/**
 * generate-blog.js (v2)
 * 
 * all-flights-cache.json에서 Top 5 특가를 추출하여
 * 네이버 블로그에 복붙 가능한 HTML 파일을 자동 생성합니다.
 * 
 * v2 변경사항:
 * - 인천 출발 2개 이상 보장
 * - 트렌드 분석 → 항공권 팁 (매번 달라지는 내용)
 * - 벚꽃 시즌 뱃지 → 문맥 텍스트
 * - Playwright 카드 스크린샷 통합
 * 
 * Usage: node scripts/generate-blog.js
 * Output: public/blog-post-YYMMDD.html + public/blog-cards/*.png
 */

const fs = require('fs');
const path = require('path');

// ===== 설정 =====
const DATA_PATH = path.join(__dirname, '..', 'data', 'all-flights-cache.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'public');
const CARDS_DIR = path.join(OUTPUT_DIR, 'blog-cards');
const TOP_N = 5;
const MIN_INCHEON = 2;
const SITE_URL = 'https://tikitikit.kr';

// ===== 항공사명 정규화 =====
const AIRLINE_NAME_MAP = {
    '베트남 항공': '베트남항공',
    '비엣젯 항공': '비엣젯항공',
    '아시아나 항공': '아시아나항공',
    '에미레이트 항공': '에미레이트항공',
    '에어로케이항공': '에어로케이',
    '중화 항공': '중화항공',
    '타이 비엣젯 항공': '타이비엣젯항공',
    '타이 비엣젯항공': '타이비엣젯항공',
    '터키 항공': '터키항공',
    '티웨이 항공': '티웨이항공',
    '필리핀 항공': '필리핀항공',
    '에티하드 항공': '에티하드항공',
    '투르크메니스탄 항공': '투르크메니스탄항공',
    'Airasia': '에어아시아',
    'ANA항공': 'ANA',
    '홍콩에어': '홍콩항공',
};

function normalizeAirline(name) {
    if (!name) return name;
    const trimmed = name.trim();
    return AIRLINE_NAME_MAP[trimmed] || trimmed;
}

// ===== 도시명 정규화 (괄호 제거 + 이름 통일) =====
const CITY_NAME_MAP = {
    '서울': '인천',
    '푸껫': '푸켓',
    '청도': '칭다오',
    '오사카(간사이)': '오사카',
    '방콕(수완나폼)': '방콕',
    '나트랑(깜랑)': '나트랑',
    '하코다테(북해도)': '하코다테',
};

function normalizeCity(city) {
    if (!city) return '';
    // 먼저 원본 그대로 매핑 체크
    if (CITY_NAME_MAP[city]) return CITY_NAME_MAP[city];
    // 괄호 제거
    const stripped = city.replace(/\([^)]*\)/g, '').trim();
    // 괄호 제거 후 매핑 체크
    return CITY_NAME_MAP[stripped] || stripped;
}

// ===== 도시별 에디터 픽 텍스트 =====
const CITY_DESCRIPTIONS = {
    '칭다오': {
        emoji: '🍺',
        lines: [
            '칭다오 맥주의 본고장에서 생맥주 한 잔 🍺',
            '잔교(잔치아오)에서 야경 보며 해산물 한 상!',
        ],
        closing: '치맥 값으로 해외여행이죠.'
    },
    '청도': {
        emoji: '🍺',
        lines: [
            '칭다오 맥주의 본고장에서 생맥주 한 잔 🍺',
            '잔교에서 야경 보며 해산물 한 상!',
        ],
        closing: '비행 1시간 반이면 도착하는 가까운 해외.'
    },
    '후쿠오카': {
        emoji: '🍜',
        lines: [
            '하카타 라멘의 본고장에서 진짜 돈코츠 한 그릇 🍜',
            '텐진 거리에서 쇼핑하고 모츠나베까지!',
        ],
        closing: '라멘 값으로 일본 여행이죠.'
    },
    '오사카': {
        emoji: '🏯',
        lines: [
            '도톤보리에서 타코야끼 한 입 🏯',
            '오사카성 산책하고 신세카이에서 쿠시카츠까지!',
        ],
        closing: '먹방 여행의 성지, 놓치면 후회합니다.'
    },
    '도쿄': {
        emoji: '🗼',
        lines: [
            '시부야 스크램블에서 도쿄 감성 만끽 🗼',
            '아사쿠사 센소지부터 아키하바라까지!',
        ],
        closing: '도쿄의 모든 것을 이 가격에.'
    },
    '나가사키': {
        emoji: '⛪',
        lines: [
            '이국적인 나가사키 야경에 취하고 ⛪',
            '짬뽕의 원조를 맛보는 미식 여행!',
        ],
        closing: '숨은 보석 같은 도시를 만나보세요.'
    },
    '세부': {
        emoji: '🏝️',
        lines: [
            '에메랄드빛 바다에서 아일랜드 호핑 🏝️',
            '오슬롭 고래상어 투어까지 완벽 코스!',
        ],
        closing: '동남아 휴양의 정석이죠.'
    },
    '다낭': {
        emoji: '🌊',
        lines: [
            '미케 비치에서 여유롭게 🌊',
            '호이안 야시장에서 반미와 쌀국수 한 그릇!',
        ],
        closing: '가성비 최고의 휴양지입니다.'
    },
    '방콕': {
        emoji: '🛕',
        lines: [
            '왓아룬의 황금빛 야경에 감탄하고 🛕',
            '카오산 로드에서 패드타이 한 접시!',
        ],
        closing: '풍성한 먹거리와 문화가 기다립니다.'
    },
    '괌': {
        emoji: '🏖️',
        lines: [
            '투몬 비치에서 스노클링 🏖️',
            '차모로 빌리지 야시장에서 현지 음식 탐험!',
        ],
        closing: '비행 4시간이면 리조트 파라다이스.'
    },
    '사이판': {
        emoji: '🐠',
        lines: [
            '마나가하 섬에서 투명한 바다 속으로 🐠',
            '그로토 다이빙 포인트는 세계 TOP 급!',
        ],
        closing: '가족 여행으로도 최고의 선택.'
    },
    '보라카이': {
        emoji: '🌅',
        lines: [
            '화이트 비치에서 세계 최고의 석양을 🌅',
            '디몰에서 망고 스무디 한 잔이면 천국!',
        ],
        closing: '가성비 최강 동남아 휴양지.'
    },
    '타이페이': {
        emoji: '🧋',
        lines: [
            '스린 야시장에서 지파이 한 조각 🧋',
            '지우펀 골목에서 홍차 한 잔의 여유!',
        ],
        closing: '가까운 곳에서 만나는 미식 천국.'
    },
    '다카마쓰': {
        emoji: '🍡',
        lines: [
            '리쓰린 공원에서 일본 정원의 진수를 🍡',
            '사누키 우동의 본고장, 한 그릇에 감동!',
        ],
        closing: '숨겨진 일본 소도시 여행의 매력.'
    },
    '마츠야마': {
        emoji: '♨️',
        lines: [
            '도고 온천에서 3000년 역사의 힐링 ♨️',
            '미카와시마 전망대에서 세토내해 파노라마!',
        ],
        closing: '온천 여행의 끝판왕.'
    },
    '삿포로': {
        emoji: '⛷️',
        lines: [
            '파우더 스노우에서 겨울 스포츠를 ⛷️',
            '미소 라멘과 징기스칸 바비큐의 본고장!',
        ],
        closing: '겨울 여행의 로망이 이 가격에.'
    },
    '마닐라': {
        emoji: '🌆',
        lines: [
            '인트라무로스에서 스페인 식민지 역사 탐방 🌆',
            '말라떼 거리에서 필리핀 로컬 음식 도전!',
        ],
        closing: '세부/보라카이 경유지로도 최적.'
    },
};

// ===== 시즌/문맥 텍스트 (벚꽃 시즌 등) =====
const SEASON_CONTEXT = {
    // 일본 도시별 벚꽃 문맥
    '후쿠오카': '🌸 3월 말~4월 초 후쿠오카는 마이즈루 공원 벚꽃이 절정!\n하카타 라멘 + 벚꽃 산책, 꿀조합 🌸',
    '오사카': '🌸 3월 말~4월 초 오사카성 벚꽃이 만개하는 시기!\n도톤보리 야경 + 벚꽃 나들이, 완벽 코스 🌸',
    '도쿄': '🌸 3월 말~4월 초 우에노 공원 벚꽃 시즌!\n메구로가와 벚꽃길 산책 추천 🌸',
    '나가사키': '🌸 3월 말~4월 초 나가사키 평화공원 벚꽃이 절정!\n이국적인 거리 + 벚꽃, 감성 여행 🌸',
    '다카마쓰': '🌸 3월 말~4월 초 리쓰린 공원 벚꽃이 압권!\n사누키 우동 + 벚꽃 산책, 소도시 힐링 🌸',
    '마츠야마': '🌸 3월 말 마츠야마성 벚꽃 + 도고 온천 조합!\n세토내해 봄 풍경이 기다립니다 🌸',
    '삿포로': '🌸 삿포로 벚꽃은 5월 초! 일본에서 가장 늦은 벚꽃을 만나보세요 🌸',
    '기타큐슈': '🌸 3월 말 고쿠라성 벚꽃이 아름다운 시기!\n모지코 레트로 거리 산책 추천 🌸',
    '구마모토': '🌸 3월 말~4월 초 구마모토성 벚꽃이 절정!\n말고기 사시미와 함께하는 봄 여행 🌸',
};

// ===== 항공권 팁 풀 =====
const TIP_POOLS = {
    // 조건: 일본 노선이 있고 벚꽃 시즌일 때
    cherryBlossom: [
        '🌸 일본 벚꽃 시즌 TIP: 3월 말~4월 초가 절정! 규슈(후쿠오카·나가사키)가 가장 빨리 피고, 도쿄는 4월 초가 피크입니다.',
        '🌸 벚꽃 시즌 항공권은 2~3주 전에 풀리는 땡처리가 가장 저렴합니다. 지금이 딱 그 타이밍!',
        '🌸 벚꽃 시즌 꿀팁: 만개일 기준 1~2일 전에 도착하면 벚꽃 + 인파 피하기 둘 다 가능해요.',
    ],
    // 조건: 동남아 노선이 있을 때
    seAsia: [
        '🏖️ 동남아 여행 TIP: 3~5월은 건기에 해당하는 지역이 많아 여행 적기입니다!',
        '🏖️ 세부·보라카이·다낭은 3월이 수온도 따뜻하고 비도 적어 물놀이 최적기!',
        '🏖️ 동남아 땡처리 꿀팁: 주중 출발이 주말보다 평균 3~5만원 저렴합니다.',
    ],
    // 조건: 중국 노선이 있을 때
    china: [
        '🇨🇳 중국 여행 TIP: 칭다오·상하이 등은 3~5월이 여행 적기! 날씨도 좋고 성수기 전이라 저렴합니다.',
        '🇨🇳 중국 단거리 꿀팁: 비행 2시간 이내, 1박 2일도 가능한 가성비 목적지입니다.',
    ],
    // 조건: 지방 출발이 있을 때
    regional: [
        '✈️ 지방 공항 꿀팁: 부산·청주·대구 출발은 인천보다 평균 2~5만원 저렴하고, 주차비·교통비까지 절약!',
        '✈️ 지방 출발 TIP: 주변 공항에서 출발하면 공항 이동 시간만 2~3시간 세이브됩니다.',
        '✈️ 부산 김해공항은 일본·동남아 직항이 다양! 인천까지 안 가도 됩니다.',
    ],
    // 조건: 가격이 낮을 때 (15만원 이하)
    budget: [
        '💰 땡처리 가격 TIP: 왕복 15만원 이하면 국내 KTX 왕복보다 저렴한 가격입니다!',
        '💰 초특가 꿀팁: 이 가격대는 보통 출발 1~2주 전에만 풀립니다. 일정 맞으면 바로 예약!',
    ],
    // 일반 팁
    general: [
        '💡 땡처리 항공권은 여행사 미판매 좌석이라 가격이 파격적! 대신 날짜 변경이 어려울 수 있어요.',
        '💡 항공권 예약 TIP: 시간대별로 가격이 달라질 수 있어요. 오전보다 야간 편이 보통 저렴합니다.',
        '💡 수하물 TIP: 땡처리 항공권도 보통 15~20kg 수하물이 포함되어 있습니다. 상세 조건은 예약 시 확인!',
    ],
    // 태평양 리조트
    pacific: [
        '🏝️ 괌·사이판 TIP: 3~4시간 비행으로 리조트 휴양! 건기인 1~4월이 여행 최적기입니다.',
        '🏝️ 괌·사이판 꿀팁: 면세 쇼핑 + 해양 액티비티까지, 짧은 비행에 리조트 풀코스!',
    ],
};

// ===== 요일 이름 =====
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// ===== 메인 로직 =====
async function main() {
    // 1. 데이터 로드
    if (!fs.existsSync(DATA_PATH)) {
        console.error('❌ 캐시 파일을 찾을 수 없습니다:', DATA_PATH);
        console.error('   npm run crawl:all 을 먼저 실행하세요.');
        process.exit(1);
    }

    const cacheData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    let flights = cacheData.flights || [];
    console.log(`📦 총 ${flights.length}개 항공편 로드`);

    // 2. 항공사명 정규화
    flights = flights.map(f => ({
        ...f,
        airline: normalizeAirline(f.airline),
    }));

    // 3. 만료 항공편 제거 (출발일이 오늘 이전)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    flights = flights.filter(f => {
        if (!f.departure?.date) return false;
        const dateStr = f.departure.date.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return false;
        const depDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        return depDate >= today;
    });
    console.log(`✅ 유효 항공편: ${flights.length}개`);

    // 4. 중복 제거 (같은 노선+날짜+항공사 → 최저가만, 정규화된 도시명 기준)
    const dedupMap = new Map();
    for (const f of flights) {
        const depCity = normalizeCity(f.departure?.city);
        const arrCity = normalizeCity(f.arrival?.city);
        const key = `${depCity}|${arrCity}|${f.departure?.date}|${f.airline}`;
        const existing = dedupMap.get(key);
        if (!existing || f.price < existing.price) {
            dedupMap.set(key, f);
        }
    }
    flights = Array.from(dedupMap.values());
    console.log(`🔄 중복 제거 후: ${flights.length}개`);

    // 5. Top 5 선발 (인천 출발 2개+ 보장)
    flights.sort((a, b) => a.price - b.price);
    const topFlights = selectTop5WithIncheon(flights);

    if (topFlights.length === 0) {
        console.error('❌ 유효한 항공편이 없습니다.');
        process.exit(1);
    }

    console.log('\n🏆 Top 5 특가:');
    topFlights.forEach((f, i) => {
        const isICN = normalizeCity(f.departure?.city) === '인천' ? ' [인천]' : '';
        console.log(`  ${i + 1}위: ${f.departure?.city} → ${f.arrival?.city} | ${f.airline} | ${f.price.toLocaleString()}원${isICN}`);
    });

    // 6. 카드 스크린샷 촬영
    console.log('\n📸 카드 스크린샷 촬영 시작...');
    if (!fs.existsSync(CARDS_DIR)) {
        fs.mkdirSync(CARDS_DIR, { recursive: true });
    }

    // 인천 출발 중 Top 5에 포함되지 않은 것도 따로 수집
    const icnInTop5 = topFlights.filter(f => normalizeCity(f.departure?.city) === '인천');
    // 인천 출발 중 Top 5에 포함 안 된 추가 항공편 (최대 3개 더)
    const icnExtra = getExtraIncheonFlights(flights, topFlights, 3);
    const allIcnFlights = [...icnInTop5, ...icnExtra];

    const allScreenshotFlights = [...topFlights, ...icnExtra];
    await captureCardScreenshots(allScreenshotFlights, topFlights.length);

    // 7. HTML 생성
    const html = generateHTML(topFlights, allIcnFlights);

    // 8. 파일 저장
    const dateStr = formatDateForFilename(today);
    const filename = `blog-post-${dateStr}.html`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`\n✅ 블로그 포스트 생성 완료: ${outputPath}`);
    console.log(`🌐 http://localhost:3000/${filename}`);
}

// ===== Top 5 선발 (인천 2개+ 보장) =====
function selectTop5WithIncheon(sortedFlights) {
    const topFlights = [];
    const seenDests = new Set();

    // 1단계: 인천 출발 중 도착지 다양하게 2개 확보 (서울(ICN)도 인천으로 인식)
    const icnFlights = sortedFlights.filter(f => normalizeCity(f.departure?.city) === '인천');
    let icnCount = 0;
    for (const f of icnFlights) {
        const dest = normalizeCity(f.arrival?.city);
        if (seenDests.has(dest)) continue;
        seenDests.add(dest);
        topFlights.push(f);
        icnCount++;
        if (icnCount >= MIN_INCHEON) break;
    }

    // 2단계: 나머지 (TOP_N - icnCount)개를 전체에서 채움
    for (const f of sortedFlights) {
        if (topFlights.length >= TOP_N) break;
        const dest = normalizeCity(f.arrival?.city);
        if (seenDests.has(dest)) continue;
        seenDests.add(dest);
        topFlights.push(f);
    }

    // 3단계: 가격순 재정렬 
    topFlights.sort((a, b) => a.price - b.price);
    return topFlights;
}

// ===== 인천 추가 항공편 (Top 5 밖) =====
function getExtraIncheonFlights(allFlights, topFlights, maxExtra) {
    const topIds = new Set(topFlights.map(f => `${f.departure?.city}|${f.arrival?.city}|${f.departure?.date}|${f.airline}`));
    const topDests = new Set(topFlights.filter(f => normalizeCity(f.departure?.city) === '인천').map(f => normalizeCity(f.arrival?.city)));
    const extras = [];
    const seenDests = new Set(topDests);

    for (const f of allFlights) {
        if (extras.length >= maxExtra) break;
        if (normalizeCity(f.departure?.city) !== '인천') continue;
        const key = `${f.departure?.city}|${f.arrival?.city}|${f.departure?.date}|${f.airline}`;
        if (topIds.has(key)) continue;
        const dest = normalizeCity(f.arrival?.city);
        if (seenDests.has(dest)) continue;
        seenDests.add(dest);
        extras.push(f);
    }
    return extras;
}

// ===== 서버 상태 확인 =====
async function isServerRunning(url) {
    const http = url.startsWith('https') ? require('https') : require('http');
    return new Promise(resolve => {
        const req = http.get(url, () => resolve(true));
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

async function waitForServer(url, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isServerRunning(url)) return true;
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

// ===== 카드 스크린샷 (Playwright) =====
async function captureCardScreenshots(flights, top5Count) {
    let chromium;
    try {
        chromium = require('playwright').chromium;
    } catch (e) {
        console.warn('⚠️ Playwright가 설치되어 있지 않습니다. 카드 스크린샷을 건너뜁니다.');
        console.warn('   npm install playwright 로 설치하세요.');
        return;
    }

    // 서버가 실행 중인지 확인, 아니면 자동으로 시작
    let serverProcess = null;
    const localUrl = 'http://localhost:3000';
    let screenshotUrl = SITE_URL;

    const siteUp = await isServerRunning(SITE_URL);
    const localUp = await isServerRunning(localUrl);

    if (!siteUp && !localUp) {
        console.log('🚀 서버가 실행 중이 아닙니다. 자동으로 시작합니다...');
        const { spawn } = require('child_process');
        serverProcess = spawn('npm', ['run', 'dev'], {
            cwd: path.join(__dirname, '..'),
            stdio: 'pipe',
            shell: true
        });
        serverProcess.stderr.on('data', () => { }); // suppress output

        const ready = await waitForServer(localUrl, 60000);
        if (!ready) {
            console.error('❌ 서버 시작 실패 (60초 타임아웃). 스크린샷을 건너뜁니다.');
            serverProcess.kill();
            return;
        }
        console.log('✅ 서버 시작 완료');
        screenshotUrl = localUrl;
    } else if (localUp) {
        screenshotUrl = localUrl;
    }

    const browser = await chromium.launch();
    const MAX_RETRIES = 2;

    for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        const label = i < top5Count ? `rank_${i + 1}` : `icn_${i - top5Count + 1}`;
        console.log(`  📸 ${label}: ${f.departure?.city} → ${f.arrival?.city}`);

        let captured = false;
        for (let attempt = 0; attempt <= MAX_RETRIES && !captured; attempt++) {
            if (attempt > 0) console.log(`    🔄 재시도 ${attempt}/${MAX_RETRIES}...`);

            const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
            try {
                // 원본 항공편 데이터로 API mock
                await page.route('**/api/flights*', async route => {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            flights: [f],
                            lastUpdated: new Date().toISOString()
                        })
                    });
                });

                await page.goto(screenshotUrl, { waitUntil: 'networkidle', timeout: 20000 });
                await page.waitForTimeout(1500);

                // ① 날짜 필터 해제: 날짜 태그의 × 버튼 클릭 (setStartDate(''), setEndDate(''))
                try {
                    const dateTag = page.locator('span:has-text("~") button');
                    if (await dateTag.first().isVisible({ timeout: 2000 }).catch(() => false)) {
                        await dateTag.first().click();
                        await page.waitForTimeout(500);
                    }
                } catch (e) { /* 날짜 필터 없으면 무시 */ }

                // ② 출발지 필터 해제: '전체' 칩 클릭 (setDepartureFilter('all'))
                try {
                    const allChip = page.locator('button').filter({ hasText: '전체' }).first();
                    if (await allChip.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await allChip.click();
                        await page.waitForTimeout(1000);
                    }
                } catch (e) { /* 전체 칩 없으면 무시 */ }

                const cardLocator = page.locator('.card').first();
                await cardLocator.waitFor({ state: 'visible', timeout: 10000 });

                const savePath = path.join(CARDS_DIR, `${label}.png`);
                await cardLocator.screenshot({ path: savePath });
                console.log(`    ✅ ${label}.png 저장 완료`);
                captured = true;
            } catch (e) {
                console.error(`    ❌ ${label} 캡처 실패 (attempt ${attempt}):`, e.message?.split('\n')[0]);
            } finally {
                await page.close();
            }
        }

        if (!captured) {
            console.warn(`    ⚠️ ${label} 최종 실패 — HTML에 이미지 없이 생성됩니다.`);
        }
    }

    await browser.close();

    // 자동 시작한 서버 종료
    if (serverProcess) {
        console.log('🛑 자동 시작한 서버를 종료합니다...');
        serverProcess.kill();
    }
    console.log('📸 카드 스크린샷 완료');
}

// ===== 날짜 포맷 =====
function formatDateForFilename(date) {
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
}

function formatDateShort(dateStr) {
    const cleaned = dateStr.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
    const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return dateStr;
    const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayName = DAY_NAMES[d.getDay()];
    return `${month}/${day}(${dayName})`;
}

function formatDateRange(depDateStr, arrDateStr) {
    const cleanDate = (str) => {
        const cleaned = str.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
        const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    };
    const dep = cleanDate(depDateStr);
    const arr = cleanDate(arrDateStr);
    if (!dep || !arr) return '';
    return `${dep.getMonth() + 1}/${dep.getDate()}~${arr.getMonth() + 1}/${arr.getDate()}`;
}

function formatMonthDay(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ===== 여행일수 계산 =====
function calculateTripDuration(depDateStr, arrDateStr) {
    const parseDate = (str) => {
        const cleaned = str.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
        const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    };

    const dep = parseDate(depDateStr);
    const arr = parseDate(arrDateStr);
    if (!dep || !arr) return '';

    const diffMs = arr.getTime() - dep.getTime();
    const nights = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (nights <= 0) return '';

    const days = nights + 1;
    return `${nights}박 ${days}일`;
}

// ===== 가격 포맷 =====
function formatPrice(price) {
    return price.toLocaleString('ko-KR');
}

function formatPriceShort(price) {
    if (price >= 10000) {
        const man = Math.floor(price / 10000);
        const remainder = price % 10000;
        if (remainder === 0) return `${man}만원`;
        return `${man}만${formatPrice(remainder)}원`;
    }
    return `${formatPrice(price)}원`;
}

// ===== 순위 아이콘 =====
function getRankLabel(rank) {
    switch (rank) {
        case 1: return '🥇 1위';
        case 2: return '🥈 2위';
        case 3: return '🥉 3위';
        default: return `${rank}위`;
    }
}

// ===== 도시명 매칭 (괄호 포함 이름 처리) =====
function matchCityDescription(cityName) {
    if (!cityName) return null;
    if (CITY_DESCRIPTIONS[cityName]) return CITY_DESCRIPTIONS[cityName];
    for (const [key, desc] of Object.entries(CITY_DESCRIPTIONS)) {
        if (cityName.includes(key)) return desc;
    }
    return null;
}

// ===== 지역 분류 =====
function categorizeRegion(city) {
    const normalized = normalizeCity(city);
    const japan = ['도쿄', '오사카', '후쿠오카', '나고야', '삿포로', '나가사키', '다카마쓰', '마츠야마', '오키나와', '히로시마', '가고시마', '기타큐슈', '구마모토'];
    const seAsia = ['방콕', '다낭', '세부', '마닐라', '보라카이', '호치민', '하노이', '발리', '푸켓', '치앙마이', '싱가포르', '쿠알라룸푸르'];
    const china = ['칭다오', '상하이', '베이징', '광저우', '하얼빈', '다롄', '청도'];
    const taiwan = ['타이페이', '타이중', '가오슝'];
    const pacific = ['괌', '사이판', '하와이'];

    if (japan.some(c => normalized.includes(c))) return '일본';
    if (seAsia.some(c => normalized.includes(c))) return '동남아';
    if (china.some(c => normalized.includes(c))) return '중국';
    if (taiwan.some(c => normalized.includes(c))) return '대만';
    if (pacific.some(c => normalized.includes(c))) return '태평양';
    return '기타';
}

// ===== 벚꽃 시즌 체크 =====
function isCherryBlossomSeason(flight) {
    const city = normalizeCity(flight.arrival?.city || '');
    const region = categorizeRegion(city);
    if (region !== '일본') return false;

    const match = flight.departure?.date?.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return false;
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);

    // 삿포로는 5월 초
    if (city.includes('삿포로')) {
        return (month === 4 && day >= 25) || (month === 5 && day <= 10);
    }
    // 나머지 일본: 3월 20일 ~ 4월 15일
    return (month === 3 && day >= 20) || (month === 4 && day <= 15);
}

// ===== 시즌 문맥 텍스트 =====
function getSeasonContext(flight) {
    if (!isCherryBlossomSeason(flight)) return null;
    const city = normalizeCity(flight.arrival?.city || '');
    // 정확히 일치하는 도시명 찾기
    for (const [key, text] of Object.entries(SEASON_CONTEXT)) {
        if (city.includes(key)) return text;
    }
    // 일반 일본 벚꽃
    return `🌸 벚꽃 시즌 ${calculateTripDuration(flight.departure?.date, flight.arrival?.date)} 꿀조합!`;
}

// ===== 에디터 픽 생성 =====
function generateEditorPick(flight) {
    const city = flight.arrival?.city || '';
    const desc = matchCityDescription(city);
    const duration = calculateTripDuration(flight.departure?.date, flight.arrival?.date);
    const priceText = formatPriceShort(flight.price);

    let lines = [];
    lines.push(`<p>&nbsp;</p>`);
    lines.push(`<p><b>${flight.departure?.city}-${city} 왕복 ${formatPrice(flight.price)}원!</b></p>`);
    lines.push(`<p>&nbsp;</p>`);

    if (desc) {
        lines.push(`<p>${flight.airline} 직항으로</p>`);
        if (duration) lines.push(`<p>${duration} 알찬 일정입니다.</p>`);
        lines.push(`<p>&nbsp;</p>`);
        desc.lines.forEach(l => lines.push(`<p>${l}</p>`));
        lines.push(`<p>&nbsp;</p>`);
        lines.push(`<p>왕복 <b>${priceText}</b>에 이 정도면</p>`);
        lines.push(`<p>${desc.closing}</p>`);
    } else {
        lines.push(`<p>${flight.airline} 직항으로</p>`);
        if (duration) lines.push(`<p>${duration} 알찬 일정입니다.</p>`);
        lines.push(`<p>&nbsp;</p>`);
        lines.push(`<p>왕복 <b>${priceText}</b>이면</p>`);
        if (flight.price < 200000) {
            lines.push(`<p>KTX 왕복보다 싼 해외여행이에요.</p>`);
        } else if (flight.price < 300000) {
            lines.push(`<p>커피 몇 잔 값 아끼면 되는 여행이에요.</p>`);
        } else {
            lines.push(`<p>이 가격이면 꽤 괜찮은 딜이에요.</p>`);
        }
    }

    lines.push(`<p>&nbsp;</p>`);
    lines.push(`<p>다양한 일정이 열려 있으니</p>`);
    lines.push(`<p>마음에 드는 날짜를 골라보세요!</p>`);
    lines.push(`<p>&nbsp;</p>`);
    lines.push(`<p style="font-size: 14px; color: #999;">👉 다른 날짜도 궁금하다면 <a href="https://tikitikit.kr" style="color: #4f46e5;">tikitikit.kr</a>에서 확인해보세요.</p>`);

    return lines.join('\n            ');
}

// ===== 항공권 팁 생성 (매번 달라지는 내용) =====
function generateTips(topFlights) {
    const tips = [];
    const regions = topFlights.map(f => categorizeRegion(f.arrival?.city || ''));
    const hasCherryBlossom = topFlights.some(f => isCherryBlossomSeason(f));
    const hasRegional = topFlights.some(f => f.departure?.city !== '인천');
    const hasBudget = topFlights.some(f => f.price <= 150000);

    // 조건별로 관련 팁 풀에서 1개씩 랜덤 선택
    if (hasCherryBlossom && TIP_POOLS.cherryBlossom.length > 0) {
        tips.push(pickRandom(TIP_POOLS.cherryBlossom));
    }
    if (regions.includes('동남아') && TIP_POOLS.seAsia.length > 0) {
        tips.push(pickRandom(TIP_POOLS.seAsia));
    }
    if (regions.includes('중국') && TIP_POOLS.china.length > 0) {
        tips.push(pickRandom(TIP_POOLS.china));
    }
    if (regions.includes('태평양') && TIP_POOLS.pacific.length > 0) {
        tips.push(pickRandom(TIP_POOLS.pacific));
    }
    if (hasRegional && TIP_POOLS.regional.length > 0) {
        tips.push(pickRandom(TIP_POOLS.regional));
    }
    if (hasBudget && TIP_POOLS.budget.length > 0) {
        tips.push(pickRandom(TIP_POOLS.budget));
    }

    // 최소 1개, 최대 3개
    if (tips.length === 0) {
        tips.push(pickRandom(TIP_POOLS.general));
    }

    // 3개까지만
    const selected = tips.slice(0, 3);

    // 3개 미만이면 general에서 보충
    while (selected.length < 3 && TIP_POOLS.general.length > 0) {
        const tip = pickRandom(TIP_POOLS.general);
        if (!selected.includes(tip)) {
            selected.push(tip);
        } else {
            break; // 무한루프 방지
        }
    }

    return selected;
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ===== 인천 출발 한줄 코멘트 =====
function getIcnComment(flight) {
    const city = normalizeCity(flight.arrival?.city || '');
    const duration = calculateTripDuration(flight.departure?.date, flight.arrival?.date);
    const region = categorizeRegion(city);

    // 벚꽃 시즌이면 벚꽃 코멘트
    if (isCherryBlossomSeason(flight)) {
        return `🌸 벚꽃 시즌 ${duration}`;
    }

    const comments = {
        '괌': '비치 리조트 꿀조합!',
        '사이판': '투명 바다 힐링 여행!',
        '세부': '아일랜드 호핑 추천!',
        '다낭': '미케 비치 + 호이안 코스!',
        '방콕': '맛집 투어 완전정복!',
        '마닐라': '세부/보라카이 경유 가능!',
        '보라카이': '화이트 비치 꿀조합!',
    };

    const matched = Object.entries(comments).find(([key]) => city.includes(key));
    if (matched) return `${duration} ${matched[1]}`;

    if (region === '일본') return `${duration} 일본 소도시 여행!`;
    return `${duration} 가성비 여행!`;
}

// ===== HTML 생성 =====
function generateHTML(topFlights, allIcnFlights) {
    const now = new Date();
    const dateLabel = formatMonthDay(now);
    const first = topFlights[0];
    const second = topFlights[1];

    // 제목 생성 — 고정 앞부분 + 매번 바뀌는 후킹 서브타이틀
    const titleCity = (first.arrival?.city || '').replace(/\([^)]*\)/g, '').trim();
    const titlePrice = formatPriceShort(first.price);
    const titlePrefix = `[${dateLabel}] 땡처리 항공권 특가 Top 5 🔥`;

    // 데이터 기반 서브타이틀 후보 풀
    // 만원대 표기 (예: 15만원대, 20만원대)
    const priceRange = `${Math.floor(first.price / 10000)}만원대`;
    const subtitleCandidates = [
        `${titleCity} ${priceRange}!`,
        `오늘 최저가 ${priceRange} ${titleCity}`,
        `${titleCity} 왕복 ${priceRange} ✈️`,
    ];
    // 10만원대면 추가 후보
    if (first.price < 200000) {
        subtitleCandidates.push(`10만원대 해외여행 가능?!`);
        subtitleCandidates.push(`${titleCity} ${priceRange}이면 KTX보다 싸네`);
    }
    // 일본 도시 2개 이상이면
    const japanCount = topFlights.filter(f => ['일본'].includes(categorizeRegion(f.arrival?.city || ''))).length;
    if (japanCount >= 2) subtitleCandidates.push(`일본 특가 쏟아진다 ✈️`);
    // 동남아 있으면
    const seaCount = topFlights.filter(f => ['동남아'].includes(categorizeRegion(f.arrival?.city || ''))).length;
    if (seaCount >= 1) subtitleCandidates.push(`동남아 특가 터졌다 🌴`);

    // 날짜 기반 랜덤 선택 (같은 날이면 같은 결과)
    const dayHash = now.getDate() + now.getMonth() * 31;
    const subtitle = subtitleCandidates[dayHash % subtitleCandidates.length];
    const pageTitle = `${titlePrefix} ${subtitle}`;

    // 각 순위별 HTML 생성 (텍스트 + 이미지 + 시즌 코멘트)
    const rankSections = topFlights.map((f, i) => {
        const rank = i + 1;
        const depCity = f.departure?.city || '';
        const arrCity = f.arrival?.city || '';
        const country = categorizeRegion(arrCity);
        const countryLabel = country !== '기타' ? ` (${country})` : '';
        const depDate = formatDateShort(f.departure?.date || '');
        const arrDate = formatDateShort(f.arrival?.date || '');
        const duration = calculateTripDuration(f.departure?.date, f.arrival?.date);
        const durationText = duration ? ` · ${duration}` : '';

        // 벚꽃 시즌 텍스트 (뱃지 대신 문맥)
        const seasonCtx = getSeasonContext(f);
        const seasonText = seasonCtx
            ? `\n        <p>&nbsp;</p>\n        ${seasonCtx.split('\n').map(l => `<p>${l}</p>`).join('\n        ')}`
            : '';

        // 1위는 빨간 가격
        const priceColor = rank === 1 ? 'color: #e53e3e;' : '';

        // 4~5위도 한 줄 코멘트 추가 (시즌 코멘트가 없는 경우)
        let extraComment = '';
        if (!seasonCtx) {
            const desc = matchCityDescription(arrCity);
            if (desc) {
                extraComment = `\n        <p>&nbsp;</p>\n        <p>${desc.lines[0]}</p>`;
            }
        }

        return `
        <p>&nbsp;</p>
        <p>${getRankLabel(rank)}</p>
        <p><b>${depCity} ↔ ${arrCity}${countryLabel}</b></p>
        <p>${f.airline} · ${depDate}~${arrDate}${durationText}</p>
        <p style="font-size: 20px; font-weight: 800; ${priceColor}"><b>${formatPrice(f.price)}원</b></p>
        <p>&nbsp;</p>
        <p><img src="blog-cards/rank_${rank}.png" alt="${depCity}-${arrCity} 항공권" style="max-width: 100%; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></p>${seasonText}${extraComment}`;
    }).join('\n');

    // 에디터 픽 (날짜별 로테이션 — 매일 다른 항공편 픽)
    const pickIndex = dayHash % topFlights.length;
    const pickedFlight = topFlights[pickIndex];
    const editorPick = generateEditorPick(pickedFlight);

    // 인천 출발 섹션
    let icnSection = '';
    if (allIcnFlights.length > 0) {
        const icnItems = allIcnFlights.map((f, i) => {
            const city = f.arrival?.city || '';
            const dateRange = formatDateRange(f.departure?.date || '', f.arrival?.date || '');
            const comment = getIcnComment(f);
            // 카드 이미지: Top 5에 포함된 인천 항공편은 rank_N.png, 추가분은 icn_N.png
            const topIdx = topFlights.indexOf(f);
            const imgName = topIdx >= 0 ? `rank_${topIdx + 1}` : `icn_${i - topFlights.filter(tf => tf.departure?.city === '인천').length + 1}`;
            // 간단히: allIcnFlights 중에서의 인덱스 기반
            let imgSrc;
            const topFlightIdx = topFlights.findIndex(tf =>
                tf.departure?.city === f.departure?.city &&
                tf.arrival?.city === f.arrival?.city &&
                tf.departure?.date === f.departure?.date &&
                tf.airline === f.airline
            );
            if (topFlightIdx >= 0) {
                imgSrc = `blog-cards/rank_${topFlightIdx + 1}.png`;
            } else {
                // icn extra 중 몇 번째?
                const icnExtraIdx = allIcnFlights.filter((ef, ei) => ei < i && topFlights.findIndex(tf =>
                    tf.departure?.city === ef.departure?.city &&
                    tf.arrival?.city === ef.arrival?.city &&
                    tf.departure?.date === ef.departure?.date &&
                    tf.airline === ef.airline
                ) < 0).length;
                imgSrc = `blog-cards/icn_${icnExtraIdx + 1}.png`;
            }

            return `
        <p>&nbsp;</p>
        <p><img src="${imgSrc}" alt="인천-${city} 항공권" style="max-width: 100%; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></p>
        <p>&nbsp;</p>
        <p>✈️ <b>${city} ${formatPrice(f.price)}원</b> (${f.airline})</p>
        <p>${dateRange} · ${comment}</p>`;
        }).join('\n');

        icnSection = `
        <hr class="divider">

        <p class="section-title">📌 인천 출발은 뭐가 있을까?</p>

        <p>&nbsp;</p>
        <p>이번 인천 출발 최저가 라인업!</p>
        <p style="font-size: 13px; color: #999;">(<a href="https://tikitikit.kr" style="color: #999;">tikitikit.kr</a> 기준 실시간 최저가)</p>
${icnItems}`;
    }

    // 팁
    const tips = generateTips(topFlights);
    let tipSection = '';
    if (tips.length > 0) {
        const tipLines = tips.map(t => `            <p>${t}</p>`).join('\n');
        tipSection = `
        <hr class="divider">

        <div class="tip-box">
            <p><b>✨ 이번 주 항공권 꿀팁</b></p>
            <p>&nbsp;</p>
${tipLines}
        </div>`;
    }

    // 해시태그
    const cities = [...new Set(topFlights.map(f => f.arrival?.city).filter(Boolean))];
    const hashtags = [
        '#티키티킷', '#땡처리항공권', '#특가항공권',
        ...cities.map(c => `#${normalizeCity(c)}여행`),
        '#해외여행꿀팁'
    ].join(' ');

    // 인트로 스몰톡 (매일 바뀌는 자연스러운 인사)
    const dayOfWeek = now.getDay(); // 0=일 ~ 6=토
    const month = now.getMonth() + 1;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    const introPool = [
        // 요일별
        `<p>${dayNames[dayOfWeek]}요일이네요.</p>
        <p>이번 주 여행 계획 세우셨나요?</p>
        <p>&nbsp;</p>
        <p>오늘의 땡처리 특가 Top 5,</p>
        <p>같이 보시죠 👇</p>`,

        `<p>요새 항공권 보는 재미가 쏠쏠하네요 ✈️</p>
        <p>&nbsp;</p>
        <p>오늘도 괜찮은 가격이 꽤 있어서</p>
        <p>바로 정리해봤어요.</p>`,

        `<p>안녕하세요, 티키티킷입니다.</p>
        <p>&nbsp;</p>
        <p>매일 여행사 특가를 모아보는데</p>
        <p>오늘은 좀 괜찮은 것들이 보여서</p>
        <p>공유드려요 😊</p>`,

        `<p>혹시 다음 여행지 고민 중이신가요?</p>
        <p>&nbsp;</p>
        <p>오늘 올라온 특가 중에</p>
        <p>끌리는 게 있을지도 몰라요.</p>
        <p>한번 볼까요? 👇</p>`,

        `<p>항공권은 타이밍이더라고요.</p>
        <p>어제까지 없던 가격이 오늘 뜨기도 하고요.</p>
        <p>&nbsp;</p>
        <p>오늘의 특가 라인업 정리해봤습니다.</p>`,
    ];

    // 계절별 추가 후보
    if (month >= 3 && month <= 4) {
        introPool.push(`<p>벚꽃 시즌이 다가오고 있네요 🌸</p>
        <p>일본 쪽 특가가 많이 풀리는 시기라</p>
        <p>눈여겨볼 만한 것들이 있어요.</p>`);
    }
    if (month >= 6 && month <= 8) {
        introPool.push(`<p>여름 휴가 시즌!</p>
        <p>아직 항공권 안 잡으셨다면</p>
        <p>오늘 특가 한번 확인해보세요 🏖️</p>`);
    }
    if (month >= 11 || month <= 1) {
        introPool.push(`<p>연말 여행 생각만 해도 설레네요.</p>
        <p>따뜻한 곳으로 떠나고 싶은 계절이죠 ☀️</p>
        <p>&nbsp;</p>
        <p>오늘의 특가 정리해봤어요.</p>`);
    }

    const introSmallTalk = introPool[(dayHash + 3) % introPool.length];

    return `<!DOCTYPE html>
<html lang="ko">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Noto Sans KR', -apple-system, sans-serif;
            max-width: 720px;
            margin: 0 auto;
            padding: 40px 20px;
            background: #f5f5f5;
            color: #333;
            line-height: 2.2;
            font-size: 16px;
        }

        .post {
            background: white;
            padding: 40px 32px;
            border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            text-align: center;
        }

        .divider {
            border: none;
            border-top: 1px solid #e0e0e0;
            margin: 36px 0;
        }

        p {
            margin-bottom: 4px;
        }

        img {
            max-width: 100%;
            height: auto;
        }

        .section-title {
            font-size: 20px;
            font-weight: 700;
            color: #1a1a1a;
            margin: 36px 0 20px;
        }

        .tip-box {
            background: #f0f9ff;
            border-radius: 12px;
            padding: 24px;
            margin: 24px 0;
            text-align: left;
            border-left: 4px solid #3b82f6;
            line-height: 2.0;
        }

        .cta-link {
            display: inline-block;
            color: #4f46e5;
            text-decoration: underline;
            font-weight: bold;
            font-size: 18px;
            margin-top: 16px;
        }

        .note {
            font-size: 13px;
            color: #888;
            line-height: 1.8;
            margin-top: 30px;
        }

        .copy-guide {
            position: fixed;
            top: 12px;
            right: 12px;
            background: #1a1a1a;
            color: white;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            z-index: 100;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800&display=swap" rel="stylesheet">
</head>

<body>

    <div class="copy-guide">💡 Ctrl+A → Ctrl+C → 네이버 에디터에 Ctrl+V</div>

    <div class="post">

        <h1 style="text-align: center; font-size: 22px; font-weight: 800; color: #1a1a1a; margin: 16px 0 24px; line-height: 1.5;">${pageTitle}</h1>

        <p>&nbsp;</p>
${introSmallTalk}

        <hr class="divider">

        <p class="section-title">🏆 ${dateLabel} 기준 특가 Top 5</p>
${rankSections}

        <p>&nbsp;</p>
        <p style="font-size: 13px; color: #888;">※ 유류할증료/텍스 포함 왕복 총액 기준</p>
        <p style="font-size: 13px; color: #e53e3e; font-weight: bold;">※ 좌석이 빠지면 가격이 바뀌거나 사라질 수 있어요.</p>
        <p style="font-size: 13px; color: #999; margin-top: 8px;">*가격 데이터 출처: <a href="https://tikitikit.kr" style="color: #999;">티키티킷(tikitikit.kr)</a></p>

        <hr class="divider">

        <p class="section-title">💡 에디터 픽 : ${pickIndex + 1}위 ${pickedFlight.departure?.city}-${pickedFlight.arrival?.city}</p>

            ${editorPick}
${icnSection}
${tipSection}

        <hr class="divider">

        <p>&nbsp;</p>
        <p>오늘 소개한 특가 외에도</p>
        <p>매일 새로운 땡처리 항공권이 올라오고 있어요.</p>
        <p>&nbsp;</p>
        <p>혹시 원하는 날짜나 목적지가 따로 있다면</p>
        <p>한번 들러서 확인해보세요 😊</p>
        <p>&nbsp;</p>
        <p><a href="https://tikitikit.kr" class="cta-link">tikitikit.kr</a></p>

        <p class="note">${hashtags}</p>

    </div>
</body>

</html>`;
}

// ===== 실행 =====
main().catch(err => {
    console.error('❌ 오류 발생:', err);
    process.exit(1);
});
