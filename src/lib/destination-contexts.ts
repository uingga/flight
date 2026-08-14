import { normalizeCity } from './utils/flight-helpers';

export interface DestinationContext {
    city: string;
    location: string;
    transfer: string;
    shortTrip: string;
    longTrip: string;
    goodFor: string[];
    caution: string[];
    sourceUrls: string[];
    reviewedAt: string;
}

const CONTEXTS: Record<string, DestinationContext> = {
    '요나고': {
        city: '요나고',
        location: '일본 산인 지방의 관문으로, 가이케온천·사카이미나토·마쓰에를 함께 둘러보기 좋은 거점입니다.',
        transfer: '요나고 공항에서 요나고 시내까지 공항버스로 약 20분이라 이동이 어렵지 않은 편입니다.',
        shortTrip: '요나고 시내와 가이케온천을 중심으로 쉬고, 사카이미나토를 반나절 곁들이는 일정이 현실적입니다.',
        longTrip: '마쓰에·다이센까지 범위를 넓혀 산인 지방의 온천과 자연을 함께 볼 수 있습니다.',
        goodFor: ['조용한 소도시와 온천을 좋아하는 사람', '붐비는 대표 관광지를 피하고 싶은 사람'],
        caution: ['근교까지 넓게 보려면 열차·버스 시간표를 먼저 확인하는 편이 좋습니다.'],
        sourceUrls: ['https://www.yonago-navi.jp/access/', 'https://www.yonago-navi.jp/en/access/airplane/'],
        reviewedAt: '2026-08-14',
    },
    '미야자키': {
        city: '미야자키',
        location: '일본 규슈 남동부의 해안 도시로, 아오시마와 니치난 해안의 아열대 풍경이 대표적입니다.',
        transfer: '공항과 미야자키 시내가 가까운 편이며, 공식 관광 안내 기준 미야자키역에서 공항까지 차량으로 약 30분입니다.',
        shortTrip: '아오시마와 미야자키 시내 먹거리를 묶으면 짧은 일정에도 여행의 색이 분명합니다.',
        longTrip: '니치난 해안·오비 성하마을까지 남쪽으로 범위를 넓히기 좋습니다.',
        goodFor: ['바다 풍경과 느긋한 드라이브를 좋아하는 사람', '규슈의 덜 붐비는 도시를 찾는 사람'],
        caution: ['시외 명소를 여러 곳 볼 계획이라면 렌터카가 편리합니다.'],
        sourceUrls: ['https://www.kanko-miyazaki.jp/en/highlights/central', 'https://www.kanko-miyazaki.jp/spot/2108'],
        reviewedAt: '2026-08-14',
    },
    '탄호아': {
        city: '탄호아',
        location: '베트남 북중부의 도시로, 호 왕조 성채와 삼선 해변을 엮어 보는 지역 여행의 출발점입니다.',
        transfer: '토쑤언 공항과 주요 관광지가 떨어져 있어 택시나 사전 예약 차량을 포함한 이동 계획이 필요합니다.',
        shortTrip: '짧은 일정이라면 탄호아 시내와 삼선 해변처럼 한 권역에 집중하는 편이 좋습니다.',
        longTrip: '호 왕조 성채까지 더해 북중부의 역사와 해변을 함께 보는 일정이 가능합니다.',
        goodFor: ['유명 휴양지보다 현지 분위기가 강한 곳을 찾는 사람', '낯선 지역을 직접 설계하는 여행을 좋아하는 사람'],
        caution: ['대중교통 정보가 익숙하지 않을 수 있어 공항 이동과 숙소 위치를 먼저 확인해야 합니다.'],
        sourceUrls: ['https://www.vietnam.travel/plan-your-trip/recommended-trip/heritage-sites-vietnam'],
        reviewedAt: '2026-08-14',
    },
    '스리나가르': {
        city: '스리나가르',
        location: '인도 북부 카슈미르 계곡의 중심 도시로, 달 호수·하우스보트·무굴 정원으로 알려져 있습니다.',
        transfer: '스리나가르 공항은 도심에서 약 15km, 달 호수·도심까지 차량으로 대략 25~35분입니다.',
        shortTrip: '달 호수와 무굴 정원, 올드시티를 중심으로 도시 안에서 보내는 일정이 적합합니다.',
        longTrip: '날씨와 현지 이동 상황을 확인한 뒤 굴마르그·파할감 같은 근교를 더할 수 있습니다.',
        goodFor: ['호수와 산 풍경, 문화가 뚜렷한 여행지를 찾는 사람', '일반적인 동아시아 단거리 여행과 다른 경험을 원하는 사람'],
        caution: ['여권·비자와 함께 현지 교통·안전 공지를 출발 직전까지 확인해야 합니다.'],
        sourceUrls: ['https://srinagar.nic.in/travelandstay/', 'https://srinagar.nic.in/how-to-reach/'],
        reviewedAt: '2026-08-14',
    },
};

export const DESTINATION_CONTEXT_CITIES = Object.keys(CONTEXTS);

export function getDestinationContext(city?: string): DestinationContext | null {
    if (!city) return null;
    return CONTEXTS[normalizeCity(city)] || null;
}

export function getItineraryContext(context: DestinationContext, nights: number): string {
    return nights > 0 && nights <= 3 ? context.shortTrip : context.longTrip;
}
