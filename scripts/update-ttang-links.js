const fs = require('fs');
const path = require('path');

// Read the ttang cache file
const cacheFilePath = path.join(__dirname, '../data/ttang-cache.json');
const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));

console.log(`Found ${cacheData.flights.length} flights in cache`);

// Update each flight's link
let updatedCount = 0;
cacheData.flights.forEach(flight => {
    const oldLink = flight.link;

    // Extract destination code from the old link
    const arrMatch = oldLink.match(/arr0=([A-Z]{3})/);
    const depMatch = oldLink.match(/dep0=([A-Z]{3})/);

    if (arrMatch && depMatch) {
        const arrCode = arrMatch[1];
        const depCode = depMatch[1];

        // Create new search list link
        const newLink = `https://mm.ttang.com/ttangair/search/city/list.do?trip=RT&dep0=${depCode}&arr0=${arrCode}&adt=1&chd=0&inf=0&comp=Y&viaType=2&fareType=A`;

        flight.link = newLink;
        updatedCount++;
    }
});

// Update timestamp
cacheData.timestamp = new Date().toISOString();

// Write back to file
fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');

console.log(`✅ Updated ${updatedCount} flight links`);
console.log(`📝 Cache file updated: ${cacheFilePath}`);
