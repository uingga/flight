/**
 * 항공편 관련 유틸리티 함수
 * Dashboard.tsx에서 추출
 */

import { buildNaverSearchUrl, type ExactRouteAirports } from '../naver-route';

/** 크롤 순서와 무관하게 항공권 내용만으로 같은 ID를 만든다. */
export const buildStableFlightId = (prefix: string, parts: (string | number)[]): string => {
    const raw = parts.join('|');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
    return `${prefix}-${(hash >>> 0).toString(36)}`;
};

// Helper: string(YYYY-MM-DD) <-> Date
export const toDate = (s: string) => s ? new Date(s + 'T00:00:00') : null;
export const toStr = (d: Date | null) => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
export const fmtDate = (s: string) => s ? s.slice(5).replace(/-/g, '.') : '';
export const getDefaultStartDate = () => toStr(new Date());
export const getDefaultEndDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toStr(d);
};

// 도시명 정규화: "서울(ICN)" → "인천", "서울(GMP)" → "김포", "서울" → "인천"
export const normalizeCity = (city: string): string => {
    const trimmed = city.trim();
    // 도시명 표기 통일 매핑
    const cityNameMap: Record<string, string> = {
        '푸껫': '푸켓',
        '청도': '칭다오',
        '연태': '옌타이',
        '상해': '상하이',
        '다카마츠': '다카마쓰',
        '비엔티엔': '비엔티안',
        '대만': '타이베이',
        '타이페이': '타이베이',
        'Trabzon': '트라브존',
        '치토세': '삿포로',
        '칼리보': '보라카이',
        '칼리보(보라카이)': '보라카이',
        '화리엔': '화롄',
        '화련': '화롄',
        '제남': '지난',
        '계림': '구이린',
        '위해': '웨이하이',
        '울란바타르': '울란바토르',
        '쿠마모토': '구마모토',
        '카오슝': '가오슝',
        '클라크': '클락',
        '로마 ': '로마',
    };
    let result = trimmed;
    // 괄호 포함 형태: "서울(ICN)", "부산(PUS)", "대구(TAE)"
    const codeMatch = trimmed.match(/^(.+?)\(([A-Z]{3})\)$/);
    if (codeMatch) {
        const code = codeMatch[2];
        if (code === 'ICN') result = '인천';
        else if (code === 'GMP') result = '김포';
        else if (code === 'PUS') result = '부산';
        else if (code === 'TAE') result = '대구';
        else if (code === 'CJJ') result = '청주';
        else if (code === 'CJU') result = '제주';
        else if (code === 'NRT') result = '도쿄(나리타)';
        else if (code === 'HND') result = '도쿄(하네다)';
        else if (code === 'KIX') result = '오사카(간사이)';
        else if (code === 'PVG') result = '상하이(푸동)';
        else if (code === 'SHA') result = '상하이(홍차오)';
        else if (code === 'BKK') result = '방콕(수완나폼)';
        else if (code === 'DPS') result = '발리';
        else result = codeMatch[1]; // 기타: 괄호만 제거
    } else {
        // 한글 괄호 형태: "서울(김포)", "서울(인천)", "마나도(인도네시아)"
        const krMatch = trimmed.match(/^(.+?)\((.+?)\)$/);
        if (krMatch) {
            if (krMatch[2] === '김포') result = '김포';
            else if (krMatch[2] === '인천') result = '인천';
            else {
                // 괄호 안이 공항/지역명이면 괄호 안 사용 (간사이, 나리타, 치토세 등)
                const airportNames = ['나리타', '하네다', '간사이', '이타미', '푸동', '홍차오', '돈무앙', '수완나폼', '깜랑', '보라카이'];
                if (airportNames.includes(krMatch[2])) result = trimmed; // 공항명 포함 원본 유지
                else result = krMatch[1]; // 그 외는 괄호 앞의 도시명
            }
        } else {
            // 그냥 "서울" → "인천" (김포가 아닌 서울은 인천공항)
            if (trimmed === '서울') result = '인천';
            else if (trimmed === '청주시') result = '청주';
            else if (trimmed === '제주시') result = '제주';
            else if (trimmed === '도쿄') result = '도쿄';
            else if (trimmed === '오사카') result = '오사카(간사이)';
            else if (trimmed === '방콕') result = '방콕';
        }
    }
    // 최종 매핑 적용 (푸껫→푸켓 등)
    return cityNameMap[result] || result;
};

