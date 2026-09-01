/**
 * generate-blog.js (v2)
 * 
 * all-flights-cache.json에서 Top 3 특가를 추출하여
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
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'blog-history.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'public');
const CARDS_DIR = path.join(OUTPUT_DIR, 'blog-cards');
const TOP_N = 3;
const MIN_INCHEON = 2;
const MIN_REGIONAL = 1;
const SITE_URL = 'https://tikitikit.kr';
const PROD_API_URL = `${SITE_URL}/api/flights`;
const HISTORY_DAYS = 3; // 최근 N일 이내 포스트의 도시 중복 방지
const BLOG_SCORE_WEIGHTS = {
    price: 0.25,
    discount: 0.15,
    popularity: 0.20,
    convenience: 0.10,
    naver: 0.30,
};

function interparkDiscountRate(flight) {
    const airport = String(flight.departure?.airport || '').trim().toUpperCase();
    const seoulDeparture = airport === 'ICN' || airport === 'GMP'
        || (!/^[A-Z]{3}$/.test(airport)
            && /서울|인천|김포/.test(String(flight.departure?.city || '').replace(/\s+/g, '')));
    return seoulDeparture ? Math.max(0, flight.discountRate || 0) : 0;
}

// ===== 프로덕션 API에서 항공편 가져오기 =====
function fetchProductionFlights() {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const fetch = (url, redirects = 0) => {
            if (redirects > 3) return reject(new Error('리다이렉트 횟수 초과'));
            const req = https.get(url, { timeout: 15000 }, (res) => {
                // 리다이렉트 처리
                if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                    const redirectUrl = new URL(res.headers.location, url).href;
                    return fetch(redirectUrl, redirects + 1);
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`JSON 파싱 실패 (status: ${res.statusCode})`));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('타임아웃 (15초)')); });
        };
        fetch(PROD_API_URL);
    });
}

// ===== CLI 인자 파싱 (수동 오버라이드) =====
// 사용법:
//   node scripts/generate-blog.js --include 후쿠오카,세부   (강제 포함, 중복 제외 무시)
//   node scripts/generate-blog.js --exclude 칭다오          (강제 제외)
//   node scripts/generate-blog.js --include 후쿠오카 --exclude 칭다오
//   node scripts/generate-blog.js --local --preview-week [--date 2026-08-17]
function parseCliArgs() {
    const args = process.argv.slice(2);
    const result = { include: [], exclude: [], previewWeek: false, date: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--include' && args[i + 1]) {
            result.include = args[i + 1].split(',').map(s => s.trim());
            i++;
        } else if (args[i] === '--exclude' && args[i + 1]) {
            result.exclude = args[i + 1].split(',').map(s => s.trim());
            i++;
        } else if (args[i] === '--preview-week') {
            result.previewWeek = true;
        } else if (args[i] === '--date' && args[i + 1]) {
            result.date = args[i + 1];
            i++;
        }
    }
    return result;
}
const CLI_OVERRIDES = parseCliArgs();

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

// ===== 도시명 정규화 (이름 통일 + 복수공항 도시 보존) =====
const CITY_NAME_MAP = {
    '서울': '인천',
    '푸껫': '푸켓',
    '청도': '칭다오',
    '청도(칭다오)': '칭다오',
    '제남': '지난',
    '제남(지난)': '지난',
    '연태': '옌타이',
    '연태(옌타이)': '옌타이',
    '방콕(수완나폼)': '방콕',
    '나트랑(깜랑)': '나트랑',
    '하코다테(북해도)': '하코다테',
    '위해': '웨이하이',
    '위해(웨이하이)': '웨이하이',
    '타이페이': '타이베이',
    '대만': '타이베이',
    '상해': '상하이',
    '다카마츠': '다카마쓰',
    '삿포로(치토세)': '삿포로',
    '보라카이(KLO)': '보라카이',
    '칼리보': '보라카이',
    '칼리보(보라카이)': '보라카이',
    '오사카': '오사카(간사이)',
    '오사카(KIX)': '오사카(간사이)',
};

// 복수 공항 도시: 괄호를 제거하지 않고 원본 유지
const MULTI_AIRPORT_CITIES = ['도쿄', '오사카', '상하이'];

function normalizeCity(city) {
    if (!city) return '';
    // 먼저 원본 그대로 매핑 체크
    if (CITY_NAME_MAP[city]) return CITY_NAME_MAP[city];
    // 괄호가 있는 경우
    const match = city.match(/^(.+?)\((.+?)\)$/);
    if (match) {
        const baseName = match[1].trim();
        const mapped = CITY_NAME_MAP[baseName] || baseName;
        // 복수 공항 도시면 괄호 포함 원본 유지
        if (MULTI_AIRPORT_CITIES.includes(mapped)) {
            return `${mapped}(${match[2]})`;
        }
        // 그 외는 괄호 제거 후 매핑
        return CITY_NAME_MAP[baseName] || baseName;
    }
    return CITY_NAME_MAP[city] || city;
}

// ===== 표시용 도시명 (블로그 출력용) =====
const DISPLAY_NAME_MAP = {
    '연태(옌타이)': '옌타이',
    '제남(지난)': '지난',
    '청도(칭다오)': '칭다오',
    '위해(웨이하이)': '웨이하이',
};

function displayCity(rawCity) {
    if (!rawCity) return '';
    if (DISPLAY_NAME_MAP[rawCity]) return DISPLAY_NAME_MAP[rawCity];
    return normalizeCity(rawCity);
}

// ===== 도시별 에디터 픽 텍스트 =====
const CITY_DESCRIPTIONS = {
    '칭다오': {
        emoji: '🍺',
        variants: [
            { lines: ['칭다오 맥주의 본고장에서 생맥주 한 잔 🍺', '잔교(잔치아오)에서 야경 보며 해산물 한 상!'], closing: '치맥 값으로 해외여행이죠.' },
            { lines: ['해변 따라 독일풍 건물 산책 🍺', '칭다오 맥주 박물관에서 시음까지!'], closing: '비행 1시간 반이면 도착하는 가까운 해외.' },
            { lines: ['뚱카롱만한 조개구이에 칭다오 생맥주 한 잔 🍺', '라오산 절벽 위 풍경은 덤!'], closing: '주말 여행으로도 딱이에요.' },
            { lines: ['팔대관 이국풍 거리에서 산책하고 🏛️', '피칭루 바에서 칭다오 생맥주 한 모금!'], closing: '가까운 중국 해변 도시의 매력.' },
            { lines: ['잔교 야경 아래 해산물 한 상 🦀', '맥주 박물관에서 A·B라인 비교 시음까지!'], closing: '맥주 좋아하면 무조건 칭다오.' },
            { lines: ['중산루 거리에서 현지 간식 투어 🍢', '올림픽 요트센터에서 바다 뷰 감상!'], closing: '비행 짧고 물가 착한 근거리 여행.' },
        ],
    },
    '청도': {
        emoji: '🍺',
        variants: [
            { lines: ['칭다오 맥주의 본고장에서 생맥주 한 잔 🍺', '잔교에서 야경 보며 해산물 한 상!'], closing: '비행 1시간 반이면 도착하는 가까운 해외.' },
            { lines: ['독일풍 거리를 거닐며 맥주 한 모금 🍻', '팔대관 이국풍 건축물 산책까지!'], closing: '주말 여행으로도 딱이에요.' },
        ],
    },
    '후쿠오카': {
        emoji: '🍜',
        variants: [
            { lines: ['하카타 라멘의 본고장에서 진짜 돈코츠 한 그릇 🍜', '텐진 거리에서 쇼핑하고 모츠나베까지!'], closing: '라멘 값으로 일본 여행이죠.' },
            { lines: ['나카스 야타이 거리에서 현지인처럼 한 잔 🍶', '오호리 공원 산책하며 여유로운 하루!'], closing: '가까운 일본, 부담 없이 다녀오세요.' },
            { lines: ['캐널시티에서 쇼핑하고 🛍️', '야나가와 뱃놀이로 소도시 감성까지!'], closing: '당일치기도 가능한 가까운 일본.' },
            { lines: ['텐진 야타이에서 라멘 한 그릇 🍜', '다자이후 텐만구 산책은 필수 코스!'], closing: '먹방+감성 두 마리 토끼.' },
            { lines: ['모츠나베 한 냄비에 소주 한 잔 🍶', '하카타 리버레인에서 강변 산책까지!'], closing: '편한 일본 여행의 정석.' },
            { lines: ['이치란 본점에서 원조 라멘 도전 🍜', '마린월드에서 해양생물 구경까지!'], closing: '미식+관광 조합 최고.' },
        ],
    },
    '오사카': {
        emoji: '🏯',
        variants: [
            { lines: ['도톤보리에서 타코야끼 한 입 🏯', '오사카성 산책하고 신세카이에서 쿠시카츠까지!'], closing: '먹방 여행의 성지, 놓치면 후회합니다.' },
            { lines: ['구로몬 시장에서 해산물 폭격 🦀', '난바에서 쇼핑하고 츠텐카쿠 야경까지!'], closing: '오사카는 먹을수록 빠져드는 도시.' },
            { lines: ['유니버설 스튜디오에서 하루 종일 🎢', '우메다 스카이빌딩 전망도 놓치지 마세요!'], closing: '맛+놀이 다 되는 도시입니다.' },
        ],
    },
    '도쿄': {
        emoji: '🗼',
        variants: [
            { lines: ['시부야 스크램블에서 도쿄 감성 만끽 🗼', '아사쿠사 센소지부터 아키하바라까지!'], closing: '도쿄의 모든 것을 이 가격에.' },
            { lines: ['츠키지 외시장에서 초밥 한 접시 🍣', '하라주쿠에서 트렌디한 도쿄 만끽!'], closing: '도쿄는 갈 때마다 새로운 도시.' },
            { lines: ['신주쿠 고엔에서 도심 속 힐링 🌳', '오모테산도에서 카페 투어까지!'], closing: '이 가격에 도쿄라니, 놓칠 수 없죠.' },
        ],
    },
    '나가사키': {
        emoji: '⛪',
        variants: [
            { lines: ['이국적인 나가사키 야경에 취하고 ⛪', '짬뽕의 원조를 맛보는 미식 여행!'], closing: '숨은 보석 같은 도시를 만나보세요.' },
            { lines: ['이나사야마 전망대에서 세계 3대 야경 감상 🌃', '히라도에서 역사 산책까지!'], closing: '관광객 적은 숨은 명소.' },
        ],
    },
    '세부': {
        emoji: '🏝️',
        variants: [
            { lines: ['에메랄드빛 바다에서 아일랜드 호핑 🏝️', '오슬롭 고래상어 투어까지 완벽 코스!'], closing: '동남아 휴양의 정석이죠.' },
            { lines: ['막탄 해변에서 다이빙 입문 🤿', '세부 시내 망고스트리트에서 BBQ까지!'], closing: '바다+맛집 조합 최고.' },
        ],
    },
    '다낭': {
        emoji: '🌊',
        variants: [
            { lines: ['미케 비치에서 여유롭게 🌊', '호이안 야시장에서 반미와 쌀국수 한 그릇!'], closing: '가성비 최고의 휴양지입니다.' },
            { lines: ['바나힐 골든브릿지에서 인생샷 📸', '한시장에서 현지 해산물 실컷!'], closing: '가성비 끝판왕 여행지.' },
        ],
    },
    '방콕': {
        emoji: '🛕',
        variants: [
            { lines: ['왓아룬의 황금빛 야경에 감탄하고 🛕', '카오산 로드에서 패드타이 한 접시!'], closing: '풍성한 먹거리와 문화가 기다립니다.' },
            { lines: ['짜뚜짝 주말시장에서 쇼핑 대폭발 🛍️', '루프탑 바에서 방콕 야경 한 잔!'], closing: '가격 대비 만족도 최고.' },
        ],
    },
    '괌': {
        emoji: '🏖️',
        variants: [
            { lines: ['투몬 비치에서 스노클링 🏖️', '차모로 빌리지 야시장에서 현지 음식 탐험!'], closing: '비행 4시간이면 리조트 파라다이스.' },
            { lines: ['투몬 베이에서 선셋 카약 🌅', '마이크로네시아 몰에서 면세 쇼핑까지!'], closing: '짧은 비행, 긴 휴식.' },
        ],
    },
    '사이판': {
        emoji: '🐠',
        variants: [
            { lines: ['마나가하 섬에서 투명한 바다 속으로 🐠', '그로토 다이빙 포인트는 세계 TOP 급!'], closing: '가족 여행으로도 최고의 선택.' },
            { lines: ['버드 아일랜드에서 일출 감상 🌄', '마이크로 비치에서 한가로운 오후!'], closing: '3시간 반이면 천국 도착.' },
        ],
    },
    '보라카이': {
        emoji: '🌅',
        variants: [
            { lines: ['화이트 비치에서 세계 최고의 석양을 🌅', '디몰에서 망고 스무디 한 잔이면 천국!'], closing: '가성비 최강 동남아 휴양지.' },
            { lines: ['풀라 비치에서 고요한 바다 만끽 🐚', '아리엘스 포인트에서 클리프 다이빙 도전!'], closing: '인생 비치를 만나보세요.' },
        ],
    },
    '타이페이': {
        emoji: '🧋',
        variants: [
            { lines: ['스린 야시장에서 지파이 한 조각 🧋', '지우펀 골목에서 홍차 한 잔의 여유!'], closing: '가까운 곳에서 만나는 미식 천국.' },
            { lines: ['용산사에서 소원 빌고 🏮', '시먼딩 거리에서 대만 로컬 간식 탐험!'], closing: '2시간 반이면 미식의 나라.' },
        ],
    },
    '다카마쓰': {
        emoji: '🍡',
        variants: [
            { lines: ['리쓰린 공원에서 일본 정원의 진수를 🍡', '사누키 우동의 본고장, 한 그릇에 감동!'], closing: '숨겨진 일본 소도시 여행의 매력.' },
            { lines: ['나오시마 섬에서 예술 산책 🎨', '세토내해 바다를 바라보며 우동 한 그릇!'], closing: '조용한 힐링 여행의 정석.' },
        ],
    },
    '마츠야마': {
        emoji: '♨️',
        variants: [
            { lines: ['도고 온천에서 3000년 역사의 힐링 ♨️', '미카와시마 전망대에서 세토내해 파노라마!'], closing: '온천 여행의 끝판왕.' },
            { lines: ['마츠야마성에서 시코쿠 풍경 한눈에 🏯', '도고 상점가에서 감귤 디저트까지!'], closing: '온천+역사+맛집 풀코스.' },
        ],
    },
    '삿포로': {
        emoji: '🍜',
        variants: [
            { lines: ['오도리 공원에서 여유로운 산책 🌲', '니조 시장에서 신선한 해산물 덮밥 한 그릇!'], closing: '사계절 매력 있는 홋카이도의 수도.' },
            { lines: ['미소 라멘과 스프카레의 본고장 🍜', '다누키코지 상점가에서 현지 먹거리 탐방!'], closing: '먹방 여행으로 삿포로만 한 곳이 없어요.' },
            { lines: ['삿포로 맥주 박물관에서 시음 한 잔 🍺', '오타루 운하에서 감성 산책까지!'], closing: '도시+소도시 조합으로 알찬 여행.' },
        ],
    },
    '마닐라': {
        emoji: '🌆',
        variants: [
            { lines: ['인트라무로스에서 스페인 식민지 역사 탐방 🌆', '말라떼 거리에서 필리핀 로컬 음식 도전!'], closing: '세부/보라카이 경유지로도 최적.' },
            { lines: ['마닐라 베이에서 황금빛 선셋 🌅', 'SM 몰에서 가성비 쇼핑까지!'], closing: '동남아 허브 도시의 매력.' },
        ],
    },
    '시즈오카': {
        emoji: '♨️',
        variants: [
            { lines: ['후지산이 보이는 온천의 도시 ♨️', '녹차 산지에서 말차 디저트까지!'], closing: '후지산을 가장 가까이서 보는 여행.' },
            { lines: ['미호노마쓰바라 해변에서 후지산 한 눈에 🗻', '시즈오카 오뎅으로 현지인 맛집 투어!'], closing: '관광객 적은 일본 소도시 힐링.' },
        ],
    },
    '지난': {
        emoji: '⛲',
        variants: [
            { lines: ['천하제일의 샘, 바오투취안 공원 ⛲', '대명호 산책하며 여유로운 하루!'], closing: '중국 역사와 자연이 어우러진 도시.' },
            { lines: ['제남 구시가지에서 거리 음식 탐방 🍜', '천포 광장에서 현지 문화 체험!'], closing: '가성비 좋은 중국 소도시 여행.' },
            { lines: ['대명호 야경 산책에 산동 만두까지 🥟', '여유롭게 즐기는 소도시 감성!'], closing: '비행 짧고 물가 착한 최적의 여행지.' },
            { lines: ['취안청 광장에서 분수 쇼 감상 ⛲', '산동 가정식 한 상으로 현지 맛 체험!'], closing: '관광객 적은 중국 소도시의 매력.' },
            { lines: ['흑호천 야시장에서 산동 간식 투어 🍡', '천불산 하이킹으로 도시 전경 감상!'], closing: '먹거리와 자연 둘 다 만족.' },
        ],
    },
    '옌타이': {
        emoji: '🌊',
        variants: [
            { lines: ['옌타이 해변에서 해풍 맞으며 산책 🌊', '봉래각에서 신선의 전설을 만나보세요!'], closing: '비행 1시간 반, 가까운 중국 바닷가.' },
            { lines: ['장위포 해수욕장에서 여유로운 시간 🏖️', '현지 해산물 시장에서 해물 잔치!'], closing: '가성비 좋은 중국 해안 도시.' },
        ],
    },
    '푸꾸옥': {
        emoji: '🏝️',
        variants: [
            { lines: ['베트남의 몰디브, 푸꾸옥 🏝️', '에메랄드빛 바다에서 스노클링하고 야시장에서 해산물 폭격!'], closing: '동남아 숨은 보석 같은 섬.' },
            { lines: ['롱비치에서 선셋 보며 칵테일 한 잔 🌅', '사오 비치의 하얀 모래밭은 인생샷 명소!'], closing: '리조트+자연이 완벽 조화.' },
        ],
    },
    '웨이하이': {
        emoji: '🏖️',
        variants: [
            { lines: ['한국에서 가장 가까운 중국 해변 도시 🏖️', '류공다오 섬에서 바다 뷰 감상하고 해산물 한 상!'], closing: '비행 1시간, 당일치기도 가능한 거리.' },
            { lines: ['웨이하이 국제해수욕장에서 여유로운 오후 🌊', '해선루에서 현지식 해물 요리 도전!'], closing: '가성비 갑 중국 해안 소도시.' },
        ],
    },
    '위해': {
        emoji: '🏖️',
        variants: [
            { lines: ['한국에서 가장 가까운 중국 해변 도시 🏖️', '류공다오 섬에서 바다 뷰 감상하고 해산물 한 상!'], closing: '비행 1시간, 당일치기도 가능한 거리.' },
        ],
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

const TIP_POOLS = {
    // 조건: 일본 노선이 있고 벚꽃 시즌일 때
    cherryBlossom: [
        '🌸 일본 벚꽃 시즌 TIP: 3월 말~4월 초가 절정! 규슈(후쿠오카·나가사키)가 가장 빨리 피고, 도쿄는 4월 초가 피크입니다.',
        '🌸 벚꽃 시즌 항공권은 2~3주 전에 풀리는 땡처리가 가장 저렴합니다. 지금이 딱 그 타이밍!',
        '🌸 벚꽃 시즌 꿀팁: 만개일 기준 1~2일 전에 도착하면 벚꽃 + 인파 피하기 둘 다 가능해요.',
        '🌸 벚꽃 명소 추천: 오사카성 공원, 후쿠오카 마이즈루 공원, 도쿄 우에노 공원은 무료 입장!',
        '🌸 벚꽃 시즌 숙소는 1달 전에 마감됩니다. 항공권 잡으면 숙소부터 바로 예약하세요.',
    ],
    // 조건: 동남아 노선이 있을 때
    seAsia: [
        '🏖️ 동남아 여행 TIP: 3~5월은 건기에 해당하는 지역이 많아 여행 적기입니다!',
        '🏖️ 세부·보라카이·다낭은 3월이 수온도 따뜻하고 비도 적어 물놀이 최적기!',
        '🐋 세부는 3월이 건기 + 고래상어 시즌! 오슬롭 투어 가기 좋은 시기예요.',
        '🏖️ 동남아 숙소 TIP: 에어비앤비보다 호텔 예약앱(아고다 등)이 동남아에서는 더 저렴한 경우가 많아요.',
        '💆 태국 마사지는 관광지보다 골목 안쪽이 절반 가격! 구글맵 리뷰 4점 이상이면 OK.',
        '🍜 동남아 현지 맛집은 그랩(Grab) 앱에서 "GrabFood 인기 메뉴"로 찾으면 실패 없어요.',
    ],
    // 조건: 중국 노선이 있을 때
    china: [
        '🛂 중국 단기 여행은 무비자 입국 가능(15일 이내). 여권만 챙기세요!',
        '🇨🇳 중국 현지 결제는 알리페이/위챗페이가 필수! 출발 전 앱 설정해두세요.',
        '🍺 칭다오 맥주박물관은 입장료에 생맥주 시음 포함! 택시비도 기본 3천원대로 저렴합니다.',
        '🇨🇳 중국 인터넷: 카톡/구글이 차단되니 VPN 앱을 출발 전에 미리 설치하세요.',
        '🇨🇳 중국 단거리 꿀팁: 비행 2시간 이내, 물가도 저렴해서 주말 여행으로도 충분해요.',
    ],
    // 조건: 지방 출발이 있을 때
    regional: [
        '✈️ 지방 출발 TIP: 부산·청주·대구는 공항 접근성이 좋고 주차도 저렴해서 총비용이 더 싸요.',
        '✈️ 청주공항 장기주차장은 하루 6천원! 인천공항 대비 절반 수준이에요.',
        '✈️ 김해공항 국제선은 KTX 부산역에서 경전철 30분! 서울에서 접근도 의외로 괜찮아요.',
        '✈️ 지방 출발은 공항 인파도 적어서 체크인·보안검색이 훨씬 빠릅니다.',
    ],
    // 조건: 가격이 낮을 때 (15만원 이하)
    budget: [
        '💰 왕복 15만원 이하면 국내 KTX 왕복보다 저렴한 해외여행이에요!',
        '💰 초특가 꿀팁: 이 가격대는 보통 출발 1~2주 전에만 잠깐 풀립니다. 보이면 바로!',
        '💰 초특가 항공권은 날짜 변경이 어려울 수 있으니, 일정 확정 후 예약하세요.',
    ],
    // 일반 팁
    general: [
        '💡 3월 특가는 출발 1~2주 전에 가장 많이 풀립니다. 지금이 타이밍!',
        '💡 항공권 예약 TIP: 같은 노선도 시간대별로 가격 차이가 큽니다. 새벽·야간편이 보통 저렴해요.',
        '💡 수하물 TIP: 땡처리 항공권도 보통 15~20kg 수하물 포함! 상세 조건은 예약 시 확인.',
        '💡 여행자보험은 출발 당일까지 가입 가능! 카드사 무료 보험도 꼭 확인해보세요.',
        '💡 환전 TIP: 공항보다 시중은행 온라인 환전이 평균 1~2% 더 유리합니다.',
        '💡 공항 면세점보다 시내 면세점이 더 저렴한 경우가 많아요. 미리 온라인 주문하면 공항 픽업도 가능!',
        '💡 항공권 알림 TIP: 원하는 노선과 가격을 설정해두면 알림을 받을 수 있어요.',
        '💡 출발 3일 전 체크인 오픈! 미리 좌석 선택하면 좋은 자리 선점 가능.',
        '💡 공항 라운지 TIP: PP카드 없어도 네이버페이로 5천원대 라운지 이용 가능한 곳도 있어요.',
        '💡 해외 데이터 TIP: 공항 로밍보다 이심(eSIM)이 평균 30~50% 저렴합니다.',
        '💡 좌석 TIP: 비상구 좌석은 사전 구매가 유료지만, 체크인 때 남아있으면 무료로 배정되기도 해요.',
        '💡 환율 TIP: 트래블월렛·트래블로그 같은 선불카드를 쓰면 수수료 없이 현지 결제 가능!',
        '💡 짐 꿀팁: 압축팩 쓰면 기내용 캐리어에 3박치 옷 거뜬히 들어갑니다.',
        '💡 현지 교통 TIP: 구글맵으로 대중교통 검색하면 현지 버스·지하철 노선까지 한눈에!',
        '💡 출입국 TIP: 자동출입국 등록하면 공항에서 줄 안 서고 바로 통과!',
    ],
    // 태평양 리조트
    pacific: [
        '🏝️ 괌은 한국어 메뉴판 있는 식당이 많아서 가족여행에 최적!',
        '🏝️ 괌·사이판 꿀팁: 면세 쇼핑 + 해양 액티비티까지, 짧은 비행에 리조트 풀코스!',
        '🏝️ 괌 렌터카는 국제면허 없이 한국 면허증으로 바로 가능! 자유여행 강추.',
    ],
};

// ===== 요일 이름 =====
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

// ===== 메인 로직 =====
async function main() {
    // 1. 데이터 로드 (프로덕션 API 우선 → 로컬 캐시 폴백)
    let flights = [];
    let dataSource = '';

    // --local 플래그가 있으면 로컬 캐시 강제 사용
    const forceLocal = process.argv.includes('--local');

    if (!forceLocal) {
        try {
            console.log('🌐 프로덕션 API에서 데이터 가져오는 중...');
            const prodData = await fetchProductionFlights();
            flights = prodData.flights || [];
            dataSource = '프로덕션 API';
            console.log(`✅ 프로덕션 API에서 ${flights.length}개 항공편 로드`);
        } catch (e) {
            console.warn(`⚠️ 프로덕션 API 실패: ${e.message}`);
        }
    }

    // 프로덕션 실패 시 로컬 캐시 폴백
    if (flights.length === 0) {
        if (!fs.existsSync(DATA_PATH)) {
            console.error('❌ 캐시 파일을 찾을 수 없습니다:', DATA_PATH);
            console.error('   npm run crawl:all 을 먼저 실행하세요.');
            process.exit(1);
        }
        const cacheData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
        flights = cacheData.flights || [];
        dataSource = '로컬 캐시';
        console.log(`📦 로컬 캐시에서 ${flights.length}개 항공편 로드`);
    }

    console.log(`📊 데이터 소스: ${dataSource}`);

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

    // 5. 이전 글 히스토리 로드
    let recentDests = loadRecentDests();

    // CLI 수동 오버라이드 적용
    if (CLI_OVERRIDES.exclude.length > 0) {
        recentDests = [...new Set([...recentDests, ...CLI_OVERRIDES.exclude])];
        console.log(`🚫 수동 제외: ${CLI_OVERRIDES.exclude.join(', ')}`);
    }
    if (CLI_OVERRIDES.include.length > 0) {
        recentDests = recentDests.filter(d => !CLI_OVERRIDES.include.includes(d));
        console.log(`✅ 수동 포함 (중복 제외 면제): ${CLI_OVERRIDES.include.join(', ')}`);
    }

    if (recentDests.length > 0) {
        console.log(`🔄 최근 ${HISTORY_DAYS}일 이내 포스트 도시 (제외 대상): ${recentDests.join(', ')}`);
    }
    // 5.5 가격 하락 감지 — 최근 노선도 가격이 크게 내리면 중복 제외에서 면제
    const priceDropDests = findPriceDropFlights(flights);
    if (priceDropDests.length > 0) {
        console.log(`📉 가격 하락 감지 (최근 중복 제외 면제): ${priceDropDests.map(d => `${d.dest} ${d.prevPrice.toLocaleString()}→${d.currPrice.toLocaleString()}원`).join(', ')}`);
    }
    const priceDropDestNames = priceDropDests.map(d => d.dest);

    // 6. Top 3 선발 (종합점수 + 지방/수도권 출발 보장 + 중복 방지)
    const rankedFlights = rankBlogFlights(flights);

    if (CLI_OVERRIDES.previewWeek) {
        const requestedStartDate = parsePreviewDate(CLI_OVERRIDES.date);
        previewThemeWeek(rankedFlights, recentDests, priceDropDestNames, requestedStartDate);
        return;
    }

    const topFlights = selectTopWithIncheon(rankedFlights, recentDests, priceDropDestNames);

    if (topFlights.length === 0) {
        console.error('❌ 유효한 항공편이 없습니다.');
        process.exit(1);
    }

    console.log('\n🏆 Top 3 특가:');
    topFlights.forEach((f, i) => {
        const isICN = (normalizeCity(f.departure?.city) === '인천' || normalizeCity(f.departure?.city) === '김포') ? ' [수도권]' : '';
        const dropInfo = priceDropDestNames.includes(normalizeCity(f.arrival?.city)) ? ' 📉하락' : '';
        const score = f.blogScore;
        console.log(
            `  ${i + 1}위: ${f.departure?.city} → ${f.arrival?.city} | ${f.airline} | ${f.price.toLocaleString()}원${isICN}${dropInfo}`
            + (score ? ` | ${score.totalScore.toFixed(1)}점 (가격 ${score.priceScore.toFixed(0)} · 할인 ${score.discountScore.toFixed(0)}`
                + ` · 인기 ${score.popularityScore.toFixed(0)} · 편의 ${score.convenienceScore.toFixed(0)} · 네이버 ${score.naverScore.toFixed(0)})` : '')
        );
    });

    if (process.env.BLOG_SELECTION_DRY_RUN === '1') {
        console.log('\n✅ BLOG_SELECTION_DRY_RUN: 선정 검증만 완료');
        return;
    }

    // 6. 카드 스크린샷 촬영
    console.log('\n📸 카드 스크린샷 촬영 시작...');
    if (!fs.existsSync(CARDS_DIR)) {
        fs.mkdirSync(CARDS_DIR, { recursive: true });
    }

    // 인천 출발 섹션: Top 3·최근 도시와 중복 없이 가격·할인율·인기도 종합 상위 3개
    const ICN_SECTION_TOTAL = 3;
    const icnExtra = getExtraIncheonFlights(flights, topFlights, ICN_SECTION_TOTAL, recentDests);
    const allIcnFlights = icnExtra;

    const allScreenshotFlights = [...topFlights, ...icnExtra];
    await captureCardScreenshots(allScreenshotFlights, topFlights.length);

    // 6.5. 에디터 픽 도시의 무료 이미지 다운로드 (Unsplash)
    // generateHTML의 pickIndex(dayHash % length)와 동일한 계산으로 도시를 미리 알아낸다.
    const nowForPick = new Date();
    const pickCity = displayCity(
        topFlights[(nowForPick.getDate() + nowForPick.getMonth() * 31) % topFlights.length]?.arrival?.city || ''
    );
    try {
        await fetchUnsplashPickImage(pickCity);
    } catch (e) {
        console.warn(`⚠️ Unsplash 이미지 다운로드 실패 (${e.message}) — 글에는 생략됩니다`);
    }

    // 6.6. 대표 썸네일 생성 (글 상단 와이드/정사각)
    try {
        await generateThumbnails(topFlights);
    } catch (e) {
        console.warn(`⚠️ 대표 썸네일 생성 실패 (${e.message}) — 글에는 생략됩니다`);
    }

    // 7. HTML 생성
    const html = generateHTML(topFlights, allIcnFlights);

    // 8. 파일 저장
    const dateStr = formatDateForFilename(today);
    const filename = `blog-post-${dateStr}.html`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`\n✅ 블로그 포스트 생성 완료: ${outputPath}`);
    console.log(`🌐 http://localhost:3000/${filename}`);

    // 9. 히스토리 저장 (Top 3 + 인천 섹션 + 가격 정보)
    const allUsedFlights = [...topFlights, ...icnExtra];
    const allDests = allUsedFlights.map(f => normalizeCity(f.arrival?.city));
    const uniqueDests = [...new Set(allDests)];
    const prices = {};
    allUsedFlights.forEach(f => {
        const dest = normalizeCity(f.arrival?.city);
        if (!prices[dest] || f.price < prices[dest]) prices[dest] = f.price;
    });
    saveHistory(uniqueDests, prices);
    console.log(`📝 히스토리 저장: ${uniqueDests.join(', ')}`);
}

// ===== 블로그 히스토리 (최근 N일 이내 포스트 도시 중복 방지 + 가격 추적) =====
function loadRecentDests() {
    try {
        if (!fs.existsSync(HISTORY_PATH)) return [];
        const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
        const entries = history.entries || [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
        const recentEntries = entries.filter(e => {
            if (!e.date) return false;
            const entryDate = new Date(e.date + 'T00:00:00');
            // 오늘 항목은 제외 — 같은 날 재생성 시 자기 자신의 도시를 중복으로 오인하지 않도록
            return entryDate >= cutoff && entryDate < now;
        });
        const dests = new Set();
        recentEntries.forEach(e => (e.destinations || []).forEach(d => dests.add(d)));
        return Array.from(dests);
    } catch (e) {
        console.warn('⚠️ 히스토리 로드 실패:', e.message);
        return [];
    }
}

function loadRecentPrices() {
    try {
        if (!fs.existsSync(HISTORY_PATH)) return {};
        const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
        const entries = history.entries || [];
        // 최근 포스트들의 가격 정보 합산 (같은 도시면 가장 최근 가격)
        const prices = {};
        entries.forEach(e => {
            if (e.prices) {
                Object.entries(e.prices).forEach(([dest, price]) => {
                    prices[dest] = price;
                });
            }
        });
        return prices;
    } catch (e) {
        return {};
    }
}

// 가격 하락 감지: 이전 포스트 대비 현재 가격이 5% 이상 하락한 도시
function findPriceDropFlights(allFlights) {
    const prevPrices = loadRecentPrices();
    if (Object.keys(prevPrices).length === 0) return [];

    // 현재 각 도시별 최저가
    const currPrices = {};
    for (const f of allFlights) {
        const dest = normalizeCity(f.arrival?.city);
        if (!currPrices[dest] || f.price < currPrices[dest]) {
            currPrices[dest] = f.price;
        }
    }

    const drops = [];
    for (const [dest, prevPrice] of Object.entries(prevPrices)) {
        if (currPrices[dest] && currPrices[dest] < prevPrice * 0.95) {
            drops.push({
                dest,
                prevPrice,
                currPrice: currPrices[dest],
                dropPercent: Math.round((1 - currPrices[dest] / prevPrice) * 100),
            });
        }
    }
    return drops.sort((a, b) => b.dropPercent - a.dropPercent);
}

function saveHistory(destinations, prices = {}) {
    let history = { entries: [] };
    try {
        if (fs.existsSync(HISTORY_PATH)) {
            history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
        }
    } catch (e) { /* ignore */ }
    
    const todayStr = new Date().toISOString().split('T')[0];
    history.entries = (history.entries || []).filter(e => e.date !== todayStr);
    history.entries.push({ date: todayStr, destinations, prices });
    if (history.entries.length > 10) {
        history.entries = history.entries.slice(-10);
    }
    
    // variant 인덱스 저장 (라운드로빈용)
    const mergedVariants = { ...(history.variantIndexes || {}), ...usedVariantIndexes };
    history.variantIndexes = mergedVariants;
    
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

