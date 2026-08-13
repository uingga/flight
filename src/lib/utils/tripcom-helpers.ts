/**
 * Trip.com 어필리에이트 관련 유틸리티
 * Dashboard.tsx에서 추출
 */

import { normalizeCity } from './flight-helpers';

// Trip.com 어필리에이트 링크 생성
export const TRIPCOM_ALLIANCE_ID = '7878543';
export const TRIPCOM_SID = '295785953';
export const TRIPCOM_SUB3 = 'D13108097';

// IATA 공항코드 → Trip.com 도시코드 매핑
export const AIRPORT_TO_TRIPCOM_CITY: Record<string, string> = {
    'ICN': 'SEL', 'GMP': 'SEL', 'PUS': 'PUS', 'TAE': 'TAE', 'CJU': 'CJU', 'CJJ': 'CJJ',
    'NRT': 'TYO', 'HND': 'TYO', 'KIX': 'OSA', 'FUK': 'FUK', 'CTS': 'SPK', 'NGO': 'NGO',
    'OKA': 'OKA', 'TAK': 'TAK', 'KOJ': 'KOJ', 'MYJ': 'MYJ', 'KMJ': 'KMJ',
    'BKK': 'BKK', 'DMK': 'BKK', 'SGN': 'SGN', 'HAN': 'HAN', 'DAD': 'DAD', 'CXR': 'NHA',
    'MNL': 'MNL', 'CEB': 'CEB', 'DPS': 'DPS',
    'HKG': 'HKG', 'TPE': 'TPE', 'PVG': 'SHA', 'PEK': 'BJS',
    'SPN': 'SPN', 'GUM': 'GUM', 'HKT': 'HKT', 'CNX': 'CNX', 'SHI': 'SHI',
    'TOY': 'TOY', 'DLC': 'DLC', 'DYG': 'DYG', 'HNA': 'HNA', 'MMJ': 'MMJ',
    'IBR': 'IBR', 'ISG': 'ISG', 'HUN': 'HUN',
};