// 항공사명 표기 통일 (슬로건, 괄호, 띄어쓰기, 영문코드 등)
export const normalizeAirline = (airline: string): string => {
    let name = airline.trim();
    
    // 괄호 제거: (대한항공) → 대한항공
    name = name.replace(/^\((.+)\)$/, '$1');
    
    // 슬로건 제거: "품격 있는 선택, 아시아나항공" → "아시아나항공"
    if (name.includes(',')) {
        const parts = name.split(',');
        const last = parts[parts.length - 1].trim();
        if (last.includes('항공') || last.includes('에어')) name = last;
    }
    
    // 의미없는 텍스트 필터링
    const invalidNames = ['항공사 제공요금', '항공사 미정', '더 저렴한 항공권', '공동운항', ''];
    if (invalidNames.includes(name) || name.length > 60) return '';
    
    // IATA 코드 → 한글명 변환
    const iataMap: Record<string, string> = {
        '7C': '제주항공', 'LJ': '진에어', 'TW': '티웨이항공', 'BX': '에어부산',
        'RS': '에어서울', 'ZE': '이스타항공', 'RF': '에어로케이', 'OZ': '아시아나항공',
        'KE': '대한항공', 'AC': '에어캐나다', 'AI': '에어인디아', 'VN': '베트남항공',
        'CA': '중국국제항공', 'CZ': '중국남방항공', 'MU': '중국동방항공',
        'SL': '타이라이온에어', 'NH': 'ANA항공',
    };
    if (iataMap[name]) return iataMap[name];
    
    // 영문 항공사명 통일
    const enMap: Record<string, string> = {
        'Airasia': '에어아시아', 'AirAsia': '에어아시아', 'airasia': '에어아시아',
    };
    if (enMap[name]) return enMap[name];
    
    // 띄어쓰기 & 표기 통일
    const nameMap: Record<string, string> = {
        '진 에어': '진에어', '에어 서울': '에어서울', '에어 부산': '에어부산',
        '에어 프레미아': '에어프레미아', '이스타 항공': '이스타항공',
        '제주 항공': '제주항공', '티웨이 항공': '티웨이항공',
        't way항공': '티웨이항공', 'T Way항공': '티웨이항공', "T'way항공": '티웨이항공',
        '타이 비엣젯항공': '타이비엣젯항공', '타이비엣젯 항공': '타이비엣젯항공',
        '비엣젯 항공': '비엣젯항공', '피치 항공': '피치항공',
        '스프링 항공': '스프링항공', '에어 아시아': '에어아시아',
        '에어로케이항공': '에어로케이', '스쿠트 타이거항공': '스쿠트항공',
        '젯스타 항공': '젯스타항공', '투르크메니스탄 항공': '투르크메니스탄항공',
        '루프트한자 시티항공': '루프트한자',
        '썬푸꾸옥 항공': '썬푸꾸옥항공', '썬푸꾸옥': '썬푸꾸옥항공',
        '타이에어아시아': '타이에어아시아',
        '파라타 항공': '파라타항공',
        // 티웨이항공은 2026년 10월 트리니티항공으로 사명이 바뀐다. 여행사마다 옛 이름과
        // 새 이름을 섞어 보내와 항공사 필터가 둘로 갈라지므로 하나로 합친다.
        // 사명 변경이 실제로 적용되면 이 매핑의 방향을 뒤집으면 된다.
        '트리니티항공': '티웨이항공', '트리니티 항공': '티웨이항공',
    };
    return nameMap[name] || name;
};

