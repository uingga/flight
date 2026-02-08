export interface Flight {
    id: string;
    source: 'ttang' | 'ybtour' | 'modetour' | 'hanatour' | 'onlinetour';
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
}

export interface FlightSearchParams {
    departureCity?: string;
    arrivalCity?: string;
    minPrice?: number;
    maxPrice?: number;
    sortBy?: 'price' | 'date' | 'airline';
    sortOrder?: 'asc' | 'desc';
}