// Trip.com 도시명 → { id, name(한국어) } 매핑 (모두 브라우저/유저 확인됨 ✅)
export const TRIPCOM_CITY_DATA: Record<string, { id: number; name: string; provinceId?: number }> = {
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
    '화롄': { id: 6954, name: '화롄' }, '화련': { id: 6954, name: '화롄' }, '지난': { id: 144, name: '지난' },
    '구이린': { id: 33, name: '구이린' },
    '웨이하이': { id: 479, name: '웨이하이' },

    // 기타
    '사이판': { id: 4081, name: '사이판' }, '괌': { id: 753, name: '괌' },
    '시드니': { id: 501, name: '시드니' }, '브리즈번': { id: 680, name: '브리즈번' },
    '두바이': { id: 220, name: '두바이' }, '아부다비': { id: 766, name: '아부다비' },
    '로마': { id: 343, name: '로마' }, '이스탄불': { id: 532, name: '이스탄불' },
    '트라브존': { id: 1760, name: '트라브존' }, '싼야': { id: 43, name: '싼야' },
    '바르셀로나': { id: 40795, name: '바르셀로나' }, '밴쿠버': { id: 476, name: '밴쿠버' },
    '시모지시마': { id: 50334, name: '미야코지마' },
    '미야코지마': { id: 50334, name: '미야코지마' }, '미야코': { id: 50334, name: '미야코지마' },
    // 누락 도시 일괄 추가
    '도야마': { id: 570, name: '도야마' },
    '대련': { id: 6, name: '대련' },
    '장가계': { id: 27, name: '장가계' },
    '하나마키': { id: 50117, name: '하나마키' },
    '마츠모토': { id: 62496, name: '마츠모토' },
    '이바라키': { id: 20748, name: '이바라키' },
    '이시가키': { id: 1174, name: '이시가키' },
    // Trip.com API 인터셉트로 검증된 도시 ID (2026-05-25)
    // 유럽
    '파리': { id: 192, name: '파리' }, '런던': { id: 338, name: '런던' },
    '암스테르담': { id: 176, name: '암스테르담' }, '프라하': { id: 1288, name: '프라하' },
    '밀라노': { id: 361, name: '밀라노' }, '빈': { id: 651, name: '빈' }, '비엔나': { id: 651, name: '빈' },
    '뮌헨': { id: 363, name: '뮌헨' }, '프랑크푸르트': { id: 250, name: '프랑크푸르트' },
    '베를린': { id: 193, name: '베를린' }, '마드리드': { id: 357, name: '마드리드' },
    '리스본': { id: 1231, name: '리스본' }, '아테네': { id: 710, name: '아테네' },
    '부다페스트': { id: 637, name: '부다페스트' }, '코펜하겐': { id: 260, name: '코펜하겐' },
    '헬싱키': { id: 277, name: '헬싱키' }, '스톡홀름': { id: 420, name: '스톡홀름' },
    '취리히': { id: 434, name: '취리히' }, '산토리니': { id: 3576, name: '산토리니' },
    '두브로브니크': { id: 3901, name: '두브로브니크' }, '바르샤바': { id: 293, name: '바르샤바' },
    '에든버러': { id: 706, name: '에든버러' },
    // 미주
    '뉴욕': { id: 633, name: '뉴욕' }, '호놀룰루': { id: 757, name: '호놀룰루' },
    '라스베이거스': { id: 26282, name: '라스베이거스' }, '샌프란시스코': { id: 313, name: '샌프란시스코' },
    '시카고': { id: 549, name: '시카고' }, '칸쿤': { id: 812, name: '칸쿤' },
    // 동남아 추가
    '자카르타': { id: 524, name: '자카르타' }, '크라비': { id: 1405, name: '크라비' },
    '랑카위': { id: 1225, name: '랑카위' }, '프놈펜': { id: 303, name: '프놈펜' },
    '시엠립': { id: 1369, name: '시엠립' }, '양곤': { id: 522, name: '양곤' },
    '달랏': { id: 7712142, name: '달랏' }, '후에': { id: 1776, name: '후에' },
    '코사무이': { id: 1229, name: '코사무이' }, '페낭': { id: 10077, name: '페낭' },
    '루앙프라방': { id: 3677, name: '루앙프라방' }, '몰디브': { id: 146, name: '몰디브' },
    '카트만두': { id: 304, name: '카트만두' },
    // 중국 추가
    '광저우': { id: 32, name: '광저우' }, '선전': { id: 30, name: '선전' },
    '청두': { id: 28, name: '청두' }, '충칭': { id: 4, name: '충칭' },
    '쿤밍': { id: 34, name: '쿤밍' }, '시안': { id: 2149664, name: '시안' },
    '항저우': { id: 17, name: '항저우' }, '난징': { id: 12, name: '난징' },
    '샤먼': { id: 25, name: '샤먼' }, '창사': { id: 206, name: '창사' },
    '정저우': { id: 559, name: '정저우' },
    // 일본 추가
    '니가타': { id: 1163, name: '니가타' }, '오카야마': { id: 263, name: '오카야마' },
    '도쿠시마': { id: 1172, name: '도쿠시마' }, '아키타': { id: 3259, name: '아키타' },
    '센다이': { id: 585, name: '센다이' }, '미야자키': { id: 1779, name: '미야자키' },
    '구시로': { id: 3982, name: '구시로' }, '오비히로': { id: 5471, name: '오비히로' },
    '야쿠시마': { id: 92473, name: '야쿠시마' }, '메만베츠': { id: 4326258, name: '메만베츠' },
    // 기타 아시아
    '델리': { id: 10567, name: '델리' }, '블라디보스토크': { id: 628, name: '블라디보스토크' },
    '알마티': { id: 174, name: '알마티' }, '울란바토르': { id: 483, name: '울란바토르' },
    '가야': { id: 4163, name: '가야' }, '벵갈루루': { id: 1355, name: '벵갈루루' },
    '데라둔': { id: 36109, name: '데라둔' }, '옌지': { id: 523, name: '옌지' },
    '다카': { id: 733, name: '다카' }, '아스타나': { id: 3263, name: '아스타나' },
    '예레반': { id: 3245, name: '예레반' }, '암만': { id: 1282, name: '암만' },
    '리야드': { id: 789, name: '리야드' }, '테헤란': { id: 631, name: '테헤란' },
    '바쿠': { id: 650, name: '바쿠' }, '트빌리시': { id: 7612, name: '트빌리시' },
    // 중국 추가
    '난닝': { id: 380, name: '난닝' }, '닝보': { id: 375, name: '닝보' },
    '란저우': { id: 100, name: '란저우' }, '리장': { id: 37, name: '리장' },
    '라싸': { id: 41, name: '라싸' }, '선양': { id: 451, name: '선양' },
    '우루무치': { id: 39, name: '우루무치' }, '징훙': { id: 309, name: '징훙' },
    '창춘': { id: 158, name: '창춘' }, '친황다오': { id: 147, name: '친황다오' },
    '타이위안': { id: 105, name: '타이위안' }, '톈진': { id: 3, name: '톈진' },
    '장자제': { id: 27, name: '장자제' }, '후허하오터': { id: 156, name: '후허하오터' },
    // 동남아 추가
    '동호이': { id: 7804, name: '동호이' }, '두마게테': { id: 5184, name: '두마게테' },
    '라부안바조': { id: 7291, name: '라부안바조' }, '롬복': { id: 1392, name: '롬복' },
    '수라바야': { id: 1244, name: '수라바야' }, '욕야카르타': { id: 741, name: '욕야카르타' },
    '팔렘방': { id: 1468, name: '팔렘방' },
    '조호르바루': { id: 1376, name: '조호르바루' },
    // 유럽 추가
    '더블린': { id: 803, name: '더블린' }, '드레스덴': { id: 1412, name: '드레스덴' },
    '라이프치히': { id: 3463, name: '라이프치히' }, '라코루냐': { id: 41253, name: '라코루냐' },
    '리가': { id: 4079, name: '리가' }, '리옹': { id: 713, name: '리옹' },
    '맨체스터': { id: 722, name: '맨체스터' }, '모스크바': { id: 366, name: '모스크바' },
    '민스크': { id: 854, name: '민스크' }, '바젤': { id: 806, name: '바젤' },
    '버밍엄': { id: 1270, name: '버밍엄' }, '보드룸': { id: 1761, name: '보드룸' },
    '부쿠레슈티': { id: 674, name: '부쿠레슈티' }, '브로츠와프': { id: 1448, name: '브로츠와프' },
    '빌바오': { id: 772, name: '빌바오' }, '사라예보': { id: 10260, name: '사라예보' },
    '소피아': { id: 792, name: '소피아' }, '스플리트': { id: 3264, name: '스플리트' },
    '알리칸테': { id: 1293, name: '알리칸테' }, '앙카라': { id: 1218, name: '앙카라' },
    '오슬로': { id: 827, name: '오슬로' }, '이즈미르': { id: 1216, name: '이즈미르' },
    '자그레브': { id: 1418, name: '자그레브' }, '자다르': { id: 6531, name: '자다르' },
    '잘츠부르크': { id: 739, name: '잘츠부르크' }, '카이로': { id: 332, name: '카이로' },
    '카타니아': { id: 1419, name: '카타니아' }, '코르푸': { id: 5046, name: '코르푸' },
    '쾰른': { id: 709, name: '쾰른' }, '크라쿠프': { id: 1343, name: '크라쿠프' },
    '테네리페': { id: 11559, name: '테네리페' }, '티라나': { id: 36649, name: '티라나' },
    '토리노': { id: 32159, name: '토리노' }, '툴루즈': { id: 1361, name: '툴루즈' },
    '포르투': { id: 826, name: '포르투' }, '포즈난': { id: 1463, name: '포즈난' },
    '푼샬': { id: 3298, name: '푼샬' }, '피렌체': { id: 687, name: '피렌체' },
    '하노버': { id: 1248, name: '하노버' }, '함부르크': { id: 763, name: '함부르크' },
    '뉘른베르크': { id: 31120, name: '뉘른베르크' }, '나폴리': { id: 1262, name: '나폴리' },
    '그단스크': { id: 1461, name: '그단스크' },
    // 미주 추가
    '덴버': { id: 20099, name: '덴버' }, '멕시코시티': { id: 691, name: '멕시코시티' },
    '몬트리올': { id: 759, name: '몬트리올' }, '보고타': { id: 824, name: '보고타' },
    '에드먼턴': { id: 1245, name: '에드먼턴' }, '올랜도': { id: 1187, name: '올랜도' },
    '오타와': { id: 760, name: '오타와' }, '휴스턴': { id: 26619, name: '휴스턴' },
    '리후에': { id: 19841, name: '리후에' }, '마우이': { id: 3789, name: '마우이' },
    // 오세아니아
    '오클랜드': { id: 678, name: '오클랜드' }, '멜버른': { id: 358, name: '멜버른' },
    '골드코스트': { id: 1210, name: '골드코스트' }, '캔버라': { id: 679, name: '캔버라' },
    '퍼스': { id: 681, name: '퍼스' }, '퀸스타운': { id: 3860, name: '퀸스타운' },
    '웰링턴': { id: 843, name: '웰링턴' }, '넬슨': { id: 3994, name: '넬슨' },
    '누메아': { id: 4086, name: '누메아' }, '나디': { id: 791, name: '나디' },
    // 아프리카
    '다르에스살람': { id: 814, name: '다르에스살람' }, '잔지바르': { id: 121155483, name: '잔지바르' },
    '키갈리': { id: 1277, name: '키갈리' }, '마헤': { id: 4100, name: '마헤' },
    '코로르': { id: 5780, name: '코로르' },
    // 나머지 전체 (Trip.com API 검증 2026-05-25)
    '고아': { id: 10569, name: '고아' }, '라오아그': { id: 62743, name: '라오아그' },
    '레': { id: 21662855, name: '레' }, '론서스턴': { id: 3827, name: '론서스턴' },
    '리틀록': { id: 3236, name: '리틀록' }, '몬베츠': { id: 66917, name: '몬베츠' },
    '반다르람풍': { id: 3602, name: '반다르람풍' }, '반다르세리베가완': { id: 4048, name: '반다르세리베가완' },
    '번다버그': { id: 4574, name: '번다버그' }, '보팔': { id: 60045, name: '보팔' },
    '부지': { id: 4657, name: '부지' }, '비사카파트남': { id: 36130, name: '비사카파트남' },
    '빈툴루': { id: 1383, name: '빈툴루' }, '산데피오르': { id: 1735, name: '산데피오르' },
    '산탄데르': { id: 3176, name: '산탄데르' }, '샌안토니오': { id: 1193, name: '샌안토니오' },
    '세인트루이스': { id: 1183, name: '세인트루이스' }, '솔트레이크시티': { id: 700, name: '솔트레이크시티' },
    '슈체친': { id: 67379, name: '슈체친' }, '스리나가르': { id: 60191, name: '스리나가르' },
    '스마랑': { id: 1488, name: '스마랑' }, '아바나': { id: 713858, name: '아바나' },
    '암본': { id: 124998441, name: '암본' }, '앨리스스프링스': { id: 3404, name: '앨리스스프링스' },
    '온타리오': { id: 25633, name: '온타리오' }, '우베': { id: 4001, name: '우베' },
    '우타파오': { id: 622, name: '우타파오' }, '이즈모': { id: 7052, name: '이즈모' },
    '자무쓰': { id: 317, name: '자무쓰' }, '자이위관': { id: 326, name: '자이위관' },
    '잔장': { id: 547, name: '잔장' }, '잠비': { id: 5195, name: '잠비' },
    '제네럴산토스': { id: 3283, name: '제네럴산토스' }, '충하이': { id: 31, name: '충하이' },
    '캔자스시티': { id: 25410, name: '캔자스시티' }, '켈로나': { id: 1398, name: '켈로나' },
    '코나': { id: 7033, name: '코나' }, '크라티에': { id: 59771, name: '크라티에' },
    '클루지나포카': { id: 66105743, name: '클루지나포카' }, '키루나': { id: 7225, name: '키루나' },
    '테르나테': { id: 20792, name: '테르나테' }, '티미쇼아라': { id: 1817, name: '티미쇼아라' },
    '파당': { id: 1455, name: '파당' }, '팍세': { id: 5607, name: '팍세' },
    '페로제도': { id: 283, name: '페로제도' }, '페어뱅크스': { id: 4235, name: '페어뱅크스' },
    '페이엣빌': { id: 26012, name: '페이엣빌' }, '포트모르즈비': { id: 859, name: '포트모르즈비' },
    '폰티아낙': { id: 1388, name: '폰티아낙' }, '푸에르토프린세사': { id: 7515, name: '푸에르토프린세사' },
    '술탄압둘아지즈샤': { id: 35937, name: '술탄압둘아지즈샤' },
    '도단': { id: 221, name: '도단' }, '락자': { id: 384625, name: '락자' },
    '제네바': { id: 666, name: '제네바' },
    // 추가 누락 도시
    '인촨': { id: 855, name: '인촨' },
};

