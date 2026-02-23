
const fs = require('fs');
if (!fs.existsSync('./data/crawl-log.json')) {
  console.log('crawl-log.json not found');
  process.exit(0);
}
const logData = JSON.parse(fs.readFileSync('./data/crawl-log.json', 'utf8'));

// Find the most recent entry with errors
const entryWithErrors = logData.entries.slice().reverse().find(e => e.alerts && e.alerts.length > 0 || (e.sites && Object.values(e.sites).some(s => s.error)));

if (!entryWithErrors) {
   console.log('No recent errors found in crawl-log.json');
} else {
   console.log('Timestamp:', entryWithErrors.timestamp);
   console.log('Alerts:', entryWithErrors.alerts);
   for (const [site, data] of Object.entries(entryWithErrors.sites)) {
       if (data.error) console.log('Site Error ('+site+'):', data.error);
   }
}

// Just print the very last entry
console.log('\n--- Very Last Entry ---');
const last = logData.entries[logData.entries.length - 1];
console.log('Timestamp:', last.timestamp);
if (last.alerts) console.log('Alerts:', last.alerts);
for (const [site, data] of Object.entries(last.sites)) {
   if (data.error) console.log('Site Error ('+site+'):', data.error);
}

