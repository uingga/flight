const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'blog-post-08.html');
let html = fs.readFileSync(filePath, 'utf-8');

// Add <hr class="divider"> between city card closing </div> and next <!-- city --> comment
html = html.replace(/<\/div>\n\n        <!-- (\S)/g, '</div>\n\n        <hr class="divider">\n\n        <!-- $1');

fs.writeFileSync(filePath, html, 'utf-8');
console.log('Done! Added dividers between city cards.');