// 도시명 → IATA 공항/도시 코드 매핑
export const CITY_TO_AIRPORT: Record<string, string> = {
    // 출발지
    '인천': 'ICN', '김포': 'GMP', '부산': 'PUS', '부산(PUS)': 'PUS',
    '대구': 'TAE', '대구(TAE)': 'TAE', '제주': 'CJU', '제주시(CJU)': 'CJU',
    '청주': 'CJJ', '청주시(CJJ)': 'CJJ', '서울(ICN)': 'ICN',
    // 일본
    '도쿄(나리타)': 'NRT', '도쿄(NRT)': 'NRT', '도쿄(하네다)': 'HND',
    '오사카(간사이)': 'KIX', '오사카(KIX)': 'KIX',
    '후쿠오카': 'FUK', '삿포로(치토세)': 'CTS', '삿포로(CTS)': 'CTS', '치토세': 'CTS',
    '나고야': 'NGO', '오키나와': 'OKA', '오키나와(OKA)': 'OKA',
    '나가사키': 'NGS', '가고시마': 'KOJ', '가고시마(KOJ)': 'KOJ',
    '구마모토': 'KMJ', '마츠야마': 'MYJ', '다카마쓰': 'TAK',
    '시즈오카': 'FSZ',
    // 동남아
    '방콕': 'BKK', '방콕(BKK)': 'BKK', '방콕(수완나폼)': 'BKK', '방콕(돈무앙)': 'DMK',
    '다낭': 'DAD', '다낭(DAD)': 'DAD',
    '하노이': 'HAN', '하노이(HAN)': 'HAN',
    '나트랑': 'CXR', '나트랑(CXR)': 'CXR', '나트랑(깜랑)': 'CXR',
    '푸켓': 'HKT', '푸껫(HKT)': 'HKT',
    '세부': 'CEB', '세부(CEB)': 'CEB',
    '마닐라': 'MNL', '보홀': 'TAG', '보홀(TAG)': 'TAG', '보홀팡라오': 'TAG',
    '칼리보(보라카이)': 'KLO', '클락': 'CRK',
    '싱가포르': 'SIN', '싱가포르(SIN)': 'SIN', '싱가포르(창이공항)': 'SIN',
    '코타키나발루': 'BKI', '코타키나발루(BKI)': 'BKI',
    '치앙마이': 'CNX', '치앙마이(CNX)': 'CNX',
    '비엔티엔': 'VTE', '바탐': 'BTH', '바탐(인도네시아)': 'BTH',
    '발리': 'DPS', '발리(덴파사)': 'DPS', '마나도': 'MDC',
    '푸꾸옥': 'PQC', '푸꾸옥(PQC)': 'PQC',
    // 중화권
    '홍콩': 'HKG', '홍콩(HKG)': 'HKG',
    '대만(타이페이)': 'TPE', '타이페이': 'TPE', '타이베이': 'TPE', '타이베이(TPE)': 'TPE',
    '타이중': 'RMQ', '가오슝': 'KHH', '송산': 'TSA',
    '마카오': 'MFM', '싼야(SYX)': 'SYX',
    // 기타
    '괌': 'GUM', '사이판': 'SPN', '사이판(SPN)': 'SPN',
    '시드니': 'SYD', '브리즈번': 'BNE',
    '두바이': 'DXB', '아부다비': 'AUH',
    '로마': 'FCO', '이스탄불': 'IST', '트라브존': 'TZX',
    // 추가 누락 도시
    '보라카이': 'KLO', '호치민': 'SGN', '호치민(SGN)': 'SGN',
    '상해': 'PVG', '상하이': 'PVG', '칭다오': 'TAO', '청도': 'TAO',
    '사가': 'HSG', '요나고': 'YGJ', '히로시마': 'HIJ', '오이타': 'OIT',
    '밴쿠버': 'YVR', '비엔티안': 'VTE', '지난': 'TNA',
    '푸껫': 'HKT', '쿠알라룸푸르': 'KUL',
    '시모지시마': 'SHI', '미야코지마': 'SHI', '미야코': 'SHI', '아오모리': 'AOJ',
    '바르셀로나': 'BCN', '하이퐁': 'HPH',
    '서울': 'ICN', '청주시': 'CJJ',
    '상해(푸동)': 'PVG', '오사카': 'KIX', '도쿄': 'NRT', '삿포로': 'CTS',
    // 땡처리닷컴 추가 매핑
    '보홀(필리핀)': 'TAG', '산야(삼아)': 'SYX', '카오슝(대만)': 'KHH', '카오슝': 'KHH',
    '나트랑(깜란)': 'CXR', '연태(옌타이)': 'YNT', '웨이하이': 'WEH',
    '클락(앙헬레스)': 'CRK', '하코다테(북해도)': 'HKD', '하코다테': 'HKD',
    '고베': 'UKB', '기타큐슈': 'KKJ', '청도(칭다오)': 'TAO',
    '보라카이(깔리보)': 'KLO', '서울(김포)': 'GMP', '타이페이(송산)': 'TSA',
    // 땡처리닷컴 추가 매핑 2
    '도쿄(나리타공항)': 'NRT', '로마 (FCO)': 'FCO', '이스탄불(IST)': 'IST',
    '상해(푸동공항)': 'PVG', '타이중(대만)': 'RMQ', '마나도(인도네시아)': 'MDC',
    '하이퐁(베트남)': 'HPH',
    '구이린': 'KWL',
    '도야마': 'TOY', '도야마(TOY)': 'TOY',
    // 누락 도시 일괄 추가
    '대련': 'DLC', '장가계': 'DYG', '장가계(다융)': 'DYG',
    '하나마키': 'HNA', '화리엔': 'HUN', '화롄': 'HUN', '화련(대만)': 'HUN', '마츠모토': 'MMJ',
    '이바라키': 'IBR', '이시가키': 'ISG',
    '계림(구이린)': 'KWL', '다카마츠': 'TAK',
    '위해(웨이하이)': 'WEH', '제남(지난)': 'TNA',
    '타이중(대중)': 'RMQ', '미야코지마(시모지시마공항)': 'SHI',
    '알마티': 'ALA', '후허하오터': 'HET',
    // 추가 누락 도시 (썸네일 작업 시 확인)
    '도쿠시마': 'TKS', '오카야마': 'OKJ', '인촨': 'INC', '부지': 'FSZ', '오비히로': 'OBO',
};