// 땡처리닷컴은 결제 단계에서 성인 1인 기준 발권수수료 2만원이 추가된다.
function getEffectiveBlogPrice(flight) {
    return flight.price + (flight.source === 'ttang' ? 20000 : 0);
}

function parseHour(time) {
    const match = String(time || '').match(/^(\d{1,2}):/);
    return match ? Number(match[1]) : null;
}

function getTripDays(flight) {
    const dep = new Date(`${flight.departure?.date}T00:00:00`);
    const ret = new Date(`${flight.arrival?.date}T00:00:00`);
    if (Number.isNaN(dep.getTime()) || Number.isNaN(ret.getTime())) return null;
    return Math.round((ret - dep) / 86400000) + 1;
}

// 출발·귀국 시간이 지나치게 이르거나 늦지 않고, 3~6일 일정이면 높은 점수.
// 직항 정보가 명시된 모두투어 항공편은 직항 여부도 반영한다.
function getConvenienceScore(flight) {
    let score = 40;
    const depHour = parseHour(flight.departure?.time);
    const returnHour = parseHour(flight.arrival?.time);
    const tripDays = getTripDays(flight);

    if (depHour !== null) score += depHour >= 7 && depHour <= 20 ? 20 : (depHour >= 5 && depHour <= 22 ? 10 : 0);
    if (returnHour !== null) score += returnHour >= 9 && returnHour <= 21 ? 15 : (returnHour >= 6 && returnHour <= 23 ? 8 : 0);
    if (tripDays !== null) score += tripDays >= 3 && tripDays <= 6 ? 15 : (tripDays >= 2 && tripDays <= 8 ? 8 : 0);

    const detail = flight.modetourDetail;
    if (detail?.isDirect === true && detail?.isReturnDirect !== false) score += 10;
    if (detail?.isDirect === false || detail?.isReturnDirect === false) score -= 10;
    return Math.max(0, Math.min(100, score));
}