export const TRIPCOM_HOTEL_SUB3 = 'D13108706';

// IATA 공항코드 → 영문 도시명 (Trip.com 키워드 검색용, 한국어보다 정확)
export const IATA_TO_ENGLISH: Record<string, string> = {
    // 유럽
    'AMS': 'Amsterdam', 'ATH': 'Athens', 'BCN': 'Barcelona', 'BER': 'Berlin',
    'BRU': 'Brussels', 'BUD': 'Budapest', 'CDG': 'Paris', 'CPH': 'Copenhagen',
    'DBV': 'Dubrovnik', 'DUB': 'Dublin', 'DUS': 'Dusseldorf', 'EDI': 'Edinburgh',
    'FCO': 'Rome', 'FRA': 'Frankfurt', 'GVA': 'Geneva', 'HAM': 'Hamburg',
    'HEL': 'Helsinki', 'IST': 'Istanbul', 'JTR': 'Santorini', 'LIS': 'Lisbon',
    'LON': 'London', 'LHR': 'London', 'MAD': 'Madrid', 'MIL': 'Milan',
    'MUC': 'Munich', 'MXP': 'Milan', 'NCE': 'Nice', 'OSL': 'Oslo',
    'PAR': 'Paris', 'PRG': 'Prague', 'ARN': 'Stockholm', 'VCE': 'Venice',
    'VIE': 'Vienna', 'WAW': 'Warsaw', 'ZRH': 'Zurich',
    // 미주
    'BOS': 'Boston', 'CUN': 'Cancun', 'HNL': 'Honolulu', 'JFK': 'New York',
    'LAS': 'Las Vegas', 'MEX': 'Mexico City', 'ORD': 'Chicago', 'SEA': 'Seattle',
    'SFO': 'San Francisco', 'YVR': 'Vancouver', 'YTO': 'Toronto',
    // 동남아
    'BKK': 'Bangkok', 'BKI': 'Kota Kinabalu', 'CEB': 'Cebu', 'CGK': 'Jakarta',
    'CNX': 'Chiang Mai', 'CXR': 'Nha Trang', 'DAD': 'Da Nang', 'DLI': 'Da Lat',
    'DPS': 'Bali', 'HAN': 'Hanoi', 'HKT': 'Phuket', 'HUI': 'Hue',
    'KBV': 'Krabi', 'KUL': 'Kuala Lumpur', 'LGK': 'Langkawi', 'LPQ': 'Luang Prabang',
    'MLE': 'Maldives', 'MNL': 'Manila', 'PEN': 'Penang', 'PNH': 'Phnom Penh',
    'PQC': 'Phu Quoc', 'REP': 'Siem Reap', 'RGN': 'Yangon', 'SAI': 'Siem Reap',
    'SGN': 'Ho Chi Minh', 'SIN': 'Singapore', 'TAG': 'Bohol',
    // 일본
    'CTS': 'Sapporo', 'FUK': 'Fukuoka', 'HKD': 'Hakodate', 'HND': 'Tokyo',
    'KIX': 'Osaka', 'KMI': 'Miyazaki', 'KOJ': 'Kagoshima', 'NGO': 'Nagoya',
    'NRT': 'Tokyo', 'OKA': 'Okinawa', 'SDJ': 'Sendai', 'SPK': 'Sapporo',
    'KKJ': 'Kitakyushu', 'UKB': 'Kobe', 'KMJ': 'Kumamoto', 'NGS': 'Nagasaki',
    'MYJ': 'Matsuyama', 'TAK': 'Takamatsu', 'FSZ': 'Shizuoka', 'HIJ': 'Hiroshima',
    'AOJ': 'Aomori', 'OIT': 'Oita', 'TOY': 'Toyama', 'HSG': 'Saga',
    'AXT': 'Akita', 'KIJ': 'Niigata', 'OKJ': 'Okayama', 'TKS': 'Tokushima',
    // 중국
    'BJS': 'Beijing', 'PEK': 'Beijing', 'PVG': 'Shanghai', 'SHA': 'Shanghai',
    'CAN': 'Guangzhou', 'SZX': 'Shenzhen', 'CTU': 'Chengdu', 'CKG': 'Chongqing',
    'KMG': 'Kunming', 'XIY': 'Xian', 'NKG': 'Nanjing', 'HGH': 'Hangzhou',
    'TAO': 'Qingdao', 'DLC': 'Dalian', 'WEH': 'Weihai', 'YNT': 'Yantai',
    'KWL': 'Guilin', 'SYX': 'Sanya', 'TNA': 'Jinan', 'DYG': 'Zhangjiajie',
    'XMN': 'Xiamen', 'CSX': 'Changsha', 'CGO': 'Zhengzhou', 'HET': 'Hohhot',
    // 대만
    'TPE': 'Taipei', 'KHH': 'Kaohsiung', 'RMQ': 'Taichung', 'HUN': 'Hualien',
    // 기타
    'AKL': 'Auckland', 'ALA': 'Almaty', 'BNE': 'Brisbane', 'BOM': 'Mumbai',
    'CAI': 'Cairo', 'CHC': 'Christchurch', 'CMB': 'Colombo', 'DEL': 'Delhi',
    'DOH': 'Doha', 'DXB': 'Dubai', 'EVN': 'Yerevan', 'GUM': 'Guam',
    'HKG': 'Hong Kong', 'KTM': 'Kathmandu', 'MEL': 'Melbourne', 'MFM': 'Macau',
    'NAN': 'Fiji', 'PER': 'Perth', 'ROR': 'Palau', 'SPN': 'Saipan',
    'SYD': 'Sydney', 'TBS': 'Tbilisi', 'TLV': 'Tel Aviv', 'TYO': 'Tokyo',
    'UBN': 'Ulaanbaatar', 'VVO': 'Vladivostok', 'ZQN': 'Queenstown',
    // 추가 누락 매핑
    'INC': 'Yinchuan', 'OBO': 'Obihiro',
};