// 도시명에서 공항코드 추출 (airport: 데이터에 이미 있는 공항코드 fallback)
export const getAirportCode = (city: string, airport?: string): string | null => {
    // 직접 매핑 확인
    if (CITY_TO_AIRPORT[city]) return CITY_TO_AIRPORT[city];
    // normalizeCity로 정규화 후 매핑 확인 (예: '제남(지난)' → '지난' → TNA)
    const normalized = normalizeCity(city);
    if (normalized !== city && CITY_TO_AIRPORT[normalized]) return CITY_TO_AIRPORT[normalized];
    // 괄호 안 코드 추출: "서울(ICN)" → ICN
    const match = city.match(/\(([A-Z]{3})\)/);
    if (match) return match[1];
    // 데이터의 airport 필드 사용 (마이리얼트립 등)
    if (airport && /^[A-Z]{3}$/.test(airport)) return airport;
    return null;
};

// 도시별 시간대 (IANA). 항공권의 출발·도착 시각은 각 공항의 현지 시각이라
// 그대로 빼면 시차만큼 어긋난다. 실제 비행시간을 내려면 UTC 오프셋 차이를 보정해야 한다.
// 키는 normalizeCity를 거친 도시명이며, 괄호가 붙은 형태(도쿄(나리타))는 조회 시 앞부분으로 되짚는다.
export const CITY_TIMEZONES: Record<string, string> = {
    // 한국 (출발지)
    '인천': 'Asia/Seoul', '김포': 'Asia/Seoul', '서울': 'Asia/Seoul', '부산': 'Asia/Seoul',
    '대구': 'Asia/Seoul', '청주': 'Asia/Seoul', '제주': 'Asia/Seoul', '무안': 'Asia/Seoul',
    '양양': 'Asia/Seoul', '광주': 'Asia/Seoul', '울산': 'Asia/Seoul', '여수': 'Asia/Seoul',
    // 일본
    '도쿄': 'Asia/Tokyo', '오사카': 'Asia/Tokyo', '후쿠오카': 'Asia/Tokyo', '삿포로': 'Asia/Tokyo',
    '나고야': 'Asia/Tokyo', '오키나와': 'Asia/Tokyo', '구마모토': 'Asia/Tokyo', '기타큐슈': 'Asia/Tokyo',
    '가고시마': 'Asia/Tokyo', '나가사키': 'Asia/Tokyo', '니가타': 'Asia/Tokyo', '다카마쓰': 'Asia/Tokyo',
    '도쿠시마': 'Asia/Tokyo', '마츠야마': 'Asia/Tokyo', '미야자키': 'Asia/Tokyo', '미야코지마': 'Asia/Tokyo',
    '사가': 'Asia/Tokyo', '센다이': 'Asia/Tokyo', '시모지시마': 'Asia/Tokyo', '시즈오카': 'Asia/Tokyo',
    '오이타': 'Asia/Tokyo', '요나고': 'Asia/Tokyo', '이시가키': 'Asia/Tokyo', '히로시마': 'Asia/Tokyo',
    '고베': 'Asia/Tokyo', '오카야마': 'Asia/Tokyo', '오비히로': 'Asia/Tokyo', '아사히카와': 'Asia/Tokyo',
    '하코다테': 'Asia/Tokyo', '고마츠': 'Asia/Tokyo', '도야마': 'Asia/Tokyo',
    // 중국
    '베이징': 'Asia/Shanghai', '상하이': 'Asia/Shanghai', '칭다오': 'Asia/Shanghai', '선전': 'Asia/Shanghai',
    '청두': 'Asia/Shanghai', '시안': 'Asia/Shanghai', '쿤밍': 'Asia/Shanghai', '구이린': 'Asia/Shanghai',
    '난창': 'Asia/Shanghai', '라싸': 'Asia/Shanghai', '리장': 'Asia/Shanghai', '시닝': 'Asia/Shanghai',
    '싼야': 'Asia/Shanghai', '오르도스': 'Asia/Shanghai', '우루무치': 'Asia/Shanghai', '우시': 'Asia/Shanghai',
    '웨이하이': 'Asia/Shanghai', '잔장': 'Asia/Shanghai', '장가계': 'Asia/Shanghai', '장자제': 'Asia/Shanghai',
    '장사': 'Asia/Shanghai', '정저우': 'Asia/Shanghai', '취안저우': 'Asia/Shanghai', '친황다오': 'Asia/Shanghai',
    '카슈가르': 'Asia/Shanghai', '타이위안': 'Asia/Shanghai', '후허하오터': 'Asia/Shanghai',
    '옌타이': 'Asia/Shanghai', '지난': 'Asia/Shanghai', '다롄': 'Asia/Shanghai', '선양': 'Asia/Shanghai',
    '하얼빈': 'Asia/Shanghai', '항저우': 'Asia/Shanghai', '난징': 'Asia/Shanghai', '충칭': 'Asia/Shanghai',
    '옌지': 'Asia/Shanghai', '인촨': 'Asia/Shanghai', '톈진': 'Asia/Shanghai', '천진': 'Asia/Shanghai',
    // 대만·홍콩·마카오
    '타이베이': 'Asia/Taipei', '가오슝': 'Asia/Taipei', '타이중': 'Asia/Taipei', '화롄': 'Asia/Taipei',
    '홍콩': 'Asia/Hong_Kong', '마카오': 'Asia/Macau',
    // 베트남
    '다낭': 'Asia/Ho_Chi_Minh', '하노이': 'Asia/Ho_Chi_Minh', '호치민': 'Asia/Ho_Chi_Minh',
    '나트랑': 'Asia/Ho_Chi_Minh', '푸꾸옥': 'Asia/Ho_Chi_Minh', '달랏': 'Asia/Ho_Chi_Minh',
    '하이퐁': 'Asia/Ho_Chi_Minh', '후에': 'Asia/Ho_Chi_Minh', '껀터': 'Asia/Ho_Chi_Minh',
    '반미투옷': 'Asia/Ho_Chi_Minh', '탄호아': 'Asia/Ho_Chi_Minh', '꾸이년': 'Asia/Ho_Chi_Minh',
    // 태국·캄보디아·라오스·미얀마
    '방콕': 'Asia/Bangkok', '푸켓': 'Asia/Bangkok', '치앙마이': 'Asia/Bangkok', '끄라비': 'Asia/Bangkok',
    '시엠립': 'Asia/Phnom_Penh', '프놈펜': 'Asia/Phnom_Penh', '크라티에': 'Asia/Phnom_Penh',
    '비엔티안': 'Asia/Vientiane', '루앙프라방': 'Asia/Vientiane', '양곤': 'Asia/Yangon',
    // 필리핀
    '마닐라': 'Asia/Manila', '세부': 'Asia/Manila', '보라카이': 'Asia/Manila', '보홀': 'Asia/Manila',
    '클락': 'Asia/Manila', '일로일로': 'Asia/Manila', '두마게테': 'Asia/Manila',
    '제네럴산토스': 'Asia/Manila', '카우아얀': 'Asia/Manila', '투게가라오': 'Asia/Manila',
    '보홀팡라오': 'Asia/Manila', '다바오': 'Asia/Manila',
    // 말레이시아·싱가포르·브루나이·인도네시아
    '쿠알라룸푸르': 'Asia/Kuala_Lumpur', '코타키나발루': 'Asia/Kuala_Lumpur', '페낭': 'Asia/Kuala_Lumpur',
    '싱가포르': 'Asia/Singapore', '반다르세리베가완': 'Asia/Brunei',
    '발리': 'Asia/Makassar', '마나도': 'Asia/Makassar',
    '자카르타': 'Asia/Jakarta', '솔로': 'Asia/Jakarta', '바탐': 'Asia/Jakarta',
    '암본': 'Asia/Jayapura',
    // 인도·스리랑카·몰디브·중앙아시아·몽골
    '델리': 'Asia/Kolkata', '뭄바이': 'Asia/Kolkata', '고아': 'Asia/Kolkata', '코치': 'Asia/Kolkata',
    '콜카타': 'Asia/Kolkata', '푸네': 'Asia/Kolkata', '파트나': 'Asia/Kolkata',
    '바라나시': 'Asia/Kolkata', '찬디가르': 'Asia/Kolkata',
    '콜롬보': 'Asia/Colombo', '몰디브': 'Indian/Maldives',
    '타슈켄트': 'Asia/Tashkent', '알마티': 'Asia/Almaty', '울란바토르': 'Asia/Ulaanbaatar',
    // 중동·튀르키예
    '두바이': 'Asia/Dubai', '아부다비': 'Asia/Dubai', '도하': 'Asia/Qatar',
    '이스탄불': 'Europe/Istanbul', '보드룸': 'Europe/Istanbul', '트라브존': 'Europe/Istanbul',
    // 태평양·오세아니아
    '괌': 'Pacific/Guam', '사이판': 'Pacific/Saipan', '누메아': 'Pacific/Noumea',
    '포트모르즈비': 'Pacific/Port_Moresby', '시드니': 'Australia/Sydney', '멜버른': 'Australia/Melbourne',
    '브리즈번': 'Australia/Brisbane', '오클랜드': 'Pacific/Auckland', '나디': 'Pacific/Fiji',
    // 미주 (일광절약시간 적용 지역 — 날짜 기준으로 오프셋을 계산한다)
    '마우이': 'Pacific/Honolulu', '코나': 'Pacific/Honolulu', '호놀룰루': 'Pacific/Honolulu',
    '온타리오': 'America/Los_Angeles', '팜스프링스': 'America/Los_Angeles',
    '로스앤젤레스': 'America/Los_Angeles', '샌프란시스코': 'America/Los_Angeles',
    '시애틀': 'America/Los_Angeles', '라스베이거스': 'America/Los_Angeles',
    '스테이트칼리지': 'America/New_York', '뉴욕': 'America/New_York', '워싱턴': 'America/New_York',
    '시카고': 'America/Chicago', '댈러스': 'America/Chicago',
    '밴쿠버': 'America/Vancouver', '토론토': 'America/Toronto',
    // 유럽·러시아
    '파리': 'Europe/Paris', '마르세유': 'Europe/Paris', '로마': 'Europe/Rome', '밀라노': 'Europe/Rome',
    '바르셀로나': 'Europe/Madrid', '마드리드': 'Europe/Madrid', '바르샤바': 'Europe/Warsaw',
    '런던': 'Europe/London', '프랑크푸르트': 'Europe/Berlin', '뮌헨': 'Europe/Berlin',
    '암스테르담': 'Europe/Amsterdam', '취리히': 'Europe/Zurich', '프라하': 'Europe/Prague',
    '빈': 'Europe/Vienna', '헬싱키': 'Europe/Helsinki',
    '상트페테르부르크': 'Europe/Moscow', '모스크바': 'Europe/Moscow', '블라디보스토크': 'Asia/Vladivostok',
};