// 네이버 동일 노선·날짜 최저가와 비교. 미조회는 35점으로 두어
// 검증된 동일가(60점)나 실제 특가보다 위로 쉽게 올라오지 않게 한다.
function getNaverScore(flight) {
    if (!flight.naverLowest || flight.naverLowest <= 0) return 35;
    const savingRatio = (flight.naverLowest - getEffectiveBlogPrice(flight)) / flight.naverLowest;
    if (savingRatio >= 0.20) return 100;
    if (savingRatio >= 0.15) return 90;
    if (savingRatio >= 0.10) return 80;
    if (savingRatio >= 0.05) return 70;
    if (savingRatio >= 0) return 60;
    if (savingRatio >= -0.05) return 45;
    if (savingRatio >= -0.10) return 30;
    if (savingRatio >= -0.15) return 15;
    return 0;
}

function rankBlogFlights(candidates, statsFlights = candidates) {
    if (candidates.length === 0) return [];

    const destinationStats = new Map();
    for (const flight of statsFlights) {
        const dest = normalizeCity(flight.arrival?.city);
        const stats = destinationStats.get(dest) || { flightCount: 0, sources: new Set() };
        stats.flightCount++;
        if (flight.source) stats.sources.add(flight.source);
        destinationStats.set(dest, stats);
    }

    const byPrice = [...candidates].sort((a, b) => getEffectiveBlogPrice(a) - getEffectiveBlogPrice(b));
    const priceRanks = new Map(byPrice.map((flight, index) => [flight.id, index]));
    const maxDiscount = Math.max(1, ...candidates.map(interparkDiscountRate));
    const maxFlightCount = Math.max(1, ...Array.from(destinationStats.values()).map(stats => stats.flightCount));
    const maxSourceCount = Math.max(1, ...Array.from(destinationStats.values()).map(stats => stats.sources.size));

    return candidates.map(flight => {
        const dest = normalizeCity(flight.arrival?.city);
        const stats = destinationStats.get(dest) || { flightCount: 0, sources: new Set() };
        const rank = priceRanks.get(flight.id) || 0;
        const priceScore = candidates.length === 1 ? 100 : 100 * (1 - rank / (candidates.length - 1));
        const discountScore = 100 * interparkDiscountRate(flight) / maxDiscount;
        const volumeScore = 100 * Math.log1p(stats.flightCount) / Math.log1p(maxFlightCount);
        const sourceScore = 100 * stats.sources.size / maxSourceCount;
        const popularityScore = volumeScore * 0.6 + sourceScore * 0.4;
        const convenienceScore = getConvenienceScore(flight);
        const naverScore = getNaverScore(flight);
        const totalScore =
            priceScore * BLOG_SCORE_WEIGHTS.price
            + discountScore * BLOG_SCORE_WEIGHTS.discount
            + popularityScore * BLOG_SCORE_WEIGHTS.popularity
            + convenienceScore * BLOG_SCORE_WEIGHTS.convenience
            + naverScore * BLOG_SCORE_WEIGHTS.naver;
        return {
            ...flight,
            blogScore: { totalScore, priceScore, discountScore, popularityScore, convenienceScore, naverScore },
        };
    }).sort((a, b) => b.blogScore.totalScore - a.blogScore.totalScore || getEffectiveBlogPrice(a) - getEffectiveBlogPrice(b));
}

