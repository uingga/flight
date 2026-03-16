'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Flight } from '@/types/flight';
import Logo from './Logo';
import Sparkline from './Sparkline';
import dynamic from 'next/dynamic';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import * as gtag from '@/lib/analytics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DatePicker: any = dynamic(() => import('react-datepicker').then((mod: any) => mod.default), { ssr: false });
import styles from './Dashboard.module.css';

// Helper: string(YYYY-MM-DD) <-> Date
const toDate = (s: string) => s ? new Date(s + 'T00:00:00') : null;
const toStr = (d: Date | null) => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const fmtDate = (s: string) => s ? s.slice(5).replace(/-/g, '.') : '';
const getDefaultStartDate = () => toStr(new Date());
const getDefaultEndDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toStr(d);
};

// 도시명 정규화: "서울(ICN)" → "인천", "서울(GMP)" → "김포", "서울" → "인천"
const normalizeCity = (city: string): string => {
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
        '화리엔': '화롄',
        '제남': '지난',
        '계림': '구이린',
        '위해': '웨이하이',
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
        else result = codeMatch[1]; // 기타: 괄호만 제거
    } else {
        // 한글 괄호 형태: "서울(김포)", "서울(인천)", "마나도(인도네시아)"
        const krMatch = trimmed.match(/^(.+?)\((.+?)\)$/);
        if (krMatch) {
            if (krMatch[2] === '김포') result = '김포';
            else if (krMatch[2] === '인천') result = '인천';
            else {
                // 괄호 안이 공항/지역명이면 괄호 안 사용 (간사이, 나리타, 치토세 등)
                const airportNames = ['나리타', '하네다', '간사이', '이타미', '푸동', '홍차오', '돈무앙', '수완나폼', '깜랑', '보라카이', '덴파사'];
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

// 항공사명 표기 통일 (띄어쓰기 차이 등)
const normalizeAirline = (airline: string): string => {
    const trimmed = airline.trim();
    const airlineMap: Record<string, string> = {
        '진 에어': '진에어',
        '에어 서울': '에어서울',
        '에어 부산': '에어부산',
        '에어 프레미아': '에어프레미아',
        '이스타 항공': '이스타항공',
        '제주 항공': '제주항공',
        '티웨이 항공': '티웨이항공',
        't way항공': '티웨이항공',
        'T Way항공': '티웨이항공',
        'T\'way항공': '티웨이항공',
        '타이 비엣젯항공': '타이비엣젯항공',
        '타이비엣젯 항공': '타이비엣젯항공',
        '비엣젯 항공': '비엣젯항공',
        '피치항공': '피치항공',
        '피치 항공': '피치항공',
        '스프링항공': '스프링항공',
        '스프링 항공': '스프링항공',
        '에어아시아': '에어아시아',
        '에어 아시아': '에어아시아',
    };
    return airlineMap[trimmed] || trimmed;
};
// 도시명 → IATA 공항/도시 코드 매핑
const CITY_TO_AIRPORT: Record<string, string> = {
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
    '시모지시마': 'SHI', '아오모리': 'AOJ',
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
};

// 도시명에서 공항코드 추출
const getAirportCode = (city: string): string | null => {
    // 직접 매핑 확인
    if (CITY_TO_AIRPORT[city]) return CITY_TO_AIRPORT[city];
    // normalizeCity로 정규화 후 매핑 확인 (예: '제남(지난)' → '지난' → TNA)
    const normalized = normalizeCity(city);
    if (normalized !== city && CITY_TO_AIRPORT[normalized]) return CITY_TO_AIRPORT[normalized];
    // 괄호 안 코드 추출: "서울(ICN)" → ICN
    const match = city.match(/\(([A-Z]{3})\)/);
    if (match) return match[1];
    return null;
};

// 네이버 항공권 비교 URL 생성 (왕복)
const getNaverFlightUrl = (depCity: string, arrCity: string, depDate: string, retDate?: string): string | null => {
    const depCode = getAirportCode(depCity);
    const arrCode = getAirportCode(arrCity);
    if (!depCode || !arrCode) return null;
    const fmtDate = (d: string) => d.replace(/[\-\.]/g, '').slice(0, 8);
    const depStr = fmtDate(depDate);
    if (depStr.length !== 8) return null;
    // 왕복: 귀국 날짜가 있고, 출발일과 다르면 왕복 URL
    if (retDate) {
        const retStr = fmtDate(retDate);
        if (retStr.length === 8 && retStr !== depStr) {
            return `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depStr}/${arrCode}-${depCode}-${retStr}?adult=1&fareType=Y`;
        }
    }
    // 편도
    return `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depStr}?adult=1&fareType=Y`;
};

// 스카이스캐너 비교 URL 생성 (왕복)
const getSkyscannerUrl = (depCity: string, arrCity: string, depDate: string, retDate?: string): string | null => {
    const depCode = getAirportCode(depCity);
    const arrCode = getAirportCode(arrCity);
    if (!depCode || !arrCode) return null;
    const fmtDate = (d: string) => {
        const clean = d.replace(/[\-\.]/g, '').slice(0, 8);
        return clean.length === 8 ? clean.slice(2) : null; // YYMMDD
    };
    const depStr = fmtDate(depDate);
    if (!depStr) return null;
    const dep = depCode.toLowerCase();
    const arr = arrCode.toLowerCase();
    // 왕복: 귀국 날짜가 있고, 출발일과 다르면 왕복 URL
    if (retDate) {
        const retStr = fmtDate(retDate);
        if (retStr && retStr !== depStr) {
            return `https://www.skyscanner.co.kr/transport/flights/${dep}/${arr}/${depStr}/${retStr}/?adults=1`;
        }
    }
    // 편도
    return `https://www.skyscanner.co.kr/transport/flights/${dep}/${arr}/${depStr}/?adults=1`;
};

// Trip.com 어필리에이트 링크 생성
const TRIPCOM_ALLIANCE_ID = '7878543';
const TRIPCOM_SID = '295785953';
const TRIPCOM_SUB3 = 'D13108097';

// IATA 공항코드 → Trip.com 도시코드 매핑
const AIRPORT_TO_TRIPCOM_CITY: Record<string, string> = {
    'ICN': 'SEL', 'GMP': 'SEL', 'PUS': 'PUS', 'TAE': 'TAE', 'CJU': 'CJU', 'CJJ': 'CJJ',
    'NRT': 'TYO', 'HND': 'TYO', 'KIX': 'OSA', 'FUK': 'FUK', 'CTS': 'SPK', 'NGO': 'NGO',
    'OKA': 'OKA', 'TAK': 'TAK', 'KOJ': 'KOJ', 'MYJ': 'MYJ', 'KMJ': 'KMJ',
    'BKK': 'BKK', 'DMK': 'BKK', 'SGN': 'SGN', 'HAN': 'HAN', 'DAD': 'DAD', 'CXR': 'NHA',
    'MNL': 'MNL', 'CEB': 'CEB', 'DPS': 'DPS',
    'HKG': 'HKG', 'TPE': 'TPE', 'PVG': 'SHA', 'PEK': 'BJS',
    'SPN': 'SPN', 'GUM': 'GUM', 'HKT': 'HKT', 'CNX': 'CNX',
};

// Trip.com 도시명 → { id, name(한국어) } 매핑 (모두 브라우저/유저 확인됨 ✅)
const TRIPCOM_CITY_DATA: Record<string, { id: number; name: string; provinceId?: number }> = {
    // 일본
    '도쿄': { id: 228, name: '도쿄' }, '오사카': { id: 219, name: '오사카' },
    '후쿠오카': { id: 248, name: '후쿠오카' }, '삿포로': { id: 641, name: '삿포로' },
    '나고야': { id: 360, name: '나고야' }, '오키나와': { id: 207, name: '오키나와' },
    '교토': { id: 734, name: '교토' }, '하코다테': { id: 800, name: '하코다테' },
    '나가사키': { id: 205, name: '나가사키' }, '구마모토': { id: 4009, name: '구마모토' },
    '가고시마': { id: 735, name: '가고시마' }, '다카마쓰': { id: 5999, name: '다카마쓰' },
    '히로시마': { id: 262, name: '히로시마' }, '마츠야마': { id: 1698, name: '마츠야마' },
    '시즈오카': { id: 1176, name: '시즈오카' }, '사가': { id: 4252, name: '사가' },
    '요나고': { id: 6383, name: '요나고' }, '아오모리': { id: 4351, name: '아오모리' },
    '고베': { id: 423, name: '고베' }, '기타큐슈': { id: 3234, name: '기타큐슈' },
    '오이타': { id: 1286, name: '오이타' },
    // 동남아
    '방콕': { id: 359, name: '방콕' }, '치앙마이': { id: 623, name: '치앙마이' },
    '푸켓': { id: 725, name: '푸켓', provinceId: 11032 }, '다낭': { id: 1356, name: '다낭' },
    '호치민': { id: 301, name: '호치민' }, '하노이': { id: 286, name: '하노이' },
    '나트랑': { id: 1777, name: '나트랑' }, '세부': { id: 1239, name: '세부' },
    '마닐라': { id: 364, name: '마닐라' }, '발리': { id: 723, name: '발리' },
    '싱가포르': { id: 73, name: '싱가포르' }, '코타키나발루': { id: 1393, name: '코타키나발루' },
    '쿠알라룸푸르': { id: 315, name: '쿠알라룸푸르' }, '푸꾸옥': { id: 5649, name: '푸꾸옥 섬' },
    '보라카이': { id: 1391, name: '보라카이' }, '보홀': { id: 4257, name: '보홀' },
    '클락': { id: 77787, name: '클락' }, '하이퐁': { id: 6942, name: '하이퐁' },
    '비엔티안': { id: 486, name: '비엔티안' }, '바탐': { id: 3590, name: '바탐' },
    '마나도': { id: 1379, name: '마나도' },
    // 중화권
    '홍콩': { id: 58, name: '홍콩' }, '마카오': { id: 59, name: '마카오' },
    '타이페이': { id: 617, name: '타이베이' }, '타이베이': { id: 617, name: '타이베이' },
    '타이중': { id: 3849, name: '타이중' }, '가오슝': { id: 720, name: '가오슝' },
    '상하이': { id: 2, name: '상하이' }, '베이징': { id: 1, name: '베이징' },
    '칭다오': { id: 7, name: '칭다오' }, '옌타이': { id: 533, name: '옌타이' },
    '화롄': { id: 6954, name: '화롄' }, '지난': { id: 144, name: '지난' },
    '구이린': { id: 33, name: '구이린' },
    '웨이하이': { id: 386, name: '웨이하이' },
    // 기타
    '사이판': { id: 4081, name: '사이판' }, '괌': { id: 753, name: '괌' },
    '시드니': { id: 501, name: '시드니' }, '브리즈번': { id: 680, name: '브리즈번' },
    '두바이': { id: 220, name: '두바이' }, '아부다비': { id: 766, name: '아부다비' },
    '로마': { id: 343, name: '로마' }, '이스탄불': { id: 532, name: '이스탄불' },
    '트라브존': { id: 1760, name: '트라브존' }, '싼야': { id: 43, name: '싼야' },
    '바르셀로나': { id: 40795, name: '바르셀로나' }, '밴쿠버': { id: 476, name: '밴쿠버' },
    '시모지시마': { id: 50334, name: '미야코지마' },
};

const TRIPCOM_HOTEL_SUB3 = 'D13108706';

const getTripcomHotelUrl = (arrCity: string, depDate?: string, arrDate?: string): string | null => {
    // 공항명 괄호 제거하여 도시명만 추출 (e.g. '오사카(간사이)' → '오사카')
    let cityName = normalizeCity(arrCity);
    const bracketMatch = cityName.match(/^(.+?)\(.+?\)$/);
    if (bracketMatch) cityName = bracketMatch[1];
    const cityData = TRIPCOM_CITY_DATA[cityName];
    // 날짜 파라미터: 체크인=출발일, 체크아웃=출발일+1일 (1박 기준)
    let dateParams = '';
    if (depDate) {
        const checkin = new Date(depDate);
        const checkout = new Date(checkin);
        checkout.setDate(checkout.getDate() + 1);
        const fmt = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        dateParams = `&checkin=${fmt(checkin)}&checkout=${fmt(checkout)}`;
    }
    if (cityData) {
        const encodedName = encodeURIComponent(cityData.name);
        const provinceParam = cityData.provinceId ? `&provinceId=${cityData.provinceId}` : '';
        return `https://kr.trip.com/hotels/list?city=${cityData.id}&cityName=${encodedName}&searchType=CT&searchWord=${encodedName}${provinceParam}${dateParams}&locale=ko-KR&curr=KRW&Allianceid=${TRIPCOM_ALLIANCE_ID}&SID=${TRIPCOM_SID}&trip_sub1=&trip_sub3=${TRIPCOM_HOTEL_SUB3}`;
    }
    // 매핑에 없는 도시: 호텔 홈으로 연결
    return `https://kr.trip.com/hotels/w/home?${dateParams ? dateParams.substring(1) + '&' : ''}Allianceid=${TRIPCOM_ALLIANCE_ID}&SID=${TRIPCOM_SID}&trip_sub1=&trip_sub3=${TRIPCOM_HOTEL_SUB3}`;
};

const ITEMS_PER_PAGE = 20;

// 모바일 여부 체크
const checkIsMobile = () => {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// PC URL → 모바일 URL 변환
const getMobileUrl = (url: string, isMobile: boolean): string => {
    if (!isMobile || !url) return url;


    // 온라인투어: m.onlinetour.co.kr + /flight/m/ 경로 사용
    if (url.includes('onlinetour.co.kr')) {
        let mobileUrl = url.replace('www.onlinetour.co.kr', 'm.onlinetour.co.kr');
        mobileUrl = mobileUrl.replace('/flight/w/', '/flight/m/');
        mobileUrl = mobileUrl.replace('/dcair/dcairReservation', '/dcair/dcairReservationGuest');
        mobileUrl = mobileUrl.replace('/dcair/dcairList', '/dcair/list');
        return mobileUrl;
    }
    // 모두투어: www.modetour.com → m.modetour.com
    if (url.includes('www.modetour.com')) {
        return url.replace('www.modetour.com', 'm.modetour.com');
    }
    // 하나투어: PC URL 그대로 (모바일 fallback은 href에서 /api/redirect로 처리)
    if (url.includes('hanatour.com')) {
        return url;
    }
    // 노랑풍선: PC URL 파라미터를 모바일 URL에 전달 (도시 탭 선택)
    if (url.includes('fly.ybtour.co.kr')) {
        try {
            const parsed = new URL(url);
            const mobileUrl = new URL('https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts');
            mobileUrl.searchParams.set('efcTpCode', 'INV');
            mobileUrl.searchParams.set('efcCode', 'INV');
            for (const key of ['efcBannerCode', 'inhId', 'depDate', 'efcCityCode']) {
                const val = parsed.searchParams.get(key);
                if (val) mobileUrl.searchParams.set(key, val);
            }
            return mobileUrl.toString();
        } catch {
            return 'https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts?efcTpCode=INV&efcCode=INV';
        }
    }
    // 땡처리닷컴: www.ttang.com → m.ttang.com
    if (url.includes('www.ttang.com')) {
        return url.replace('www.ttang.com', 'm.ttang.com');
    }
    return url;
};

export default function Dashboard() {
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [priceHistory, setPriceHistory] = useState<Record<string, Array<{ date: string; minPrice: number }>>>({});
    const [interparkPrices, setInterparkPrices] = useState<Record<string, Record<string, { avg: number; lowest: number }>>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'price' | 'date' | 'airline' | 'discount' | 'discountRate'>('discount');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [regionFilter, setRegionFilter] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>(getDefaultStartDate());
    const [endDate, setEndDate] = useState<string>(getDefaultEndDate());
    const [departureFilter, setDepartureFilter] = useState<string>('all');
    const [airlineFilter, setAirlineFilter] = useState<string>('all');
    const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);
    const [showStickyPopup, setShowStickyPopup] = useState(false);
    const [shareToast, setShareToast] = useState<string | null>(null);
    const [sharedFlightId, setSharedFlightId] = useState<string | null>(null);
    const sharedRouteFallback = useRef<{ dep: string | null; arr: string | null; date: string | null } | null>(null);
    const [bookingFlight, setBookingFlight] = useState<Flight | null>(null);
    const [ttangConfirmFlight, setTtangConfirmFlight] = useState<Flight | null>(null);
    const [passengers, setPassengers] = useState({ adult: 1, child: 0, infant: 0 });
    const [bookingDisclaimer, setBookingDisclaimer] = useState<{ source: string; url: string } | null>(null);
    const disclaimerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const disclaimerWindowRef = useRef<Window | null>(null);
    const [favoriteFlights, setFavoriteFlights] = useState<string[]>([]);
    const [favFilter, setFavFilter] = useState(false);
    const [favToast, setFavToast] = useState<string | null>(null);
    const [showContactModal, setShowContactModal] = useState(false);
    const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
    const [contactSending, setContactSending] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [headerHidden, setHeaderHidden] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const lastScrollY = useRef(0);

    // 팁 페이지 데이터
    const tipPosts = useMemo(() => [
        { title: '땡처리 항공권, 이렇게 싸도 되나요?', slug: 'cheap-flights-101', emoji: '✈️' },
        { title: '지방공항이 인천보다 싼 노선 총정리', slug: 'regional-airports', emoji: '🗺️' },
        { title: '땡처리 항공권 Q&A 10가지', slug: 'faq-10', emoji: '❓' },
        { title: '일본 벚꽃 시즌 항공권 특가 가이드 🌸', slug: 'japan-cherry-blossom', emoji: '🌸' },
        { title: '동남아 우기·건기 따져서 싸게 가는 법', slug: 'southeast-asia-seasons', emoji: '🌏' },
        { title: '비행기 표 싸게 사는 법 2026 총정리', slug: 'cheap-tickets-2026', emoji: '💰' },
        { title: '땡처리, 무조건 싸다고요? 진짜 싼 건지 확인하는 법', slug: 'is-it-really-cheap', emoji: '🔍' },
    ], []);

    // 즐겨찾기 localStorage 로드
    useEffect(() => {
        try {
            const saved = localStorage.getItem('favoriteFlights');
            if (saved) setFavoriteFlights(JSON.parse(saved));
        } catch { }
    }, []);

    const toggleFavorite = (flightId: string, cityName: string) => {
        setFavoriteFlights(prev => {
            const next = prev.includes(flightId)
                ? prev.filter(id => id !== flightId)
                : [...prev, flightId];
            localStorage.setItem('favoriteFlights', JSON.stringify(next));
            if (next.includes(flightId)) {
                setFavToast(`⭐ ${cityName} 항공권 즐겨찾기 등록!`);
            } else {
                setFavToast(`${cityName} 항공권 즐겨찾기 해제`);
            }
            setTimeout(() => setFavToast(null), 2000);
            return next;
        });
    };

    const isFavoriteFlight = (flightId: string) => favoriteFlights.includes(flightId);

    useEffect(() => {
        fetchFlights();
        setIsMobile(checkIsMobile());


        // 30분마다 자동 새로고침
        const interval = setInterval(() => {
            fetchFlights();
        }, 30 * 60 * 1000);

        // 탭 다시 활성화 시 새로고침 (5분 이상 경과 시)
        let lastFetch = Date.now();
        const origFetch = fetchFlights;
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && Date.now() - lastFetch > 5 * 60 * 1000) {
                lastFetch = Date.now();
                origFetch();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    // 필터 변경 시 displayCount 리셋
    useEffect(() => {
        setDisplayCount(ITEMS_PER_PAGE);
    }, [searchTerm, sourceFilter, regionFilter, airlineFilter, startDate, endDate, departureFilter, sortBy, favFilter]);

    // 스크롤 감지 (맨위로 버튼 + 헤더 숨김)
    useEffect(() => {
        const handleScroll = () => {
            const currentY = window.scrollY;
            setShowScrollTop(currentY > 400);
            setIsScrolled(currentY > 300);
            setHeaderScrolled(currentY > 10);
            if (currentY > lastScrollY.current && currentY > 60) {
                setHeaderHidden(true);
            } else {
                setHeaderHidden(false);
            }
            lastScrollY.current = currentY;
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // IntersectionObserver 설정
    const lastElementRef = useCallback((node: HTMLDivElement | null) => {
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) {
                setDisplayCount(prev => prev + ITEMS_PER_PAGE);
            }
        });
        if (node) observerRef.current.observe(node);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const fetchFlights = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/flights');

            if (!response.ok) {
                throw new Error('항공권 데이터를 불러오는데 실패했습니다.');
            }

            const data = await response.json();
            setFlights(data.flights || []);
            setLastUpdated(data.lastUpdated || null);
            setPriceHistory(data.priceHistory || {});
            setInterparkPrices(data.interparkPrices || {});
        } catch (err) {
            setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    // 공유 링크에서 특정 항공편 필터링
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const flightId = params.get('flight');
        if (flightId) {
            setSharedFlightId(flightId);
            // Fallback 노선 정보 저장 (share 페이지에서 전달)
            const dep = params.get('dep');
            const arr = params.get('arr');
            const date = params.get('date');
            if (dep || arr || date) {
                sharedRouteFallback.current = { dep, arr, date };
            }
            // 공유 링크 접근 시 모든 필터 해제 (날짜/출발지 등이 매칭을 방해하지 않도록)
            setStartDate('');
            setEndDate('');
            setDepartureFilter('all');
            setRegionFilter('all');
            setSourceFilter('all');
            setAirlineFilter('all');
            setSearchTerm('');
            // URL 정리
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);

    const uniqueAirlines = useMemo(() => {
        const airlines = new Set(flights.map(f => normalizeAirline(f.airline)).filter(Boolean));
        return Array.from(airlines).sort((a, b) => a.localeCompare(b));
    }, [flights]);

    const averagePrices = useMemo(() => {
        const stats: Record<string, { sum: number; count: number }> = {};

        flights.forEach(flight => {
            if (flight.price > 0) {
                const city = flight.arrival.city;
                if (!stats[city]) {
                    stats[city] = { sum: 0, count: 0 };
                }
                stats[city].sum += flight.price;
                stats[city].count += 1;
            }
        });

        const averages: Record<string, number> = {};
        Object.keys(stats).forEach(city => {
            averages[city] = stats[city].sum / stats[city].count;
        });

        return averages;
    }, [flights]);

    // 각 노선별 최저가 계산
    const lowestPrices = useMemo(() => {
        const lowest: Record<string, number> = {};
        flights.forEach(flight => {
            const route = `${flight.departure.city}-${flight.arrival.city}`;
            if (!lowest[route] || flight.price < lowest[route]) {
                lowest[route] = flight.price;
            }
        });
        return lowest;
    }, [flights]);

    // 인기 도시 목록 (한국인 인기 여행지 기준, 데이터에 있는 도시만 표시)
    const popularCities = useMemo(() => {
        const topDestinations = [
            '오사카(간사이)', '도쿄(나리타)', '도쿄(하네다)', '후쿠오카',
            '다낭', '세부', '나트랑', '타이베이',
            '홍콩', '괌', '사이판', '하노이',
            '호치민', '푸켓', '발리', '싱가포르',
            '코타키나발루', '오키나와', '삿포로', '방콕'
        ];
        const availableCities = new Set(flights.map(f => f.arrival.city));
        return topDestinations.filter(city => availableCities.has(city)).slice(0, 8);
    }, [flights]);

    // 공유 기능
    const shareFlightText = (flight: Flight) => {
        const price = `${Math.floor(flight.price / 10000)}만원`;
        const depDate = formatDate(flight.departure.date);
        const arrDate = flight.arrival.date ? ` ~ ${formatDate(flight.arrival.date)}` : '';
        // 짧은 공유 URL: /share/항공편ID → 서버에서 OG 이미지 생성 → 메인 페이지로 리다이렉트
        // dep/arr/date 파라미터: ID 변경 시 노선 기반 fallback 매칭용
        const dep = normalizeCity(flight.departure.city);
        const arr = normalizeCity(flight.arrival.city);
        const dateRaw = flight.departure.date?.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
        const shareParams = new URLSearchParams();
        if (dep) shareParams.set('dep', dep);
        if (arr) shareParams.set('arr', arr);
        if (dateRaw) shareParams.set('date', dateRaw);
        const queryStr = shareParams.toString() ? `?${shareParams.toString()}` : '';
        const siteUrl = `${window.location.origin}/share/${encodeURIComponent(flight.id)}${queryStr}`;
        return `✈️ ${dep} → ${arr} ${price} | ${depDate}${arrDate} | ${flight.airline} | ${getSourceName(flight.source)}\n🔗 ${siteUrl}`;
    };

    const shareFlight = async (flight: Flight) => {
        const text = shareFlightText(flight);
        const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        const isMobile = checkIsMobile();
        try {
            if (isMobile && navigator.share) {
                await navigator.share({ text });
                gtag.trackShare(route, 'native_share');
            } else {
                await navigator.clipboard.writeText(text);
                gtag.trackShare(route, 'clipboard');
                setShareToast('✅ 링크가 복사되었습니다!');
                setTimeout(() => setShareToast(null), 2000);
            }
        } catch {
            try {
                await navigator.clipboard.writeText(text);
                gtag.trackShare(route, 'clipboard');
                setShareToast('✅ 링크가 복사되었습니다!');
                setTimeout(() => setShareToast(null), 2000);
            } catch { }
        }
    };

    // 인원수 반영 예약 URL 생성
    const getBookingUrl = (flight: Flight, pax: { adult: number; child: number; infant: number }) => {
        // 하나투어: psngrCntLst JSON
        if (flight.source === 'hanatour') {
            const psngrCntLst: Array<{ ageDvCd: string; psngrCnt: number }> = [];
            if (pax.adult > 0) psngrCntLst.push({ ageDvCd: 'A', psngrCnt: pax.adult });
            if (pax.child > 0) psngrCntLst.push({ ageDvCd: 'C', psngrCnt: pax.child });
            if (pax.infant > 0) psngrCntLst.push({ ageDvCd: 'I', psngrCnt: pax.infant });

            const fareIdMatch = flight.link.match(/fareId=([^&]+)/);

            if (fareIdMatch) {
                // fareId가 있으면 상세 예약 페이지로 직접 이동
                if (isMobile) {
                    const mobileBookingUrl = `https://m.hanatour.com/com/pmt/CHPC0PMT0011M100?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
                    const mobileSearchUrl = flight.searchLink
                        ? flight.searchLink.replace('hope.hanatour.com', 'm.hanatour.com').replace('M200', 'M100')
                        : 'https://m.hanatour.com/trp/air/CHPC0AIR0233M100';
                    return `/api/redirect?url=${encodeURIComponent(mobileBookingUrl)}&fallback=${encodeURIComponent(mobileSearchUrl)}`;
                }
                const pcBookingUrl = `https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
                const pcSearchLink = flight.searchLink || 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200';
                return `/api/redirect?url=${encodeURIComponent(pcBookingUrl)}&fallback=${encodeURIComponent(pcSearchLink)}`;
            }

            // fareId가 없으면 searchCond URL의 인원수를 업데이트하여 검색 페이지로 이동
            let url = flight.link || flight.searchLink || '';
            if (url.includes('searchCond=')) {
                try {
                    const scMatch = url.match(/searchCond=([^&]+)/);
                    if (scMatch) {
                        const sc = JSON.parse(decodeURIComponent(scMatch[1]));
                        sc.psngrCntLst = psngrCntLst;
                        url = url.replace(/searchCond=[^&]+/, `searchCond=${encodeURIComponent(JSON.stringify(sc))}`);
                    }
                } catch { }
            }
            if (isMobile) {
                return url.replace('hope.hanatour.com', 'm.hanatour.com').replace('www.hanatour.com', 'm.hanatour.com').replace('M200', 'M100');
            }
            return url.replace('hope.hanatour.com', 'www.hanatour.com');
        }

        // 모두투어: adult, child, infant 파라미터
        if (flight.source === 'modetour') {
            let url = flight.link
                .replace(/adult=\d+/, `adult=${pax.adult}`)
                .replace(/child=\d+/, `child=${pax.child}`)
                .replace(/infant=\d+/, `infant=${pax.infant}`);
            return getMobileUrl(url, isMobile);
        }

        // 땡처리닷컴: 항상 프로모션 페이지로 이동 + 출발-도착도시 하이라이트
        if (flight.source === 'ttang') {
            const depDate = flight.departure.date?.replace(/[-\.]/g, '').substring(0, 8) || '';
            const depCity = flight.departure.city?.replace(/\([^)]+\)/g, '').trim() || '';
            const arrCity = flight.arrival.city?.replace(/\([^)]+\)/g, '').trim() || '';
            const highlightText = depCity && arrCity ? `${depCity}-${arrCity}` : arrCity;
            const textFragment = highlightText ? `#:~:text=${encodeURIComponent(highlightText)}` : '';
            return `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${depDate}&adt=${pax.adult}&chd=${pax.child}&inf=${pax.infant}&page=1&scale=200${textFragment}`;
        }

        // 온라인투어: eventCode URL에 인원 파라미터 추가
        if (flight.source === 'onlinetour') {
            let url = flight.link;
            // 기존 파라미터가 있으면 교체, 없으면 추가
            if (url.includes('adt=')) {
                url = url.replace(/adt=\d+/, `adt=${pax.adult}`);
            } else {
                url += `&adt=${pax.adult}`;
            }
            if (pax.child > 0) url += `&chd=${pax.child}`;
            if (pax.infant > 0) url += `&inf=${pax.infant}`;
            return getMobileUrl(url, isMobile);
        }

        // 나머지 (ybtour 등): 인원 파라미터 없음
        return getMobileUrl(flight.link, isMobile);
    };

    const openBookingModal = (flight: Flight) => {
        setPassengers({ adult: 1, child: 0, infant: 0 });
        setBookingFlight(flight);
    };

    // 면책 팝업 닫기 (타이머 취소 + 미리 열린 빈 창 닫기)
    const dismissDisclaimer = () => {
        if (disclaimerTimerRef.current) {
            clearTimeout(disclaimerTimerRef.current);
            disclaimerTimerRef.current = null;
        }
        if (disclaimerWindowRef.current && !disclaimerWindowRef.current.closed) {
            disclaimerWindowRef.current.close();
            disclaimerWindowRef.current = null;
        }
        setBookingDisclaimer(null);
    };

    const confirmBooking = () => {
        if (!bookingFlight) return;
        const url = getBookingUrl(bookingFlight, passengers);
        const route = `${normalizeCity(bookingFlight.departure.city)}-${normalizeCity(bookingFlight.arrival.city)}`;
        gtag.trackBookingClick(bookingFlight.source, route, bookingFlight.price);

        setBookingFlight(null);

        if (!isMobile) {
            window.open(url, '_blank', 'noopener,noreferrer');
        } else {
            // 모바일: 새 탭으로 열기
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    // 노랑풍선/온라인투어용: 인원선택 없이 면책조항 팝업 후 자동 이동
    const disclaimerThenRedirect = (flight: Flight) => {
        const url = getMobileUrl(flight.link, isMobile);
        const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        gtag.trackBookingClick(flight.source, route, flight.price);
        setBookingDisclaimer({ source: flight.source, url });

        if (!isMobile) {
            // 데스크탑: 면책 팝업 보여준 뒤 새 탭에서 열기
            disclaimerTimerRef.current = setTimeout(() => {
                window.open(url, '_blank', 'noopener,noreferrer');
                setBookingDisclaimer(null);
            }, 2000);
        }
        // 모바일: 면책 팝업 + 수동 이동 버튼 (자동 이동 없음)
    };

    // 필터 전체 초기화 (출발지·날짜 모두 해제)
    const resetAllFilters = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setRegionFilter('all');
        setAirlineFilter('all');
        setDepartureFilter('all');
        setStartDate('');
        setEndDate('');
        setSortBy('discount');
    };

    // 홈으로 (인천/김포 + 기본 날짜 복원)
    const goHome = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setRegionFilter('all');
        setAirlineFilter('all');
        setDepartureFilter('all');
        setStartDate(getDefaultStartDate());
        setEndDate(getDefaultEndDate());
        setSortBy('discount');
        setSharedFlightId(null);
        sharedRouteFallback.current = null;
    };

    // 활성 필터 여부
    const hasActiveFilters = searchTerm || sourceFilter !== 'all' || regionFilter !== 'all' ||
        airlineFilter !== 'all' || departureFilter !== 'all' || startDate || endDate;

    const filteredFlights = flights.filter(flight => {
        const matchesSearch =
            flight.departure.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            flight.arrival.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            flight.airline.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesSource = sourceFilter === 'all' || flight.source === sourceFilter;
        const matchesRegion = regionFilter === 'all' || flight.region === regionFilter;
        const matchesAirline = airlineFilter === 'all' || normalizeAirline(flight.airline) === airlineFilter;
        const normalizeDate = (d: string) => {
            if (!d) return '';
            const m = d.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/);
            return m ? `${m[1]}-${m[2]}-${m[3]}` : d;
        };
        const flightDate = normalizeDate(flight.departure.date);
        const matchesDate =
            (!startDate || flightDate >= startDate) &&
            (!endDate || flightDate <= endDate);

        const matchesDeparture = departureFilter === 'all' || (() => {
            if (departureFilter === '인천') return /인천|김포|서울|ICN|GMP|SEL/.test(flight.departure.city);
            if (departureFilter === '부산') return /부산|김해|PUS/.test(flight.departure.city);
            return flight.departure.city.includes(departureFilter);
        })();


        // 공유 링크로 접근 시 해당 항공편만 표시
        if (sharedFlightId) {
            // 1. 정확한 ID 매칭
            if (flight.id === sharedFlightId) return true;
            // 2. fuzzy 매칭: ybtour ID에서 도착지+출발일 추출 → 같은 노선 매칭
            const parts = sharedFlightId.match(/^[^-]+-(.+)-(\d{8})-\d+$/);
            if (parts) {
                const [, city, dateStr] = parts;
                const flDate = flight.departure?.date?.replace(/[-\.]/g, '').substring(0, 8);
                if (flight.arrival?.city?.includes(city) && flDate === dateStr) return true;
            }
            // 3. Fallback: share 페이지에서 전달받은 노선 정보(dep/arr/date)로 매칭
            const fb = sharedRouteFallback.current;
            if (fb) {
                const flCity = flight.arrival?.city?.replace(/\([^)]+\)/g, '').trim();
                const flDate = flight.departure?.date?.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
                const matchArr = fb.arr && flCity && flCity.includes(fb.arr);
                const matchDate = fb.date && flDate && flDate.startsWith(fb.date.substring(0, 10));
                if (matchArr && matchDate) return true;
            }
            return false;
        }

        const matchesFav = !favFilter || isFavoriteFlight(flight.id);

        return matchesSearch && matchesSource && matchesRegion && matchesAirline && matchesDate && matchesDeparture && matchesFav;
    }).sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
            case 'price':
                comparison = a.price - b.price;
                break;
            case 'date':
                comparison = new Date(a.departure.date).getTime() - new Date(b.departure.date).getTime();
                if (comparison === 0) {
                    comparison = a.departure.time.localeCompare(b.departure.time);
                }
                break;
            case 'airline':
                comparison = a.airline.localeCompare(b.airline);
                break;
            case 'discountRate': {
                const getDiscountRate = (f: Flight) => {
                    const city = f.arrival.city?.replace(/\([^)]+\)/, '').trim();
                    const depMonth = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                    const ipMonthData = interparkPrices[city]?.[depMonth];
                    if (ipMonthData?.avg && f.price > 0) {
                        return ((ipMonthData.avg - f.price) / ipMonthData.avg) * 100;
                    }
                    return -999;
                };
                comparison = getDiscountRate(b) - getDiscountRate(a);
                break;
            }
            case 'discount': {
                // 스마트 정렬 (Penalty Score Sorting)
                // 기본적으로 가격순(최저가)으로 정렬하되, 네이버 최저가나 평균가를 넘으면 페널티 가중치를 부여합니다.
                const getSortScore = (flight: Flight) => {
                    const city = flight.arrival.city?.replace(/\([^)]+\)/, '').trim();
                    const depMonth = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                    const ipCityData = interparkPrices[city];
                    // 당월 데이터가 없으면 가장 가까운 월 데이터 사용
                    let ipMonthData = ipCityData?.[depMonth];
                    if (!ipMonthData && ipCityData && depMonth) {
                        const months = Object.keys(ipCityData).sort();
                        const closest = months.reduce((best, m) => {
                            const diff = Math.abs(m.localeCompare(depMonth));
                            const bestDiff = best ? Math.abs(best.localeCompare(depMonth)) : Infinity;
                            return diff < bestDiff ? m : best;
                        }, '' as string);
                        if (closest) ipMonthData = ipCityData[closest];
                    }

                    let score = flight.price;

                    // 인터파크 도시 데이터 자체가 없는 경우 — 약간 페널티 (검증 불가)
                    if (!ipMonthData) {
                        return score * 1.1;
                    }

                    // 1. 월간 최저가 이하 — 페널티 없음
                    if (flight.price <= ipMonthData.lowest) {
                        return score;
                    }

                    // 2. 최저가 초과 ~ ×1.2 이내 — 살짝 페널티
                    if (flight.price <= ipMonthData.lowest * 1.2) {
                        return score * 1.15;
                    }

                    // 3. 최저가의 120% 초과 ~ 평균가 미만 -> 페널티
                    if (flight.price < ipMonthData.avg) {
                        return score * 1.3;
                    }

                    // 4. 평균가보다 비싼 경우 (창렬) -> 맨 밑으로 유배
                    return score * 10;
                };

                const scoreA = getSortScore(a);
                const scoreB = getSortScore(b);

                comparison = scoreA - scoreB;

                // 기존 할인율 정렬은 내림차순(desc) 효과를 주기 위해 여기서 반전시켰지만,
                // 이제는 낮을수록 좋은 값(티어, 가격)이므로 기본 오름차순이 맞습니다.
                // 아래 sortOrder 처리와 맞물려 정상 작동합니다.
                break;
            }
        }

        return sortOrder === 'asc' ? comparison : -comparison;
    });

    // 표시할 항공권 (무한 스크롤용)
    const displayedFlights = filteredFlights.slice(0, displayCount);
    const hasMore = displayCount < filteredFlights.length;

    // ============================================
    // Insight Bars — 카드 사이에 삽입되는 정보 바
    // ============================================
    const generateInsightBar = (barIndex: number) => {
        // 순서: 인기도시 → 최근특가 → 할인Top5 → 계절추천 → 금요밤 → 주말출발 → 가격하락 → 20만원이하 → 내일출발 → 팁 → 지역현황
        const barOrder = [2, 15, 7, 11, 6, 9, 14, 10, 8, 5];
        const barType = barOrder[barIndex % barOrder.length];

        // 공유 도시 이미지맵 & 카드 렌더러
        const cityImageMap: Record<string, string> = {
            // Japan
            '오사카': 'osaka', '도쿄': 'tokyo', '후쿠오카': 'fukuoka', '삿포로': 'sapporo',
            '나고야': 'nagoya', '나가사키': 'nagasaki', '구마모토': 'kumamoto',
            '다카마쓰': 'takamatsu', '다카마츠': 'takamatsu', '마츠야마': 'matsuyama',
            '오키나와': 'okinawa', '미야코지마': 'miyakojima', '이시가키': 'ishigaki',
            '시모지시마': 'shimojishima', '시즈오카': 'shizuoka', '나라': 'nara',
            // Vietnam
            '다낭': 'danang', '나트랑': 'nhatrang', '하노이': 'hanoi', '호치민': 'hochiminh',
            '푸꾸옥': 'phuquoc', '하이퐁': 'haiphong',
            // Thailand
            '방콕': 'bangkok', '푸켓': 'phuket', '치앙마이': 'chiangmai',
            // Philippines
            '세부': 'cebu', '보라카이': 'boracay', '보홀': 'bohol', '클락': 'clark', '칼리보': 'kalibo',
            // Taiwan
            '타이베이': 'taipei', '타이페이': 'taipei', '가오슝': 'kaohsiung', '대만': 'taipei',
            // China
            '상하이': 'shanghai', '상해': 'shanghai', '청도': 'qingdao', '칭다오': 'qingdao',
            '계림': 'guilin', '구이린': 'guilin',
            '위해': 'weihai', '웨이하이': 'weihai', '연태': 'yantai', '옌타이': 'yantai',
            '제남': 'jinan', '지난': 'jinan',
            // Southeast Asia & Others
            '싱가포르': 'singapore', '홍콩': 'hongkong', '마카오': 'macau',
            '코타키나발루': 'kotakinabalu', '마나도': 'manado', '바탐': 'batam',
            '발리': 'bali', '비엔티엔': 'vientiane',
            // Pacific
            '괌': 'guam', '사이판': 'saipan',
            // Others
            '두바이': 'dubai', '이스탄불': 'istanbul', '로마': 'rome',
            '브리즈번': 'brisbane', '시드니': 'sydney', '런던': 'london', '울란바토르': 'ulaanbaatar',
            // Aliases with chitose
            '치토세': 'sapporo',
            // Seasonal / domestic
            '교토': 'kyoto', '하코네': 'hakone', '유후인': 'yufuin',
            '히로시마': 'hiroshima', '나하': 'naha', '부산': 'busan', '제주': 'jeju',
        };
        const getCityImage = (city: string) => {
            const base = city.replace(/\(.+\)/, '').trim();
            return cityImageMap[base] || null;
        };
        const renderCityCard = (key: string, city: string, line1: string, line2: string, onClick: (e: React.MouseEvent) => void) => {
            const imgKey = getCityImage(city);
            const hasImage = !!imgKey;
            return (
                <div
                    key={key}
                    className={`${styles.newFlightMiniCard} ${hasImage ? styles.newFlightMiniCardImg : ''}`}
                    style={hasImage ? { backgroundImage: `url(/images/cities/${imgKey}.png)` } : undefined}
                    onClick={onClick}
                >
                    {hasImage && <div className={styles.newFlightOverlay} />}
                    <div className={styles.newFlightRoute} style={hasImage ? { color: 'white', position: 'relative', zIndex: 1, textShadow: '0 1px 4px rgba(0,0,0,0.6)' } : undefined}>{city}</div>
                    <div className={styles.newFlightPrice} style={hasImage ? { color: 'white', position: 'relative', zIndex: 1, textShadow: '0 1px 4px rgba(0,0,0,0.6)' } : undefined}>{line1}</div>
                    <div className={styles.newFlightAirline} style={hasImage ? { color: 'rgba(255,255,255,0.85)', position: 'relative', zIndex: 1, textShadow: '0 1px 3px rgba(0,0,0,0.5)' } : undefined}>{line2}</div>
                </div>
            );
        };
        const renderCardBar = (barIdx: number, icon: string, title: string, cards: React.ReactNode) => {
            const scrollerId = `scroller-${barIdx}`;
            const scrollBy = (dir: number) => {
                const el = document.getElementById(scrollerId);
                if (el) el.scrollBy({ left: dir * 200, behavior: 'smooth' });
            };
            return (
                <div key={`insight-${barIdx}`} className={`${styles.insightBar} ${styles.insightBarNew}`}>
                    <div className={styles.newFlightHeader}>
                        <span>{icon} {title}</span>
                    </div>
                    <div className={styles.scrollerWrap}>
                        <button className={`${styles.scrollBtn} ${styles.scrollBtnLeft}`} onClick={(e) => { e.stopPropagation(); scrollBy(-1); }} aria-label="이전">‹</button>
                        <div id={scrollerId} className={styles.newFlightScroller}
                            onMouseDown={(e) => {
                                const el = e.currentTarget;
                                el.dataset.dragging = 'true';
                                el.dataset.dragged = 'false';
                                el.dataset.startX = String(e.pageX);
                                el.dataset.scrollLeft = String(el.scrollLeft);
                                el.dataset.prevX = String(e.pageX);
                                el.dataset.prevTime = String(Date.now());
                                el.dataset.velocity = '0';
                                el.style.cursor = 'grabbing';
                                el.style.userSelect = 'none';
                            }}
                            onMouseMove={(e) => {
                                const el = e.currentTarget;
                                if (el.dataset.dragging !== 'true') return;
                                const dx = e.pageX - Number(el.dataset.startX);
                                el.scrollLeft = Number(el.dataset.scrollLeft) - dx;
                                if (Math.abs(dx) > 5) {
                                    el.dataset.dragged = 'true';
                                    el.style.pointerEvents = 'auto';
                                    el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = 'none');
                                }
                                const now = Date.now();
                                const dt = now - Number(el.dataset.prevTime);
                                if (dt > 0) {
                                    el.dataset.velocity = String((e.pageX - Number(el.dataset.prevX)) / dt);
                                }
                                el.dataset.prevX = String(e.pageX);
                                el.dataset.prevTime = String(now);
                            }}
                            onMouseUp={(e) => {
                                const el = e.currentTarget;
                                el.dataset.dragging = 'false';
                                el.style.cursor = '';
                                el.style.userSelect = '';
                                let v = Number(el.dataset.velocity) * 15;
                                const glide = () => {
                                    if (Math.abs(v) < 0.5) {
                                        el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = '');
                                        return;
                                    }
                                    el.scrollLeft -= v;
                                    v *= 0.92;
                                    requestAnimationFrame(glide);
                                };
                                if (el.dataset.dragged === 'true') {
                                    requestAnimationFrame(glide);
                                } else {
                                    el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = '');
                                }
                            }}
                            onMouseLeave={(e) => {
                                const el = e.currentTarget;
                                if (el.dataset.dragging === 'true') {
                                    el.dataset.dragging = 'false';
                                    el.style.cursor = '';
                                    el.style.userSelect = '';
                                    let v = Number(el.dataset.velocity) * 15;
                                    const glide = () => {
                                        if (Math.abs(v) < 0.5) {
                                            el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = '');
                                            return;
                                        }
                                        el.scrollLeft -= v;
                                        v *= 0.92;
                                        requestAnimationFrame(glide);
                                    };
                                    requestAnimationFrame(glide);
                                }
                            }}
                        >
                            {cards}
                        </div>
                        <button className={`${styles.scrollBtn} ${styles.scrollBtnRight}`} onClick={(e) => { e.stopPropagation(); scrollBy(1); }} aria-label="다음">›</button>
                    </div>
                </div>
            );
        };

        switch (barType) {
            case 1: { // 🌏 지역별 현황
                const regionCounts: Record<string, number> = {};
                flights.forEach(f => {
                    if (f.region) {
                        regionCounts[f.region] = (regionCounts[f.region] || 0) + 1;
                    }
                });
                const regions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
                if (regions.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>🌏</span>
                        <div className={styles.insightContent}>
                            {regions.map(([region, count]) => (
                                <span
                                    key={region}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setRegionFilter(region); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {region} <span className={styles.insightChipCount}>{count}건</span>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 2: { // 🗺️ 도시 바로가기
                if (popularCities.length === 0) return null;
                return renderCardBar(barIndex, '🗺️', '인기 도시', popularCities.map(city => {
                    const nc = normalizeCity(city);
                    const cityFlights = flights.filter(f => normalizeCity(f.arrival.city) === nc);
                    const minP = cityFlights.length > 0 ? Math.min(...cityFlights.map(f => f.price)) : 0;
                    return renderCityCard(city, nc, minP > 0 ? `${Math.floor(minP / 10000)}만원~` : '', `${cityFlights.length}건`, (e) => { e.stopPropagation(); setSearchTerm(city); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 3: { // ✈️ 항공사별 최저가
                const airlinePrices: Record<string, number> = {};
                flights.forEach(f => {
                    if (f.airline && f.price > 0 && (!airlinePrices[f.airline] || f.price < airlinePrices[f.airline])) {
                        airlinePrices[f.airline] = f.price;
                    }
                });
                const topAirlines = Object.entries(airlinePrices).sort((a, b) => a[1] - b[1]).slice(0, 4);
                if (topAirlines.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>✈️</span>
                        <div className={styles.insightContent}>
                            <span>항공사별 최저가 —</span>
                            {topAirlines.map(([airline, price]) => (
                                <span
                                    key={airline}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setAirlineFilter(airline); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {airline} <strong>{Math.floor(price / 10000)}만원~</strong>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 4: { // 📅 출발 시기별
                const now = new Date();
                const thisWeekEnd = new Date(now);
                thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()));
                const nextWeekEnd = new Date(thisWeekEnd);
                nextWeekEnd.setDate(thisWeekEnd.getDate() + 7);
                const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

                let thisWeek = 0, nextWeek = 0, thisMonth = 0, nextMonth = 0;
                flights.forEach(f => {
                    const d = new Date(f.departure.date?.replace(/\./g, '-') || '');
                    if (isNaN(d.getTime())) return;
                    if (d <= thisWeekEnd) thisWeek++;
                    else if (d <= nextWeekEnd) nextWeek++;
                    if (d <= thisMonthEnd) thisMonth++;
                    else if (d <= nextMonthEnd) nextMonth++;
                });

                const chips: Array<{ label: string; count: number; start: string; end: string }> = [];
                if (thisWeek > 0) chips.push({ label: '이번 주 출발', count: thisWeek, start: toStr(now), end: toStr(thisWeekEnd) });
                if (nextWeek > 0) chips.push({ label: '다음 주 출발', count: nextWeek, start: toStr(thisWeekEnd), end: toStr(nextWeekEnd) });
                if (thisMonth > 0) chips.push({ label: '이번 달', count: thisMonth, start: toStr(now), end: toStr(thisMonthEnd) });
                if (nextMonth > 0) chips.push({ label: '다음 달', count: nextMonth, start: toStr(thisMonthEnd), end: toStr(nextMonthEnd) });

                if (chips.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>📅</span>
                        <div className={styles.insightContent}>
                            {chips.slice(0, 4).map(chip => (
                                <span
                                    key={chip.label}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setStartDate(chip.start); setEndDate(chip.end); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {chip.label} <span className={styles.insightChipCount}>{chip.count}건</span>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 5: { // 📝 여행 팁
                return renderCardBar(barIndex, '📝', '여행 꿀팁', tipPosts.map((post, i) => (
                    <a
                        key={`tip-${i}`}
                        href={`/tips/${post.slug}`}
                        className={styles.newFlightMiniCard}
                        style={{ textDecoration: 'none', color: 'inherit', padding: '14px 18px', maxWidth: '180px' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={styles.newFlightRoute} style={{ fontSize: '0.93rem', whiteSpace: 'normal' }}>{post.emoji} {post.title}</div>
                        <div className={styles.newFlightAirline}>읽어보기 →</div>
                    </a>
                )));
            }
            case 6: { // 🔥 역대급 할인 Top 5
                const discountFlights: Array<{ flight: Flight; percent: number }> = [];
                flights.forEach(f => {
                    const city = f.arrival.city?.replace(/\([^)]+\)/, '').trim();
                    const depMonth = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                    const ipMonthData = interparkPrices[city]?.[depMonth];
                    if (ipMonthData?.avg && f.price > 0) {
                        const percent = ((ipMonthData.avg - f.price) / ipMonthData.avg) * 100;
                        if (percent >= 10) {
                            discountFlights.push({ flight: f, percent });
                        }
                    }
                });
                // 할인율 내림차순 → 같은 도시 중복 제거 → Top 5
                discountFlights.sort((a, b) => b.percent - a.percent);
                const seenCities = new Set<string>();
                const top5 = discountFlights.filter(({ flight }) => {
                    const city = normalizeCity(flight.arrival.city);
                    if (seenCities.has(city)) return false;
                    seenCities.add(city);
                    return true;
                }).slice(0, 7);
                if (top5.length === 0) return null;
                return renderCardBar(barIndex, '🔥', '할인율 높은 항공권 Top 7', top5.map(({ flight, percent }) => {
                    const city = normalizeCity(flight.arrival.city);
                    const depDate = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10) || '';
                    return renderCityCard(flight.id, city, `${Math.floor(flight.price / 10000)}만원`, `-${Math.round(percent)}%`, (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 7: { // 💨 곧 출발
                const now7 = new Date();
                const toDateStr7 = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const tomorrow7 = new Date(now7); tomorrow7.setDate(now7.getDate() + 1);
                const day3 = new Date(now7); day3.setDate(now7.getDate() + 3);
                const tomorrowStr7 = toDateStr7(tomorrow7);
                const day3Str7 = toDateStr7(day3);

                const soonFlights: Flight[] = [];
                flights.forEach(f => {
                    const fd = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10);
                    if (!fd) return;
                    if (fd >= tomorrowStr7 && fd <= day3Str7) soonFlights.push(f);
                });
                if (soonFlights.length === 0) return null;
                soonFlights.sort((a, b) => a.price - b.price);
                const seen7 = new Set<string>();
                const unique7 = soonFlights.filter(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (seen7.has(city)) return false;
                    seen7.add(city);
                    return true;
                }).slice(0, 10);
                return renderCardBar(barIndex, '💨', '3일 이내 바로 떠날 수 있는 곳', unique7.map(f => {
                    const city = normalizeCity(f.arrival.city);
                    const fd = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10) || '';
                    return renderCityCard(f.id, city, `${Math.floor(f.price / 10000)}만원~`, '곧 출발', (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 9: { // ☀️ 주말 출발
                const weekendFlights9: Flight[] = [];
                flights.forEach(f => {
                    const fd = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10);
                    if (!fd) return;
                    const dt = new Date(fd);
                    if (isNaN(dt.getTime())) return;
                    const day = dt.getDay();
                    if (day === 0 || day === 6) weekendFlights9.push(f);
                });
                if (weekendFlights9.length === 0) return null;
                weekendFlights9.sort((a, b) => a.price - b.price);
                const seen9 = new Set<string>();
                const unique9 = weekendFlights9.filter(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (seen9.has(city)) return false;
                    seen9.add(city);
                    return true;
                }).slice(0, 10);
                return renderCardBar(barIndex, '☀️', '주말 출발 특가', unique9.map(f => {
                    const city = normalizeCity(f.arrival.city);
                    return renderCityCard(f.id, city, `${Math.floor(f.price / 10000)}만원~`, '주말 출발', (e) => { e.stopPropagation(); setSearchTerm(city); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 10: { // 💸 20만원 이하
                const cheapFlights: Flight[] = [];
                flights.forEach(f => {
                    if (f.price > 0 && f.price < 200000) cheapFlights.push(f);
                });
                if (cheapFlights.length === 0) return null;
                cheapFlights.sort((a, b) => a.price - b.price);
                const seen10 = new Set<string>();
                const unique10 = cheapFlights.filter(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (seen10.has(city)) return false;
                    seen10.add(city);
                    return true;
                }).slice(0, 5);
                return renderCardBar(barIndex, '💸', '20만원 이하로 갈 수 있는 곳', unique10.map(f => {
                    const city = normalizeCity(f.arrival.city);
                    return renderCityCard(f.id, city, `${Math.floor(f.price / 10000)}만원`, '20만원 이하', (e) => { e.stopPropagation(); setSearchTerm(city); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 8: { // 🌙 금요일 출발
                const friFlights8: Array<{ flight: Flight; time: string }> = [];
                flights.forEach(f => {
                    const dateStr = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10);
                    if (!dateStr) return;
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return;
                    if (d.getDay() === 5 && f.price > 0) {
                        friFlights8.push({ flight: f, time: f.departure?.time || '' });
                    }
                });
                if (friFlights8.length === 0) return null;
                friFlights8.sort((a, b) => a.flight.price - b.flight.price);
                const seenCities8 = new Set<string>();
                const uniqueFri8 = friFlights8.filter(({ flight }) => {
                    const city = normalizeCity(flight.arrival.city);
                    if (seenCities8.has(city)) return false;
                    seenCities8.add(city);
                    return true;
                }).slice(0, 10);
                return renderCardBar(barIndex, '🌙', '금요일 출발 특가', uniqueFri8.map(({ flight }) => {
                    const city = normalizeCity(flight.arrival.city);
                    const friDate = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10) || '';
                    return renderCityCard(flight.id, city, `${Math.floor(flight.price / 10000)}만원~`, '금요일 밤', (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 11: { // 📉 가격 하락 노선
                const today11 = new Date();
                const todayStr11 = `${today11.getFullYear()}-${String(today11.getMonth() + 1).padStart(2, '0')}-${String(today11.getDate()).padStart(2, '0')}`;
                const yesterday11 = new Date(today11);
                yesterday11.setDate(today11.getDate() - 1);
                const yesterdayStr11 = `${yesterday11.getFullYear()}-${String(yesterday11.getMonth() + 1).padStart(2, '0')}-${String(yesterday11.getDate()).padStart(2, '0')}`;

                type PriceDrop = { route: string; city: string; todayPrice: number; yesterdayPrice: number; drop: number };
                const drops: PriceDrop[] = [];

                for (const [route, history] of Object.entries(priceHistory)) {
                    if (!history || history.length < 2) continue;
                    const todayEntry = history.find(h => h.date === todayStr11);
                    const yesterdayEntry = history.find(h => h.date === yesterdayStr11);
                    if (!todayEntry || !yesterdayEntry) continue;
                    const drop = yesterdayEntry.minPrice - todayEntry.minPrice;
                    if (drop > 0) {
                        // 노선명에서 도시 추출: "부산-세부" → "세부", normalizeCity로 통일
                        const city = normalizeCity(route.split('-')[1] || route);
                        drops.push({ route, city, todayPrice: todayEntry.minPrice, yesterdayPrice: yesterdayEntry.minPrice, drop });
                    }
                }

                if (drops.length === 0) return null;
                // 하락폭 큰 순, 도시 중복 제거
                drops.sort((a, b) => b.drop - a.drop);
                const seenCities11 = new Set<string>();
                const topDrops = drops.filter(d => {
                    const nc = normalizeCity(d.city);
                    if (seenCities11.has(nc)) return false;
                    seenCities11.add(nc);
                    return true;
                }).slice(0, 5);

                return renderCardBar(barIndex, '📉', '어제보다 가격 내린 항공권', topDrops.map(d =>
                    renderCityCard(d.route, d.city, `${Math.floor(d.todayPrice / 10000)}만원`, `↓${Math.floor(d.drop / 10000)}만원`, (e) => { e.stopPropagation(); setSearchTerm(d.city); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); })
                ));
            }
            case 12: { // 👀 인기 항공권 (목적지별 항공편 수 기준)
                const destCounts: Record<string, { count: number; minPrice: number }> = {};
                flights.forEach(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (!destCounts[city]) destCounts[city] = { count: 0, minPrice: f.price };
                    destCounts[city].count++;
                    if (f.price < destCounts[city].minPrice) destCounts[city].minPrice = f.price;
                });
                const popular = Object.entries(destCounts)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 5);
                if (popular.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>👀</span>
                        <div className={styles.insightContent}>
                            <span>오늘 항공권 많은 도시 —</span>
                            {popular.map(([city, data]) => (
                                <span
                                    key={city}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setSearchTerm(city); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {city} <span className={styles.insightChipCount}>{data.count}건</span>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 14: { // 🌸 계절 추천
                const month = new Date().getMonth() + 1;
                type SeasonRec = { emoji: string; city: string; reason: string };
                const seasonMap: Record<number, { title: string; recs: SeasonRec[] }> = {
                    1: {
                        title: '1월 여행 추천', recs: [
                            { emoji: '❄️', city: '삿포로', reason: '눈축제' },
                            { emoji: '🏖️', city: '다낭', reason: '건기 시작' },
                            { emoji: '🌴', city: '방콕', reason: '건기 여행' },
                            { emoji: '⛷️', city: '나세라', reason: '강설 코스' },
                        ]
                    },
                    2: {
                        title: '2월 여행 추천', recs: [
                            { emoji: '🌺', city: '다낭', reason: '꽃 시즌' },
                            { emoji: '🌴', city: '세부', reason: '건기 여행' },
                            { emoji: '🌞', city: '푸켓', reason: '건기 성수기' },
                            { emoji: '🌴', city: '방콕', reason: '베스트 시즌' },
                        ]
                    },
                    3: {
                        title: '3월 여행 추천', recs: [
                            { emoji: '🌸', city: '후쿠오카', reason: '벚꽃 시작' },
                            { emoji: '🏖️', city: '다낭', reason: '건기 여행' },
                            { emoji: '🌺', city: '타이페이', reason: '벚꽃 시즌' },
                            { emoji: '🌴', city: '세부', reason: '건기 끝무렵' },
                        ]
                    },
                    4: {
                        title: '4월 여행 추천', recs: [
                            { emoji: '🌸', city: '도쿄', reason: '벚꽃 절정' },
                            { emoji: '🌸', city: '오사카', reason: '벚꽃 절정' },
                            { emoji: '🌿', city: '다낭', reason: '건기 여행' },
                            { emoji: '🏖️', city: '보라카이', reason: '바다 시즌' },
                        ]
                    },
                    5: {
                        title: '5월 여행 추천', recs: [
                            { emoji: '🌿', city: '오키나와', reason: '우기 전 바다' },
                            { emoji: '🌺', city: '다낭', reason: '건기 마지막' },
                            { emoji: '🏖️', city: '발리', reason: '건기 여행' },
                            { emoji: '🌞', city: '타이페이', reason: '망고 시즌' },
                        ]
                    },
                    6: {
                        title: '6월 여행 추천', recs: [
                            { emoji: '🏖️', city: '오키나와', reason: '우기 전 마지막' },
                            { emoji: '🌿', city: '후쿠오카', reason: '매실 전 여유' },
                            { emoji: '🏖️', city: '괌', reason: '건기 여행' },
                            { emoji: '🌞', city: '런던', reason: '여름 시작' },
                        ]
                    },
                    7: {
                        title: '7월 여행 추천', recs: [
                            { emoji: '🏖️', city: '세부', reason: '우기 피한 해변' },
                            { emoji: '🌊', city: '괌', reason: '투명 바다' },
                            { emoji: '🌞', city: '런던', reason: '여름 여행' },
                            { emoji: '🏔️', city: '울란바토르', reason: '초원 여행' },
                        ]
                    },
                    8: {
                        title: '8월 여행 추천', recs: [
                            { emoji: '🏖️', city: '사이판', reason: '투명 바다' },
                            { emoji: '🌊', city: '발리', reason: '건기 여행' },
                            { emoji: '🏖️', city: '다낭', reason: '우기지만 저렴' },
                            { emoji: '🌞', city: '로마', reason: '유럽 여행' },
                        ]
                    },
                    9: {
                        title: '9월 여행 추천', recs: [
                            { emoji: '🍁', city: '오사카', reason: '가을 여행' },
                            { emoji: '🌿', city: '다낭', reason: '우기 끝무렵' },
                            { emoji: '🏖️', city: '세부', reason: '비수기 특가' },
                            { emoji: '🌞', city: '방콕', reason: '비수기 특가' },
                        ]
                    },
                    10: {
                        title: '10월 여행 추천', recs: [
                            { emoji: '🍁', city: '도쿄', reason: '단풍 여행' },
                            { emoji: '🌿', city: '다낭', reason: '건기 시작' },
                            { emoji: '🏖️', city: '푸켓', reason: '건기 시작' },
                            { emoji: '🌞', city: '발리', reason: '건기 여행' },
                        ]
                    },
                    11: {
                        title: '11월 여행 추천', recs: [
                            { emoji: '🍁', city: '나라', reason: '단풍 마지막' },
                            { emoji: '🌴', city: '다낭', reason: '건기 여행' },
                            { emoji: '🏖️', city: '세부', reason: '건기 여행' },
                            { emoji: '🌞', city: '방콕', reason: '건기 시작' },
                        ]
                    },
                    12: {
                        title: '12월 여행 추천', recs: [
                            { emoji: '❄️', city: '삿포로', reason: '눈축제 여행' },
                            { emoji: '🌴', city: '세부', reason: '건기 여행' },
                            { emoji: '🏖️', city: '푸켓', reason: '건기 성수기' },
                            { emoji: '🌞', city: '방콕', reason: '베스트 시즌' },
                        ]
                    },
                };
                const season = seasonMap[month];
                if (!season) return null;
                return renderCardBar(barIndex, '🌸', season.title, season.recs.map(r =>
                    renderCityCard(r.city, r.city, r.reason, r.emoji, (e) => { e.stopPropagation(); setSearchTerm(r.city); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); })
                ));
            }
            case 15: { // ✨ 새로 올라온 항공권
                const todayStr15 = new Date().toISOString().split('T')[0];
                let titlePrefix = '오늘';

                // 그룹핑 함수
                const groupFlights = (list: Flight[]) => {
                    const rm = new Map<string, { dep: string; arr: string; minPrice: number; count: number; depDate: string; arrDate: string; latestSeen: string }>();
                    list.forEach((f: any) => {
                        const dep = normalizeCity(f.departure.city);
                        const arr = normalizeCity(f.arrival.city);
                        const seen = f.firstSeen || '';
                        const existing = rm.get(arr);
                        if (!existing) {
                            rm.set(arr, { dep, arr, minPrice: f.price, count: 1, depDate: f.departure.date, arrDate: f.arrival.date, latestSeen: seen });
                        } else {
                            existing.count++;
                            if (seen > existing.latestSeen) existing.latestSeen = seen;
                            if (f.price < existing.minPrice) {
                                existing.minPrice = f.price;
                                existing.dep = dep;
                                existing.depDate = f.departure.date;
                                existing.arrDate = f.arrival.date;
                            }
                        }
                    });
                    // 최근 등록순 (내림차순) → 같은 날이면 가격순
                    return Array.from(rm.values()).sort((a, b) => a.latestSeen > b.latestSeen ? -1 : a.latestSeen < b.latestSeen ? 1 : a.minPrice - b.minPrice);
                };

                // 오늘 것 먼저
                let newFlights15 = flights.filter((f: any) => f.firstSeen === todayStr15 && f.price > 0);
                let groupedRoutes = groupFlights(newFlights15);

                // 노선이 7개 미만이면 최근 3일까지 확장
                if (groupedRoutes.length < 7) {
                    const d3 = new Date();
                    d3.setDate(d3.getDate() - 3);
                    const d3Str = d3.toISOString().split('T')[0];
                    newFlights15 = flights.filter((f: any) => f.firstSeen && f.firstSeen >= d3Str && f.price > 0);
                    groupedRoutes = groupFlights(newFlights15);
                    titlePrefix = '최근';
                }
                if (groupedRoutes.length === 0) return null;

                const routeLabel = groupedRoutes.length <= 10 ? ` ${groupedRoutes.length}개 노선` : '';
                return renderCardBar(barIndex, '✨', `${titlePrefix} 올라온 특가${routeLabel}`, groupedRoutes.slice(0, 20).map((r, i) => {
                    const depDate = r.depDate ? new Date(r.depDate.replace(/\./g, '-')) : null;
                    const arrDate = r.arrDate ? new Date(r.arrDate.replace(/\./g, '-')) : null;
                    const dateStr = depDate && arrDate && !isNaN(depDate.getTime()) && !isNaN(arrDate.getTime())
                        ? `${depDate.getMonth() + 1}/${depDate.getDate()}~${arrDate.getMonth() + 1}/${arrDate.getDate()}`
                        : '';
                    const priceStr = `${Math.floor(r.minPrice / 10000)}만${r.minPrice % 10000 > 0 ? Math.floor((r.minPrice % 10000) / 1000) + '천' : ''}원~`;
                    const dateInfo = `${dateStr}${r.count > 1 ? ` 외 ${r.count - 1}건` : ''}`;
                    return renderCityCard(`new-${i}`, r.arr, priceStr, dateInfo, (e) => { e.stopPropagation(); setSearchTerm(r.arr); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            default:
                return null;
        }
    };

    const formatPrice = (price: number) => {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
        }).format(price);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '날짜 확인';
        try {
            // 한국식 날짜 형식 처리: "2026.02.22(일)" -> "2026-02-22"
            let normalizedDate = dateStr;

            // "YYYY.MM.DD(요일)" 형식 처리
            const koreanDateMatch = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
            if (koreanDateMatch) {
                normalizedDate = `${koreanDateMatch[1]}-${koreanDateMatch[2]}-${koreanDateMatch[3]}`;
            }

            // "YY.MM.DD" 형식 처리 (2자리 연도)
            const shortYearMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
            if (shortYearMatch && !koreanDateMatch) {
                normalizedDate = `20${shortYearMatch[1]}-${shortYearMatch[2]}-${shortYearMatch[3]}`;
            }

            const date = new Date(normalizedDate);
            if (isNaN(date.getTime())) {
                return dateStr; // 파싱 실패시 원본 반환
            }
            return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    const calcDuration = (depTime: string | undefined, arrTime: string | undefined, depDate: string | undefined, arrDate: string | undefined) => {
        if (!depTime || !arrTime) return null;
        const [dh, dm] = depTime.split(':').map(Number);
        const [ah, am] = arrTime.split(':').map(Number);
        if (isNaN(dh) || isNaN(dm) || isNaN(ah) || isNaN(am)) return null;
        let diffMin = (ah * 60 + am) - (dh * 60 + dm);
        // If arrival is earlier in the day, assume next day (overnight flight)
        if (diffMin <= 0 && depDate !== arrDate) {
            diffMin += 24 * 60;
        }
        if (diffMin <= 0) return null;
        const hours = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        return `${hours}시간${mins > 0 ? ` ${mins}분` : ''}`;
    };

    const getSourceBadgeClass = (source: string) => {
        switch (source) {

            case 'ybtour': return styles.badgeYbtour;
            case 'modetour': return styles.badgeModetour;
            case 'hanatour': return styles.badgeHanatour;
            case 'onlinetour': return styles.badgeOnlinetour;
            case 'ttang': return styles.badgeTtang;
            default: return '';
        }
    };

    const getSourceName = (source: string) => {
        switch (source) {

            case 'ybtour': return '노랑풍선';
            case 'modetour': return '모두투어';
            case 'hanatour': return '하나투어';
            case 'onlinetour': return '온라인투어';
            case 'ttang': return '땡처리닷컴';
            default: return source;
        }
    };

    return (
        <div className={styles.dashboard}>
            <header className={`${styles.header} ${(headerHidden || (isMobile && isScrolled)) ? styles.headerHidden : ''} ${headerScrolled ? styles.headerScrolled : ''}`}>
                <div className={styles.headerContainer}>
                    <div className={styles.headerLeft}>
                        <h1 className={styles.title} onClick={() => { goHome(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ cursor: 'pointer' }}>
                            <Logo size={isMobile ? 0.95 : 1.05} />
                        </h1>
                    </div>
                    <div className={styles.headerRight}>
                        <p className={styles.subtitle}>
                            전국 여행사의 <strong className={styles.highlight}>땡처리 항공권</strong>을 한눈에! 🚀
                        </p>
                    </div>
                </div>
            </header>

            {/* 스크롤 시 고정 필터 바 */}
            {(() => {
                const [stickyDrop, setStickyDrop] = React.useState<'date' | 'departure' | 'region' | null>(null);
                return (
                <div className={`${styles.stickyFilterBar} ${isScrolled ? styles.stickyFilterBarVisible : ''}`}>
                    {stickyDrop && <div className={styles.stickyBackdrop} onClick={() => setStickyDrop(null)} />}
                    <div className={styles.stickyChips}>
                        {/* 날짜 칩 */}
                        <div className={styles.stickyChipWrap}>
                            <button
                                className={`${styles.stickyChip} ${startDate ? styles.stickyChipActive : ''} ${stickyDrop === 'date' ? styles.stickyChipOpen : ''}`}
                                onClick={(e) => { e.stopPropagation(); setStickyDrop(stickyDrop === 'date' ? null : 'date'); }}
                            >
                                📅 {startDate ? `${startDate.slice(5).replace('-', '.')}` : '전체'}
                                {endDate ? ` ~ ${endDate.slice(5).replace('-', '.')}` : ''}
                                <span className={styles.stickyChevron}>{stickyDrop === 'date' ? '▲' : '▼'}</span>
                            </button>
                            {stickyDrop === 'date' && (
                                <div className={`${styles.stickyMiniDrop} ${styles.stickyMiniDropLeft}`}>
                                    <DatePicker
                                        selectsRange={true}
                                        startDate={toDate(startDate)}
                                        endDate={toDate(endDate)}
                                        onChange={(update: [Date | null, Date | null]) => {
                                            const [start, end] = update;
                                            setStartDate(toStr(start));
                                            setEndDate(toStr(end));
                                            if (end) {
                                                gtag.trackDateFilter(toStr(start), toStr(end));
                                                setStickyDrop(null);
                                            }
                                        }}
                                        locale={ko}
                                        inline
                                        minDate={new Date()}
                                        calendarClassName={styles.stickyCalendar}
                                    />
                                    {(startDate || endDate) && (
                                        <button
                                            className={styles.stickyResetBtn}
                                            onClick={() => { setStartDate(''); setEndDate(''); setStickyDrop(null); }}
                                        >
                                            날짜 초기화
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 출발 칩 */}
                        <div className={styles.stickyChipWrap}>
                            <button
                                className={`${styles.stickyChip} ${departureFilter !== 'all' ? styles.stickyChipActive : ''} ${stickyDrop === 'departure' ? styles.stickyChipOpen : ''}`}
                                onClick={(e) => { e.stopPropagation(); setStickyDrop(stickyDrop === 'departure' ? null : 'departure'); }}
                            >
                                ✈️ 출발 {departureFilter === 'all' ? '전체' : departureFilter === '인천' ? '인천/김포' : departureFilter === '부산' ? '부산/김해' : departureFilter}
                                <span className={styles.stickyChevron}>{stickyDrop === 'departure' ? '▲' : '▼'}</span>
                            </button>
                            {stickyDrop === 'departure' && (
                                <div className={styles.stickyMiniDrop}>
                                    <div className={styles.stickyMiniList}>
                                        {[
                                            { value: 'all', label: '전체' },
                                            { value: '인천', label: '인천/김포' },
                                            { value: '부산', label: '부산/김해' },
                                            { value: '대구', label: '대구' },
                                            { value: '청주', label: '청주' },
                                            { value: '제주', label: '제주' },
                                        ].map((opt) => (
                                            <button
                                                key={opt.value}
                                                className={`${styles.stickyOptionChip} ${departureFilter === opt.value ? styles.stickyOptionActive : ''}`}
                                                onClick={() => { setDepartureFilter(opt.value); gtag.trackFilterChange('departure', opt.value); setStickyDrop(null); }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 도착 칩 */}
                        <div className={styles.stickyChipWrap}>
                            <button
                                className={`${styles.stickyChip} ${regionFilter !== 'all' ? styles.stickyChipActive : ''} ${stickyDrop === 'region' ? styles.stickyChipOpen : ''}`}
                                onClick={(e) => { e.stopPropagation(); setStickyDrop(stickyDrop === 'region' ? null : 'region'); }}
                            >
                                📍 도착 {regionFilter === 'all' ? '전체' : regionFilter}
                                <span className={styles.stickyChevron}>{stickyDrop === 'region' ? '▲' : '▼'}</span>
                            </button>
                            {stickyDrop === 'region' && (
                                <div className={`${styles.stickyMiniDrop} ${styles.stickyMiniDropRight}`}>
                                    <div className={styles.stickyMiniList}>
                                        {[
                                            { value: 'all', label: '전체' },
                                            { value: '동남아', label: '동남아' },
                                            { value: '일본', label: '일본' },
                                            { value: '중국', label: '중국' },
                                            { value: '미주', label: '미주' },
                                            { value: '유럽', label: '유럽' },
                                            { value: '남태평양', label: '남태평양' },
                                            { value: '기타', label: '기타' },
                                        ].map((opt) => (
                                            <button
                                                key={opt.value}
                                                className={`${styles.stickyOptionChip} ${regionFilter === opt.value ? styles.stickyOptionActive : ''}`}
                                                onClick={() => { setRegionFilter(opt.value); setStickyDrop(null); }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* SEO: 검색엔진 크롤러용 콘텐츠 (JavaScript 미지원 시 표시) */}
            <noscript>
                <div style={{ padding: '40px 20px', maxWidth: '800px', margin: '0 auto', lineHeight: 1.8 }}>
                    <h2>티키티킷 - 5대 여행사 땡처리 항공권 비교</h2>
                    <p>
                        티키티킷은 하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴의
                        실시간 땡처리 항공권을 한눈에 비교할 수 있는 무료 서비스입니다.
                    </p>
                    <h3>인기 여행지 땡처리 항공권</h3>
                    <ul>
                        <li>일본 항공권: 오사카, 도쿄, 후쿠오카, 삿포로, 오키나와</li>
                        <li>동남아 항공권: 다낭, 방콕, 세부, 나트랑, 푸켓, 발리, 호치민, 하노이</li>
                        <li>중화권 항공권: 대만(타이페이), 홍콩, 마카오</li>
                        <li>기타: 괌, 사이판, 싱가포르, 코타키나발루</li>
                    </ul>
                    <h3>서비스 특징</h3>
                    <ul>
                        <li>매일 7회 자동 업데이트로 최신 특가 정보 제공</li>
                        <li>5대 여행사 가격 한눈에 비교</li>
                        <li>출발일, 도착지, 항공사별 필터링</li>
                        <li>관심 노선 즐겨찾기</li>
                        <li>회원가입 없이 무료 이용</li>
                    </ul>
                    <p>이 페이지를 정상적으로 이용하려면 JavaScript를 활성화해주세요.</p>
                </div>
            </noscript>

            <div className="container">
                <div className={styles.controls}>
                    {/* 1. 날짜 + 검색 한 줄 */}
                    <div className={styles.secondaryRow}>
                        <div className={styles.dateRange}>
                            <span className={styles.dateIcon}>📅</span>
                            <DatePicker
                                selectsRange={true}
                                startDate={toDate(startDate)}
                                endDate={toDate(endDate)}
                                onChange={(update: [Date | null, Date | null]) => {
                                    const [start, end] = update;
                                    setStartDate(toStr(start));
                                    setEndDate(toStr(end));
                                    if (end) {
                                        gtag.trackDateFilter(toStr(start), toStr(end));
                                        setTimeout(() => setIsCalendarOpen(false), 500);
                                    }
                                }}
                                open={isCalendarOpen}
                                onInputClick={() => setIsCalendarOpen(true)}
                                onClickOutside={() => setIsCalendarOpen(false)}
                                shouldCloseOnSelect={false}
                                dateFormat="MM.dd"
                                locale={ko}
                                className={styles.dateInput}
                                placeholderText="언제 떠나세요?"
                                popperClassName={styles.datePickerPopper}
                                calendarClassName={styles.datePickerCalendar}
                                minDate={new Date()}
                                isClearable={true}
                                onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.blur()}
                            />
                        </div>
                        <div className={styles.searchBox} style={{ flex: 1, minWidth: '150px', position: 'relative' }}>
                            <span className={styles.searchIcon}>🔍</span>
                            <input
                                type="text"
                                placeholder="도시명으로 검색 (예: 다낭, 오사카)"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onFocus={() => setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                className={styles.searchInput}
                            />
                            {showSuggestions && (() => {
                                // 검색어 입력 중이면 데이터에서 매칭되는 도시 제안
                                if (searchTerm) {
                                    const term = searchTerm.toLowerCase();
                                    const matchCities = new Set<string>();
                                    flights.forEach(f => {
                                        const dep = normalizeCity(f.departure.city);
                                        const arr = normalizeCity(f.arrival.city);
                                        if (dep.toLowerCase().includes(term)) matchCities.add(dep);
                                        if (arr.toLowerCase().includes(term)) matchCities.add(arr);
                                        if (f.airline.toLowerCase().includes(term)) matchCities.add(f.airline);
                                    });
                                    const matches = Array.from(matchCities).slice(0, 8);
                                    if (matches.length === 0) return null;
                                    return (
                                        <ul className={styles.suggestionsDropdown}>
                                            <li className={styles.suggestionHeader}>검색 결과</li>
                                            {matches.map((item) => (
                                                <li key={item} className={styles.suggestionItem}
                                                    onMouseDown={(e) => { e.preventDefault(); setSearchTerm(item); setShowSuggestions(false); }}>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    );
                                }
                                // 빈 칸이면 인기 도시 표시
                                return (
                                    <ul className={styles.suggestionsDropdown}>
                                        <li className={styles.suggestionHeader}>인기 도시</li>
                                        {popularCities.map((city) => (
                                            <li key={city} className={styles.suggestionItem}
                                                onMouseDown={(e) => { e.preventDefault(); setSearchTerm(city); setShowSuggestions(false); }}>
                                                {city}
                                            </li>
                                        ))}
                                    </ul>
                                );
                            })()}
                        </div>
                    </div>

                    {/* 3. 필터 토글 버튼 (모바일) + 출발지 + 도착지역 칩 필터 */}
                    <button
                        className={styles.filterToggleBtn}
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <span>
                            {departureFilter !== 'all' || regionFilter !== 'all'
                                ? [
                                    departureFilter !== 'all' && ('출발지 : ' + (departureFilter === '인천' ? '인천/김포' : departureFilter === '부산' ? '부산/김해' : departureFilter)),
                                    regionFilter !== 'all' && regionFilter,
                                ].filter(Boolean).join(' · ')
                                : '출발지 · 지역 선택'}
                        </span>
                        <span className={`${styles.filterToggleArrow} ${showFilters ? styles.filterToggleArrowOpen : ''}`}>▾</span>
                    </button>
                    <div className={`${styles.filterRow} ${showFilters ? styles.filterRowOpen : ''}`}>
                        {/* 출발지 칩 필터 */}
                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>출발지</span>
                            <div className={styles.chipGroup}>
                                {[
                                    { value: 'all', label: '전체' },
                                    { value: '인천', label: '인천/김포' },
                                    { value: '부산', label: '부산/김해' },
                                    { value: '대구', label: '대구' },
                                    { value: '청주', label: '청주' },
                                    { value: '제주', label: '제주' },
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => { setDepartureFilter(option.value); gtag.trackFilterChange('departure', option.value); }}
                                        className={`${styles.chip} ${departureFilter === option.value ? styles.chipActive : ''}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 지역 칩 필터 */}
                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>도착 지역</span>
                            <div className={styles.chipGroup}>
                                {[
                                    { value: 'all', label: '전체' },
                                    { value: '동남아', label: '동남아' },
                                    { value: '일본', label: '일본' },
                                    { value: '중국', label: '중국' },
                                    { value: '미주', label: '미주' },
                                    { value: '유럽', label: '유럽' },
                                    { value: '남태평양', label: '남태평양' },
                                    { value: '기타', label: '기타' },
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setRegionFilter(option.value)}
                                        className={`${styles.chip} ${regionFilter === option.value ? styles.chipActive : ''}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                </div>


                {loading && (
                    <div className={styles.skeletonGrid}>
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className={styles.skeletonCard}>
                                <div className={styles.skeletonBar}></div>
                                {/* 헤더: 여행사 + 항공사 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                    <div className={`${styles.skeletonLine} ${styles.short}`} style={{ marginBottom: 0 }}></div>
                                    <div className={`${styles.skeletonLine}`} style={{ width: '20%', marginBottom: 0 }}></div>
                                </div>
                                {/* 노선: 출발 → 도착 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 0' }}>
                                    <div style={{ flex: 1, textAlign: 'center' }}>
                                        <div className={styles.skeletonLine} style={{ width: '60%', height: '20px', margin: '0 auto 6px' }}></div>
                                        <div className={styles.skeletonLine} style={{ width: '80%', height: '12px', margin: '0 auto' }}></div>
                                    </div>
                                    <div className={styles.skeletonLine} style={{ width: '30px', height: '20px', flexShrink: 0, marginBottom: 0 }}></div>
                                    <div style={{ flex: 1, textAlign: 'center' }}>
                                        <div className={styles.skeletonLine} style={{ width: '60%', height: '20px', margin: '0 auto 6px' }}></div>
                                        <div className={styles.skeletonLine} style={{ width: '80%', height: '12px', margin: '0 auto' }}></div>
                                    </div>
                                </div>
                                {/* 푸터: 가격 + 버튼 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
                                    <div className={`${styles.skeletonLine} ${styles.tall}`} style={{ width: '35%', marginBottom: 0 }}></div>
                                    <div className={styles.skeletonLine} style={{ width: '80px', height: '36px', borderRadius: '8px', marginBottom: 0 }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div className={styles.error}>
                        <p>⚠️ {error}</p>
                        <button onClick={fetchFlights} className="btn btn-primary">
                            다시 시도
                        </button>
                    </div>
                )}

                {!loading && !error && (
                    <>
                        {/* 적용된 필터 요약 */}
                        {hasActiveFilters && (
                            <div className={styles.filterSummary}>
                                {searchTerm && (
                                    <span className={styles.filterTag}>
                                        검색: {searchTerm}
                                        <button onClick={() => setSearchTerm('')}>×</button>
                                    </span>
                                )}
                                {departureFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        출발지 : {departureFilter}
                                        <button onClick={() => setDepartureFilter('all')}>×</button>
                                    </span>
                                )}
                                {regionFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {regionFilter}
                                        <button onClick={() => setRegionFilter('all')}>×</button>
                                    </span>
                                )}
                                {sourceFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {getSourceName(sourceFilter)}
                                        <button onClick={() => setSourceFilter('all')}>×</button>
                                    </span>
                                )}
                                {airlineFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {airlineFilter}
                                        <button onClick={() => setAirlineFilter('all')}>×</button>
                                    </span>
                                )}
                                {(startDate || endDate) && (
                                    <span className={styles.filterTag}>
                                        {fmtDate(startDate) || '시작'} ~ {fmtDate(endDate) || '종료'}
                                        <button onClick={() => { setStartDate(''); setEndDate(''); }}>×</button>
                                    </span>
                                )}
                                <button onClick={resetAllFilters} className={`btn ${styles.resetAllBtn}`}>
                                    전체 초기화
                                </button>
                            </div>
                        )}




                        {/* 항공권 수 + 여행사/항공사/정렬 드롭다운 */}
                        <div className={styles.stats}>
                            <div className={styles.statsHeader}>
                                <span className={styles.resultCount}>총 <strong>{filteredFlights.length}</strong>개의 항공권</span>
                                {favoriteFlights.length > 0 && (
                                    <button
                                        className={favFilter ? styles.favFilterBtnActive : styles.favFilterBtn}
                                        onClick={() => setFavFilter(!favFilter)}
                                    >
                                        ⭐ 즐겨찾기{favFilter ? ' ON' : ''}
                                    </button>
                                )}
                            </div>
                            <div className={styles.statsFilters}>
                                <select
                                    value={sourceFilter}
                                    onChange={(e) => setSourceFilter(e.target.value)}
                                    className={styles.statsSelect}
                                >
                                    <option value="all">{isMobile ? '여행사' : '전체 여행사'}</option>

                                    <option value="ybtour">노랑풍선</option>
                                    <option value="modetour">모두투어</option>
                                    <option value="hanatour">하나투어</option>
                                    <option value="onlinetour">온라인투어</option>
                                    <option value="ttang">땡처리닷컴</option>
                                </select>
                                <select
                                    value={airlineFilter}
                                    onChange={(e) => setAirlineFilter(e.target.value)}
                                    className={styles.statsSelect}
                                >
                                    <option value="all">{isMobile ? '항공사' : '전체 항공사'}</option>
                                    {uniqueAirlines.map(airline => (
                                        <option key={airline} value={airline}>
                                            {airline}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as any)}
                                    className={styles.statsSelect}
                                >
                                    <option value="discount">추천순</option>
                                    <option value="price">가격순</option>
                                    <option value="discountRate">할인율순</option>
                                    <option value="date">날짜순</option>
                                </select>
                            </div>
                        </div>

                        {sharedFlightId && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 16px', marginBottom: '12px',
                                background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--color-border)', fontSize: '0.9rem'
                            }}>
                                <span>✈️ 공유된 항공편</span>
                                <button
                                    onClick={() => setSharedFlightId(null)}
                                    className="btn btn-primary"
                                    style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                                >
                                    전체 항공편 보기
                                </button>
                            </div>
                        )}

                        <div className={styles.flightGrid}>
                            {displayedFlights.flatMap((flight, index) => {
                                const route = `${flight.departure.city}-${flight.arrival.city}`;
                                const isLowestPrice = lowestPrices[route] === flight.price;
                                const items: React.ReactNode[] = [];

                                // 인사이트 바 삽입: 모바일 3개 후 시작(9개 간격), PC 6개 후 시작(12개 간격)
                                const insightOffset = isMobile ? 3 : 6;
                                const insightInterval = isMobile ? 9 : 12;
                                if (index > 0 && index >= insightOffset && (index - insightOffset) % insightInterval === 0 && !searchTerm) {
                                    const bar = generateInsightBar(Math.floor((index - insightOffset) / insightInterval));
                                    if (bar) items.push(bar);
                                }

                                items.push(
                                    <div
                                        key={flight.id}
                                        className={`card ${styles.flightCard} fade-in`}
                                        onClick={() => {
                                            const destination = normalizeCity(flight.arrival.city);
                                            const agency = getSourceName(flight.source);

                                            const formatD = (d: string) => d ? d.slice(5).replace('-', '.') : '';
                                            const arrStr = flight.arrival.date ? formatD(flight.arrival.date) : '';
                                            const depStr = flight.departure.date ? formatD(flight.departure.date) : '';
                                            const flight_date = arrStr ? `${depStr}~${arrStr}` : (flight.departure.date || '');

                                            gtag.trackCardClick(
                                                `${normalizeCity(flight.departure.city)}-${destination}`,
                                                flight.price,
                                                agency,
                                                flight.source
                                            );
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >

                                        <div className={styles.cardHeader}>
                                            <div className={styles.cardHeaderLeft}>
                                                <span className={`badge ${getSourceBadgeClass(flight.source)}`}>
                                                    {getSourceName(flight.source)}
                                                </span>
                                                <span className={styles.airline}>{normalizeAirline(flight.airline)}</span>
                                                {(() => {
                                                    const seatNum = flight.availableSeats || (flight.seats ? parseInt(flight.seats) : 0);
                                                    if (!seatNum) return null;
                                                    return (
                                                        <span className={seatNum <= 9 ? styles.seatsBadgeCritical : styles.seatsBadge}>
                                                            {seatNum <= 5 && '🔥 '}{seatNum}석
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                            <div className={styles.cardHeaderRight}>
                                                <button
                                                    type="button"
                                                    className={isFavoriteFlight(flight.id) ? styles.favBtnActive : styles.shareBtn}
                                                    onClick={(e) => {
                                                        e.preventDefault(); e.stopPropagation();
                                                        toggleFavorite(flight.id, normalizeCity(flight.arrival.city));
                                                    }}
                                                    title={isFavoriteFlight(flight.id) ? '즐겨찾기 해제' : '즐겨찾기'}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill={isFavoriteFlight(flight.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.shareBtn}
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); shareFlight(flight); }}
                                                    title="공유하기"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                                                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                                        <polyline points="16 6 12 2 8 6" />
                                                        <line x1="12" y1="2" x2="12" y2="15" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>

                                        <div className={styles.route}>
                                            <div className={styles.location}>
                                                <div className={styles.city}>{normalizeCity(flight.departure.city)}</div>
                                                <div className={styles.date}>{formatDate(flight.departure.date)}</div>
                                                {flight.departure.time && (
                                                    <div className={styles.time}>{flight.departure.time}</div>
                                                )}
                                            </div>

                                            <div className={styles.arrowSection}>
                                                <div className={styles.arrow}>✈</div>
                                            </div>

                                            <div className={styles.location}>
                                                <div className={styles.city}>{normalizeCity(flight.arrival.city)}</div>
                                                <div className={styles.date}>{formatDate(flight.arrival.date)}</div>
                                                {flight.arrival.time && (
                                                    <div className={styles.time}>{flight.arrival.time}</div>
                                                )}
                                            </div>
                                        </div>

                                        <div className={styles.cardFooterWrapper}>
                                            <div className={styles.cardFooter}>
                                                <div className={styles.priceSection}>
                                                    <div className={styles.price}>{formatPrice(flight.price)}</div>
                                                    {(() => {
                                                        const city = flight.arrival.city?.replace(/\([^)]+\)/, '').trim();
                                                        const depMonth = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                                                        const ipCityData = interparkPrices[city];
                                                        const ipMonthData = ipCityData?.[depMonth];
                                                        if (ipMonthData?.avg && flight.price > 0) {
                                                            const percent = ((ipMonthData.avg - flight.price) / ipMonthData.avg) * 100;
                                                            if (percent >= 5) {
                                                                return <span className={styles.discountBadge}>-{Math.round(percent)}%</span>;
                                                            }
                                                        }
                                                        return null;
                                                    })()}

                                                </div>
                                                {['hanatour', 'modetour'].includes(flight.source) ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary"
                                                        onClick={(e) => { e.stopPropagation(); openBookingModal(flight); }}
                                                    >
                                                        예약하기 →
                                                    </button>
                                                ) : flight.source === 'ttang' ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTtangConfirmFlight(flight);
                                                        }}
                                                    >
                                                        예약하기 →
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            disclaimerThenRedirect(flight);
                                                        }}
                                                    >
                                                        예약하기 →
                                                    </button>
                                                )}
                                            </div>
                                            {(() => {
                                                const naverUrl = getNaverFlightUrl(flight.departure.city, flight.arrival.city, flight.departure.date, flight.arrival.date);
                                                const tripcomHotelUrl = getTripcomHotelUrl(flight.arrival.city, flight.departure.date, flight.arrival.date);
                                                if (!naverUrl && !tripcomHotelUrl) return null;
                                                return (
                                                    <div className={styles.compareLinks}>
                                                        {naverUrl && (
                                                            <a href={naverUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLink} title="네이버 항공권에서 비교"
                                                                onClick={() => gtag.trackCompareClick('naver', `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`, flight.price)}
                                                            >
                                                                네이버 가격비교 ›
                                                            </a>
                                                        )}
                                                        {tripcomHotelUrl && (
                                                            <a href={tripcomHotelUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLinkHotel} title="트립닷컴에서 호텔 검색"
                                                                onClick={() => gtag.trackCompareClick('tripcom', `${normalizeCity(flight.arrival.city)}-hotel`, flight.price)}
                                                            >
                                                                🏨 {normalizeCity(flight.arrival.city)} 호텔도 비교 ›
                                                            </a>
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                        </div>


                                    </div>
                                );
                                return items;
                            })}
                        </div>

                        {/* 무한 스크롤 감지 요소 */}
                        {hasMore && (
                            <div ref={lastElementRef} className={styles.loadMore}>
                                <div className={styles.spinner}></div>
                                <span>더 불러오는 중...</span>
                            </div>
                        )}

                        {!hasMore && filteredFlights.length > ITEMS_PER_PAGE && (
                            <div className={styles.endMessage}>
                                모든 항공권을 불러왔습니다
                            </div>
                        )}

                        {filteredFlights.length === 0 && (
                            <div className={styles.emptyState}>
                                <div className={styles.emptyIcon}>✈️</div>
                                {sharedFlightId ? (
                                    <>
                                        <p>공유된 항공편이 만료되었거나 찾을 수 없습니다</p>
                                        <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                                            해당 특가 항공권이 종료되었을 수 있습니다
                                        </p>
                                        <button
                                            onClick={() => { setSharedFlightId(null); sharedRouteFallback.current = null; resetAllFilters(); }}
                                            className="btn btn-primary"
                                        >
                                            전체 항공편 보기
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>검색 결과가 없습니다</p>
                                        <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                                            필터를 조정하거나 다른 조건으로 검색해보세요
                                        </p>
                                        {hasActiveFilters && (
                                            <button
                                                onClick={resetAllFilters}
                                                className="btn btn-secondary"
                                            >
                                                필터 초기화
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 맨위로 버튼 */}
            {showScrollTop && (
                <button
                    onClick={scrollToTop}
                    className={styles.scrollTopBtn}
                    aria-label="맨 위로"
                >
                    ↑
                </button>
            )}

            {/* 푸터 */}
            <footer className={styles.footer}>
                <div className="container">
                    <div className={styles.footerContent}>
                        {/* 서비스 소개 */}
                        <div className={styles.footerSection}>
                            <Logo size={0.7} />
                            <p className={styles.footerDesc}>
                                여행사 땡처리 항공권을 한 곳에서 비교하세요.<br />
                                여러 여행사의 특가 항공권을 실시간으로 모아 가장 저렴한 항공편을 쉽게 찾을 수 있습니다.
                            </p>
                        </div>

                        {/* 데이터 소스 */}
                        <div className={styles.footerSection}>
                            <h4 className={styles.footerTitle}>여행사 바로가기</h4>
                            <div className={styles.footerLinks}>
                                <a href="https://www.hanatour.com" target="_blank" rel="noopener noreferrer">하나투어</a>
                                <a href="https://www.onlinetour.co.kr" target="_blank" rel="noopener noreferrer">온라인투어</a>
                                <a href="https://www.ybtour.co.kr" target="_blank" rel="noopener noreferrer">노랑풍선</a>
                                <a href="https://www.modetour.com" target="_blank" rel="noopener noreferrer">모두투어</a>
                                <a href="https://www.ttang.com" target="_blank" rel="noopener noreferrer">땡처리닷컴</a>
                            </div>
                        </div>

                        {/* 인기 여행지 */}
                        <div className={styles.footerSection}>
                            <h4 className={styles.footerTitle}>인기 여행지</h4>
                            <div className={styles.footerTags}>
                                {['오사카', '도쿄', '후쿠오카', '다낭', '방콕', '세부', '괌', '타이베이'].map(city => (
                                    <span
                                        key={city}
                                        className={styles.footerTag}
                                        onClick={() => { setSearchTerm(city); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                        style={{ cursor: 'pointer' }}
                                    >{city}</span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 면책 조항 */}
                    <div className={styles.footerDisclaimer}>
                        본 서비스는 각 여행사의 특가 항공권 정보를 수집하여 제공하며, 실제 예약 시점의 가격 및 좌석 상태는 해당 여행사와 다를 수 있습니다. 예약은 각 여행사 사이트에서 직접 진행됩니다.
                        <br /><br />
                        티키티킷은 통신판매중개자로서 통신판매의 당사자가 아닙니다. 따라서 항공권의 예약, 결제, 취소, 환불 및 운항 스케줄 등에 대한 모든 의무와 법적 책임은 해당 상품을 판매하는 여행사 및 항공사에 있습니다.
                    </div>

                    <div className={styles.footerBottom}>
                        <span>© 2026 티키티킷 · 여행을 더 쉽게</span>
                        <span style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                            <a href="/terms" style={{ color: 'var(--color-text-muted)' }}>이용약관</a>
                            <a href="/privacy" style={{ color: 'var(--color-text-muted)' }}>개인정보처리방침</a>
                            <a href="#" onClick={(e) => { e.preventDefault(); setShowContactModal(true); }} style={{ color: 'var(--color-text-muted)' }}>문의하기</a>
                        </span>
                    </div>
                </div>
            </footer>

            {/* 인원 선택 모달 */}
            {bookingFlight && (
                <div className={styles.modalOverlay} onClick={() => setBookingFlight(null)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>탑승 인원 선택</h3>
                            <button className={styles.modalClose} onClick={() => setBookingFlight(null)}>×</button>
                        </div>
                        <div className={styles.modalFlightInfo}>
                            <span>{normalizeCity(bookingFlight.departure.city)} → {normalizeCity(bookingFlight.arrival.city)}</span>
                            <span className={styles.modalPrice}>{formatPrice(bookingFlight.price)}/1인</span>
                        </div>
                        <div className={styles.paxRows}>
                            <div className={styles.paxRow}>
                                <div className={styles.paxLabel}>
                                    <span className={styles.paxType}>성인</span>
                                    <span className={styles.paxAge}>만 12세 이상</span>
                                </div>
                                <div className={styles.paxCounter}>
                                    <button className={styles.paxBtn} disabled={passengers.adult <= 1} onClick={() => setPassengers(p => ({ ...p, adult: p.adult - 1 }))}>−</button>
                                    <span className={styles.paxCount}>{passengers.adult}</span>
                                    <button className={styles.paxBtn} disabled={passengers.adult >= 9} onClick={() => setPassengers(p => ({ ...p, adult: p.adult + 1 }))}>+</button>
                                </div>
                            </div>
                            <div className={styles.paxRow}>
                                <div className={styles.paxLabel}>
                                    <span className={styles.paxType}>소아</span>
                                    <span className={styles.paxAge}>만 2~11세</span>
                                </div>
                                <div className={styles.paxCounter}>
                                    <button className={styles.paxBtn} disabled={passengers.child <= 0} onClick={() => setPassengers(p => ({ ...p, child: p.child - 1 }))}>−</button>
                                    <span className={styles.paxCount}>{passengers.child}</span>
                                    <button className={styles.paxBtn} disabled={passengers.child >= 9} onClick={() => setPassengers(p => ({ ...p, child: p.child + 1 }))}>+</button>
                                </div>
                            </div>
                            <div className={styles.paxRow}>
                                <div className={styles.paxLabel}>
                                    <span className={styles.paxType}>유아</span>
                                    <span className={styles.paxAge}>만 2세 미만</span>
                                </div>
                                <div className={styles.paxCounter}>
                                    <button className={styles.paxBtn} disabled={passengers.infant <= 0} onClick={() => setPassengers(p => ({ ...p, infant: p.infant - 1 }))}>−</button>
                                    <span className={styles.paxCount}>{passengers.infant}</span>
                                    <button className={styles.paxBtn} disabled={passengers.infant >= 4} onClick={() => setPassengers(p => ({ ...p, infant: p.infant + 1 }))}>+</button>
                                </div>
                            </div>
                        </div>
                        <div className={styles.modalTotal}>
                            <span className={styles.modalTotalLabel}>총 {passengers.adult + passengers.child + passengers.infant}명</span>
                            <span className={styles.modalTotalPrice}>
                                {formatPrice(bookingFlight.price * (passengers.adult + passengers.child + passengers.infant))}
                            </span>
                        </div>
                        <div style={{ padding: '0 0 12px', fontSize: '11px', color: '#aaa', lineHeight: 1.6 }}>
                            <p style={{ margin: 0 }}>
                                표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                실제 예약은 해당 여행사에서 직접 이루어집니다.
                                티키티킷은 가격 비교 정보를 제공하며,
                                예약·결제·환불 등에 대한 책임은 해당 여행사에 있습니다.
                            </p>
                        </div>
                        <button className={styles.modalConfirm} onClick={confirmBooking}>
                            {getSourceName(bookingFlight.source)}에서 예약하기 →
                        </button>
                    </div>
                </div>
            )}

            {/* 예약 면책조항 팝업 */}
            {bookingDisclaimer && (
                <div className={styles.modalOverlay} onClick={dismissDisclaimer}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>안내</h3>
                            <button className={styles.modalClose} onClick={dismissDisclaimer}>×</button>
                        </div>
                        <div style={{ padding: '20px 16px 8px', lineHeight: 1.7 }}>
                            {!isMobile && (
                                <>
                                    {bookingDisclaimer.source === 'hanatour' ? (
                                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>⏳</div>
                                    ) : (
                                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>✈️</div>
                                    )}
                                    <p style={{ fontSize: '14px', color: '#555', margin: '0 0 4px' }}>
                                        잠시 후 자동으로 이동합니다
                                    </p>
                                    {bookingDisclaimer.source === 'hanatour' && (
                                        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 4px' }}>
                                            하나투어 페이지 연결에 시간이 걸릴 수 있어요
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                        {isMobile && (
                            <div style={{ fontSize: '36px', textAlign: 'center', margin: '0 0 8px' }}>✈️</div>
                        )}
                        <div style={{ padding: '0 16px 20px', fontSize: '12px', color: '#999', lineHeight: 1.6, textAlign: 'left' }}>
                            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#aaa', fontSize: '11px' }}>안내사항</p>
                            <p style={{ margin: 0 }}>
                                표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                실제 예약은 해당 여행사에서 직접 이루어집니다.
                                티키티킷은 가격 비교 정보를 제공하며,
                                예약·결제·환불 등에 대한 책임은 해당 여행사에 있습니다.
                            </p>
                        </div>
                        {isMobile && (
                            <div style={{ padding: '0 16px 16px' }}>
                                <a
                                    href={bookingDisclaimer.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.modalConfirm}
                                    style={{ display: 'block', textDecoration: 'none', textAlign: 'center' }}
                                    onClick={() => setBookingDisclaimer(null)}
                                >
                                    {getSourceName(bookingDisclaimer.source)}에서 예약하기 →
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            )}



            {/* 땡처리닷컴 수수료 안내 모달 */}
            {ttangConfirmFlight && (
                <div className={styles.modalOverlay} onClick={() => setTtangConfirmFlight(null)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>안내</h3>
                            <button className={styles.modalClose} onClick={() => setTtangConfirmFlight(null)}>×</button>
                        </div>
                        <div style={{ padding: '12px 20px 16px', fontSize: '15px', color: '#333', lineHeight: 1.8, textAlign: 'center' }}>
                            땡처리닷컴은 표시된 가격 외에<br />
                            <b>발권수수료(TASF)</b>가 별도 부과됩니다.
                        </div>
                        <div style={{ padding: '0 16px 16px', fontSize: '12px', color: '#999', lineHeight: 1.6, textAlign: 'left' }}>
                            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#aaa', fontSize: '11px' }}>안내사항</p>
                            <p style={{ margin: 0 }}>
                                표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                실제 예약은 해당 여행사에서 직접 이루어집니다.
                                티키티킷은 가격 비교 정보를 제공하며,
                                예약·결제·환불 등에 대한 책임은 해당 여행사에 있습니다.
                            </p>
                        </div>
                        <button className={styles.modalConfirm} onClick={() => {
                            const f = ttangConfirmFlight;
                            const r = `${normalizeCity(f.departure.city)}-${normalizeCity(f.arrival.city)}`;
                            gtag.trackBookingClick(f.source, r, f.price);
                            const depDate = f.departure.date?.replace(/[-\.]/g, '').substring(0, 8) || '';
                            const arrCity = f.arrival.city?.replace(/\([^)]+\)/g, '').trim() || '';
                            const textFragment = arrCity ? `#:~:text=${encodeURIComponent(arrCity)}` : '';
                            const url = `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${depDate}&adt=1&chd=0&inf=0&page=1&scale=200${textFragment}`;
                            window.open(url, '_blank', 'noopener,noreferrer');
                            setTtangConfirmFlight(null);
                        }}>
                            땡처리닷컴에서 예약하기 →
                        </button>
                    </div>
                </div>
            )}

            {/* 문의하기 모달 */}
            {showContactModal && (
                <div className={styles.modalOverlay} onClick={() => setShowContactModal(false)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>📬 문의하기</h3>
                            <button className={styles.modalClose} onClick={() => setShowContactModal(false)}>×</button>
                        </div>
                        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>이름 (선택)</label>
                                <input
                                    type="text"
                                    value={contactForm.name}
                                    onChange={(e) => setContactForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="홍길동"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>이메일 (선택)</label>
                                <input
                                    type="email"
                                    value={contactForm.email}
                                    onChange={(e) => setContactForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="reply@example.com"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>문의 내용 *</label>
                                <textarea
                                    value={contactForm.message}
                                    onChange={(e) => setContactForm(f => ({ ...f, message: e.target.value }))}
                                    placeholder="문의 내용을 입력해주세요."
                                    rows={4}
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem', resize: 'vertical', fontFamily: 'inherit' }}
                                />
                            </div>
                            <button
                                className={styles.modalConfirm}
                                disabled={!contactForm.message.trim() || contactSending}
                                onClick={async () => {
                                    setContactSending(true);
                                    try {
                                        const res = await fetch('/api/contact', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(contactForm),
                                        });
                                        if (res.ok) {
                                            setShowContactModal(false);
                                            setContactForm({ name: '', email: '', message: '' });
                                            setShareToast('✅ 문의가 전송되었습니다. 감사합니다!');
                                            setTimeout(() => setShareToast(''), 3000);
                                        } else {
                                            const data = await res.json();
                                            setShareToast(`❌ ${data.error || '전송에 실패했습니다.'}`);
                                            setTimeout(() => setShareToast(''), 3000);
                                        }
                                    } catch {
                                        setShareToast('❌ 네트워크 오류가 발생했습니다.');
                                        setTimeout(() => setShareToast(''), 3000);
                                    } finally {
                                        setContactSending(false);
                                    }
                                }}
                            >
                                {contactSending ? '전송 중...' : '문의 보내기 ✉️'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 공유/알림 토스트 */}
            {shareToast && (
                <div className={styles.shareToast}>{shareToast}</div>
            )}
            {favToast && (
                <div className={styles.shareToast}>{favToast}</div>
            )}
        </div>
    );
}
