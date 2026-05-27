const fs = require('fs');
let content = fs.readFileSync('public/blog-post-01.html', 'utf8');
content = content.replace(
    /            <p>👇 <b>오늘 마감되기 전에 특가 확인하기<\/b> \r?\n            <a href="https:\/\/tikitikit\.kr" class="cta-button">티키티킷 실시간 특가 검색 👉<\/a>/,
    '            <div style="margin-top: 40px;">\n                <p>✈️ <a href="https://tikitikit.kr" style="color: #4f46e5; text-decoration: underline; font-weight: bold;">티키티킷(TikiTikit) 특가 항공권 검색해보기</a></p>\n            </div>'
);
content = content.replace(
    /            <p>👇 <b>오늘 마감되기 전에 특가 확인하기<\/b> \uFFFD<\/p>\r?\n            <a href="https:\/\/tikitikit\.kr" class="cta-button">티키티킷 실시간 특가 검색 👉<\/a>/,
    '            <div style="margin-top: 40px;">\n                <p>✈️ <a href="https://tikitikit.kr" style="color: #4f46e5; text-decoration: underline; font-weight: bold;">티키티킷(TikiTikit) 특가 항공권 검색해보기</a></p>\n            </div>'
);
content = content.replace(
    /            <p>👇 <b>오늘 마감되기 전에 특가 확인하기<\/b> .*?<\/p>\r?\n            <a href="https:\/\/tikitikit\.kr" class="cta-button">티키티킷 실시간 특가 검색 👉<\/a>/,
    '            <div style="margin-top: 40px;">\n                <p>✈️ <a href="https://tikitikit.kr" style="color: #4f46e5; text-decoration: underline; font-weight: bold;">티키티킷(TikiTikit) 특가 항공권 검색해보기</a></p>\n            </div>'
);
fs.writeFileSync('public/blog-post-01.html', content);
console.log('Replaced successfully.');