/** 도시명 → IANA 시간대. 괄호가 붙은 표기(도쿄(나리타))는 앞부분 도시명으로 되짚는다. */
export const getCityTimeZone = (city: string): string | null => {
    if (!city) return null;
    const trimmed = city.trim();
    const candidates = [normalizeCity(trimmed), trimmed];
    for (const candidate of candidates) {
        if (CITY_TIMEZONES[candidate]) return CITY_TIMEZONES[candidate];
        const base = candidate.replace(/\(.*?\)/g, '').trim();
        if (base && CITY_TIMEZONES[base]) return CITY_TIMEZONES[base];
    }
    return null;
};

/** 특정 시점에 해당 시간대가 UTC와 몇 분 차이나는지 (일광절약시간 포함) */
const timeZoneOffsetMinutes = (timeZone: string, at: Date): number | null => {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        }).formatToParts(at);
        const value: Record<string, number> = {};
        for (const part of parts) {
            if (part.type !== 'literal') value[part.type] = Number(part.value);
        }
        if (Object.values(value).some(Number.isNaN)) return null;
        const asUTC = Date.UTC(value.year, value.month - 1, value.day, value.hour % 24, value.minute);
        return (asUTC - at.getTime()) / 60000;
    } catch {
        return null;
    }
};

const parseYmd = (date?: string): Date => {
    const match = date?.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
    // 일광절약시간 경계를 피하려고 정오 기준으로 오프셋을 잰다
    if (!match) return new Date();
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
};

