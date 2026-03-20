const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'blog-post-08.html');
let html = fs.readFileSync(filePath, 'utf-8');

const cities = ['osaka', 'danang', 'fukuoka', 'bangkok', 'taipei', 'nhatrang', 'cebu', 'tokyo', 'qingdao', 'guam'];
const cityNames = ['오사카', '다낭', '후쿠오카', '방콕', '타이페이', '나트랑', '세부', '도쿄', '칭다오', '괌'];

// Replace each mini-table with its image
const miniTableRegex = /<table class="mini-table">[\s\S]*?<\/table>/g;
let matchIndex = 0;
html = html.replace(miniTableRegex, (match) => {
    if (matchIndex < cities.length) {
        const city = cities[matchIndex];
        const name = cityNames[matchIndex];
        matchIndex++;
        return `<p><img src="images/blog08-mini-${city}.png" alt="${name} 물가 참고표" style="width: 100%; border-radius: 8px;"></p>`;
    }
    return match;
});
console.log(`✅ Replaced ${matchIndex} mini-tables`);

// Replace the bottom cost table (the remaining <table> ... </table> that is NOT an image)
// After removing main table, there should be one table left
const costTableRegex = /(<h2 class="center">💰 항공권 \+ 숙박비 비용 비교[\s\S]*?)<table>[\s\S]*?<\/table>/;
html = html.replace(costTableRegex, (match, prefix) => {
    console.log('✅ Replaced cost table');
    return prefix + '<p><img src="images/blog08-cost.png" alt="항공권+숙박비 비용 비교표" style="width: 100%; border-radius: 8px;"></p>';
});

fs.writeFileSync(filePath, html, 'utf-8');
console.log('\n🎉 All tables replaced with images!');
