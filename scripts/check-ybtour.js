var fs = require('fs');
var data = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
var yb = data.filter(function (f) { return f.source === 'ybtour'; });
console.log('YBTour total:', yb.length);
for (var i = 0; i < Math.min(yb.length, 10); i++) {
    var f = yb[i];
    console.log((i + 1) + '. ' + f.airline + ' ' + f.departure.city + ' > ' + f.arrival.city + ' | dep:' + f.departure.date + ' | ret:' + f.arrival.date + ' | ' + f.price);
}
var noDate = yb.filter(function (f) { return !f.departure.date || !f.arrival.date; });
console.log('Missing dates:', noDate.length);
