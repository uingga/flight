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
    seats?: string;
    flightNumber?: string;
    region?: string;
    searchLink?: string;
    discountRate?: number; // 인터파크 최저가 대비 할인율 (%)

}

export interface FlightSearchParams {
    departureCity?: string;
    arrivalCity?: string;
    minPrice?: number;
    maxPrice?: number;
    sortBy?: 'price' | 'date' | 'airline';
    sortOrder?: 'asc' | 'desc';
}
