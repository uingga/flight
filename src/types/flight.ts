export interface Flight {
    id: string;
    source: 'ybtour' | 'modetour' | 'hanatour' | 'onlinetour' | 'ttang';
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
    flightNumber?: string;
    region?: string;
    searchLink?: string;
    mobileFareId?: string;  // 모바일 전용 fareId (UUID 형식, 하나투어)
}

export interface FlightSearchParams {
    departureCity?: string;
    arrivalCity?: string;
    minPrice?: number;
    maxPrice?: number;
    sortBy?: 'price' | 'date' | 'airline';
    sortOrder?: 'asc' | 'desc';
}
