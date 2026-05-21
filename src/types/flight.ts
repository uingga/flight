export interface Flight {
    id: string;
    source: 'ybtour' | 'modetour' | 'hanatour' | 'onlinetour' | 'ttang' | 'myrealtrip';
    airline: string;
    departure: {
        city: string;
        airport: string;
        date: string;
        time: string;
    };
    arrival: {
        city: string;
        airport: string;
        date: string;
        time: string;
    };
    price: number;
    currency: string;
    link: string;
    availableSeats?: number;
    seats?: string;
    flightNumber?: string;
    region?: string;
    searchLink?: string;
    discountRate?: number; // 인터파크 최저가 대비 할인율 (%)

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
