const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
const ot = d.flights.filter(f => f.source === 'onlinetour');
console.log('OnlineTour:', ot.length);
console.log('\nSample:');
ot.slice(0, 3).forEach(f => {
    console.log(f.departure.city + ' > ' + f.arrival.city + ' | ' + f.price);
    console.log('  link: ' + f.link);
    console.log('  searchLink: ' + (f.searchLink || 'NONE'));
});
const withSearch = ot.filter(f => f.searchLink);
const withEvent = ot.filter(f => f.link?.includes('eventCode'));
console.log('\nwithSearchLink:', withSearch.length);
console.log('withEventCode:', withEvent.length);
