// Seed price history from current cache data with simulated 7-day history
const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, '..', 'data', 'all-flights-cache.json');
const historyPath = path.join(__dirname, '..', 'data', 'price-history.json');

const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
const history = {};

// Group by route
const routePrices = {};
cache.flights.forEach(f => {
    const route = `${f.departure.city}-${f.arrival.city}`;
    if (f.price > 0) {
        if (!routePrices[route]) routePrices[route] = [];
        routePrices[route].push(f.price);
    }
});

// Generate 7 days of simulated history
const today = new Date();
Object.entries(routePrices).forEach(([route, prices]) => {
    const minPrice = Math.min(...prices);
    const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

    history[route] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        // Simulate slight price variation (±5%)
        const variation = 1 + (Math.random() * 0.10 - 0.05);
        const dayMin = Math.round(minPrice * variation);
        const dayAvg = Math.round(avgPrice * variation);

        history[route].push({
            date: dateStr,
            minPrice: dayMin,
            avgPrice: dayAvg,
            count: prices.length,
        });
    }
});

fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
console.log(`Seeded ${Object.keys(history).length} routes with 7-day history`);
