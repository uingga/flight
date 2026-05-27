const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf-8'));
const skip = ['지난', '후쿠오카', '시즈오카', '세부', '미야코지마', '괌', '오사카', '마나도', '코타키나발루'];
const flights = d.flights.filter(f => f.price > 0 && !skip.some(s => (f.arrival?.city || '').includes(s)));
flights.sort((a, b) => a.price - b.price);
const seen = new Set();
let i = 0;
for (const f of flights) {
    const dest = f.arrival?.city;
    if (!dest || seen.has(dest)) continue;
    seen.add(dest);
    i++;
    if (i > 12) break;
    const dep = f.departure?.city || '';
    const isICN = (dep === '인천' || dep === '서울' || dep === '김포') ? '[수도권]' : '[지방]';
    console.log(i + '. ' + dest + ' | ' + dep + ' | ' + f.airline + ' | ' + f.price.toLocaleString() + '원 | ' + f.departure?.date + ' ' + isICN);
}
