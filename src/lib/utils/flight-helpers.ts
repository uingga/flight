/**
 * 항공편 관련 유틸리티 함수
 * Dashboard.tsx에서 추출
 */

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
    if (invalidNames.includes(name) || name.length > 20) return '';
    
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

// 네이버 항공권 비교 URL 생성 (왕복)
export const getNaverFlightUrl = (depCity: string, arrCity: string, depDate: string, retDate?: string, depAirport?: string, arrAirport?: string): string | null => {
    const depCode = getAirportCode(depCity, depAirport);
    const arrCode = getAirportCode(arrCity, arrAirport);
    if (!depCode || !arrCode) return null;
    const fmtD = (d: string) => d.replace(/[-\.]/g, '').slice(0, 8);
    const depStr = fmtD(depDate);
    if (depStr.length !== 8) return null;
    // 왕복: 귀국 날짜가 있고, 출발일과 다르면 왕복 URL
    if (retDate) {
        const retStr = fmtD(retDate);
        if (retStr.length === 8 && retStr !== depStr) {
            return `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depStr}/${arrCode}-${depCode}-${retStr}?adult=1&fareType=Y`;
        }
    }
    // 편도
    return `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depStr}?adult=1&fareType=Y`;
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