// ===== 요일별 발견형 콘텐츠 미리보기 =====
const BLOG_THEMES = {
    budget: { label: '20만원으로 갈 수 있는 여행' },
    regional: { label: '지방공항에서 발견한 특가' },
    noLeave: { label: '연차 없이 가능한 일정' },
    shortTrip: { label: '연차 하루면 가능한 짧은 일정' },
    discovery: { label: '처음 보는 여행지' },
    drop: { label: '이번 주 티키티킷 드롭' },
    lastMinute: { label: '다음 주 바로 떠나는 항공권' },
};

function parsePreviewDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error(`--date 형식이 올바르지 않습니다: ${value} (YYYY-MM-DD 필요)`);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) throw new Error(`--date 값을 해석할 수 없습니다: ${value}`);
    return date;
}

function addLocalDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
}

function getNextMonday(date) {
    const day = date.getDay();
    const offset = day === 1 ? 0 : (8 - day) % 7;
    return addLocalDays(date, offset);
}

function formatYmd(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

function flightDepartureDate(flight) {
    const match = String(flight.departure?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isCapitalDeparture(flight) {
    const city = normalizeCity(flight.departure?.city);
    return city === '인천' || city === '김포';
}

function uniqueDestinationCount(flights) {
    return new Set(flights.map(f => normalizeCity(f.arrival?.city))).size;
}

function isNoLeaveSchedule(flight) {
    const depDate = flightDepartureDate(flight);
    const returnDate = (() => {
        const match = String(flight.arrival?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
    })();
    if (!depDate || !returnDate) return false;

    const depDay = depDate.getDay();
    const returnDay = returnDate.getDay();
    const depHour = parseHour(flight.departure?.time);
    const leavesAfterWork = depDay === 5 && depHour !== null && depHour >= 17;
    const leavesSaturday = depDay === 6;
    return (leavesAfterWork || leavesSaturday) && returnDay === 0;
}

// 평일 09~18시 근무를 가정해 실제로 휴가가 필요한 평일 수를 계산한다.
// 출발일 18시 이후 출발과 귀국일 08시 이전 도착은 연차가 필요 없는 것으로 본다.
function getRequiredLeaveDays(flight) {
    const depDate = flightDepartureDate(flight);
    const returnMatch = String(flight.arrival?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!depDate || !returnMatch) return Number.POSITIVE_INFINITY;
    const returnDate = new Date(Number(returnMatch[1]), Number(returnMatch[2]) - 1, Number(returnMatch[3]));
    const depHour = parseHour(flight.departure?.time);
    const returnHour = parseHour(flight.arrival?.arrivalTime || flight.arrival?.time);
    let leaveDays = 0;

    for (let cursor = new Date(depDate); cursor <= returnDate; cursor = addLocalDays(cursor, 1)) {
        const day = cursor.getDay();
        if (day === 0 || day === 6) continue;
        const isDepartureDay = cursor.toDateString() === depDate.toDateString();
        const isReturnDay = cursor.toDateString() === returnDate.toDateString();
        if (isDepartureDay && depHour !== null && depHour >= 18) continue;
        if (isReturnDay && returnHour !== null && returnHour < 8) continue;
        leaveDays++;
    }
    return leaveDays;
}

function getDaysUntilDeparture(flight, referenceDate) {
    const depDate = flightDepartureDate(flight);
    if (!depDate) return Number.POSITIVE_INFINITY;
    const start = new Date(referenceDate);
    start.setHours(0, 0, 0, 0);
    return Math.round((depDate - start) / 86400000);
}

function isRecentlyAdded(flight, referenceDate, days = 4) {
    const match = String(flight.firstSeen || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return false;
    const firstSeen = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const age = Math.round((referenceDate - firstSeen) / 86400000);
    return age >= 0 && age <= days;
}

function discoveryPriceCap(flight) {
    const region = categorizeRegion(flight.arrival?.city || '');
    if (region === '일본' || region === '중국' || region === '대만') return 300000;
    if (region === '동남아') return 450000;
    return 600000;
}

function rankDiscoveryFlights(flights) {
    return flights
        .filter(flight => {
            const score = flight.blogScore;
            const tripDays = getTripDays(flight);
            return score
                && score.totalScore >= 35
                && score.naverScore >= 15
                && getEffectiveBlogPrice(flight) <= discoveryPriceCap(flight)
                && tripDays !== null && tripDays >= 2 && tripDays <= 8;
        })
        .map(flight => {
            const noveltyScore = 100 - flight.blogScore.popularityScore;
            const discoveryScore = flight.blogScore.totalScore * 0.65 + noveltyScore * 0.35;
            return { ...flight, discoveryScore };
        })
        .sort((a, b) => b.discoveryScore - a.discoveryScore || getEffectiveBlogPrice(a) - getEffectiveBlogPrice(b));
}

function getThemeCandidates(allRankedFlights, referenceDate) {
    const available = allRankedFlights.filter(flight => {
        const daysUntil = getDaysUntilDeparture(flight, referenceDate);
        return daysUntil >= 0;
    });
    const day = referenceDate.getDay();
    let key;
    let candidates;
    let fallback = '';

    if (day === 1) {
        key = 'budget';
        candidates = available.filter(f => getEffectiveBlogPrice(f) <= 200000);
        if (uniqueDestinationCount(candidates) < TOP_N) {
            fallback = '20만원 이하 후보 부족으로 일반 드롭으로 대체';
            key = 'drop';
            candidates = available;
        }
    } else if (day === 2) {
        key = 'regional';
        // 기존 원칙대로 전체 3개 중 지방공항 출발은 정확히 1개만 담는다.
        candidates = available;
    } else if (day === 3) {
        key = 'noLeave';
        candidates = available.filter(isNoLeaveSchedule);
        if (uniqueDestinationCount(candidates) < TOP_N) {
            fallback = `연차 없이 가능한 목적지가 ${uniqueDestinationCount(candidates)}개뿐이라 2~4일 짧은 일정으로 대체`;
            key = 'shortTrip';
            candidates = available.filter(f => {
                const tripDays = getTripDays(f);
                return tripDays !== null && tripDays >= 2 && tripDays <= 4 && getRequiredLeaveDays(f) <= 1;
            });
            if (uniqueDestinationCount(candidates) < TOP_N) {
                fallback += ' (후보 부족으로 일반 드롭 사용)';
                key = 'drop';
                candidates = available;
            }
        }
    } else if (day === 4) {
        key = 'discovery';
        candidates = rankDiscoveryFlights(available);
    } else if (day === 5) {
        key = 'drop';
        candidates = available;
    } else {
        key = 'lastMinute';
        candidates = available
            .filter(f => {
                const daysUntil = getDaysUntilDeparture(f, referenceDate);
                return daysUntil >= 0 && daysUntil <= 14;
            })
            .sort((a, b) => {
                const dayDiff = getDaysUntilDeparture(a, referenceDate) - getDaysUntilDeparture(b, referenceDate);
                return dayDiff || (b.blogScore?.totalScore || 0) - (a.blogScore?.totalScore || 0);
            });
        if (uniqueDestinationCount(candidates) < TOP_N) {
            const newlyAdded = available.filter(f => isRecentlyAdded(f, referenceDate));
            if (uniqueDestinationCount(newlyAdded) >= TOP_N) {
                fallback = '2주 안 출발 후보 부족으로 이번 주 새로 등장한 목적지로 대체';
                candidates = newlyAdded;
            } else {
                fallback = '출발 임박·신규 후보 부족으로 일반 드롭으로 대체';
                key = 'drop';
                candidates = available;
            }
        }
    }

    return { key, candidates, fallback, originalDay: day };
}

function makeThemeTitle(themeKey, flights, referenceDate) {
    const first = flights[0];
    if (!first) return BLOG_THEMES[themeKey]?.label || '티키티킷 특가';
    const date = `${referenceDate.getMonth() + 1}/${referenceDate.getDate()}`;
    const city = displayCity(first.arrival?.city || '');
    const price = `${Math.floor(getEffectiveBlogPrice(first) / 10000)}만원대`;
    const regional = flights.find(f => !isCapitalDeparture(f));

    if (themeKey === 'budget') return `[${date}] 20만원으로 갈 수 있는 해외여행 | ${city} ${price}`;
    if (themeKey === 'regional' && regional) {
        return `[${date}] ${displayCity(regional.departure?.city)}에서 바로 떠나는 ${displayCity(regional.arrival?.city)} ${Math.floor(getEffectiveBlogPrice(regional) / 10000)}만원대`;
    }
    if (themeKey === 'noLeave') return `[${date}] 연차 없이 다녀올 수 있는 ${city} 주말여행`;
    if (themeKey === 'shortTrip') return `[${date}] 연차 하루면 가능한 ${city} ${getTripDays(first)}일 여행`;
    if (themeKey === 'discovery') return `[${date}] 처음 보는 ${city}, 왕복 ${price}이면 가볼 만할까?`;
    if (themeKey === 'lastMinute') return `[${date}] 다음 주 바로 떠날 수 있는 ${city} 항공권`;
    return `[${date}] 이번 주 티키티킷 드롭 | ${city} ${price}`;
}

function previewThemeWeek(allRankedFlights, recentDests, priceDropDests, requestedStartDate) {
    const baseDate = requestedStartDate || getNextMonday(new Date());
    const simulatedDays = [];

    console.log(`\n📅 발견형 블로그 일주일 미리보기: ${formatYmd(baseDate)}부터`);
    for (let offset = 0; offset < 7; offset++) {
        const referenceDate = addLocalDays(baseDate, offset);
        const recentFromPreview = simulatedDays
            .slice(Math.max(0, simulatedDays.length - HISTORY_DAYS))
            .flatMap(day => day.destinations);
        const existingRecent = offset < HISTORY_DAYS ? recentDests : [];
        const blockedDests = [...new Set([...existingRecent, ...recentFromPreview])];
        const theme = getThemeCandidates(allRankedFlights, referenceDate);
        const selected = selectTopWithIncheon(theme.candidates, blockedDests, priceDropDests);
        const destinations = selected.map(f => normalizeCity(f.arrival?.city));
        simulatedDays.push({ destinations });

        console.log(`\n${formatYmd(referenceDate)} (${DAY_NAMES[referenceDate.getDay()]}) · ${BLOG_THEMES[theme.key].label}`);
        if (theme.fallback) console.log(`  ↳ 대체 규칙: ${theme.fallback}`);
        console.log(`  제목 예시: ${makeThemeTitle(theme.key, selected, referenceDate)}`);
        selected.forEach((flight, index) => {
            const discovery = flight.discoveryScore ? ` · 발견 ${flight.discoveryScore.toFixed(1)}` : '';
            console.log(
                `  ${index + 1}. ${flight.departure?.city} → ${flight.arrival?.city}`
                + ` · ${getEffectiveBlogPrice(flight).toLocaleString()}원 · ${getTripDays(flight)}일`
                + ` · 종합 ${(flight.blogScore?.totalScore || 0).toFixed(1)}${discovery}`
            );
        });
    }
    console.log('\n✅ 실제 블로그 초안과 히스토리는 변경하지 않았습니다.');
}

// ===== Top N 선발 (지방 1 + 인천/김포 2 기본 + 최근 중복 방지 + 가격 하락 면제) =====
function selectTopWithIncheon(sortedFlights, recentDests = [], priceDropDests = []) {
    const topFlights = [];
    const seenDests = new Set();
    const priceDropSet = new Set(priceDropDests);
    // 가격 하락 도시는 recent에서 제외
    const recentSet = new Set(recentDests.filter(d => !priceDropSet.has(d)));
    const isCapital = (f) => {
        const dep = normalizeCity(f.departure?.city);
        return dep === '인천' || dep === '김포';
    };

    // 0단계: --include 강제 포함 (최우선)
    if (CLI_OVERRIDES.include.length > 0) {
        for (const includeDest of CLI_OVERRIDES.include) {
            // 정확 매칭 → 부분 매칭(includes) fallback
            let bestFlight = sortedFlights.find(f => normalizeCity(f.arrival?.city) === includeDest);
            if (!bestFlight) {
                bestFlight = sortedFlights.find(f => {
                    const nc = normalizeCity(f.arrival?.city);
                    return nc.includes(includeDest) || includeDest.includes(nc);
                });
            }
            if (bestFlight) {
                const nc = normalizeCity(bestFlight.arrival?.city);
                seenDests.add(nc);
                topFlights.push(bestFlight);
                console.log(`  📌 강제 포함: ${bestFlight.departure?.city} → ${bestFlight.arrival?.city} | ${bestFlight.price.toLocaleString()}원`);
            } else {
                console.warn(`  ⚠️ --include ${includeDest}: 데이터에서 찾을 수 없음`);
            }
        }
    }

    // 1단계: 지방 출발 먼저 확보 (최소 MIN_REGIONAL개)
    const regionalFlights = sortedFlights.filter(f => !isCapital(f));
    let regionalCount = topFlights.filter(f => !isCapital(f)).length;
    for (const f of regionalFlights) {
        if (topFlights.length >= TOP_N) break;
        if (regionalCount >= MIN_REGIONAL) break;
        const dest = normalizeCity(f.arrival?.city);
        if (seenDests.has(dest) || recentSet.has(dest)) continue;
        seenDests.add(dest);
        topFlights.push(f);
        regionalCount++;
    }

    // 2단계: 인천/김포 출발 확보 (최소 MIN_INCHEON개)
    const icnFlights = sortedFlights.filter(f => isCapital(f));
    let icnCount = topFlights.filter(f => isCapital(f)).length;
    for (const f of icnFlights) {
        if (topFlights.length >= TOP_N) break;
        if (icnCount >= MIN_INCHEON) break;
        const dest = normalizeCity(f.arrival?.city);
        if (seenDests.has(dest) || recentSet.has(dest)) continue;
        seenDests.add(dest);
        topFlights.push(f);
        icnCount++;
    }

    // 3단계: 나머지를 전체에서 채움 (최근 중복 제외, 가격 하락 면제)
    for (const f of sortedFlights) {
        if (topFlights.length >= TOP_N) break;
        const dest = normalizeCity(f.arrival?.city);
        if (seenDests.has(dest) || recentSet.has(dest)) continue;
        seenDests.add(dest);
        topFlights.push(f);
    }

    // 4단계: 만약 중복 제외로 TOP_N을 못 채웠으면 중복 허용하여 채움
    if (topFlights.length < TOP_N) {
        console.warn(`⚠️ 중복 제외 후 ${topFlights.length}개만 선발됨, 중복 허용하여 채움`);
        for (const f of sortedFlights) {
            if (topFlights.length >= TOP_N) break;
            const dest = normalizeCity(f.arrival?.city);
            if (seenDests.has(dest)) continue;
            seenDests.add(dest);
            topFlights.push(f);
        }
    }

    // 5단계: 종합점수순 유지
    topFlights.sort((a, b) => (b.blogScore?.totalScore || 0) - (a.blogScore?.totalScore || 0));
    return topFlights;
}

// ===== 인천 추가 항공편 (TOP 3와 같은 종합점수) =====
function getExtraIncheonFlights(allFlights, topFlights, maxExtra, recentDests = []) {
    const topIds = new Set(topFlights.map(f => `${f.departure?.city}|${f.arrival?.city}|${f.departure?.date}|${f.airline}`));
    const topDests = new Set(topFlights.map(f => normalizeCity(f.arrival?.city)));
    // 인천 추천은 가격 하락 예외를 두지 않아 최근 3일 도시의 재등장을 막는다.
    const recentSet = new Set(recentDests);

    const capitalFlights = allFlights.filter(f => {
        const depCity = normalizeCity(f.departure?.city);
        return depCity === '인천' || depCity === '김포';
    });

    // 목적지별 가장 저렴한 항공편 하나를 대표 후보로 사용한다.
    const candidateByDest = new Map();
    for (const f of capitalFlights) {
        const key = `${f.departure?.city}|${f.arrival?.city}|${f.departure?.date}|${f.airline}`;
        if (topIds.has(key)) continue;
        const dest = normalizeCity(f.arrival?.city);
        if (topDests.has(dest) || recentSet.has(dest)) continue;
        const current = candidateByDest.get(dest);
        if (!current || f.price < current.price) candidateByDest.set(dest, f);
    }
    const candidates = Array.from(candidateByDest.values());
    if (candidates.length === 0) return [];

    const selected = rankBlogFlights(candidates, capitalFlights).slice(0, maxExtra);
    if (selected.length > 0) {
        console.log('📊 인천 추천 종합점수 (가격 25% · 할인율 15% · 인기 20% · 편의 10% · 네이버 30%):');
        selected.forEach(flight => {
            const { totalScore, priceScore, discountScore, popularityScore, convenienceScore, naverScore } = flight.blogScore;
            console.log(
                `  ${normalizeCity(flight.arrival?.city)} ${totalScore.toFixed(1)}점`
                + ` (가격 ${priceScore.toFixed(0)} · 할인 ${discountScore.toFixed(0)} · 인기 ${popularityScore.toFixed(0)}`
                + ` · 편의 ${convenienceScore.toFixed(0)} · 네이버 ${naverScore.toFixed(0)})`
            );
        });
    }
    return selected;
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

// ===== 에디터 픽 도시 무료 이미지 (Unsplash, 무료 라이선스) =====
const UNSPLASH_PHOTO = path.join(CARDS_DIR, 'pick_photo.jpg');

// 검색 품질을 위한 한→영 도시명 (없으면 한글명으로 검색)
const CITY_EN = {
    '도쿄': 'tokyo', '오사카': 'osaka', '후쿠오카': 'fukuoka', '삿포로': 'sapporo',
    '오키나와': 'okinawa', '나하': 'okinawa', '나고야': 'nagoya', '히로시마': 'hiroshima',
    '다카마쓰': 'takamatsu japan', '다카마츠': 'takamatsu japan',
    '마쓰야마': 'matsuyama japan', '마츠야마': 'matsuyama japan', '오이타': 'oita japan',
    '가고시마': 'kagoshima', '구마모토': 'kumamoto', '미야자키': 'miyazaki japan',
    '니가타': 'niigata', '센다이': 'sendai', '시즈오카': 'shizuoka', '요나고': 'yonago',
    '오카야마': 'okayama', '고마쓰': 'komatsu japan', '도야마': 'toyama', '아사히카와': 'asahikawa',
    '하코다테': 'hakodate', '기타큐슈': 'kitakyushu', '사가': 'saga japan', '나가사키': 'nagasaki',
    '도쿠시마': 'tokushima', '미야코지마': 'miyakojima', '이시가키': 'ishigaki', '오비히로': 'obihiro',
    '베이징': 'beijing', '상하이': 'shanghai', '칭다오': 'qingdao', '웨이하이': 'weihai',
    '옌지': 'yanji', '다롄': 'dalian', '선양': 'shenyang china', '장자제': 'zhangjiajie',
    '시안': 'xian china', '청두': 'chengdu', '충칭': 'chongqing', '광저우': 'guangzhou',
    '홍콩': 'hong kong', '마카오': 'macau', '타이베이': 'taipei', '가오슝': 'kaohsiung',
    '다낭': 'da nang', '나트랑': 'nha trang', '호치민': 'ho chi minh city', '하노이': 'hanoi',
    '푸꾸옥': 'phu quoc', '방콕': 'bangkok', '치앙마이': 'chiang mai', '푸껫': 'phuket',
    '세부': 'cebu', '마닐라': 'manila', '보라카이': 'boracay', '칼리보': 'boracay',
    '발리': 'bali', '덴파사르': 'bali', '자카르타': 'jakarta', '코타키나발루': 'kota kinabalu',
    '쿠알라룸푸르': 'kuala lumpur', '싱가포르': 'singapore', '프놈펜': 'phnom penh',
    '씨엠립': 'siem reap', '비엔티안': 'vientiane', '괌': 'guam', '사이판': 'saipan',
    '울란바토르': 'ulaanbaatar', '타슈켄트': 'tashkent', '알마티': 'almaty',
};

function cityQueryAndSlug(cityKorean) {
    const base = cityKorean.replace(/\([^)]*\)/g, '').trim(); // "오사카(간사이)" → "오사카"
    const query = CITY_EN[base] || base;
    const slug = query.split(' ')[0].replace(/[^a-z0-9가-힣]/gi, '').toLowerCase() || 'city';
    return { base, query, slug };
}

// Unsplash 검색 첫 사진을 outPath에 저장
// (봇 방어(Anubis)가 일반 헤드리스를 403으로 차단 → 스텔스 + 화면 밖 창)
async function downloadUnsplashTo(query, outPath) {
    let chromium;
    try {
        const extra = require('playwright-extra');
        const stealth = require('puppeteer-extra-plugin-stealth');
        extra.chromium.use(stealth());
        chromium = extra.chromium;
    } catch { throw new Error('playwright-extra 미설치'); }

    console.log(`🖼️ Unsplash에서 "${query}" 이미지 검색 중...`);
    const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--window-position=-2400,-100'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`https://unsplash.com/ko/s/%EC%82%AC%EC%A7%84/${encodeURIComponent(query)}`,
            { waitUntil: 'domcontentloaded', timeout: 30000 });
        // 사진 URL은 images.unsplash.com/photo-… 패턴 (작가 아바타는 /profile-…, 유료는 plus.unsplash.com이라 제외됨)
        await page.waitForSelector('img[src*="images.unsplash.com/photo-"]', { timeout: 20000 });
        const imgUrl = await page.evaluate(() => {
            const img = document.querySelector('img[src*="images.unsplash.com/photo-"]');
            if (!img) return null;
            const u = new URL(img.src);
            u.searchParams.set('w', '1080');
            u.searchParams.set('q', '80');
            return u.toString();
        });
        if (!imgUrl) throw new Error('검색 결과 없음');
        const resp = await page.request.get(imgUrl);
        if (!resp.ok()) throw new Error(`다운로드 실패 (${resp.status()})`);
        fs.writeFileSync(outPath, await resp.body());
        console.log(`✅ Unsplash 이미지 저장: ${require('path').basename(outPath)} ("${query}")`);
    } finally {
        await browser.close();
    }
}

async function fetchUnsplashPickImage(cityKorean) {
    // 지난 실행의 파일이 남아 엉뚱한 도시 사진이 들어가지 않도록 먼저 제거
    if (fs.existsSync(UNSPLASH_PHOTO)) fs.unlinkSync(UNSPLASH_PHOTO);
    const { query } = cityQueryAndSlug(cityKorean);
    await downloadUnsplashTo(query, UNSPLASH_PHOTO);
}

// ===== 대표 썸네일 (와이드 960×480 + 정사각 800×800) 자동 생성 =====
const IMAGES_DIR = path.join(OUTPUT_DIR, 'images');

// 도시 패널 이미지: 기존 수제 썸네일 → 자동 다운로드 캐시 → Unsplash → 공항 기본 이미지
async function ensurePanelImage(cityKorean) {
    const { query, slug } = cityQueryAndSlug(cityKorean);
    const named = `thumb_${slug}.png`;
    if (fs.existsSync(path.join(IMAGES_DIR, named))) return `images/${named}`;
    const auto = `thumb_auto_${slug}.jpg`;
    if (!fs.existsSync(path.join(IMAGES_DIR, auto))) {
        try {
            await downloadUnsplashTo(query, path.join(IMAGES_DIR, auto));
        } catch (e) {
            console.warn(`⚠️ 패널 이미지 다운로드 실패 (${query}): ${e.message} — 기본 이미지 사용`);
            return 'images/thumb_airport.png';
        }
    }
    return `images/${auto}`;
}

async function generateThumbnails(topFlights) {
    const now = new Date();
    const dateStr = formatDateForFilename(now);
    const md = `${now.getMonth() + 1}/${now.getDate()}`;
    const cities = topFlights.slice(0, 3).map(f => displayCity(f.arrival?.city || ''));
    const panels = [];
    for (const c of cities) panels.push(await ensurePanelImage(c));
    while (panels.length < 3) panels.push('images/thumb_airport.png');

    const priceLine = topFlights.slice(0, 2)
        .map(f => `${displayCity(f.arrival?.city || '').replace(/\([^)]*\)/g, '')} ${Math.round(f.price / 10000)}만`)
        .join(' · ');

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #111; display: flex; flex-direction: column; align-items: center; gap: 40px; padding: 40px; }
        label { color: #888; font-size: 14px; font-family: sans-serif; }
        .wide-banner { width: 960px; height: 480px; position: relative; overflow: hidden; font-family: 'Noto Sans KR', sans-serif; background: #000; }
        .square-thumb { width: 800px; height: 800px; position: relative; overflow: hidden; font-family: 'Noto Sans KR', sans-serif; background: #000; }
        .panels { display: flex; width: 100%; height: 100%; position: relative; }
        .panel { position: absolute; top: 0; bottom: 0; background-size: cover; background-position: center; }
        .wide-banner .panel-1 { left: 0; width: 38%; clip-path: polygon(0 0, 100% 0, 90% 100%, 0 100%); background-image: url('${panels[0]}'); }
        .wide-banner .panel-2 { left: 30%; width: 40%; clip-path: polygon(10% 0, 100% 0, 90% 100%, 0 100%); background-image: url('${panels[1]}'); }
        .wide-banner .panel-3 { right: 0; width: 38%; clip-path: polygon(10% 0, 100% 0, 100% 100%, 0 100%); background-image: url('${panels[2]}'); }
        .square-thumb .panel-1 { left: 0; width: 38%; clip-path: polygon(0 0, 100% 0, 88% 100%, 0 100%); background-image: url('${panels[0]}'); }
        .square-thumb .panel-2 { left: 30%; width: 40%; clip-path: polygon(12% 0, 100% 0, 88% 100%, 0 100%); background-image: url('${panels[1]}'); }
        .square-thumb .panel-3 { right: 0; width: 38%; clip-path: polygon(12% 0, 100% 0, 100% 100%, 0 100%); background-image: url('${panels[2]}'); }
        .text-overlay { position: absolute; bottom: 0; left: 0; right: 0; height: 55%; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.65) 60%, transparent 100%); display: flex; flex-direction: column; justify-content: flex-end; align-items: center; padding-bottom: 36px; z-index: 10; }
        .text-overlay-full { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.25) 100%); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 10; }
        .line1 { color: white; font-size: 42px; font-weight: 900; text-shadow: 3px 3px 10px rgba(0,0,0,0.7); letter-spacing: -1px; }
        .line2 { color: white; font-size: 36px; font-weight: 800; text-shadow: 3px 3px 10px rgba(0,0,0,0.7); letter-spacing: -1px; margin-top: 6px; }
        .line-accent { color: #ffd700; font-size: 28px; font-weight: 800; text-shadow: 2px 2px 8px rgba(0,0,0,0.7); margin-top: 12px; }
        .site-badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 20px; padding: 6px 20px; color: white; font-size: 16px; font-weight: 600; margin-top: 16px; backdrop-filter: blur(4px); }
        .square-thumb .line-accent { font-size: 42px; margin-top: 24px; }
        .square-thumb .site-badge { font-size: 24px; margin-top: 24px; padding: 8px 24px; }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700;800;900&display=swap" rel="stylesheet">
</head>
<body>
    <label>정사각 썸네일 (800×800)</label>
    <div class="square-thumb" id="square-thumb">
        <div class="panels">
            <div class="panel panel-1"></div>
            <div class="panel panel-2"></div>
            <div class="panel panel-3"></div>
        </div>
        <div class="text-overlay-full">
            <div class="line1" style="font-size: 90px; line-height: 1.15;">[${md}]<br>땡처리 항공권<br>특가 Top 3 🔥</div>
            <div class="line-accent">${priceLine}</div>
            <div class="site-badge">티키티킷 tikitikit.kr</div>
        </div>
    </div>
</body>
</html>`;

    const thumbHtmlPath = path.join(OUTPUT_DIR, `blog-thumbnail-${dateStr}.html`);
    fs.writeFileSync(thumbHtmlPath, html, 'utf-8');

    const { chromium: pw } = require('playwright');
    const browser = await pw.launch();
    try {
        const pg = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
        await pg.goto('file:///' + thumbHtmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 30000 });
        await pg.waitForTimeout(2000); // 웹폰트 렌더링 대기
        await pg.locator('#square-thumb').screenshot({ path: path.join(IMAGES_DIR, `blog-thumb-${dateStr}-square.png`) });
        console.log(`✅ 대표 썸네일 생성: images/blog-thumb-${dateStr}-square.png (1:1)`);
    } finally {
        await browser.close();
    }
}

// ===== 카드 스크린샷 (Playwright) =====
async function captureCardScreenshots(flights, top5Count) {
    // 프로덕션은 Vercel 보안 검문이 일반 헤드리스를 차단하므로
    // 네이버 크롤러와 같은 스텔스 + 화면 밖 창 방식을 쓴다.
    let chromium;
    let stealthMode = false;
    try {
        const extra = require('playwright-extra');
        const stealth = require('puppeteer-extra-plugin-stealth');
        extra.chromium.use(stealth());
        chromium = extra.chromium;
        stealthMode = true;
    } catch (e) {
        try {
            chromium = require('playwright').chromium;
        } catch (e2) {
            console.warn('⚠️ Playwright가 설치되어 있지 않습니다. 카드 스크린샷을 건너뜁니다.');
            console.warn('   npm install playwright 로 설치하세요.');
            return;
        }
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

    const browser = await chromium.launch(stealthMode
        ? { headless: false, args: ['--no-sandbox', '--window-position=-2400,-100'] }
        : {});
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

// ===== 도시별 variant 사용 히스토리 (라운드로빈) =====
const usedVariantIndexes = {};
function loadVariantHistory() {
    try {
        if (!fs.existsSync(HISTORY_PATH)) return {};
        const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
        return history.variantIndexes || {};
    } catch { return {}; }
}
const variantHistory = loadVariantHistory();

function matchCityDescription(cityName) {
    if (!cityName) return null;
    let cityDesc = null;
    let cityKey = null;
    if (CITY_DESCRIPTIONS[cityName]) {
        cityDesc = CITY_DESCRIPTIONS[cityName];
        cityKey = cityName;
    } else {
        for (const [key, desc] of Object.entries(CITY_DESCRIPTIONS)) {
            if (cityName.includes(key)) { cityDesc = desc; cityKey = key; break; }
        }
    }
    if (!cityDesc) return null;
    // variants 배열에서 라운드로빈 선택 (이전에 안 쓴 것 우선)
    if (cityDesc.variants && cityDesc.variants.length > 0) {
        const lastIdx = variantHistory[cityKey] ?? -1;
        const nextIdx = (lastIdx + 1) % cityDesc.variants.length;
        // 현재 실행에서 사용한 인덱스 기록
        usedVariantIndexes[cityKey] = nextIdx;
        variantHistory[cityKey] = nextIdx;
        const variant = cityDesc.variants[nextIdx];
        return { emoji: cityDesc.emoji, lines: variant.lines, closing: variant.closing };
    }
    // 하위 호환: lines/closing 직접 있는 경우
    return cityDesc;
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
    const city = displayCity(flight.arrival?.city || '');
    const depCityDisplay = displayCity(flight.departure?.city || '');
    const desc = matchCityDescription(flight.arrival?.city || '');
    const duration = calculateTripDuration(flight.departure?.date, flight.arrival?.date);
    const priceText = formatPriceShort(flight.price);
    const durationLine = pickRandom([
        '알찬 일정입니다.',
        '부담 없이 다녀오기 좋은 일정이에요.',
        '짧지만 꽉 채운 일정이에요.',
        '리프레시하기 딱 좋은 일정이에요.',
        '여행 감각 깨우기 좋은 일정이에요.',
    ]);

    let lines = [];
    lines.push(`<p>&nbsp;</p>`);
    lines.push(`<p><b>${depCityDisplay}-${city} 왕복 ${formatPrice(flight.price)}원!</b></p>`);
    lines.push(`<p>&nbsp;</p>`);

    if (desc) {
        lines.push(`<p>${flight.airline} 직항으로</p>`);
        if (duration) lines.push(`<p>${duration} ${durationLine}</p>`);
        lines.push(`<p>&nbsp;</p>`);
        desc.lines.forEach(l => lines.push(`<p>${l}</p>`));
        lines.push(`<p>&nbsp;</p>`);
        lines.push(`<p>왕복 <b>${priceText}</b>이면</p>`);
        lines.push(`<p>${desc.closing}</p>`);
    } else {
        lines.push(`<p>${flight.airline} 직항으로</p>`);
        if (duration) lines.push(`<p>${duration} ${durationLine}</p>`);
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
        '푸켓': '비치 리조트 힐링!',
        '나트랑': '바다 + 머드온천 코스!',
        '타이페이': '야시장 미식 여행!',
        '호치민': '쌀국수 + 카페거리 탐방!',
        '하노이': '구시가지 골목 투어!',
    };

    const matched = Object.entries(comments).find(([key]) => city.includes(key));
    if (matched) return `${duration} ${matched[1]}`;

    if (region === '일본') {
        return `${duration} ` + pickRandom([
            '일본 소도시 여행!',
            '온천에 몸 담그러 가볼까요?',
            '가까운 일본, 가볍게 다녀오기!',
            '현지 라멘 한 그릇 하러 출발!',
            '편의점 털이 + 미식 여행!',
        ]);
    }
    if (region === '중국') {
        return `${duration} ` + pickRandom([
            '근거리 맛집 투어!',
            '가성비 미식 여행!',
            '이색 도시 탐방 어때요?',
            '현지 음식에 도전해볼까요?',
        ]);
    }
    if (region === '동남아') {
        return `${duration} ` + pickRandom([
            '휴양지 힐링!',
            '수영장에서 뒹굴뒹굴 힐링!',
            '따뜻한 나라로 잠깐 도피!',
            '마사지 + 맛집 힐링 코스!',
            '한 손엔 코코넛, 한 손엔 선크림!',
        ]);
    }
    const defaultComments = [
        `${duration} 새로운 여행지 탐험!`,
        `${duration} 특가로 떠나볼까요?`,
        `${duration} 알찬 일정 가능!`,
        `${duration} 짧고 굵게 리프레시!`,
        `${duration} 주말 붙이면 딱 좋은 일정!`,
        `${duration} 숨은 여행지 개척해볼까요?`,
        `${duration} 이 가격이면 일단 찜!`,
        `${duration} 연차 하루면 충분해요!`,
    ];
    return pickRandom(defaultComments);
}

// ===== 스마트 인트로 생성 (Top 3 내용 기반) =====
function generateSmartIntro(topFlights, now) {
    const month = now.getMonth() + 1;
    const dayOfWeek = now.getDay();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const regions = topFlights.map(f => categorizeRegion(f.arrival?.city || ''));
    const cities = topFlights.map(f => displayCity(f.arrival?.city || ''));
    const lowestPrice = Math.min(...topFlights.map(f => f.price));
    const priceMan = Math.floor(lowestPrice / 10000);

    // 지배적 지역 파악
    const regionCount = {};
    regions.forEach(r => { regionCount[r] = (regionCount[r] || 0) + 1; });
    const dominantRegion = Object.entries(regionCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '기타';
    const uniqueRegions = [...new Set(regions.filter(r => r !== '기타'))];

    // 지역 맵핑
    const regionEmoji = {
        '일본': '🇯🇵', '중국': '🇨🇳', '동남아': '🌴', '대만': '🇹🇼', '괌/사이판': '🏝️',
    };

    // 인트로 로테이션 풀 — 조건별 다양한 멘트 (네이버 저품질 방지)
    const INTRO_POOLS = {
        budget: [
            [`<p>오늘 진짜 괜찮은 가격이 떴어요 🔥</p>`, `<p>&nbsp;</p>`, `<p>${cities[0]} 왕복 ${priceMan}만원대,</p>`, `<p>이 가격이면 고민하면 늦어요!</p>`],
            [`<p>${priceMan}만원대 해외여행, 실화인가요? ✈️</p>`, `<p>&nbsp;</p>`, `<p>${cities[0]} 왕복이 이 가격이면</p>`, `<p>좌석 빠지기 전에 확인해보세요!</p>`],
            [`<p>KTX 왕복보다 싼 항공권 발견 💰</p>`, `<p>&nbsp;</p>`, `<p>${cities[0]} ${priceMan}만원대,</p>`, `<p>이런 가격은 오래 안 가요!</p>`],
            [`<p>오늘의 특가, 가격 보고 깜짝 놀랐어요 😲</p>`, `<p>&nbsp;</p>`, `<p>${cities[0]} 왕복 ${priceMan}만원대!</p>`, `<p>망설이면 놓칩니다.</p>`],
            [`<p>${cities[0]} 왕복 ${priceMan}만원대, KTX보다 싸네요 🚄</p>`, `<p>&nbsp;</p>`, `<p>이 정도 가격의 항공권은</p>`, `<p>자주 나오지 않아요!</p>`],
        ],
        china: [
            [`<p>오늘은 중국 쪽 특가가 많이 풀렸어요 🇨🇳</p>`, `<p>&nbsp;</p>`, `<p>가성비 좋은 근거리 여행지로</p>`, `<p>가볍게 다녀올 수 있는 곳들이에요.</p>`],
            [`<p>중국 근거리 특가가 쏟아졌어요 🇨🇳</p>`, `<p>&nbsp;</p>`, `<p>비행 2시간 이내,</p>`, `<p>주말 여행으로도 충분해요!</p>`],
            [`<p>가까운 중국 여행, 오늘 가격 괜찮네요 🇨🇳</p>`, `<p>&nbsp;</p>`, `<p>물가도 저렴하고 비행도 짧아서</p>`, `<p>부담 없이 다녀올 수 있어요.</p>`],
        ],
        japanCherry: [
            [`<p>벚꽃 시즌이 다가오고 있네요 🌸</p>`, `<p>&nbsp;</p>`, `<p>일본 쪽 특가가 많이 풀리는 시기라</p>`, `<p>눈여겨볼 만한 것들이 있어요.</p>`],
            [`<p>벚꽃 구경 갈 타이밍이에요 🌸</p>`, `<p>&nbsp;</p>`, `<p>일본행 특가가 속속 올라오고 있어요.</p>`, `<p>지금이 예약 적기!</p>`],
            [`<p>일본 벚꽃 시즌, 항공권도 활짝 🌸</p>`, `<p>&nbsp;</p>`, `<p>꽃 구경 가기 좋은 가격의</p>`, `<p>항공권들이 나왔어요.</p>`],
        ],
        japan: [
            [`<p>일본 쪽 특가가 많이 올라왔어요 🇯🇵</p>`, `<p>&nbsp;</p>`, `<p>소도시부터 대도시까지</p>`, `<p>다양한 옵션이 있으니 확인해보세요.</p>`],
            [`<p>일본 여행 계획 있다면 주목! 🇯🇵</p>`, `<p>&nbsp;</p>`, `<p>오늘 괜찮은 가격들이 풀렸어요.</p>`, `<p>라인업 한번 보세요.</p>`],
            [`<p>일본행 항공권, 오늘 가격 좋아요 🇯🇵</p>`, `<p>&nbsp;</p>`, `<p>가까운 일본이라 부담도 적고</p>`, `<p>가성비도 좋은 옵션들이에요.</p>`],
        ],
        seAsia: [
            [`<p>동남아 특가가 쏟아지고 있어요 🌴</p>`, `<p>&nbsp;</p>`, `<p>따뜻한 곳에서 힐링하고 싶다면</p>`, `<p>오늘 라인업 한번 보세요!</p>`],
            [`<p>따뜻한 곳으로 떠나고 싶은 날이에요 🌴</p>`, `<p>&nbsp;</p>`, `<p>동남아 특가가 여러 개 올라왔어요.</p>`, `<p>비치에서 쉬고 싶다면 지금!</p>`],
            [`<p>동남아 항공권, 오늘 가격이 착해요 🏖️</p>`, `<p>&nbsp;</p>`, `<p>리조트 힐링부터 맛집 투어까지</p>`, `<p>선택지가 다양합니다.</p>`],
        ],
        mixed: [
            [`<p>오늘은 ${uniqueRegions.slice(0, 2).join(', ')} 등</p>`, `<p>다양한 지역의 특가가 올라왔어요 ✈️</p>`, `<p>&nbsp;</p>`, `<p>취향에 맞는 여행지가 있을지도!</p>`],
            [`<p>${uniqueRegions.slice(0, 2).join('부터 ')}까지</p>`, `<p>오늘 특가 라인업이 다채로워요 ✈️</p>`, `<p>&nbsp;</p>`, `<p>어디로 떠날지 골라보세요!</p>`],
            [`<p>여러 지역에서 동시에 특가가! 🌏</p>`, `<p>&nbsp;</p>`, `<p>${uniqueRegions.slice(0, 2).join(', ')} 쪽으로</p>`, `<p>괜찮은 가격들이 올라왔어요.</p>`],
        ],
        friday: [
            [`<p>금요일이에요! 주말 앞두고</p>`, `<p>갑자기 떠나고 싶어질 때 있잖아요 ✈️</p>`, `<p>&nbsp;</p>`, `<p>오늘의 특가 라인업 정리해봤어요.</p>`],
            [`<p>금요일 특가 정리해왔어요 🎉</p>`, `<p>&nbsp;</p>`, `<p>주말에 뭐 할지 고민된다면</p>`, `<p>항공권부터 확인해보세요!</p>`],
            [`<p>불금이니까 여행 얘기 해야죠 ✈️</p>`, `<p>&nbsp;</p>`, `<p>오늘의 땡처리 특가,</p>`, `<p>주말 계획에 참고하세요!</p>`],
        ],
        monday: [
            [`<p>월요일부터 여행 얘기하면</p>`, `<p>한 주가 좀 더 기대되지 않나요? 😊</p>`, `<p>&nbsp;</p>`, `<p>오늘의 땡처리 특가 정리해봤어요.</p>`],
            [`<p>월요일부터 이런 가격이라니 ✈️</p>`, `<p>&nbsp;</p>`, `<p>한 주의 시작,</p>`, `<p>여행 계획으로 힘내봐요!</p>`],
            [`<p>월요병 치료제는 항공권 특가 💊</p>`, `<p>&nbsp;</p>`, `<p>오늘 올라온 것들 중에</p>`, `<p>눈에 띄는 것들 모아봤어요.</p>`],
        ],
        default: [
            [`<p>오늘도 괜찮은 특가가 올라왔어요.</p>`, `<p>&nbsp;</p>`, `<p>항공권은 타이밍이 중요하니까</p>`, `<p>한번 확인해보세요 👇</p>`],
            [`<p>오늘의 항공권 특가 정리해봤어요 ✈️</p>`, `<p>&nbsp;</p>`, `<p>매일 가격이 바뀌니까</p>`, `<p>눈에 띄는 게 있으면 바로!</p>`],
            [`<p>새로운 땡처리 항공권이 올라왔어요 🔥</p>`, `<p>&nbsp;</p>`, `<p>오늘의 라인업,</p>`, `<p>한번 살펴보세요!</p>`],
            [`<p>항공권 가격은 매일 달라져요 📉</p>`, `<p>&nbsp;</p>`, `<p>오늘은 어떤 특가가 있는지</p>`, `<p>정리해봤습니다!</p>`],
        ],
    };

    let pool;
    if (priceMan <= 15) pool = INTRO_POOLS.budget;
    else if (dominantRegion !== '기타' && regionCount[dominantRegion] >= 2) {
        if (dominantRegion === '중국') pool = INTRO_POOLS.china;
        else if (dominantRegion === '일본') pool = (month >= 3 && month <= 4) ? INTRO_POOLS.japanCherry : INTRO_POOLS.japan;
        else if (dominantRegion === '동남아') pool = INTRO_POOLS.seAsia;
        else pool = INTRO_POOLS.default;
    }
    else if (uniqueRegions.length >= 2) pool = INTRO_POOLS.mixed;
    else if (dayOfWeek === 5) pool = INTRO_POOLS.friday;
    else if (dayOfWeek === 1) pool = INTRO_POOLS.monday;
    else pool = INTRO_POOLS.default;

    const lines = pickRandom(pool);
    return lines.join('\n        ');
}

// ===== HTML 생성 =====
function generateHTML(topFlights, allIcnFlights) {
    const now = new Date();
    const dateLabel = formatMonthDay(now);
    const first = topFlights[0];
    const second = topFlights[1];

    // 제목 생성 — SEO 최적화 패턴 (2026-03-03~)
    // 형식: [M/D] 땡처리 항공권 특가 TOP 3 | {1위 목적지} {가격}, {2위 목적지} {가격} ✈️
    const dayHash = now.getDate() + now.getMonth() * 31;
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const firstCity = displayCity(first.arrival?.city || '');
    const firstPrice = `${Math.floor(first.price / 10000)}만원`;
    const secondCity = second ? displayCity(second.arrival?.city || '') : '';
    const secondPrice = second ? `${Math.floor(second.price / 10000)}만원` : '';
    const pricePart = second
        ? `${firstCity} ${firstPrice}, ${secondCity} ${secondPrice}`
        : `${firstCity} ${firstPrice}`;
    const pageTitle = `[${month}/${day}] 땡처리 항공권 특가 TOP 3 | ${pricePart} ✈️`;

    // 각 순위별 HTML 생성 (텍스트 + 이미지 + 시즌 코멘트)
    const rankSections = topFlights.map((f, i) => {
        const rank = i + 1;
        const depCity = displayCity(f.departure?.city || '');
        const arrCity = displayCity(f.arrival?.city || '');
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
        <p><img src="blog-cards/rank_${rank}.png" alt="${depCity}-${arrCity} 항공권" style="max-width: 100%; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></p>${seasonText}${extraComment}
        <p>&nbsp;</p>`;
    }).join('\n');

    // 에디터 픽 (날짜별 로테이션 — 매일 다른 항공편 픽)
    const pickIndex = dayHash % topFlights.length;
    const pickedFlight = topFlights[pickIndex];
    const editorPick = generateEditorPick(pickedFlight);

    // 인천 출발 섹션
    let icnSection = '';
    if (allIcnFlights.length > 0) {
        const icnItems = allIcnFlights.map((f, i) => {
            const city = displayCity(f.arrival?.city || '');
            const dateRange = formatDateRange(f.departure?.date || '', f.arrival?.date || '');
            const comment = getIcnComment(f);
            // 카드 이미지: Top 3에 포함된 인천 항공편은 rank_N.png, 추가분은 icn_N.png
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
        <p>&nbsp;</p>

        <p class="section-title">📌 인천 출발은 뭐가 있을까?</p>

        <p>&nbsp;</p>
        <p>이번 인천 출발 추천 라인업!</p>

${icnItems}`;
    }

    // 팁
    const tips = generateTips(topFlights);
    let tipSection = '';
    if (tips.length > 0) {
        const tipLines = tips.map(t => `            <p>${t}</p>`).join('\n');
        // blockquote는 네이버 에디터 붙여넣기 시 인용구(박스) 컴포넌트로 변환된다
        tipSection = `
        <p>&nbsp;</p>

        <blockquote class="tip-box">
            <p><b>✨ 이번 주 항공권 꿀팁</b></p>
            <p>&nbsp;</p>
${tipLines}
        </blockquote>`;
    }

    // 해시태그 — SEO 최적화 (고정 + 월별 + 목적지별)
    const cities = [...new Set(topFlights.map(f => f.arrival?.city).filter(Boolean))];
    const hashMonth = now.getMonth() + 1;
    const hashtags = [
        // ① 고정 (매일 동일)
        '#땡처리항공권', '#특가항공권', '#항공권싸게사는법', '#항공권최저가', '#해외여행꿀팁', '#티키티킷',
        // ② 월별
        `#${hashMonth}월항공권`, `#${hashMonth}월해외여행`,
        // ③ 목적지별
        ...cities.map(c => `#${normalizeCity(c)}여행`),
    ].join(' ');

    // 인트로 스몰톡 — 오늘의 Top 3 내용 기반 동적 생성
    const introSmallTalk = generateSmartIntro(topFlights, now);

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


    <div class="post">

        <img src="images/blog-thumb-${formatDateForFilename(now)}-square.png" alt="${pageTitle}" style="width: 100%; max-width: 600px; display: block; margin: 0 auto 16px; border-radius: 12px;" />

        <h1 style="text-align: center; font-size: 22px; font-weight: 800; color: #1a1a1a; margin: 16px 0 24px; line-height: 1.5;">${pageTitle}</h1>

        <p>&nbsp;</p>
${introSmallTalk}

        <p>&nbsp;</p>

        <p class="section-title">🏆 ${dateLabel} 추천 특가 TOP3</p>
${rankSections}

        <p>&nbsp;</p>
        <p style="font-size: 13px; color: #888;">※ 유류할증료/텍스 포함 왕복 총액 기준</p>
        <p style="font-size: 13px; color: #e53e3e; font-weight: bold;">※ 좌석이 빠지면 가격이 바뀌거나 사라질 수 있어요.</p>


        <p>&nbsp;</p>

        <p class="section-title">💡 에디터 픽 : ${pickIndex + 1}위 ${displayCity(pickedFlight.departure?.city)}-${displayCity(pickedFlight.arrival?.city)}</p>
${fs.existsSync(UNSPLASH_PHOTO) ? `
        <p><img src="blog-cards/pick_photo.jpg" alt="${displayCity(pickedFlight.arrival?.city)} 여행" style="max-width: 100%; border-radius: 12px;"></p>
        <p style="font-size: 11px; color: #aaa;">사진: Unsplash</p>
` : ''}
            ${editorPick}
${icnSection}
${tipSection}

        <p>&nbsp;</p>

        <p>&nbsp;</p>
        ${pickRandom([
            `<p>오늘 소개한 특가 외에도</p>\n        <p>매일 새로운 땡처리 항공권이 올라오고 있어요.</p>\n        <p>&nbsp;</p>\n        <p>혹시 원하는 날짜나 목적지가 따로 있다면</p>\n        <p>한번 들러서 확인해보세요 😊</p>`,
            `<p>특가는 매일 바뀌니까,</p>\n        <p>출발 전에 한번 비교해보는 것도 좋아요.</p>\n        <p>&nbsp;</p>\n        <p>내가 원하는 날짜에 더 싼 게 있을 수도! 😊</p>`,
            `<p>항공권은 타이밍이에요 ⏰</p>\n        <p>좋은 가격은 빨리 사라지니까</p>\n        <p>&nbsp;</p>\n        <p>마음에 드는 게 있다면 바로 확인!</p>`,
            `<p>매일 새로운 특가가 올라오고 있어요.</p>\n        <p>&nbsp;</p>\n        <p>다음 여행지를 고민 중이라면</p>\n        <p>한번 구경해보세요 ✈️</p>`,
            `<p>오늘 본 가격이 내일은 없을 수도 있어요.</p>\n        <p>&nbsp;</p>\n        <p>여행 계획이 있다면</p>\n        <p>지금 한번 확인해보세요 😊</p>`,
            `<p>좋은 항공권은 금방 사라져요 💨</p>\n        <p>&nbsp;</p>\n        <p>관심 있는 노선이 있다면</p>\n        <p>가격 비교해보는 걸 추천해요!</p>`,
            `<p>땡처리 항공권은 매일 업데이트돼요.</p>\n        <p>&nbsp;</p>\n        <p>아직 원하는 게 없었다면</p>\n        <p>내일 다시 한번 확인해보세요 🙂</p>`,
            `<p>여행은 가격이 맞을 때가 타이밍이에요.</p>\n        <p>&nbsp;</p>\n        <p>오늘의 특가 중 마음에 드는 게 있다면</p>\n        <p>놓치지 마세요! ✈️</p>`,
        ])}
        <p>&nbsp;</p>
        <p><b>전국 여행사의 땡처리 항공권을 한눈에!</b></p>
        <p><a href="https://tikitikit.kr" class="cta-link">tikitikit.kr</a></p>

        <p>&nbsp;</p>
        <p>&nbsp;</p>
        <p>&nbsp;</p>
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
