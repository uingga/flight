const fs = require('fs');
const path = require('path');

const allPath = path.join(__dirname, '..', 'data', 'all-flights-cache.json');
const mdtPath = path.join(__dirname, '..', 'data', 'modetour-cache.json');

const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
const mdt = JSON.parse(fs.readFileSync(mdtPath, 'utf8'));

const nonModetour = all.flights.filter(f => f.source !== 'modetour');
const merged = [...nonModetour, ...mdt.flights];

all.flights = merged;
all.count = merged.length;
all.sources = all.sources || {};
all.sources.modetour = mdt.flights.length;
all.lastUpdated = new Date().toISOString();

fs.writeFileSync(allPath, JSON.stringify(all, null, 2));

const withDetail = mdt.flights.filter(f => f.modetourDetail).length;
console.log('Total:', merged.length, '| Modetour:', mdt.flights.length, '| With detail:', withDetail);