const parseHm = (time?: string): number | null => {
    const match = time?.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
};

export interface FlightTiming {
    duration: string;
    arrivalDayOffset: number;
}

/** 여행사 응답과 수동 캡처의 비행시간 표기를 화면용 형식으로 통일한다. */
export const formatAgencyFlightDuration = (value?: string): string | null => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    const colon = trimmed.match(/^(\d{1,2}):(\d{2})/);
    const korean = trimmed.match(/^(\d{1,2})\s*시간(?:\s*(\d{1,2})\s*분)?/);
    const hours = Number(colon?.[1] ?? korean?.[1]);
    const minutes = Number(colon?.[2] ?? korean?.[2] ?? 0);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59 || (hours === 0 && minutes === 0)) {
        return null;
    }

    return `${hours}시간${minutes > 0 ? ` ${minutes}분` : ''}`;
};

/**
 * 실제 비행시간과 도착지 현지 날짜의 변경 일수.
 * 출·도착 시각이 각기 현지 시각이므로 UTC 오프셋 차이를 보정한다.
 * 예: 인천(+9) 22:00 → 방콕(+7) 01:00은 5시간 비행이며 현지 날짜는 다음 날(+1)이다.
 * 시간대를 모르는 도시는 틀린 값을 보여주느니 null을 돌려준다.
 */
