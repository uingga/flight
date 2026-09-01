const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
const flights = Array.isArray(raw) ? raw : raw.flights || [];
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const airport = flight => String(flight.departure?.airport || '').toUpperCase();
const isSeoulDeparture = flight => ['ICN', 'GMP'].includes(airport(flight));
const interparkDiscount = flight => isSeoulDeparture(flight)
  ? Math.max(0, Number(flight.discountRate || 0))
  : 0;
const valid = flights.filter(flight => (
  String(flight.departure?.date || '').slice(0, 10) >= today && Number(flight.price) > 0
));
const seoul = valid.filter(isSeoulDeparture);
const regional = valid.filter(flight => !isSeoulDeparture(flight));

console.log('Total valid flights:', valid.length);
console.log('Sources:', [...new Set(valid.map(flight => flight.source))]);
console.log('Seoul flights:', seoul.length);
console.log('Regional flights:', regional.length);
console.log('Departure airports:', [...new Set(valid.map(airport))]);

console.log('\n=== 서울 출발 인터파크 할인율 TOP 30 ===');
seoul
  .sort((a, b) => interparkDiscount(b) - interparkDiscount(a))
  .slice(0, 30)
  .forEach((flight, index) => {
    console.log(
      `${index + 1}. [${flight.source}] ${airport(flight)}→${flight.arrival?.city || flight.arrival?.airport}`
      + ` | ${flight.departure?.date}~${flight.arrival?.date} | ${Number(flight.price).toLocaleString()}원`
      + ` (${interparkDiscount(flight)}%↓) | ${flight.airline}`,
    );
  });

console.log('\n=== 지방 출발 (인터파크 서울 기준 할인율 미적용) ===');
regional
  .sort((a, b) => Number(a.price) - Number(b.price))
  .slice(0, 20)
  .forEach((flight, index) => {
    console.log(
      `${index + 1}. [${flight.source}] ${airport(flight)}→${flight.arrival?.city || flight.arrival?.airport}`
      + ` | ${flight.departure?.date}~${flight.arrival?.date} | ${Number(flight.price).toLocaleString()}원`
      + ` | ${flight.airline}`,
    );
  });

console.log('\n=== Price ranges ===');
const under20 = valid.filter(flight => flight.price < 200_000).length;
const under30 = valid.filter(flight => flight.price >= 200_000 && flight.price < 300_000).length;
const under40 = valid.filter(flight => flight.price >= 300_000 && flight.price < 400_000).length;
const over40 = valid.filter(flight => flight.price >= 400_000).length;
console.log(`Under 20만: ${under20}, 20-30만: ${under30}, 30-40만: ${under40}, Over 40만: ${over40}`);
