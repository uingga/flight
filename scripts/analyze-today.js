const fs = require('fs');
const flights = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
const now = new Date();

// Filter valid future flights with price
const valid = flights.filter(f => new Date(f.departureDate) > now && f.price > 0);
console.log('Total valid flights:', valid.length);
console.log('Sources:', [...new Set(valid.map(f => f.source))]);

const icn = valid.filter(f => f.departure === 'ICN');
const others = valid.filter(f => f.departure !== 'ICN');
console.log('ICN flights:', icn.length);
console.log('Non-ICN flights:', others.length);

// Unique departures
console.log('Departure airports:', [...new Set(valid.map(f => f.departure))]);

// Sort by discount rate
const sorted = valid.sort((a, b) => b.discountRate - a.discountRate);

console.log('\n=== TOP 30 by discount rate ===');
sorted.slice(0, 30).forEach((f, i) => {
  console.log(`${i + 1}. [${f.source}] ${f.departure}→${f.arrivalCity || f.arrival} | ${f.departureDate}~${f.returnDate} | ${f.price.toLocaleString()}원 (${f.discountRate}%↓) | ${f.airline}`);
});

console.log('\n=== ICN TOP 20 by discount rate ===');
const icnSorted = icn.sort((a, b) => b.discountRate - a.discountRate);
icnSorted.slice(0, 20).forEach((f, i) => {
  console.log(`${i + 1}. [${f.source}] ICN→${f.arrivalCity || f.arrival} | ${f.departureDate}~${f.returnDate} | ${f.price.toLocaleString()}원 (${f.discountRate}%↓) | ${f.airline}`);
});

console.log('\n=== Non-ICN TOP 15 by discount rate ===');
const otherSorted = others.sort((a, b) => b.discountRate - a.discountRate);
otherSorted.slice(0, 15).forEach((f, i) => {
  console.log(`${i + 1}. [${f.source}] ${f.departure}→${f.arrivalCity || f.arrival} | ${f.departureDate}~${f.returnDate} | ${f.price.toLocaleString()}원 (${f.discountRate}%↓) | ${f.airline}`);
});

// Show price range overview
console.log('\n=== Price ranges ===');
const under20 = valid.filter(f => f.price < 200000).length;
const under30 = valid.filter(f => f.price >= 200000 && f.price < 300000).length;
const under40 = valid.filter(f => f.price >= 300000 && f.price < 400000).length;
const over40 = valid.filter(f => f.price >= 400000).length;
console.log(`Under 20만: ${under20}, 20-30만: ${under30}, 30-40만: ${under40}, Over 40만: ${over40}`);