export const calcFlightTiming = (
    depCity: string, depTime: string | undefined, depDate: string | undefined,
    arrCity: string, arrTime: string | undefined,
): FlightTiming | null => {
    const depMinutes = parseHm(depTime);
    const arrMinutes = parseHm(arrTime);
    if (depMinutes === null || arrMinutes === null) return null;

    const depZone = getCityTimeZone(depCity);
    const arrZone = getCityTimeZone(arrCity);
    if (!depZone || !arrZone) return null;

    const at = parseYmd(depDate);
    const depOffset = timeZoneOffsetMinutes(depZone, at);
    const arrOffset = timeZoneOffsetMinutes(arrZone, at);
    if (depOffset === null || arrOffset === null) return null;

    // 현지 시각 차이에 시차를 더해 실제 경과 시간으로 되돌린다
    let total = (arrMinutes - depMinutes) + (depOffset - arrOffset);
    let arrivalDayOffset = 0;
    // 날짜를 넘긴 경우 (도착 데이터에 날짜가 없어 가장 가까운 다음 날로 본다)
    while (total <= 0) {
        total += 24 * 60;
        arrivalDayOffset += 1;
    }
    // 30시간을 넘으면 데이터가 잘못된 것으로 보고 표시하지 않는다
    if (total > 30 * 60) return null;

    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return {
        duration: `${hours}시간${minutes > 0 ? ` ${minutes}분` : ''}`,
        arrivalDayOffset,
    };
};

