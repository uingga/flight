export interface Flight {
    id: string;
    source: 'ybtour' | 'modetour' | 'hanatour' | 'onlinetour' | 'ttang' | 'myrealtrip';
    airline: string;
    departure: {
        city: string;
        airport: string;
        date: string;
        time: string;
        arrivalTime?: string; // 가는편 현지 도착시간 (ttang/ybtour는 realtime 보강, onlinetour는 목록 파싱)
    };
    arrival: {
        city: string;
        airport: string;
        date: string;
        time: string;      // 오는편 출발시간
        arrivalTime?: string; // 오는편 도착시간
    };
    price: number;
    currency: string;
    link: string;
    availableSeats?: number;
    seats?: string;
    flightNumber?: string;
    /** 최소 탑승 인원. 2 이상이면 1인으로는 예약할 수 없다 (노랑풍선 상세에서 수집). */
    minPax?: number;
    region?: string;
    searchLink?: string;
    discountRate?: number; // 서울(인천·김포) 출발만 인터파크 최저가 대비 할인율 (%); 지방 출발은 0
    naverLowest?: number;  // 네이버 항공권 최저가 (동일 구간+날짜)
    naverCheckedAt?: string; // 네이버 동일 구간+날짜 가격을 확인한 시각
    nearbyNaverBaseline?: number; // 최근 60일에 확인한 같은 노선·출발일 앞뒤 14일 네이버 가격 중간값
    nearbyNaverSampleCount?: number; // 같은 노선·출발일 앞뒤 14일 표본 수 (1~14일 동일 가중치, 여행 기간 제한 없음)
    nearbyNaverRecommendationMultiplier?: number; // 날짜 프리미엄에 따른 느슨한 추천 감점
    nearbyNaverTodayPickExcluded?: boolean; // 인접 기준보다 30%·5만원 이상 비싸 오늘의 표에서 제외
    priceCheckedAt?: string; // 해당 여행사 가격을 마지막으로 정상 확인한 시각
    detailCheckedAt?: string; // 시간·좌석 등 상세 정보를 마지막으로 정상 확인한 시각
    firstSeen?: string; // 이 항공권을 캐시에서 처음 발견한 날짜
    /** 땡처리닷컴에서 동일 노선·날짜의 서로 다른 실제 요금 상품을 구분한다. */
    ttangProduct?: {
        masterId: string;
        fareId: string; // 목록/일정 API의 hanaFareId
        tripDayLabel?: string; // 원문 검토용. 화면 숙박일수 계산에는 사용하지 않는다.
    };
    /** 예약 결과에서 확인한 실제 가는편·오는편 공항. 도시 검색 코드를 공항으로 오인하지 않기 위해 사용한다. */
    routeAirports?: {
        outboundDeparture: string;
        outboundArrival: string;
        returnDeparture: string;
        returnArrival: string;
    };

    // 모두투어 상세 정보 (선택적 — 모두투어 소스에서만 사용)
    modetourDetail?: {
        flyingTime?: string;           // 가는편 비행시간 (예: "02:30")
        returnFlyingTime?: string;     // 오는편 비행시간
        isDirect?: boolean;            // 가는편 직항 여부
        isReturnDirect?: boolean;      // 오는편 직항 여부
        departureArrivalTime?: string; // 가는편 도착시간
        returnDepartureTime?: string;  // 오는편 출발시간
        returnArrivalTime?: string;    // 오는편 도착시간
        normalPrice?: number;          // 정상가
        sourceDiscountRate?: number;   // 모두투어 자체 할인율 (%)
        baseFare?: number;             // 성인 항공료 (세금 제외)
        tax?: number;                  // 유류할증료
        tax2?: number;                 // 제세공과금
        childBaseFare?: number;        // 소아 항공료
        childTax?: number;             // 소아 유류할증
        childTax2?: number;            // 소아 제세공과금
        infantFare?: number;           // 유아 요금
        departureFlightNo?: string;    // 가는편 편명 (예: "BX1645")
        returnFlightNo?: string;       // 오는편 편명 (예: "BX1635")
        returnDepartureAirport?: string; // 귀국편 출발 공항코드
        returnArrivalAirport?: string;   // 귀국편 도착 공항코드
    };

}


export interface FlightSearchParams {
    departureCity?: string;
    arrivalCity?: string;
    minPrice?: number;
    maxPrice?: number;
    sortBy?: 'price' | 'date' | 'airline';
    sortOrder?: 'asc' | 'desc';
}
