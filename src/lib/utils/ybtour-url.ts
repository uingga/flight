import { Flight } from '@/types/flight';

export interface YbtourPassengers {
    adult: number;
    child: number;
    infant: number;
}

const AIRLINE_CODE_MAP: Record<string, string> = {
    '대한항공': 'KE',
    '아시아나항공': 'OZ',
    '제주항공': '7C',
    '진에어': 'LJ',
    '티웨이항공': 'TW',
    '에어부산': 'BX',
    '에어서울': 'RS',
    '이스타항공': 'ZE',
    '에어로케이': 'RF',
};

export function getYbtourBookingUrl(flight: Flight, pax: YbtourPassengers): string {
    const compactDate = (value: string | undefined) => value?.replace(/\D/g, '').slice(0, 8) || '';
    const cityName = (city: string | undefined, airport: string | undefined) => {
        const base = city?.replace(/\([^)]+\)/g, '').trim() || '';
        if (airport === 'ICN' && (base === '서울' || base === '인천')) return '인천';
        if (airport === 'GMP' && (base === '서울' || base === '김포')) return '김포';
        return base;
    };

    const depCode = flight.departure.airport || '';
    const arrCode = flight.arrival.airport || '';
    const depDate = compactDate(flight.departure.date);
    const returnDate = compactDate(flight.arrival.date);
    const depName = cityName(flight.departure.city, depCode);
    const arrName = cityName(flight.arrival.city, arrCode);

    let inhIdAirline = '';
    try {
        const stored = new URL(flight.link || flight.searchLink || '');
        inhIdAirline = (stored.searchParams.get('inhId') || '').match(/^([A-Z0-9]{2})/)?.[1] || '';
    } catch { /* 항공사명 매핑 사용 */ }
    const airlineCode = inhIdAirline || AIRLINE_CODE_MAP[flight.airline] || '';

    if (depCode && arrCode && depDate && returnDate) {
        const now = new Date();
        const today = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
        ].join('');
        const params = new URLSearchParams({
            version: '2',
            adt: String(pax.adult),
            chd: String(pax.child),
            inf: String(pax.infant),
            comp: 'Y',
            comp_nm: '',
            dayInd: 'N',
            trip: 'RT',
            STEP: '',
            startlocal: 'Y',
            daySeq: '0',
            retdate: returnDate,
            md_count: '2',
            prefCarArry: airlineCode,
            prefStsArry: 'ALL',
            prefViaArry: 'ALL',
            returnUnfix: 'N',
            val: '',
            plusDate: '',
            strDateSearch: depDate.slice(0, 6),
            BookableDate: today,
            CabinClass: '',
            activedMulti: 'invY',
            arrapo_count: '2',
            clearapo: 'Y',
            firstFlag: 'Y',
            AdultCount: String(pax.adult),
            YoungCount: '0',
            ChildCount: String(pax.child),
            dep0: depCode,
            dep0_text: depName,
            arr0: arrCode,
            arr0_text: arrName,
            depdate0: depDate,
            'DepApo[0]': depCode,
            'DepApo_name[0]': depName,
            'ArrApo[0]': arrCode,
            'ArrApo_name[0]': arrName,
            'DepDate[0]': depDate,
            dep1: arrCode,
            dep1_text: arrName,
            arr1: depCode,
            arr1_text: depName,
            depdate1: returnDate,
            'DepApo[1]': arrCode,
            'DepApo_name[1]': arrName,
            'ArrApo[1]': depCode,
            'ArrApo_name[1]': depName,
            'DepDate[1]': returnDate,
            startArea: 'Y',
            defaultDate: today,
            LengthOfStay: '',
            RtnOpenInd: 'N',
            kayakclickid: '',
            via0: '',
            noViaSearch: 'N',
            freebag: '',
        });
        return `https://mfly.ybtour.co.kr/mobile/fr/booking/findMainFareMobile.lts?${params.toString()}`;
    }

    // 오래된 데이터에 공항이나 귀국일이 없을 때만 기존 땡처리 목록으로 이동한다.
    return flight.link || flight.searchLink || 'https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV';
}
