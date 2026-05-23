const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const startMarker = 'const getTripcomHotelUrl = ';
const startIdx = code.indexOf(startMarker);
// Find the closing }; of the arrow function
let braceCount = 0;
let endIdx = -1;
for (let i = code.indexOf('{', startIdx); i < code.length; i++) {
    if (code[i] === '{') braceCount++;
    if (code[i] === '}') braceCount--;
    if (braceCount === 0) {
        endIdx = i + 2; // include };
        break;
    }
}

console.log('Start:', startIdx, 'End:', endIdx);
console.log('Old function length:', endIdx - startIdx);

const newFn = `const getTripcomHotelUrl = (arrCity: string, depDate?: string, arrDate?: string, arrAirport?: string): string | null => {
    let cityName = normalizeCity(arrCity);
    const bm = cityName.match(/^(.+?)\\((.+?)\\)$/);
    if (bm) cityName = bm[1];
    let dateParams = '';
    if (depDate) {
        const ci = new Date(depDate);
        const co = new Date(ci);
        co.setDate(co.getDate() + 1);
        const fmt = (d: Date) => d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
        dateParams = 'checkin=' + fmt(ci) + '&checkout=' + fmt(co) + '&';
    }
    // Trip.com SEO slug URL: /hotels/{slug}-hotels-list/
    const en = arrAirport ? IATA_TO_ENGLISH[arrAirport] : null;
    const slug = (en || cityName).toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9\\-]/g, '').replace(/-+/g, '-');
    return 'https://kr.trip.com/hotels/' + slug + '-hotels-list/?' + dateParams + 'Allianceid=' + TRIPCOM_ALLIANCE_ID + '&SID=' + TRIPCOM_SID + '&trip_sub1=&trip_sub3=' + TRIPCOM_HOTEL_SUB3;
};`;

code = code.substring(0, startIdx) + newFn + code.substring(endIdx);
fs.writeFileSync('src/components/Dashboard.tsx', code, 'utf8');
console.log('Done! New function length:', newFn.length);