/** 실제 비행시간만 필요한 기존 화면용 호환 함수. */
export const calcFlightDuration = (
    depCity: string, depTime: string | undefined, depDate: string | undefined,
    arrCity: string, arrTime: string | undefined,
): string | null => calcFlightTiming(depCity, depTime, depDate, arrCity, arrTime)?.duration || null;

// 네이버 항공권 비교 URL 생성 (왕복)
export const getNaverFlightUrl = (
    depCity: string,
    arrCity: string,
    depDate: string,
    retDate?: string,
    depAirport?: string,
    arrAirport?: string,
    routeAirports?: ExactRouteAirports,
): string | null => {
    if (routeAirports) return buildNaverSearchUrl(routeAirports, depDate, retDate);

    const depCode = getAirportCode(depCity, depAirport);
    const arrCode = getAirportCode(arrCity, arrAirport);
    if (!depCode || !arrCode) return null;
    return buildNaverSearchUrl({
        outboundDeparture: depCode,
        outboundArrival: arrCode,
        returnDeparture: arrCode,
        returnArrival: depCode,
    }, depDate, retDate);
};

// 스카이스캐너 비교 URL 생성 (왕복)
export const getSkyscannerUrl = (depCity: string, arrCity: string, depDate: string, retDate?: string, depAirport?: string, arrAirport?: string): string | null => {
    const depCode = getAirportCode(depCity, depAirport);
    const arrCode = getAirportCode(arrCity, arrAirport);
    if (!depCode || !arrCode) return null;
    const fmtD = (d: string) => {
        const clean = d.replace(/[-\.]/g, '').slice(0, 8);
        return clean.length === 8 ? clean.slice(2) : null; // YYMMDD
    };
    const depStr = fmtD(depDate);
    if (!depStr) return null;
    const dep = depCode.toLowerCase();
    const arr = arrCode.toLowerCase();
    // 왕복: 귀국 날짜가 있고, 출발일과 다르면 왕복 URL
    if (retDate) {
        const retStr = fmtD(retDate);
        if (retStr && retStr !== depStr) {
            return `https://www.skyscanner.co.kr/transport/flights/${dep}/${arr}/${depStr}/${retStr}/?adults=1`;
        }
    }
    // 편도
    return `https://www.skyscanner.co.kr/transport/flights/${dep}/${arr}/${depStr}/?adults=1`;
};
