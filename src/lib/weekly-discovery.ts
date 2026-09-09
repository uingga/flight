import type { Flight } from '@/types/flight';

export type Discovery = {
    headline?: string;
    departureCity?: string;
    departureAirport?: string;
    city: string;
    location: string;
    summary: string;
    detail: string;
    story?: string[];
    latitude: number;
    longitude: number;
    image: string;
    imageCaption?: string;
};

const DISCOVERIES: Discovery[] = [
    { city: '리장', location: '중국 윈난', summary: '골목 끝에 설산이 나오는 곳.', detail: '해발 2,400m의 오래된 도시 사이로 물길이 흐릅니다.', story: ['리장은 사진 한 장 안에 오래된 골목과 설산이 함께 들어오는 도시입니다. 해발 2,400m의 고성 사이로 설산에서 시작된 물길이 흐르고, 집과 골목, 작은 다리가 그 물길을 따라 이어집니다. 12세기부터 차마고도의 교역지였고, 지금도 나시족의 문화와 오래된 목조 건물이 도시 곳곳에 남아 있습니다.', '보통 오래된 도시와 큰 자연을 보려면 일정을 따로 잡아야 합니다. 리장에서는 골목을 걷던 여행이 그대로 설산으로 이어집니다. 처음에는 ‘리장이 어디지?’ 하고 눌렀다가, 나갈 때는 항공권 날짜를 확인하게 되는 곳. 티키티킷이 이번 주 이 도시를 꺼내놓은 이유입니다.'], latitude: 26.855, longitude: 100.227, image: '/images/cities/lijiang.png' },
    { city: '옌타이', location: '중국 산둥', summary: '해안 산책과 와이너리를 함께 즐기기 좋아 짧은 일정에도 여유가 있어요.', detail: '도시와 바다가 가깝고 이동 동선이 단순해 천천히 둘러보기 좋아요.', latitude: 37.4645, longitude: 121.4479, image: '/images/cities/yantai.png' },
    { city: '웨이하이', location: '중국 산둥', summary: '붐비지 않는 해변과 산책로가 많아 조용히 쉬어 가기 좋은 도시예요.', detail: '유명 관광지를 빠르게 도는 여행보다 바닷가에 머물며 쉬는 일정에 잘 맞아요.', latitude: 37.5131, longitude: 122.1204, image: '/images/cities/weihai.png' },
    { city: '마쓰야마', location: '일본 시코쿠', summary: '도고온천과 오래된 전차가 이어져 차 없이도 천천히 둘러보기 좋아요.', detail: '온천과 성, 오래된 상점가가 가까워 짧은 일정에도 소도시의 분위기를 충분히 느낄 수 있어요.', latitude: 33.8392, longitude: 132.7657, image: '/images/cities/matsuyama.png' },
    { city: '구마모토', location: '일본 규슈', summary: '성과 정원이 도심에 모여 있고, 근교 온천까지 함께 묶기 좋아요.', detail: '후쿠오카와는 다른 차분한 규슈 여행을 원할 때 고르기 좋은 목적지예요.', latitude: 32.8031, longitude: 130.7079, image: '/images/cities/kumamoto.png' },
    { city: '타이중', location: '대만 중부', summary: '시장과 카페를 즐기고 근교 호수와 산지까지 하루 코스로 다녀오기 좋아요.', detail: '도심에서 먹고 쉬는 날과 근교 풍경을 보는 날을 나누기 좋은 도시예요.', latitude: 24.1477, longitude: 120.6736, image: '/images/cities/taichung.png' },
];

export const LIJIANG_DISCOVERY: Discovery = {
    ...DISCOVERIES[0],
    headline: '🧭 리장이 어디냐고요?',
    summary: '골목 끝에 설산이 나오는 곳',
    detail: '해발 2,400m의 오래된 도시 사이로 물길이 흐릅니다. 이름은 낯선데, 풍경은 한 번에 기억납니다.',
};

export const IBARAKI_DISCOVERY: Discovery = {
    headline: '🌊 일본에 이런 바다가?',
    departureCity: '청주',
    departureAirport: 'CJJ',
    city: '이바라키',
    location: '일본 간토',
    summary: '바다에 문을 세워놓은 동네',
    detail: '파도가 치는 바위 위에 신사의 문이 서 있습니다. 오아라이 해안에서는 바다만 찍어도 사진에 문이 하나 들어옵니다.',
    story: [
        '도쿄 이야기는 많이 들어봤어도, 그 위쪽 바닷가는 어떠셨어요? 이바라키는 도쿄 북동쪽, 태평양을 마주한 간토 지역이에요. 유명한 순서대로 여행하면 자꾸 뒤로 밀리는 곳인데, 청주에서 바로 가는 땡처리 항공권이 뜨면 이야기가 달라지죠. 기대 없이 갔다가 제일 오래 남는 여행지, 이바라키가 딱 그런 곳이에요.',
        '오아라이 해안에는 바다 한가운데 바위 위에 선 신사의 돌문, 가미이소 도리이가 있어요. 돌문 사이로 바다가 보이고, 그 아래로 파도가 밀려옵니다. 히타치 해변공원은 계절마다 꽃과 식물의 색이 바뀌어, 언제 가느냐에 따라 전혀 다른 공원을 만나요. 배가 고파지면 나카미나토 수산시장에서 초밥이나 해산물 덮밥 한 그릇, 아이와 함께라면 아쿠아월드 오아라이 수족관까지 더하면 하루가 꽉 차요.',
        '한 가지만 미리 챙겨두세요. 공항에서 각 여행지까지 교통편은 따로 확인이 필요해요. 그 정도 수고는 감수할 만한 바다가 기다리고 있으니까요. 이바라키, 생각 안 해봤던 곳이라 더 궁금하지 않으세요?',
    ],
    latitude: 36.3156,
    longitude: 140.587,
    image: '/images/cities/ibaraki.png',
    imageCaption: '여행지 이해를 돕기 위한 연출 이미지',
};

// Switch the active destination here; retained entries share the same UI and map.
export const WEEKLY_DISCOVERY = IBARAKI_DISCOVERY;

export function matchesDiscoveryFlight(flight: Flight, item: Discovery = WEEKLY_DISCOVERY) {
    return flight.arrival.city.replace(/\([^)]+\)/g, '').trim() === item.city
        && (!item.departureCity || flight.departure.city.includes(item.departureCity)
            || (!!item.departureAirport && flight.departure.airport === item.departureAirport));
}
