const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./data/all-flights-cache.json', 'utf8'));
const tsx = fs.readFileSync('./src/components/Dashboard.tsx', 'utf8');

const cities = [...new Set(d.flights.map(f => f.arrival.city))];
const missing = [];

for (const city of cities) {
    // normalizeCity 적용 후의 이름으로도 확인
    let normalized = city.trim();
    const codeMatch = normalized.match(/^(.+?)\(([A-Z]{3})\)$/);
    if (codeMatch) normalized = codeMatch[1];
    const krMatch = normalized.match(/^(.+?)\((.+?)\)$/);
    if (krMatch) normalized = krMatch[1];

    if (!tsx.includes(`'${city}'`) && !tsx.includes(`'${normalized}'`)) {
        missing.push(city);
    }
}
console.log('CITY_TO_AIRPORT에 없을 수 있는 도시:');
missing.forEach(c => console.log(' ', c));