export const getTripcomTrackingId = (
    arrCity: string, depDate?: string, arrDate?: string, arrAirport?: string,
    depCity?: string, depAirport?: string,
): string => {
    const parts = [
        'hotel',
        depAirport || (depCity ? normalizeCity(depCity) : ''),
        arrAirport || normalizeCity(arrCity),
        depDate?.replace(/\D/g, ''),
        arrDate?.replace(/\D/g, ''),
    ].filter(Boolean);
    return parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
};

export const getTripcomHotelUrl = (
    arrCity: string, depDate?: string, arrDate?: string, arrAirport?: string,
    depCity?: string, depAirport?: string,
): string | null => {
    let cityName = normalizeCity(arrCity);
    const bm = cityName.match(/^(.+?)[(](.+?)[)]$/);
    if (bm) cityName = bm[1];
    let checkinStr = '';
    let checkoutStr = '';
    if (depDate) {
        const ci = new Date(depDate);
        const co = new Date(ci);
        co.setDate(co.getDate() + 1);
        const fmt = (d: Date) => d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
        checkinStr = fmt(ci);
        checkoutStr = fmt(co);
    }
    const dateQs = checkinStr ? '&checkin=' + checkinStr + '&checkout=' + checkoutStr : '';
    const trackingId = getTripcomTrackingId(arrCity, depDate, arrDate, arrAirport, depCity, depAirport);
    const affQs = '&Allianceid=' + TRIPCOM_ALLIANCE_ID + '&SID=' + TRIPCOM_SID + '&trip_sub1=' + encodeURIComponent(trackingId) + '&trip_sub3=' + TRIPCOM_HOTEL_SUB3;
    // 1순위: TRIPCOM_CITY_DATA (검증된 city ID)
    const cityData = TRIPCOM_CITY_DATA[cityName];
    if (cityData) {
        const n = encodeURIComponent(cityData.name);
        const prov = cityData.provinceId ? '&provinceId=' + cityData.provinceId : '';
        return 'https://kr.trip.com/hotels/list?city=' + cityData.id + '&cityName=' + n + '&searchType=CT&searchWord=' + n + prov + dateQs + '&locale=ko-KR&curr=KRW' + affQs;
    }
    // 2순위: IATA 영문 도시명으로 searchWord 검색 (모든 항공권 커버)
    const en = arrAirport ? IATA_TO_ENGLISH[arrAirport] : null;
    const searchWord = encodeURIComponent(en || cityName);
    return 'https://kr.trip.com/hotels/list?searchType=CT&searchWord=' + searchWord + dateQs + '&locale=ko-KR&curr=KRW' + affQs;
};
